import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { buildManagerPlan, feedbackForChat } from './manager'
import { importSubmissions } from './taskInbox'
import { mergeWorkspaces } from './merge'

const now = new Date('2026-10-20T18:00:00Z')
function workspace() { const ws = createSeedWorkspace(); ws.tasks = []; ws.activity = []; return ws }
const file = { path: 'data/task-inbox/chaos-review.json', text: JSON.stringify({ format: 'forgeboard-task', version: 1, id: 'chaos-review-01', project: 'Count on Chaos', date: '2026-10-20', summary: 'Review changes', estimateMinutes: 20, handoff: { agent: 'claude-code', completedWork: ['Fixed score reset'], review: 'Play a run and verify scores and menus.', resume: 'Open the new demo build' }, subtasks: Array.from({ length: 10 }, (_, index) => ({ id: `test-${index + 1}`, title: `Test ${index + 1}` })) }) }

describe('manager workflow', () => {
  it('keeps tests 6–10 after 1–5 pass and step 6 fails, including on reimport', () => {
    const first = importSubmissions(workspace(), [file], now.toISOString()).workspace
    const task = first.tasks[0]
    task.subtasks!.slice(0, 5).forEach((step) => { step.completedAt = now.toISOString() })
    task.subtasks![5].blockedReason = 'Score freezes'
    task.reviewNotes = 'I finished 1–5. Step 6 freezes.'
    task.workStatus = 'blocked'
    const next = importSubmissions(first, [file], now.toISOString())
    expect(next.added).toBe(0)
    expect(next.workspace.tasks[0].subtasks!.filter((step) => !step.completedAt)).toHaveLength(5)
    const feedback = feedbackForChat(task, 'Count on Chaos')
    expect(feedback).toContain('- [x] Test 5')
    expect(feedback).toContain('- [ ] Test 6 — BLOCKED: Score freezes')
    expect(feedback).toContain('- [ ] Test 10')
    expect(buildManagerPlan(next.workspace, now).next).toHaveLength(0)
    expect(buildManagerPlan(next.workspace, now).waiting).toHaveLength(1)
  })
  it('honors a light day, time budget, reminders, and ready state', () => {
    const ws = importSubmissions(workspace(), [file], now.toISOString()).workspace
    const task = ws.tasks[0]
    ws.tasks.push({ ...structuredClone(task), id: 'future', reviewAt: '2026-10-21T18:00:00Z' }, { ...structuredClone(task), id: 'parked', workStatus: 'later' }, { ...structuredClone(task), id: 'ready', reviewAt: '2026-10-20T17:00:00Z' })
    ws.manager = { id: 'manager', updatedAt: now.toISOString(), energy: 'light', dailyMinutes: 15 }
    const plan = buildManagerPlan(ws, now)
    expect(plan.next).toHaveLength(1)
    expect(plan.next[0].id).toBe('ready')
    expect(plan.minutes).toBe(15)
    expect(plan.reminders.map((item) => item.id)).toEqual(['ready'])
    expect(plan.waiting.map((item) => item.id)).toEqual(['future', 'parked'])
  })
  it('keeps manager settings and review checkbox edits from separate devices', () => {
    const base = importSubmissions(workspace(), [file], now.toISOString()).workspace
    const a = structuredClone(base), b = structuredClone(base)
    a.manager = { id: 'manager', updatedAt: now.toISOString(), energy: 'light', dailyMinutes: 30 }
    b.tasks[0].subtasks![0].completedAt = now.toISOString()
    b.tasks[0].updatedAt = '2026-10-20T18:01:00Z'
    const merged = mergeWorkspaces(base, a, b)
    expect(merged.manager?.energy).toBe('light')
    expect(merged.tasks[0].subtasks![0].completedAt).toBeTruthy()
  })
  it('related new handoffs do not replace prior unfinished steps', () => {
    const first = importSubmissions(workspace(), [file], now.toISOString()).workspace
    const follow = JSON.parse(file.text)
    follow.id = 'chaos-fix-review-02'
    follow.handoff.relatedSubmissionId = 'chaos-review-01'
    follow.subtasks = [{ id: 'retest', title: 'Retest the fixed score freeze' }]
    const next = importSubmissions(first, [{ path: 'fix.json', text: JSON.stringify(follow) }], now.toISOString())
    expect(next.workspace.tasks).toHaveLength(2)
    expect(next.workspace.tasks[0].subtasks).toHaveLength(10)
    expect(next.workspace.tasks[1].handoff?.relatedSubmissionId).toBe('chaos-review-01')
  })
})
