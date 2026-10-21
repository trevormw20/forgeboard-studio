import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate, install } from './forgeboard-handoff.mjs'
import { instructionBlock, rewriteForgeboardSections } from './project-instructions.mjs'
import { normalizeDrop } from './desktop-inbox.mjs'
import { importSubmissions } from '../runtime/inbox-core.mjs'

test('installs in both agents without replacing existing instructions or duplicating on retry', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'forgeboard-protocol-test-'))
  try {
    await writeFile(join(folder, 'AGENTS.md'), 'Existing project instructions.\n')
    await install(folder)
    await install(folder)
    const agents = await readFile(join(folder, 'AGENTS.md'), 'utf8')
    assert.ok(agents.startsWith('Existing project instructions.'))
    assert.equal(agents.split('<!-- forgeboard-handoff -->').length, 2)
    assert.match(await readFile(join(folder, 'CLAUDE.md'), 'utf8'), /FORGEBOARD_INSTRUCTIONS/)
  } finally { await rm(folder, { recursive: true }) }
})

test('replaces stale Forgeboard sections without changing business/game rules or storing one shared chat ID', () => {
  const text = '# Project\n\nKeep brand rules.\n\n## Forgeboard handoff workflow\nRequire a missing path.\n\n## Tests\nKeep game approval gates.\n'
  const block = instructionBlock({ name: 'Test project', id: 'test-project', workspace: 'C:/test-project' })
  const updated = rewriteForgeboardSections(text, block)
  assert.match(updated, /Keep brand rules/); assert.match(updated, /Keep game approval gates/)
  assert.doesNotMatch(updated, /Require a missing path/)
  assert.equal(rewriteForgeboardSections(updated, block), updated)
  assert.match(updated, /UUID-based Forgeboard REPORTING ID/)
  assert.match(updated, /task-only report is valid without any chat ID/)
})

test('new Claude and Codex reporting identities register automatically under the same verified project', () => {
  const at = '2026-10-21T18:00:00Z', project = 'inbox-project:tactics%20game'
  const workspace = { projects: [{ id: project, name: 'Tactics game' }], tasks: [], activity: [] }
  const md = (agent, chat) => `---\nforgeboard: 1\nid: report-${agent}\nproject: "${project}"\ndate: 2026-10-21\nchat_id: ${chat}\nchat_name: ${agent} test role\nagent: ${agent}\nstatus: waiting-on-me\nnext_action: Review the changed flow.\n---\n# Review reported changes\n## Completed\n- Updated the flow.\n## Review\n- [ ] Check the changed flow.\n`
  const records = [normalizeDrop(md('claude', 'tactics-claude-11111111-1111-4111-8111-111111111111'), 'claude.md', at), normalizeDrop(md('codex', 'tactics-codex-22222222-2222-4222-8222-222222222222'), 'codex.md', at)].flat()
  const files = records.map((record) => ({ path: `${record.id}.json`, text: JSON.stringify(record) }))
  const result = importSubmissions(workspace, files, at)
  assert.deepEqual(result.errors, [])
  assert.equal(result.workspace.agentChats.length, 2)
  assert.equal(result.workspace.projects.length, 1)
  assert.equal(result.workspace.tasks.length, 2)
  assert.ok(result.workspace.agentChats.every((chat) => chat.projectId === project))
  result.workspace.tasks[0].subtasks[0].completedAt = at
  const again = importSubmissions(result.workspace, files, at)
  assert.equal(again.workspace.agentChats.length, 2)
  assert.equal(again.workspace.tasks[0].subtasks[0].completedAt, at)
})

test('task-only Markdown saves real human checks without a chat mapping and rejects mixed-project batches', () => {
  const at = '2026-10-21T18:00:00Z'
  const md = '---\nforgeboard: 1\nid: task-only-check\nproject: Soleivar\ndate: 2026-10-21\nagent: claude\n---\n# Review the offer\n- [ ] Check the displayed price.\n'
  const records = normalizeDrop(md, 'soleivar.md', at)
  const result = importSubmissions({ projects: [{ id: 'inbox-project:soleivar', name: 'Soleivar' }], tasks: [], activity: [] }, records.map((record) => ({ path: `${record.id}.json`, text: JSON.stringify(record) })), at)
  assert.deepEqual(result.errors, []); assert.equal(result.workspace.tasks.length, 1)
  assert.equal(result.workspace.agentChats?.length ?? 0, 0)
  assert.equal(result.workspace.tasks[0].projectId, 'inbox-project:soleivar')
  assert.throws(() => normalizeDrop(JSON.stringify([records[0], { ...records[0], id: 'another', project: 'Snail Mail' }]), 'mixed.json', at), /separate file per project/)
})
test('rejects invalid input before trying to publish private data', () => {
  const value = { format: 'forgeboard-task', version: 1, id: 'review-01', date: '2026-10-21', summary: 'Review changes', project: 'Count on Chaos', subtasks: [{ id: 'one', title: 'Play a run' }] }
  assert.equal(validate(value, 1000).id, 'review-01')
  assert.throws(() => validate({ ...value, date: '2026-02-30' }, 1000))
  assert.throws(() => validate({ ...value, subtasks: [...value.subtasks, ...value.subtasks] }, 1000))
  assert.throws(() => validate(value, 200001))
})
