import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { importSubmissions } from './taskInbox'
import { projectProgress } from './coordination'
import { mergeWorkspaces } from './merge'
import { buildManagerPlan } from './manager'

const now = '2026-10-21T18:00:00Z'
const status = { format: 'forgeboard-status', version: 1, id: 'tactics-art-ready', project: 'Tactics game', at: now, chat: { id: 'tactics-art', name: 'Art producer', agent: 'codex' }, status: 'waiting-on-agent', summary: 'ART-007 is ready for review.', nextAction: 'Claude reviews and imports it.' }
const file = (value: unknown) => ({ path: 'data/task-inbox/status.json', text: JSON.stringify(value) })
describe('project and agent progress', () => {
  it('registers a requested project without inventing tasks, chat identities, or progress', () => {
    const base = createSeedWorkspace()
    const registration = file({ format: 'forgeboard-project', version: 1, id: 'snail-setup', project: 'Snail Mail', at: now, icon: '✉️', color: '#aabbcc' })
    const first = importSubmissions(base, [registration], now)
    const project = first.workspace.projects.find((item) => item.name === 'Snail Mail')!
    expect(project.workState).toBe('unknown')
    expect(first.workspace.agentChats).toBeUndefined()
    expect(first.workspace.tasks).toHaveLength(base.tasks.length)
    project.color = '#112233'
    const second = importSubmissions(first.workspace, [registration], now)
    expect(second.updates).toBe(0)
    expect(second.workspace.projects.find((item) => item.id === project.id)?.color).toBe('#112233')
    const reported = importSubmissions(second.workspace, [file({ ...status, project: 'Snail Mail', status: 'waiting-on-me' })], now).workspace
    expect(projectProgress(reported, reported.projects.find((item) => item.id === project.id)!)).toBe('waiting-on-me')
  })
  it('imports status without creating a master-list task and ignores duplicate or older updates', () => {
    const base = createSeedWorkspace()
    const first = importSubmissions(base, [file(status)], now)
    expect(first.workspace.tasks).toHaveLength(base.tasks.length)
    expect(first.updates).toBe(1)
    const old = { ...status, id: 'older', at: '2026-10-21T17:00:00Z', status: 'in-progress' }
    const second = importSubmissions(first.workspace, [file(status), file(old)], now)
    expect(second.workspace.agentChats?.[0].status).toBe('waiting-on-agent')
    expect(second.workspace.agentEvents).toHaveLength(2)
  })
  it('retains a manual pause while a new agent status arrives; finishing a chat does not finish the project', () => {
    const first = importSubmissions(createSeedWorkspace(), [file(status)], now).workspace
    first.agentChats![0].paused = true
    const second = importSubmissions(first, [file({ ...status, id: 'finished-part', status: 'done', at: '2026-10-21T18:01:00Z' })], '2026-10-21T18:02:00Z').workspace
    expect(second.agentChats![0].paused).toBe(true)
    const project = second.projects.find((p) => p.name === 'Tactics game')!
    expect(projectProgress(second, project)).toBe('paused')
    second.agentChats![0].paused = false
    expect(projectProgress(second, project)).not.toBe('done')
  })
  it('keeps status reports and independent project controls from different devices', () => {
    const base = createSeedWorkspace()
    const a = importSubmissions(base, [file(status)], now).workspace, b = structuredClone(base)
    b.projects[0].workState = 'paused'
    const merged = mergeWorkspaces(base, a, b)
    expect(merged.agentChats).toHaveLength(1)
    expect(merged.projects[0].workState).toBe('paused')
    expect(buildManagerPlan(merged).next.some((task) => task.projectId === merged.projects[0].id)).toBe(false)
  })
  it('keeps separate evidence entries when two devices record an experiment', () => {
    const base = createSeedWorkspace()
    base.experiments = [{ id: 'test-offer', projectId: base.projects[0].id, hypothesis: 'Relevant readers want the letter subscription', action: 'Ask relevant readers for a response', target: 10, unit: 'actions', reviewDate: '2026-11-01', decisionRule: 'Review response quality before changing the offer.', observations: [], status: 'running', createdAt: now, updatedAt: now }]
    const a = structuredClone(base), b = structuredClone(base)
    a.experiments![0].observations.push({ id: 'desktop', at: now, amount: 2, evidence: 'Two reader conversations; one requested an example.' })
    a.experiments![0].updatedAt = '2026-10-21T18:01:00Z'
    b.experiments![0].observations.push({ id: 'phone', at: now, amount: 1, evidence: 'One response about price.' })
    b.experiments![0].updatedAt = '2026-10-21T18:02:00Z'
    const merged = mergeWorkspaces(base, a, b)
    expect(merged.experiments![0].observations).toHaveLength(2)
    expect(merged.experiments![0].observations.reduce((sum, item) => sum + item.amount, 0)).toBe(3)
  })
  it('updates a relay receipt from claimed to delivered without marking the target chat done', () => {
    const base = createSeedWorkspace()
    const receipt = { format: 'forgeboard-relay-result', version: 1, id: 'relay-one', handoffId: 'tactics-art-ready', at: now, state: 'claimed', detail: 'Claimed.' }
    const first = importSubmissions(base, [file(receipt)], now).workspace
    const next = importSubmissions(first, [file({ ...receipt, at: '2026-10-21T18:01:00Z', state: 'delivered', detail: 'Target turn received handoff.' })], '2026-10-21T18:02:00Z')
    expect(next.workspace.relayReceipts).toHaveLength(1)
    expect(next.workspace.relayReceipts![0].state).toBe('delivered')
    expect(next.workspace.agentChats).toBeUndefined()
  })
})
