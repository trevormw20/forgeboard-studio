import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeDrop, publishRecords, stable, repositoryEndpoint } from './desktop-inbox.mjs'
import { scanOnce } from './forgeboard-desktop.mjs'

const at = '2026-10-21T17:30:00Z'
const task = { format: 'forgeboard-task', version: 1, id: 'folder-review-one', project: 'Snail Mail', date: '2026-10-21', summary: 'Review the opening letter', subtasks: [{ id: 'read', title: 'Check the opening is understandable.' }] }
const status = { format: 'forgeboard-status', version: 1, id: 'folder-status-one', project: 'Snail Mail', at, chat: { id: 'snail-planner', name: 'Story planner', agent: 'claude' }, status: 'waiting-on-me', summary: 'Opening letter ready for review.' }

test('normalizes one project per file and keeps both status and original checklist', () => {
  assert.equal(repositoryEndpoint('owner/vault'), 'repos/owner/vault')
  assert.equal(repositoryEndpoint('owner/vault', 'git/ref/heads/main'), 'repos/owner/vault/git/ref/heads/main')
  const records = normalizeDrop(JSON.stringify([task, status]), 'snail.json', at)
  assert.equal(records.length, 2)
  assert.equal(records[0].desktopDelivery.id, records[1].desktopDelivery.id)
  assert.deepEqual(records[0].subtasks, task.subtasks)
  assert.throws(() => normalizeDrop(JSON.stringify([task, { ...status, project: 'Tactics game' }]), 'bad.json', at), /separate file per project/)
  assert.throws(() => normalizeDrop(JSON.stringify({ ...task, notes: `sk-ant-${'a'.repeat(35)}` }), 'key.json', at), /credential/)
  assert.throws(() => normalizeDrop(JSON.stringify({ format: 'forgeboard-relay-result', id: 'fake-delivery' }), 'fake.json', at), /Only Forgeboard/)
})
test('accepts a simple Cowork Markdown report without marking human checks complete', () => {
  const md = `---\nforgeboard: 1\nid: snail-md-one\nproject: Snail Mail\ndate: 2026-10-21\nchat_id: snail-planner\nchat_name: Story planner\nagent: claude\nstatus: waiting-on-me\nnext_action: Read the opening letter.\n---\n# Review the opening letter\n## Completed\n- Revised the opening.\n## Review\n- [ ] Check the opening.\n- [ ] Check the ending.\n- [x] Technical lint passed.\n`
  const records = normalizeDrop(md, 'snail.md', at)
  assert.equal(records[0].subtasks.length, 2)
  assert.equal(records[0].subtasks[0].completedAt, undefined)
  assert.deepEqual(records[0].handoff.completedWork, ['Revised the opening.'])
  assert.equal(records[1].status, 'waiting-on-me')
})
test('waits for settled files, keeps originals offline, retries, and never republishes unchanged files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'forgeboard-drop-test-'))
  try {
    await writeFile(join(folder, 'review.json'), JSON.stringify(task))
    const state = { entries: {} }; let calls = 0
    const publish = async () => { if (++calls === 1) throw new Error('Offline'); return { commit: 'verified-commit' } }
    await scanOnce(folder, state, publish, 0)
    assert.equal(calls, 0)
    await scanOnce(folder, state, publish, 2500)
    assert.equal(state.entries['review.json'].phase, 'error')
    assert.match(await readFile(join(folder, 'review.json'), 'utf8'), /folder-review-one/)
    await scanOnce(folder, state, publish, 40000)
    assert.equal(state.entries['review.json'].phase, 'sent')
    await scanOnce(folder, state, publish, 50000)
    assert.equal(calls, 2)
    await writeFile(join(folder, 'invalid.json'), '{not ready')
    await scanOnce(folder, state, publish, 50000)
    await scanOnce(folder, state, publish, 53000)
    assert.equal(state.entries['invalid.json'].phase, 'invalid')
    assert.equal(calls, 2)
  } finally { await rm(folder, { recursive: true }) }
})

function fakeGit({ privateRepo = true, conflict = false } = {}) {
  let head = 'h0', counter = 0
  const trees = new Map([['t0', [{ path: 'data/workspace.json', mode: '100644', type: 'blob', sha: 'workspace-blob' }]]])
  const commits = new Map([['h0', { tree: { sha: 't0' } }]])
  const blobs = new Map(), writes = []
  const request = async (method, path, body) => {
    if (method !== 'GET') writes.push({ method, path, body })
    if (path === '') return { private: privateRepo }
    if (path === 'git/ref/heads/main') return { object: { sha: head } }
    if (path.startsWith('git/commits/') && method === 'GET') return commits.get(path.split('/').at(-1))
    if (path.startsWith('git/trees/') && method === 'GET') return { tree: trees.get(path.split('/').at(-1).split('?')[0]) }
    if (path.startsWith('git/blobs/')) return { content: Buffer.from(blobs.get(path.split('/').at(-1))).toString('base64') }
    if (path === 'git/trees') {
      const files = new Map(trees.get(body.base_tree).map((file) => [file.path, file]))
      for (const change of body.tree) { const sha = `b${++counter}`; blobs.set(sha, change.content); files.set(change.path, { path: change.path, mode: change.mode, type: change.type, sha }) }
      const sha = `t${++counter}`; trees.set(sha, [...files.values()]); return { sha }
    }
    if (path === 'git/commits') { const sha = `h${++counter}`; commits.set(sha, { tree: { sha: body.tree } }); return { sha } }
    if (path === 'git/refs/heads/main') {
      assert.equal(body.force, false)
      if (conflict) { conflict = false; head = 'human-head'; trees.set('human-tree', [...trees.get('t0'), { path: 'human-note.md', mode: '100644', type: 'blob', sha: 'human-blob' }]); commits.set(head, { tree: { sha: 'human-tree' } }); throw Object.assign(new Error('Head changed'), { status: 422 }) }
      head = body.sha; return { object: { sha: head } }
    }
    throw new Error(`Unexpected test request ${method} ${path}`)
  }
  return { request, writes, currentTree: () => trees.get(commits.get(head).tree.sha) }
}
test('atomically publishes to a private repo, rebases on conflicts, and preserves unrelated files', async () => {
  const git = fakeGit({ conflict: true })
  const records = normalizeDrop(JSON.stringify([task, status]), 'snail.json', at)
  const first = await publishRecords(records, git.request)
  assert.equal(first.count, 2)
  assert.equal(git.currentTree().filter((file) => file.path.startsWith('data/task-inbox')).length, 2)
  assert.ok(git.currentTree().some((file) => file.path === 'human-note.md'))
  assert.ok(git.currentTree().some((file) => file.path === 'data/workspace.json'))
  const again = await publishRecords(records, git.request)
  assert.equal(again.alreadyPublished, true)
  await assert.rejects(() => publishRecords([{ ...records[0], summary: 'Overwritten old task' }], git.request), /different content/)
  const publicGit = fakeGit({ privateRepo: false })
  await assert.rejects(() => publishRecords(records, publicGit.request), /PRIVATE/)
  assert.equal(publicGit.writes.length, 0)
  assert.equal(stable({ b: 1, a: 2 }), stable({ a: 2, b: 1 }))
})
