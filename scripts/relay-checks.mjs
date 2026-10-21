import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCoordination } from '../shared/coordination.mjs'
import { relayOnce, selectRoute, buildRelayPrompt } from './forgeboard-relay.mjs'

const at = '2026-10-21T18:00:00Z', now = new Date(at)
const event = { format: 'forgeboard-status', version: 1, id: 'art-ready-01', project: 'Tactics game', at, chat: { id: 'art', name: 'Art producer', agent: 'codex' }, status: 'waiting-on-agent', summary: 'ART-007 ready for director review', handoff: { toChatId: 'director', instruction: 'Review the report and update the approved queue.', files: ['REPORT.md'], chainId: 'art-007', hop: 0 } }
const config = (cwd) => ({ enabled: true, maxHops: 4, maxPerDay: 6, routes: [{ enabled: true, project: 'Tactics game', fromChatId: 'art', toChatId: 'director', provider: 'claude-code', sessionId: 'exact-session-id', cwd, scope: 'Review assets and update the queue; do not deploy.', allowedFiles: ['REPORT.md'] }] })
const workspace = { projects: [{ id: 'tactics', name: 'Tactics game' }], agentChats: [] }

test('validates explicit handoffs and rejects unsafe or unfinished ones', () => {
  assert.equal(parseCoordination(event).id, 'art-ready-01')
  assert.throws(() => parseCoordination({ ...event, status: 'in-progress' }))
  assert.throws(() => parseCoordination({ ...event, handoff: { ...event.handoff, files: ['../private.md'] } }))
})
test('requires an enabled exact route; pause, duplicate, hop, and daily limits stop dispatch', () => {
  const settings = config(process.cwd())
  assert.ok(selectRoute(event, settings, workspace, [], now))
  assert.equal(selectRoute(event, { ...settings, routes: [] }, workspace, [], now), null)
  assert.equal(selectRoute(event, settings, workspace, [{ handoffId: event.id, at }], now), null)
  assert.equal(selectRoute(event, settings, { ...workspace, agentChats: [{ id: 'director', paused: true }] }, [], now), null)
  assert.equal(selectRoute(event, settings, { ...workspace, agentChats: [{ id: 'art', updatedAt: '2026-10-21T18:01:00Z' }] }, [], now), null)
  assert.equal(selectRoute(event, settings, { ...workspace, projects: [{ id: 'tactics', name: 'Tactics game', workState: 'waiting-on-me' }] }, [], now), null)
  assert.equal(selectRoute({ ...event, handoff: { ...event.handoff, hop: 4 } }, settings, workspace, [], now), null)
  assert.equal(selectRoute(event, settings, workspace, Array.from({ length: 6 }, (_, i) => ({ handoffId: `other-${i}`, at })), now), null)
  assert.throws(() => selectRoute({ ...event, handoff: { ...event.handoff, files: ['not-approved.md'] } }, settings, workspace, [], now))
})
test('delivers once, preserves approved context, and records failures without automatic redelivery', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'forgeboard-relay-test-'))
  try {
    await writeFile(join(folder, 'REPORT.md'), 'ART-007 passed checks. Director still needs to review.')
    const receipts = [], settings = config(folder)
    const transport = {
      snapshot: async () => ({ events: [event], receipts: [...receipts], workspace }),
      claim: async () => { if (receipts.length) return null; const receipt = { handoffId: event.id, at, state: 'claimed' }; receipts.push(receipt); return { receipt } },
      finish: async (_claim, state, detail) => { Object.assign(receipts[0], { state, detail }); return receipts[0] },
    }
    let dispatches = 0
    await relayOnce(settings, transport, { now, run: false, dispatch: () => { dispatches++ } })
    assert.equal(dispatches, 0)
    assert.equal(receipts.length, 0)
    await relayOnce(settings, transport, { now, run: true, dispatch: (_route, prompt) => { dispatches++; assert.match(prompt, /Director still needs to review/); assert.match(prompt, /hop 1/); throw Object.assign(new Error('Delivery uncertain'), { uncertain: true }) } })
    assert.equal(receipts[0].state, 'needs-check')
    await relayOnce(settings, transport, { now, run: true, dispatch: () => { dispatches++ } })
    assert.equal(dispatches, 1)
    assert.match(buildRelayPrompt(event, settings.routes[0], []), /Permitted work:/)
  } finally { await rm(folder, { recursive: true }) }
})
