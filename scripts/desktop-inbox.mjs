import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseSubmission, parseCoordination } from '../runtime/inbox-core.mjs'

export const DEFAULT_REPO = 'trevormw20/forgeboard-studio-vault'
export const MAX_BYTES = 200000
export const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
export const digest = (value) => createHash('sha256').update(value).digest('hex')
const noMetadata = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each update must be a Forgeboard object.')
  const { desktopDelivery: _delivery, ...record } = value
  return record
}
const blobSha = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')

function markdownRecords(text, now, fileName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error('Markdown needs the Forgeboard metadata block. Use FORGEBOARD_INSTRUCTIONS.md in the inbox.')
  const meta = {}
  for (const line of match[1].split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'))) {
    const field = /^([a-z_]+):\s*(.*?)\s*$/.exec(line)
    if (!field || Object.hasOwn(meta, field[1])) throw new Error('Use unique, simple key: value metadata fields.')
    let value = field[2]
    if (value.startsWith('"')) { try { value = JSON.parse(value) } catch { throw new Error('Invalid quoted metadata value.') } }
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    Object.defineProperty(meta, field[1], { value, enumerable: true })
  }
  if (String(meta.forgeboard) !== '1' || !meta.id || !meta.project || !meta.date) throw new Error('Markdown needs forgeboard: 1, id, project, and date.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date) || !Number.isFinite(Date.parse(`${meta.date}T00:00:00Z`)) || new Date(`${meta.date}T00:00:00Z`).toISOString().slice(0, 10) !== meta.date) throw new Error('Use a real calendar date in YYYY-MM-DD format.')
  const body = match[2].trim()
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? meta.summary
  const steps = [...body.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map((step, index) => ({ id: `step-${index + 1}`, title: step[1].trim() }))
  const records = []
  if (steps.length) {
    const completedSection = /##\s+(?:Completed|What changed)\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/i.exec(body)?.[1] ?? ''
    const completedWork = [...completedSection.matchAll(/^\s*[-*]\s+(?!\[)(.+)$/gm)].map((line) => line[1].trim())
    records.push({ format: 'forgeboard-task', version: 1, id: meta.id, project: meta.project, date: meta.date, summary: title, notes: body, priority: meta.priority ?? 'medium', board: meta.board ?? 'myTodo', subtasks: steps, handoff: { agent: meta.agent ?? 'other', source: fileName, completedWork, review: meta.review ?? 'Review the unchecked steps and record the results.', resume: meta.next_action ?? 'Start with the first unchecked step.' } })
  }
  if (meta.chat_id) records.push({ format: 'forgeboard-status', version: 1, id: `status-${digest(`${meta.id}:${meta.chat_id}`).slice(0, 32)}`, project: meta.project, at: meta.at ?? now, chat: { id: meta.chat_id, name: meta.chat_name ?? meta.chat_id, agent: meta.agent ?? 'other', source: fileName }, status: meta.status, summary: title, ...(meta.next_action ? { nextAction: meta.next_action } : {}) })
  if (!records.length) throw new Error('Include unchecked review steps, or chat_id and status for a status-only report.')
  return records
}

export function normalizeDrop(text, fileName, at = new Date().toISOString()) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('File exceeds 200 KB. Write a shorter handoff.')
  if (/(?:sk-(?:ant-|proj-)[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9]{15,}|github_pat_[a-zA-Z0-9_]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text)) throw new Error('Possible credential found. Nothing was sent; remove credentials from the handoff.')
  let value
  if (extname(fileName).toLowerCase() === '.md') value = markdownRecords(text, at, basename(fileName))
  else {
    try { value = JSON.parse(text.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) }
    catch { throw new Error('Invalid JSON. File kept locally; the bridge will try again after it changes.') }
  }
  const records = (Array.isArray(value) ? value : [value]).map(noMetadata)
  if (!records.length || records.length > 25) throw new Error('Use 1–25 update objects per file.')
  const ids = new Set()
  for (const record of records) {
    if (record.format === 'forgeboard-task') parseSubmission(JSON.stringify(record))
    else if (['forgeboard-status', 'forgeboard-project'].includes(record.format)) parseCoordination(record)
    else throw new Error('Only Forgeboard tasks, chat statuses, and project registrations are accepted.')
    if (ids.has(record.id)) throw new Error('Every record in a file needs a different id.')
    ids.add(record.id)
  }
  if (new Set(records.map((record) => record.project.trim().toLowerCase())).size !== 1) throw new Error('Use a separate file per project, so projects cannot be mixed.')
  const id = `desktop-${digest(stable(records)).slice(0, 32)}`
  const desktopDelivery = { id, sourceFile: basename(fileName), recordIds: [...ids], submittedAt: at }
  return records.map((record) => ({ ...record, desktopDelivery }))
}

export function ghRequest(repository) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('Invalid private repository name.')
  return async (method, path, body) => {
    const args = ['api', `repos/${repository}/${path}`, '--method', method]
    if (body !== undefined) args.push('--input', '-')
    const result = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding: 'utf8', windowsHide: true, timeout: 25000, maxBuffer: 8 * 1024 * 1024 })
    if (result.error || result.status !== 0) {
      const error = new Error(result.error?.code === 'ENOENT' ? 'Install GitHub CLI and sign in with access to the private data vault.' : 'GitHub is unavailable or access was denied. Files remain queued locally; check gh auth status.')
      error.status = Number(/HTTP (\d{3})/.exec(result.stderr ?? '')?.[1]) || undefined
      throw error
    }
    try { return JSON.parse(result.stdout) } catch { throw new Error('GitHub returned an unreadable result. No local handoff was removed.') }
  }
}

