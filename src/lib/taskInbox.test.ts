import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { importSubmissions, parseSubmission } from './taskInbox'
import { mergeWorkspaces } from './merge'

const submission = { format: 'forgeboard-task', version: 1, id: 'chaos-2026-10-09-a', project: 'Count on Chaos', date: '2026-10-09', summary: 'Fix and verify demo changes', subtasks: [{ id: 'fix', title: 'Fix score reset' }, { id: 'test', title: 'Play and report feedback' }] }
const files = [{ path: 'data/task-inbox/chaos.json', text: JSON.stringify(submission) }]
const now = '2026-10-09T12:00:00.000Z'

describe('chat submission inbox', () => {
  it('creates one dated parent, nested steps, and a separate project', () => {
    const base = createSeedWorkspace()
    const result = importSubmissions(base, files, now)
    expect(result.added).toBe(1)
    expect(result.workspace.tasks.length).toBe(base.tasks.length + 1)
    expect(result.workspace.tasks.at(-1)?.subtasks).toHaveLength(2)
    expect(result.workspace.tasks.at(-1)?.title).toBe('2026-10-09 · Fix and verify demo changes')
    expect(base.projects.some((project) => project.name === 'Count on Chaos')).toBe(false)
  })
  it('never duplicates or resets completed/deleted work, even after a file rename', () => {
    const first = importSubmissions(createSeedWorkspace(), files, now).workspace
    const task = first.tasks.at(-1)!
    task.subtasks![0].completedAt = now
    task.completedAt = now
    task.deletedAt = now
    const result = importSubmissions(first, [{ ...files[0], path: 'renamed.json' }], now)
    expect(result.added).toBe(0)
    expect(result.workspace.tasks.at(-1)?.subtasks![0].completedAt).toBe(now)
  })
  it('deduplicates concurrent device imports and preserves checked steps', () => {
    const base = createSeedWorkspace()
    const a = importSubmissions(base, files, now).workspace
    const b = importSubmissions(base, files, now).workspace
    a.tasks.at(-1)!.subtasks![0].completedAt = '2026-10-09T13:00:00Z'
    a.tasks.at(-1)!.subtasks![0].updatedAt = '2026-10-09T13:00:00Z'
    const result = mergeWorkspaces(base, a, b)
    expect(result.tasks.filter((task) => task.submission)).toHaveLength(1)
    expect(result.projects.filter((project) => project.name === 'Count on Chaos')).toHaveLength(1)
    expect(result.tasks.at(-1)?.subtasks![0].completedAt).toBeTruthy()
  })
  it('isolates invalid files and rejects impossible dates and duplicate steps', () => {
    const result = importSubmissions(createSeedWorkspace(), [{ path: 'bad.json', text: '{}' }, ...files], now)
    expect(result.added).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(() => parseSubmission(JSON.stringify({ ...submission, date: '2026-02-30' }))).toThrow()
    expect(() => parseSubmission(JSON.stringify({ ...submission, subtasks: [submission.subtasks[0], submission.subtasks[0]] }))).toThrow()
  })
})
