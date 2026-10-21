#!/usr/bin/env node
import { readFile, readdir, lstat, realpath, mkdir, writeFile, rename, unlink, open } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { normalizeDrop, digest, ghRequest, publishRecords, DEFAULT_REPO, MAX_BYTES } from './desktop-inbox.mjs'

export const DEFAULT_FOLDER = fileURLToPath(new URL('../../Forgeboard Inbox/', import.meta.url))
const APP_FOLDER = fileURLToPath(new URL('../', import.meta.url))
const CONTROL = '_bridge'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('Bridge state could not be read. Original inbox files are unchanged.') } }
async function writeJson(path, value) { const tmp = `${path}.${randomUUID()}.tmp`; await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(tmp, path) }
const inside = (root, target) => { const rel = relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel)) }

export async function prepareFolder(folder) {
  const absolute = resolve(folder)
  if (inside(resolve(APP_FOLDER), absolute)) throw new Error('Use an inbox OUTSIDE the public app/code repository.')
  await mkdir(absolute, { recursive: true })
  if ((await lstat(absolute)).isSymbolicLink()) throw new Error('Use an ordinary inbox folder, not a link or junction.')
  const root = await realpath(absolute), control = join(root, CONTROL)
  if (inside(await realpath(APP_FOLDER), root)) throw new Error('The resolved inbox must remain outside the public app repository.')
  await mkdir(control, { recursive: true })
  if ((await lstat(control)).isSymbolicLink() || !inside(root, await realpath(control))) throw new Error('Bridge control folder must stay inside the inbox.')
  return { root, control }
}

export async function scanOnce(folder, state, publish, now = Date.now()) {
  const { root } = await prepareFolder(folder)
  state.entries ??= {}
  let sent = 0
  for (const item of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/\.(json|md)$/i.test(item.name) || /^(README|FORGEBOARD_INSTRUCTIONS)\.md$/i.test(item.name)) continue
    const path = join(root, item.name)
    if (item.isSymbolicLink()) { state.entries[item.name] = { phase: 'error', error: 'Links are not followed. Save a real handoff file in this folder.' }; continue }
    if (!item.isFile()) continue
    const stat = await lstat(path)
    if (stat.size > MAX_BYTES) { state.entries[item.name] = { phase: 'error', error: 'File exceeds 200 KB. Write a shorter handoff.' }; continue }
    if (!inside(root, await realpath(path))) continue
    const text = await readFile(path, 'utf8'), hash = digest(text)
    let entry = state.entries[item.name]
    if (!entry || entry.hash !== hash) {
      entry = state.entries[item.name] = { hash, phase: 'settling', since: now, fileTime: stat.mtime.toISOString(), attempts: 0 }
      continue
    }
    if (entry.phase === 'sent' || entry.phase === 'invalid' || now - entry.since < 2000 || entry.retryAt > now || sent >= 3) continue
    try { entry.records ??= normalizeDrop(text, item.name, entry.fileTime) }
    catch (error) { entry.phase = 'invalid'; entry.error = error.message; continue }
    // Do not send a snapshot while the source is still changing.
    if (digest(await readFile(path, 'utf8')) !== hash) { delete state.entries[item.name]; continue }
    try {
      const result = await publish(entry.records)
      Object.assign(entry, { phase: 'sent', sentAt: new Date(now).toISOString(), commit: result.commit, error: undefined, retryAt: undefined, records: undefined })
      sent++
    } catch (error) {
      entry.attempts++
      Object.assign(entry, { phase: 'error', error: error.message, retryAt: now + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 5)) })
    }
  }
  return { sent, totalSent: Object.values(state.entries).filter((entry) => entry.phase === 'sent').length, pending: Object.values(state.entries).filter((entry) => ['settling', 'error'].includes(entry.phase)).length, errors: Object.entries(state.entries).filter(([, entry]) => ['error', 'invalid'].includes(entry.phase)).map(([file, entry]) => ({ file, message: entry.error })) }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
