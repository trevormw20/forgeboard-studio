#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseCoordination } from '../shared/coordination.mjs'
import { instructionBlock, rewriteForgeboardSections } from './project-instructions.mjs'

const DEFAULT_REPO = 'trevormw20/forgeboard-studio-vault'
export function validate(value, bytes) {
  if (['forgeboard-status', 'forgeboard-relay-result', 'forgeboard-project'].includes(value?.format)) {
    if (bytes > 200000) throw new Error('File exceeds 200 KB.')
    return parseCoordination(value)
  }
  if (bytes > 200000 || value?.format !== 'forgeboard-task' || value.version !== 1) throw new Error('Use a forgeboard-task version 1 file under 200 KB.')
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value.id ?? '')) throw new Error('Invalid stable submission id.')
  for (const key of ['project', 'summary']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 500) throw new Error(`Invalid ${key}.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date) throw new Error('Use a real YYYY-MM-DD date.')
  if (!Array.isArray(value.subtasks) || !value.subtasks.length || value.subtasks.length > 200) throw new Error('Include 1–200 checklist steps.')
  const ids = new Set()
  for (const step of value.subtasks) {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(step.id) || ids.has(step.id) || typeof step.title !== 'string' || !step.title.trim() || step.title.length > 1000) throw new Error('Each step needs a unique id and title.')
    ids.add(step.id)
  }
  if (value.board && !['bugs', 'aiTodo', 'myTodo', 'ideas', 'playtest', 'assets'].includes(value.board)) throw new Error('Invalid board.')
  if (value.priority && !['low', 'medium', 'high'].includes(value.priority)) throw new Error('Invalid priority.')
  if (value.estimateMinutes !== undefined && (!Number.isInteger(value.estimateMinutes) || value.estimateMinutes < 1 || value.estimateMinutes > 480)) throw new Error('Invalid estimate.')
  if (value.reviewAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.reviewAt) || !Number.isFinite(Date.parse(value.reviewAt)))) throw new Error('reviewAt needs a timezone.')
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 20000)) throw new Error('Invalid notes.')
  if (value.handoff) {
    const h = value.handoff
    if (!['codex', 'claude-code', 'claude', 'chatgpt', 'other'].includes(h.agent) || typeof h.review !== 'string' || !h.review.trim() || h.review.length > 4000 || !Array.isArray(h.completedWork) || h.completedWork.length > 50 || h.completedWork.some((s) => typeof s !== 'string' || !s.trim() || s.length > 1000)) throw new Error('Invalid handoff context.')
    for (const key of ['source', 'resume', 'relatedSubmissionId']) if (h[key] !== undefined && (typeof h[key] !== 'string' || h[key].length > 4000)) throw new Error(`Invalid handoff ${key}.`)
  }
  return value
}
export function gh(args, input) {
  const result = spawnSync('gh', args, { input, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error('GitHub CLI is not available. Install gh and authenticate on this machine.')
  return result
}
export function must(result) { if (result.status !== 0) throw new Error('GitHub operation failed. Check gh auth status and access to the private vault. No workspace data was overwritten.'); return result.stdout }
export async function publish(file, repo = DEFAULT_REPO) {
  const text = await readFile(file, 'utf8'), value = validate(JSON.parse(text), Buffer.byteLength(text))
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository name.')
  const endpoint = `repos/${repo}/contents/data/task-inbox/${value.id}.json`
  const existing = gh(['api', `${endpoint}?ref=main`])
  if (existing.status === 0) {
    const previous = JSON.parse(existing.stdout)
    if (Buffer.from(previous.content, 'base64').toString('utf8') !== text) throw new Error('This id already has different content. Use a new id for new work.')
    return `Already published: ${value.id}`
  }
  if (!existing.stderr.includes('404')) throw new Error('Cannot read the private vault. Check gh auth status and repository access.')
  must(gh(['api', endpoint, '--method', 'PUT', '--input', '-'], JSON.stringify({ message: '[Forgeboard] agent review handoff', branch: 'main', content: Buffer.from(text).toString('base64') })))
  must(gh(['api', `${endpoint}?ref=main`, '--jq', '.sha']))
  return `Published and verified: ${value.id}`
}
export async function install(directory) {
  const root = resolve(directory)
  if (!(await stat(root)).isDirectory()) throw new Error('Project must be an existing directory.')
  const block = instructionBlock()
  const results = []
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = join(root, name)
    let existing = ''
    try { existing = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const updated = rewriteForgeboardSections(existing, block)
    if (updated === existing) { results.push(`${name}: already installed`); continue }
    await writeFile(file, updated)
    results.push(`${name}: shared handoff instructions installed/updated`)
  }
  return results.join('\n')
}
export function status(project, repo = DEFAULT_REPO) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository name.')
  const content = JSON.parse(must(gh(['api', `repos/${repo}/contents/data/workspace.json?ref=main`])))
  const workspace = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))
  const matches = workspace.projects.filter((p) => !p.deletedAt && (p.id === project || p.name.toLowerCase() === project.toLowerCase()))
  if (matches.length !== 1) throw new Error('Project not found or ambiguous. Use its exact id.')
  return JSON.stringify(workspace.tasks.filter((t) => t.projectId === matches[0].id && !t.deletedAt && !t.completedAt).map((t) => ({ id: t.id, submissionId: t.submission?.id, title: t.title, status: t.workStatus, reviewAt: t.reviewAt, reviewNotes: t.reviewNotes, steps: (t.subtasks ?? []).filter((s) => !s.deletedAt).map((s) => ({ title: s.title, completed: Boolean(s.completedAt), blockedReason: s.blockedReason })) })), null, 2)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2)
  const option = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  try {
    if (command === 'publish' && option('file')) console.log(await publish(resolve(option('file')), option('repo')))
    else if (command === 'install' && option('project')) console.log(await install(option('project')))
    else if (command === 'status' && option('project')) console.log(status(option('project'), option('repo')))
    else throw new Error('Usage: forgeboard-handoff.mjs publish --file FILE | install --project FOLDER | status --project NAME [--repo OWNER/VAULT]')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
