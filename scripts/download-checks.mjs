import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('direct installers match the verified signed release files byte for byte', async () => {
  const latest = JSON.parse(await readFile(new URL('../public/downloads/latest.json', import.meta.url), 'utf8'));
  assert.match(latest.version, /^\d+\.\d+\.\d+$/);
  const directory = new URL(`../public/downloads/${latest.version}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.version, latest.version);
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal((await readFile(new URL('SOURCE_COMMIT.txt', directory), 'utf8')).trim(), manifest.sourceCommit);
  assert.deepEqual(manifest.files.map(file => file.name), ['Forgeboard-Notes.apk', 'Niki-Notes.apk']);
  const page = await readFile(new URL('../public/downloads/index.html', import.meta.url), 'utf8');
  const sums = await readFile(new URL('SHA256SUMS.txt', directory), 'utf8');
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.name, directory));
    assert.equal(bytes.length, file.bytes);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.ok(sums.includes(`${file.sha256}  ${file.name}`));
    assert.ok(page.includes(`href="./${latest.version}/${file.name}" download="${file.name}"`));
    assert.ok(page.includes(file.sha256));
  }
  assert.ok(!/<script|<form|https:\/\/github\.com\/.*releases\/download/i.test(page));
});
test('installer navigation and binaries bypass the PWA cache; normal app still works', async () => {
  const listeners = {};
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const context = { URL, self: { location: { href: 'https://example.org/forgeboard-studio/sw.js', origin: 'https://example.org' }, addEventListener: (name, handler) => { listeners[name] = handler; } }, fetch: async () => ({ clone: () => ({}) }), caches: { match: async () => undefined, open: async () => ({ put: async () => undefined }) } };
  vm.runInNewContext(sw, context);
  for (const path of ['downloads/', 'downloads/0.2.0/Forgeboard-Notes.apk', 'downloads/0.2.0/Niki-Notes.apk']) {
    for (const mode of ['navigate', 'no-cors']) {
      let intercepted = false;
      listeners.fetch({ request: { url: `https://example.org/forgeboard-studio/${path}`, method: 'GET', mode }, respondWith: () => { intercepted = true; } });
      assert.equal(intercepted, false, `${mode}: ${path}`);
    }
  }
  let response;
  listeners.fetch({ request: { url: 'https://example.org/forgeboard-studio/', method: 'GET', mode: 'navigate' }, respondWith: value => { response = value; } });
  assert.ok(await response);
});
