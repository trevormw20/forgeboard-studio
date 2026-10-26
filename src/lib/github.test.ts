import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeedWorkspace } from '../seed'
import type { ConnectionConfig } from '../types'

let github: typeof import('./github')
const request = vi.fn<typeof fetch>()
const config: ConnectionConfig = { owner: 'fixture-owner', repo: 'private-fixture', branch: 'main', path: 'data/workspace.json', token: 'fixture-token-not-a-real-secret', rememberToken: false }
const inboxPath = (name: string) => `data/task-inbox/${name}.json`
const entry = (name: string, sha = name) => ({ type: 'file', path: inboxPath(name), size: 30, sha })
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers })
const unchanged = () => new Response(null, { status: 304 })
const encoded = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)))
const file = (text: string, sha: string, etag?: string) => json({ content: encoded(text), sha }, 200, etag ? { ETag: etag } : undefined)
const sentHeaders = (index: number) => new Headers(request.mock.calls[index][1]?.headers)

beforeEach(async () => {
  vi.resetModules()
  github = await import('./github')
  request.mockReset()
  vi.stubGlobal('fetch', request)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('efficient authorized GitHub polling', () => {
  it('polls only the directory when inbox SHAs have not changed, including a real 304 response', async () => {
    request.mockResolvedValueOnce(json([entry('a'), entry('b')], 200, { ETag: '"inbox-v1"' }))
      .mockResolvedValueOnce(file('First task', 'a'))
      .mockResolvedValueOnce(file('Second task', 'b'))
      .mockResolvedValueOnce(unchanged())
    const first = await github.fetchTaskInbox(config)
    first[0].text = 'Caller mutation must not leak'
    const next = await github.fetchTaskInbox(config)
    expect(next).toEqual([{ path: inboxPath('a'), text: 'First task' }, { path: inboxPath('b'), text: 'Second task' }])
    expect(request).toHaveBeenCalledTimes(4)
    expect(sentHeaders(3).get('If-None-Match')).toBe('"inbox-v1"')
    expect(sentHeaders(3).get('Authorization')).toBe(`Bearer ${config.token}`)
    expect(request.mock.calls[3][1]?.cache).toBe('no-store')
  })

  it('downloads only changed or new SHAs and drops removed paths from later results', async () => {
    request.mockResolvedValueOnce(json([entry('a'), entry('b'), entry('removed')], 200, { ETag: '"v1"' }))
      .mockResolvedValueOnce(file('A', 'a')).mockResolvedValueOnce(file('B', 'b')).mockResolvedValueOnce(file('Gone', 'removed'))
      .mockResolvedValueOnce(json([entry('a'), entry('b', 'b-v2'), entry('new')], 200, { ETag: '"v2"' }))
      .mockResolvedValueOnce(file('Updated B', 'b-v2')).mockResolvedValueOnce(file('New', 'new'))
      .mockResolvedValueOnce(unchanged())
    await github.fetchTaskInbox(config)
    const next = await github.fetchTaskInbox(config)
    expect(request).toHaveBeenCalledTimes(7)
    expect(String(request.mock.calls[5][0])).toContain('data/task-inbox/b.json?ref=main')
    expect(String(request.mock.calls[6][0])).toContain('data/task-inbox/new.json?ref=main')
    expect(next).toEqual([{ path: inboxPath('a'), text: 'A' }, { path: inboxPath('b'), text: 'Updated B' }, { path: inboxPath('new'), text: 'New' }])
    expect(await github.fetchTaskInbox(config)).toEqual(next)
    expect(request).toHaveBeenCalledTimes(8)
    expect(sentHeaders(7).get('If-None-Match')).toBe('"v2"')
  })

  it('reuses a cached file body for an authorized 304 if a listing has no SHA', async () => {
    const noSha = { type: 'file', path: inboxPath('legacy'), size: 30 }
    request.mockResolvedValueOnce(json([noSha], 200, { ETag: '"list"' }))
      .mockResolvedValueOnce(file('Still available', 'blob-sha', '"blob"'))
      .mockResolvedValueOnce(unchanged()).mockResolvedValueOnce(unchanged())
    await github.fetchTaskInbox(config)
    expect(await github.fetchTaskInbox(config)).toEqual([{ path: inboxPath('legacy'), text: 'Still available' }])
    expect(sentHeaders(3).get('If-None-Match')).toBe('"blob"')
  })

  it('returns an independently parsed workspace on 304 instead of an empty or mutated workspace', async () => {
    const workspace = createSeedWorkspace()
    workspace.projects[0].name = 'Notes ✓'
    request.mockResolvedValueOnce(file(JSON.stringify(workspace), 'workspace-sha', '"workspace"')).mockResolvedValueOnce(unchanged())
    const first = await github.fetchWorkspace(config)
    first.workspace.projects[0].name = 'Do not mutate the remote snapshot'
    const next = await github.fetchWorkspace(config)
    expect(next.sha).toBe('workspace-sha')
    expect(next.workspace.projects[0].name).toBe('Notes ✓')
    expect(sentHeaders(1).get('If-None-Match')).toBe('"workspace"')
  })

  it.each([
    ['owner', 'other-owner'], ['repo', 'other-private-repo'], ['branch', 'other-branch'], ['path', 'other/workspace.json'], ['token', 'other-fixture-token'],
  ] as const)('isolates cached private responses when %s changes', async (field, value) => {
    const workspace = createSeedWorkspace()
    request.mockResolvedValueOnce(file(JSON.stringify(workspace), 'first', '"first"'))
      .mockResolvedValueOnce(file(JSON.stringify(workspace), 'second', '"second"')).mockResolvedValueOnce(unchanged())
    await github.fetchWorkspace(config)
    expect((await github.fetchWorkspace({ ...config, [field]: value })).sha).toBe('second')
    expect(sentHeaders(1).has('If-None-Match')).toBe(false)
    expect((await github.fetchWorkspace(config)).sha).toBe('first')
    expect(sentHeaders(2).get('If-None-Match')).toBe('"first"')
  })

  it('does not reuse another token’s inbox file text when the repository and SHA are identical', async () => {
    request.mockResolvedValueOnce(json([entry('a')])).mockResolvedValueOnce(file('Original token content', 'a'))
      .mockResolvedValueOnce(json([entry('a')])).mockResolvedValueOnce(file('New token content', 'a'))
    await github.fetchTaskInbox(config)
    expect(await github.fetchTaskInbox({ ...config, token: 'another-fixture-token' })).toEqual([{ path: inboxPath('a'), text: 'New token content' }])
    expect(request).toHaveBeenCalledTimes(4)
    expect(sentHeaders(2).has('If-None-Match')).toBe(false)
  })

  it.each([401, 403])('throws on a %s inbox response rather than silently serving old private tasks', async (status) => {
    request.mockResolvedValueOnce(json([entry('a')], 200, { ETag: '"list"' })).mockResolvedValueOnce(file('Private task', 'a'))
      .mockResolvedValueOnce(json({ message: 'Not authorized' }, status)).mockResolvedValueOnce(unchanged())
    await github.fetchTaskInbox(config)
    await expect(github.fetchTaskInbox(config)).rejects.toMatchObject({ name: 'GitHubSyncError', status })
    await expect(github.fetchTaskInbox(config)).rejects.toMatchObject({ status: 304 })
    expect(sentHeaders(3).has('If-None-Match')).toBe(false)
  })

  it('accepts a missing inbox without treating it as an external feed and forgets removed cached files', async () => {
    request.mockResolvedValueOnce(json([entry('a')], 200, { ETag: '"list"' })).mockResolvedValueOnce(file('Old', 'a'))
      .mockResolvedValueOnce(json({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(json([entry('a')])).mockResolvedValueOnce(file('Downloaded again', 'a'))
    await github.fetchTaskInbox(config)
    expect(await github.fetchTaskInbox(config)).toEqual([])
    expect(await github.fetchTaskInbox(config)).toEqual([{ path: inboxPath('a'), text: 'Downloaded again' }])
    expect(sentHeaders(3).has('If-None-Match')).toBe(false)
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('rejects a 304 response that has no authenticated cached body', async () => {
    request.mockResolvedValueOnce(unchanged())
    await expect(github.fetchWorkspace(config)).rejects.toMatchObject({ name: 'GitHubSyncError', status: 304 })
  })

  it('invalidates the old workspace ETag after a successful PUT and encodes Unicode correctly', async () => {
    const workspace = createSeedWorkspace()
    request.mockResolvedValueOnce(file(JSON.stringify(workspace), 'before', '"before"'))
      .mockResolvedValueOnce(json({ content: { sha: 'after' } })).mockResolvedValueOnce(file(JSON.stringify(workspace), 'after', '"after"'))
    await github.fetchWorkspace(config)
    workspace.projects[0].name = 'My notes ✓'
    expect(await github.putWorkspace(config, workspace, 'before')).toBe('after')
    expect((await github.fetchWorkspace(config)).sha).toBe('after')
    expect(sentHeaders(2).has('If-None-Match')).toBe(false)
    const payload = JSON.parse(String(request.mock.calls[1][1]?.body)) as { content: string; sha: string }
    expect(payload.sha).toBe('before')
    const text = new TextDecoder().decode(Uint8Array.from(atob(payload.content), (character) => character.charCodeAt(0)))
    expect(JSON.parse(text).projects[0].name).toBe('My notes ✓')
  })

  it.each([
    [429, { 'Retry-After': '120' }, 120_000],
    [403, { 'Retry-After': 'Mon, 26 Oct 2026 18:02:00 GMT' }, 120_000],
    [403, { 'X-RateLimit-Reset': String(Date.parse('2026-10-26T18:03:00Z') / 1000) }, 180_000],
    [429, {}, 60_000],
    [403, { 'Retry-After': 'invalid', 'X-RateLimit-Reset': 'invalid' }, 60_000],
  ])('provides a safe retry deadline for status %s with %j', async (status, retryHeaders, delay) => {
    const now = Date.parse('2026-10-26T18:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    request.mockResolvedValueOnce(json({ message: 'Slow down' }, Number(status), retryHeaders as HeadersInit))
    await expect(github.fetchWorkspace(config)).rejects.toMatchObject({ status, retryAt: now + Number(delay) })
  })

  it('exposes rate backoff on inbox requests and PUTs as well as workspace reads', async () => {
    const now = Date.parse('2026-10-26T18:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    request.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '30' })).mockResolvedValueOnce(json({}, 403, { 'Retry-After': '45' }))
    await expect(github.fetchTaskInbox(config)).rejects.toMatchObject({ status: 429, retryAt: now + 30_000 })
    await expect(github.putWorkspace(config, createSeedWorkspace(), 'sha')).rejects.toMatchObject({ status: 403, retryAt: now + 45_000 })
  })
})