// One fast-forward commit publishes a whole file's status + checklist together.
// Rebase the tree onto the new head on conflict; never force or replace a workspace.
export async function publishRecords(records, request) {
  if (!(await request('GET', '')).private) throw new Error('Desktop handoffs can only be published to a PRIVATE repository.')
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = (await request('GET', 'git/ref/heads/main')).object.sha
    const commit = await request('GET', `git/commits/${head}`)
    const listing = await request('GET', `git/trees/${commit.tree.sha}?recursive=1`)
    if (listing.truncated || !Array.isArray(listing.tree)) throw new Error('Repository tree is too large to verify safely. Files remain queued.')
    const changes = []
    for (const record of records) {
      const path = `data/task-inbox/${record.id}.json`
      const content = `${JSON.stringify(record, null, 2)}\n`
      const existing = listing.tree.find((file) => file.path === path)
      if (existing) {
        if (existing.type !== 'blob' || existing.mode !== '100644') throw new Error('Inbox destination is not an ordinary JSON file.')
        if (existing.sha === blobSha(content)) continue
        const blob = await request('GET', `git/blobs/${existing.sha}`)
        let previous
        try { previous = JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')) } catch { throw new Error('Existing inbox record could not be checked.') }
        if (stable(noMetadata(previous)) !== stable(noMetadata(record))) throw new Error(`Submission id ${record.id} already has different content. Keep the old file and use a new id for new work.`)
        continue
      }
      changes.push({ path, mode: '100644', type: 'blob', content })
    }
    if (!changes.length) return { count: 0, commit: head, alreadyPublished: true }
    const tree = await request('POST', 'git/trees', { base_tree: commit.tree.sha, tree: changes })
    const next = await request('POST', 'git/commits', { message: `[Forgeboard] Desktop handoff (${changes.length} records)`, tree: tree.sha, parents: [head] })
    try {
      await request('PATCH', 'git/refs/heads/main', { sha: next.sha, force: false })
      // A successful ref update makes the immutable records reachable on main.
      const verified = await request('GET', 'git/ref/heads/main')
      if (!verified.object?.sha) throw new Error('Could not verify the published branch. Retry the same file; do not change its id.')
      return { count: changes.length, commit: next.sha, alreadyPublished: false }
    } catch (error) {
      if (![409, 422].includes(error.status) || attempt === 2) throw error
    }
  }
  throw new Error('Repository kept changing. The file is still queued locally.')
}
