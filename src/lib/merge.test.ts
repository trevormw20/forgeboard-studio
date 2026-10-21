import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { mergeWorkspaces, sameWorkspaceContent } from './merge'

describe('workspace conflict merge', () => {
  it('ignores no-op sync timestamps but detects real summary and checkbox changes', () => {
    const base = createSeedWorkspace(), remote = structuredClone(base)
    remote.updatedAt = '2030-01-01T00:00:00Z'
    expect(sameWorkspaceContent(base, remote)).toBe(true)
    remote.tasks[0].title = 'Changed'
    expect(sameWorkspaceContent(base, remote)).toBe(false)
    const local = structuredClone(base)
    local.tasks[0].subtasks = [{ id: 'check', title: 'Review', createdAt: base.updatedAt, updatedAt: remote.updatedAt, completedAt: remote.updatedAt }]
    remote.handoffSummaries = [{ id: 'handoff', projectId: remote.projects[0].id, sourceFile: 'review.md', recordIds: ['review'], title: 'Review', inputHash: 'hash', receivedAt: remote.updatedAt, updatedAt: remote.updatedAt, state: 'ai', summary: 'Reported changes', needsYou: 'Test', nextStep: 'Open', attempts: 1 }]
    const merged = mergeWorkspaces(base, local, remote)
    expect(merged.tasks[0].subtasks?.[0].completedAt).toBe(remote.updatedAt)
    expect(merged.handoffSummaries?.[0].summary).toBe('Reported changes')
  })
  it('keeps independent edits from two devices', () => {
    const base = createSeedWorkspace()
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.tasks[0].title = 'Local title'
    local.tasks[0].updatedAt = '2026-08-26T10:00:00.000Z'
    remote.tasks[1].title = 'Remote title'
    remote.tasks[1].updatedAt = '2026-08-26T10:01:00.000Z'
    const merged = mergeWorkspaces(base, local, remote)
    expect(merged.tasks[0].title).toBe('Local title')
    expect(merged.tasks[1].title).toBe('Remote title')
  })

  it('preserves both snapshots when the same item conflicts', () => {
    const base = createSeedWorkspace()
    const local = structuredClone(base)
    const remote = structuredClone(base)
    local.tasks[0].title = 'Local title'
    local.tasks[0].updatedAt = '2026-08-26T10:00:00.000Z'
    remote.tasks[0].title = 'Remote title'
    remote.tasks[0].updatedAt = '2026-08-26T10:01:00.000Z'
    const merged = mergeWorkspaces(base, local, remote)
    expect(merged.tasks[0].title).toBe('Remote title')
    expect(merged.conflicts.at(-1)?.local).toMatchObject({ title: 'Local title' })
    expect(merged.conflicts.at(-1)?.remote).toMatchObject({ title: 'Remote title' })
  })

  it('merges subtask additions and keeps the newest checkbox state', () => {
    const base = createSeedWorkspace()
    const task = base.tasks[0]
    task.subtasks = [{ id: 'subtask-shared', title: 'Shared step', createdAt: '2026-08-26T09:00:00.000Z', updatedAt: '2026-08-26T09:00:00.000Z' }]
    const local = structuredClone(base)
    const remote = structuredClone(base)

    local.tasks[0].subtasks![0].completedAt = '2026-08-26T10:02:00.000Z'
    local.tasks[0].subtasks![0].updatedAt = '2026-08-26T10:02:00.000Z'
    local.tasks[0].updatedAt = '2026-08-26T10:02:00.000Z'
    remote.tasks[0].subtasks!.push({ id: 'subtask-remote', title: 'Remote step', createdAt: '2026-08-26T10:01:00.000Z', updatedAt: '2026-08-26T10:01:00.000Z' })
    remote.tasks[0].updatedAt = '2026-08-26T10:01:00.000Z'

    const merged = mergeWorkspaces(base, local, remote)
    expect(merged.tasks[0].subtasks).toHaveLength(2)
    expect(merged.tasks[0].subtasks?.find((item) => item.id === 'subtask-shared')?.completedAt).toBe('2026-08-26T10:02:00.000Z')
    expect(merged.tasks[0].subtasks?.find((item) => item.id === 'subtask-remote')?.title).toBe('Remote step')
  })
})
