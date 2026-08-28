import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { mergeWorkspaces } from './merge'

describe('workspace conflict merge', () => {
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
