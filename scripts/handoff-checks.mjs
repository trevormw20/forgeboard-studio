import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate, install } from './forgeboard-handoff.mjs'

test('installs in both agents without replacing existing instructions or duplicating on retry', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'forgeboard-protocol-test-'))
  try {
    await writeFile(join(folder, 'AGENTS.md'), 'Existing project instructions.\n')
    await install(folder)
    await install(folder)
    const agents = await readFile(join(folder, 'AGENTS.md'), 'utf8')
    assert.ok(agents.startsWith('Existing project instructions.'))
    assert.equal(agents.split('<!-- forgeboard-handoff -->').length, 2)
    assert.match(await readFile(join(folder, 'CLAUDE.md'), 'utf8'), /FORGEBOARD_HANDOFF/)
  } finally { await rm(folder, { recursive: true }) }
})
test('rejects invalid input before trying to publish private data', () => {
  const value = { format: 'forgeboard-task', version: 1, id: 'review-01', date: '2026-10-21', summary: 'Review changes', project: 'Count on Chaos', subtasks: [{ id: 'one', title: 'Play a run' }] }
  assert.equal(validate(value, 1000).id, 'review-01')
  assert.throws(() => validate({ ...value, date: '2026-02-30' }, 1000))
  assert.throws(() => validate({ ...value, subtasks: [...value.subtasks, ...value.subtasks] }, 1000))
  assert.throws(() => validate(value, 200001))
})