export async function watch(folder, repository) {
  const { root, control } = await prepareFolder(folder)
  const statePath = join(control, 'receipts.json'), statusPath = join(control, 'status.json')
  const state = await readJson(statePath, { entries: {} })
  if (state.repository && state.repository !== repository) throw new Error('This inbox belongs to another repository. Use a different inbox folder.')
  state.repository = repository
  for (const entry of Object.values(state.entries ?? {})) if (entry.phase === 'error') delete entry.retryAt
  const lockPath = join(control, 'watcher.lock'), session = randomUUID()
  let handle
  try { handle = await open(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const previous = await readJson(lockPath, {})
    if (!previous.pid || alive(previous.pid)) throw new Error('A bridge may already be running. Use Status or Stop; do not launch duplicate watchers.')
    await rename(lockPath, join(control, `stale-lock-${Date.now()}.json`))
    handle = await open(lockPath, 'wx', 0o600)
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, session, folder: root, repository, startedAt: new Date().toISOString() }))
  await handle.close()
  let stopping = false
  process.on('SIGINT', () => { stopping = true })
  process.on('SIGTERM', () => { stopping = true })
  const request = ghRequest(repository)
  let status = { running: true, repository, folder: root, pid: process.pid }
  try {
    while (!stopping) {
      const stop = await readJson(join(control, 'stop.json'), {})
      if (stop.session === session) break
      try {
        const result = await scanOnce(root, state, (records) => publishRecords(records, request))
        await writeJson(statePath, state)
        status = { ...status, ...result, running: true, checkedAt: new Date().toISOString() }
        await writeJson(statusPath, status)
        if (result.sent) console.log(`Sent ${result.sent} handoff file(s) to the private vault. Originals remain in the inbox.`)
      } catch (error) {
        status = { ...status, running: true, error: error.message, checkedAt: new Date().toISOString() }
        await writeJson(statusPath, status)
      }
      await sleep(5000)
    }
  } finally {
    await writeJson(statePath, state)
    await writeJson(statusPath, { ...status, running: false, stoppedAt: new Date().toISOString() })
    if ((await readJson(lockPath, {})).session === session) await unlink(lockPath)
  }
}

export async function start(folder, repository, { openApp = true } = {}) {
  const { root, control } = await prepareFolder(folder)
  const lock = await readJson(join(control, 'watcher.lock'), {})
  if (lock.pid && alive(lock.pid) && lock.repository !== repository) throw new Error('This inbox already watches another repository. Use a different folder.')
  if (lock.pid && alive(lock.pid)) console.log('Forgeboard inbox bridge is already running.')
  else {
    const log = openSync(join(control, 'bridge.log'), 'a', 0o600)
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', '--folder', root, '--repo', repository], { detached: true, windowsHide: true, stdio: ['ignore', log, log] })
    child.unref(); closeSync(log)
    let ready = false
    for (let i = 0; i < 30; i++) { await sleep(100); const current = await readJson(join(control, 'watcher.lock'), {}); if (current.pid === child.pid) { ready = true; break } }
    if (!ready) throw new Error('Bridge did not start. Check _bridge/bridge.log in the inbox.')
    console.log(`Forgeboard inbox bridge started. Folder: ${root}`)
  }
  if (openApp) {
    const url = 'https://trevormw20.github.io/forgeboard-studio/'
    const child = process.platform === 'win32' ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' }) : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => console.log(`Open Forgeboard at ${url}`)); child.unref()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command = 'start', ...args] = process.argv.slice(2)
  const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1] }
  const folder = option('folder', DEFAULT_FOLDER), repository = option('repo', DEFAULT_REPO)
  try {
    if (command === 'start') await start(folder, repository, { openApp: !args.includes('--no-open') })
    else if (command === 'watch') await watch(folder, repository)
    else if (command === 'once') {
      const { control } = await prepareFolder(folder), statePath = join(control, 'receipts.json')
      const lock = await readJson(join(control, 'watcher.lock'), {})
      if (lock.pid && alive(lock.pid)) throw new Error('The inbox bridge is running. It will send this file automatically; do not run a second scan.')
      const state = await readJson(statePath, { entries: {} })
      if (state.repository && state.repository !== repository) throw new Error('This inbox belongs to another repository.')
      state.repository = repository
      const request = ghRequest(repository)
      await scanOnce(folder, state, (records) => publishRecords(records, request))
      await sleep(2100)
      console.log(JSON.stringify(await scanOnce(folder, state, (records) => publishRecords(records, request)), null, 2))
      await writeJson(statePath, state)
    } else if (command === 'stop') {
      const { control } = await prepareFolder(folder), lock = await readJson(join(control, 'watcher.lock'), {})
      if (!lock.session || !alive(lock.pid)) console.log('Bridge is not running.')
      else { await writeJson(join(control, 'stop.json'), { session: lock.session }); console.log('Stop requested. Queued and original files will be kept.') }
    } else if (command === 'status') {
      const { control } = await prepareFolder(folder)
      const status = await readJson(join(control, 'status.json'), { running: false }), lock = await readJson(join(control, 'watcher.lock'), {})
      console.log(JSON.stringify({ ...status, running: Boolean(lock.pid && alive(lock.pid)) }, null, 2))
    } else throw new Error('Use start, stop, status, or once [--folder ABSOLUTE_FOLDER] [--repo OWNER/PRIVATE_VAULT].')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
