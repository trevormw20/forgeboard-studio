import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRequest, validateDraft, validateNote, validateAdditions, clean, processInbox, smokeTest } from './voice-cleanup.mjs';
const id = '18a358b8-19e2-4f51-9ada-46fad0e23645';
const request = { version: 1, id, createdAt: '2026-10-27T12:00:00Z', transcript: 'Walmart: fish and sauce. Costco: turkey.' };
const note = { id: 'note-shopping', title: 'Shopping', body: 'Only this note', items: [
  { id: 'walmart', text: 'Walmart', parentId: '', completed: false },
  { id: 'fish', text: 'Fish', parentId: 'walmart', completed: true },
] };
test('note-aware requests include only bounded selected-note context and validated hierarchy', () => {
  const selected = validateRequest({ ...request, mode: 'append-to-note', note, workspace: 'NEVER SEND' }, `${id}.json`);
  assert.deepEqual(selected.note, note); assert.equal(selected.workspace, undefined);
  for (const bad of [{ ...note, body: 'x'.repeat(64001) }, { ...note, items: [note.items[1]] }, { ...note, items: [note.items[0], note.items[0]] }]) assert.throws(() => validateNote(bad));
  assert.throws(() => validateRequest({ ...request, mode: 'edit-note', note }, `${id}.json`));
});
test('append-only plans accept existing and newly added parents, reject edit powers and unknown targets', () => {
  const plan = { additions: [{ text: ' Milk ', parent: 'existing:walmart' }, { text: 'Brand', parent: 'new:0' }, { text: 'Reminder', parent: '' }] };
  assert.equal(validateAdditions(plan, note).additions[0].text, 'Milk');
  for (const parent of ['existing:', 'existing:other-note', 'new:0', 'new:-1', 'new:01', 'delete:walmart']) assert.throws(() => validateAdditions({ additions: [{ text: 'No', parent }] }, note));
  for (const extra of [{ title: 'Changed' }, { delete: 'fish' }, { items: [] }]) assert.throws(() => validateAdditions({ ...plan, ...extra }, note));
  assert.throws(() => validateAdditions({ additions: [{ text: 'No', parent: '', completed: true }] }, note));
});
test('Claude gets selected-note context only for explicit append mode and returns strictly additive data', async () => {
  let sent;
  const fetcher = async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"additions":[{"text":"Milk","parent":"existing:walmart"}]}' }] }) };
  };
  const result = await clean(validateRequest({ ...request, mode: 'append-to-note', note }, `${id}.json`), { key: 'fake', fetcher });
  assert.equal(result.status, 'ready');assert.deepEqual(JSON.parse(sent.messages[0].content), { transcript: request.transcript, currentNote: note });
  assert.equal(sent.tools, undefined);assert.match(sent.system, /cannot edit/);assert.deepEqual(sent.output_config.format.schema.required, ['additions']);
  assert.deepEqual(result.draft, { additions: [{ text: 'Milk', parent: 'existing:walmart' }] });
  const invalid = await clean({ ...request, mode: 'append-to-note', note }, { key: 'fake', fetcher: async () => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"additions":[{"text":"Changed","parent":"existing:other-note"}]}' }] }) }) });
  assert.equal(invalid.status, 'unavailable');
});
test('accepts only bounded, matching immutable requests', () => {
  assert.equal(validateRequest(request, `${id}.json`).id, id);
  for (const bad of [{ ...request, id: '../../secret' }, { ...request, transcript: 'a'.repeat(12001) }, { ...request, createdAt: '' }]) assert.throws(() => validateRequest(bad, `${id}.json`));
  assert.throws(() => validateRequest(request, 'other.json'));
});
test('validates hierarchy, ignores extraneous AI directives, never completes boxes', () => {
  const draft = validateDraft({ title: 'Shopping', items: [{ text: 'Walmart', depth: 0, completed: true }, { text: 'Fish', depth: 1 }], execute: 'no' });
  assert.deepEqual(draft.items[0], { text: 'Walmart', depth: 0 });
  for (const items of [[], [{ text: 'x', depth: 1 }], [{ text: 'x', depth: 0 }, { text: 'y', depth: 2 }], [{ text: '', depth: 0 }]]) assert.throws(() => validateDraft({ title: '', items }));
});
test('missing key and API failures return safe fallback with no transcript or secret', async () => {
  assert.equal((await clean(request)).reason, 'not-configured');
  const result = await clean(request, { key: 'fake-secret', fetcher: async () => { throw Error('fake-secret private transcript'); } });
  assert.equal(result.status, 'unavailable'); assert.ok(!JSON.stringify(result).includes('fake-secret'));
});
test('provider diagnostics expose only safe categories, never echoed content', async () => {
  const result = await clean(request, { key: 'fake', fetcher: async () => ({ ok: false, status: 400, json: async () => ({ error: { type: 'invalid_request_error', message: 'Your credit balance is too low. private-text fake-secret' } }) }) });
  assert.deepEqual(result, { id, status: 'unavailable', reason: 'billing-unavailable', httpStatus: 400 });
  assert.ok(!JSON.stringify(result).includes('private-text'));
});
test('only sends explicit transcript, with fixed endpoint and no tools; requires complete response', async () => {
  let sent;
  const fetcher = async (url, options) => { assert.equal(url, 'https://api.anthropic.com/v1/messages'); sent = JSON.parse(options.body); return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Groceries","items":[{"text":"Fish","depth":0}]}' }] }) }; };
  assert.equal((await clean(request, { key: 'fake', workspaceId: 'wrkspc_test', fetcher: (url, options) => { assert.equal(options.headers['anthropic-workspace-id'], 'wrkspc_test'); return fetcher(url, options); } })).status, 'ready');
  assert.equal(sent.model, 'claude-haiku-4-5'); assert.equal(sent.tools, undefined); assert.equal(JSON.parse(sent.messages[0].content).transcript, request.transcript);
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal((await clean(request, { key: 'fake', fetcher: async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens' }) }) })).status, 'unavailable');
});
test('processes only explicit voice inbox and skips already handled requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgeboard-voice-test-'));
  try {
    await fs.mkdir(path.join(root, 'data/voice-inbox'), { recursive: true });
    await fs.writeFile(path.join(root, 'data/workspace.json'), 'NOT JSON - MUST NEVER BE READ');
    await fs.writeFile(path.join(root, 'data/voice-inbox', `${id}.json`), JSON.stringify(request));
    assert.equal(await processInbox(root), 1);
    assert.equal(await processInbox(root, { key: 'fake', fetcher: () => assert.fail('repeat API call') }), 0);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data/voice-results', `${id}.json`))).status, 'unavailable');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('configuration smoke test uses only hard-coded synthetic text and returns no content or secrets', async () => {
  const result = await smokeTest({ key: 'fake-secret', fetcher: async (url, options) => {
    const body = JSON.parse(options.body);assert.match(JSON.parse(body.messages[0].content).transcript, /^Synthetic configuration test:/);
    assert.equal(JSON.parse(body.messages[0].content).currentNote.id, 'synthetic-note');
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"additions":[{"text":"Milk","parent":"existing:synthetic-walmart"}]}' }] }) };
  } });
  assert.deepEqual(result, { status: 'ready' });
  assert.equal((await smokeTest()).reason, 'not-configured');
});
