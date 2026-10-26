import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import type { AgentStatusEvent, HandoffSummary } from '../types'
import { deriveActivityNotifications, unreadNotificationIds } from './notifications'

const at = '2026-10-26T16:00:00Z'
function fixture() {
  const workspace = createSeedWorkspace()
  const project = workspace.projects[0]
  const task = workspace.tasks[0]
  Object.assign(task, { createdAt: at, submission: { id: 'review-one', date: '2026-10-26', sourceFile: 'data/task-inbox/handoff-one.json' }, handoff: { agent: 'claude', completedWork: ['Added assets'], review: 'Check the new build.' }, workStatus: 'needs-review' })
  const event: AgentStatusEvent = { format: 'forgeboard-status', version: 1, id: 'status-one', project: project.id, at, chat: { id: 'chat-one', name: 'Art chat', agent: 'claude' }, status: 'done', summary: 'My assets are ready.' }
  const summary: HandoffSummary = { id: 'file-one', projectId: project.id, sourceFile: 'handoff-one.json', recordIds: ['review-one', 'status-one'], title: 'Review the assets', inputHash: 'input-one', receivedAt: at, updatedAt: at, state: 'pending', summary: 'Agent reported new assets.', needsYou: 'Check the build.', nextStep: 'Open the test build.', attempts: 0 }
  return { workspace, project, task, event, summary }
}

