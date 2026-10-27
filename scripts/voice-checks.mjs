import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRequest, validateDraft, clean, processInbox } from './voice-cleanup.mjs';
const id = '18a358b8-19e2-4f51-9ada-46fad0e23645';
const request = { version: 1, id, createdAt: '2026-10-27T12:00:00Z', transcript: 'Walmart: fish and sauce. Costco: turkey.' };
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
