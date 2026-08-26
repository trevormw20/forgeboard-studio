import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { effectivePriority } from './priority'

describe('automatic priority escalation', () => {
  it('moves a low task through every configured level', () => {
    const workspace = createSeedWorkspace()
    const project = workspace.projects[0]
    const task = { ...workspace.tasks[0], startingPriority: 'low' as const, touchedAt: '2026-01-01T00:00:00.000Z', dueAt: undefined, escalation: { lowToMediumDays: 2, mediumToHighDays: 2, highToUrgentDays: 2 } }
    expect(effectivePriority(task, project, new Date('2026-01-02T00:00:00.000Z'))).toBe('low')
    expect(effectivePriority(task, project, new Date('2026-01-03T00:00:00.000Z'))).toBe('medium')
    expect(effectivePriority(task, project, new Date('2026-01-05T00:00:00.000Z'))).toBe('high')
    expect(effectivePriority(task, project, new Date('2026-01-07T00:00:00.000Z'))).toBe('urgent')
  })

  it('bumps an overdue task one additional level', () => {
    const workspace = createSeedWorkspace()
    const task = { ...workspace.tasks[0], startingPriority: 'medium' as const, touchedAt: '2026-01-09T00:00:00.000Z', dueAt: '2026-01-09T12:00:00.000Z' }
    expect(effectivePriority(task, workspace.projects[0], new Date('2026-01-10T00:00:00.000Z'))).toBe('high')
  })
})