describe('real activity notifications', () => {
  it('does not mistake local typing or completed checkboxes for an agent finishing work', () => {
    const workspace = createSeedWorkspace()
    workspace.tasks[0].completedAt = at
    workspace.activity.push({ id: 'local-check', type: 'completed', at, taskId: workspace.tasks[0].id, title: 'I checked it off' })
    expect(deriveActivityNotifications(workspace)).toEqual([])
  })

  it('folds a delivered status, review task, and summary from the same file into one notification', () => {
    const { workspace, task, event, summary } = fixture()
    workspace.agentEvents = [event]
    workspace.handoffSummaries = [summary]
    const items = deriveActivityNotifications(workspace)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'handoff', taskId: task.id, title: 'Review the assets', ai: false })
  })

  it('folds an early raw bridge status and task before the private summary is created, using explicit delivery metadata', () => {
    const { workspace, task, event, summary } = fixture()
    // Exact bridge shape: original source filename in metadata, while each
    // imported task points at its separate data/task-inbox/{record.id}.json.
    task.submission!.sourceFile = 'data/task-inbox/review-one.json'
    Object.assign(event, { desktopDelivery: { id: 'desktop-delivery-one', recordIds: ['review-one', 'status-one'], sourceFile: 'cowork-report.md', submittedAt: at } })
    workspace.agentEvents = [event]
    const raw = deriveActivityNotifications(workspace)
    expect(raw).toHaveLength(1)
    expect(raw[0]).toMatchObject({ taskId: task.id, chatId: event.chat.id, kind: 'handoff' })
    summary.id = 'desktop-delivery-one'
    summary.sourceFile = 'cowork-report.md'
    workspace.handoffSummaries = [summary]
    expect(deriveActivityNotifications(workspace)).toHaveLength(1)
    expect(deriveActivityNotifications(workspace)[0].id).toBe(raw[0].id)
    summary.state = 'ai'
    const ready = deriveActivityNotifications(workspace)
    expect(ready).toHaveLength(1)
    expect(ready[0].id).not.toBe(raw[0].id)
    expect(ready[0]).toMatchObject({ needsYou: 'Check the build.', nextStep: 'Open the test build.' })
  })

  it('does not guess relationships when delivery metadata is missing or malformed', () => {
    const { workspace, event } = fixture()
    workspace.agentEvents = [event]
    expect(deriveActivityNotifications(workspace)).toHaveLength(2)
    Object.assign(event, { desktopDelivery: { id: 'delivery', recordIds: ['review-one', 'not-this-status'] } })
    expect(deriveActivityNotifications(workspace)).toHaveLength(2)
  })

  it('keeps the received ID through queueing and retries but re-lights once the real Haiku result is ready', () => {
    const { workspace, summary } = fixture()
    const first = deriveActivityNotifications(workspace)[0]
    summary.sourceFile = 'original-cowork-report.md'
    workspace.handoffSummaries = [summary]
    expect(deriveActivityNotifications(workspace)[0].id).toBe(first.id)
    summary.state = 'fallback'
    summary.attempts = 2
    summary.updatedAt = '2026-10-26T16:10:00Z'
    expect(deriveActivityNotifications(workspace)[0].id).toBe(first.id)
    summary.state = 'ai'
    summary.generatedAt = '2026-10-26T16:11:00Z'
    const ready = deriveActivityNotifications(workspace)[0]
    expect(ready.id).not.toBe(first.id)
    expect(ready).toMatchObject({ kind: 'summary', ai: true, at: summary.generatedAt })
    summary.attempts++
    summary.updatedAt = '2026-10-26T16:12:00Z'
    summary.generatedAt = '2026-10-26T16:12:00Z'
    expect(deriveActivityNotifications(workspace)[0].id).toBe(ready.id)
    expect(unreadNotificationIds([ready], [{ id: first.id, readAt: at }]).has(ready.id)).toBe(true)
    expect(unreadNotificationIds([ready], [{ id: ready.id, readAt: at }]).size).toBe(0)
  })

  it('keeps a status-only update stable when its pending summary arrives under the original filename', () => {
    const { workspace, event, summary } = fixture()
    workspace.tasks = []
    workspace.agentEvents = [event]
    const original = deriveActivityNotifications(workspace)[0]
    summary.recordIds = [event.id]
    summary.sourceFile = 'original-report.md'
    workspace.handoffSummaries = [summary]
    expect(deriveActivityNotifications(workspace)[0].id).toBe(original.id)
    summary.state = 'ai'
    expect(deriveActivityNotifications(workspace)[0].id).not.toBe(original.id)
  })

  it('preserves project identity even when two projects use the same filename or record IDs', () => {
    const { workspace, summary } = fixture()
    const other = workspace.tasks.find((task) => task.projectId !== summary.projectId)!
    other.createdAt = at
    other.submission = { id: 'review-one', date: '2026-10-26', sourceFile: 'data/task-inbox/handoff-one.json' }
    workspace.handoffSummaries = [summary]
    expect(deriveActivityNotifications(workspace)).toHaveLength(2)
    expect(new Set(deriveActivityNotifications(workspace).map((item) => item.projectId)).size).toBe(2)
  })

  it('groups multiple submitted tasks in one file and does not re-notify when a user checks them', () => {
    const { workspace, task } = fixture()
    workspace.tasks.push({ ...task, id: 'second', submission: { ...task.submission!, id: 'review-two' } })
    const before = deriveActivityNotifications(workspace)
    expect(before).toHaveLength(1)
    task.completedAt = '2026-10-26T16:01:00Z'
    task.updatedAt = task.completedAt
    expect(deriveActivityNotifications(workspace).map((item) => item.id)).toEqual(before.map((item) => item.id))
  })

  it('does not re-light a summary when the user deletes its original checklist', () => {
    const { workspace, task, event, summary } = fixture()
    workspace.agentEvents = [event]
    workspace.handoffSummaries = [summary]
    const original = deriveActivityNotifications(workspace)[0]
    task.deletedAt = at
    const later = deriveActivityNotifications(workspace)[0]
    expect(later.id).toBe(original.id)
    expect(later.taskId).toBeUndefined()
    expect(unreadNotificationIds([later], [{ id: original.id, readAt: at }]).size).toBe(0)
  })

  it('uses factual part-done wording and reports relay delivery without claiming project completion', () => {
    const { workspace, event } = fixture()
    workspace.tasks = []
    workspace.agentEvents = [event, { ...event, id: 'started', status: 'in-progress' }]
    workspace.relayReceipts = [{ format: 'forgeboard-relay-result', version: 1, id: 'relay', handoffId: event.id, state: 'claimed', detail: 'Claimed', at }]
    expect(deriveActivityNotifications(workspace)).toHaveLength(1)
    expect(deriveActivityNotifications(workspace)[0].title).toBe('Art chat finished its part')
    workspace.relayReceipts[0].state = 'delivered'
    expect(deriveActivityNotifications(workspace).map((item) => item.title)).toContain('Handoff delivered')
    expect(deriveActivityNotifications(workspace).some((item) => /project.*done|project.*complete/i.test(item.title))).toBe(false)
  })

  it('skips deleted projects, deleted source tasks, and invalid timestamps', () => {
    const { workspace, task, project, event, summary } = fixture()
    workspace.agentEvents = [event]
    workspace.handoffSummaries = [summary]
    project.deletedAt = at
    expect(deriveActivityNotifications(workspace)).toHaveLength(0)
    project.deletedAt = undefined
    workspace.handoffSummaries = []
    task.deletedAt = at
    event.at = 'invalid'
    expect(deriveActivityNotifications(workspace)).toHaveLength(0)
  })
})
