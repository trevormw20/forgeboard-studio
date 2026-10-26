import type { ConnectionConfig, Workspace } from '../types'

const API_VERSION = '2022-11-28'

export class GitHubSyncError extends Error {
  status?: number
  retryAt?: number
  constructor(message: string, status?: number, retryAt?: number) {
    super(message)
    this.name = 'GitHubSyncError'
    this.status = status
    this.retryAt = retryAt
  }
}

type CachedResponse = { etag?: string; body: unknown }
type InboxEntry = { type: string; path: string; size: number; sha?: string }
type ContentsFile = { content: string; sha?: string }
type ConnectionCache = { responses: Map<string, CachedResponse>; files: Map<string, { sha: string; text: string }> }
// Credentials are used only as an in-memory cache boundary, never persisted or
// logged. Changing the token, repository, branch, or workspace path cannot reuse
// another connection's authorized responses.
const connectionCaches = new Map<string, ConnectionCache>()

function cacheFor(config: ConnectionConfig): ConnectionCache {
  const key = JSON.stringify([config.owner, config.repo, config.branch, config.path, config.token])
  let cached = connectionCaches.get(key)
  if (cached) { connectionCaches.delete(key); connectionCaches.set(key, cached); return cached }
  cached = { responses: new Map(), files: new Map() }
  connectionCaches.set(key, cached)
  // Switching accounts repeatedly should not retain old private workspaces in
  // memory indefinitely. A fresh authenticated GET restores an evicted cache.
  if (connectionCaches.size > 4) connectionCaches.delete(connectionCaches.keys().next().value!)
  return cached
}

function retryAt(response: Response): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined
  const now = Date.now()
  const after = response.headers.get('Retry-After')?.trim()
  if (after) {
    const seconds = Number(after)
    const at = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(after)
    if (Number.isFinite(at)) return Math.max(now + 1000, at)
  }
  const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000
  return Number.isFinite(reset) && reset > now ? reset : now + 60_000
}

async function responseError(response: Response): Promise<GitHubSyncError> {
  const body = await response.json().catch(() => ({})) as { message?: string }
  return new GitHubSyncError(friendlyError(response.status, body.message), response.status, retryAt(response))
}

async function getJson<T>(config: ConnectionConfig, url: string, cache: ConnectionCache, allowMissing = false): Promise<T | undefined> {
  const previous = cache.responses.get(url)
  const response = await fetch(url, {
    headers: { ...headers(config), ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}) },
    cache: 'no-store',
  })
  if (response.status === 304) {
    if (!previous) throw new GitHubSyncError('GitHub returned an empty cache response. Please sync again.', 304)
    return structuredClone(previous.body) as T
  }
  if (!response.ok) {
    cache.responses.delete(url)
    if (allowMissing && response.status === 404) return undefined
    throw await responseError(response)
  }
  const body = await response.json() as T
  cache.responses.set(url, { etag: response.headers.get('ETag') ?? undefined, body: structuredClone(body) })
  return body
}

function headers(config: ConnectionConfig): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'X-GitHub-Api-Version': API_VERSION,
  }
}

function endpoint(config: ConnectionConfig): string {
  const path = config.path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}`
}

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, '')), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export async function fetchTaskInbox(config: ConnectionConfig): Promise<{ path: string; text: string }[]> {
  const cache = cacheFor(config)
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/`
  const fileUrl = (path: string) => `${root}${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(config.branch)}`
  const entries = await getJson<InboxEntry[]>(config, fileUrl('data/task-inbox'), cache, true)
  if (!entries) {
    for (const path of cache.files.keys()) cache.responses.delete(fileUrl(path))
    cache.files.clear()
    return []
  }
  if (!Array.isArray(entries)) throw new Error('data/task-inbox must be a folder.')
  const files = entries.filter((entry) => entry.type === 'file' && entry.path.endsWith('.json'))
  if (entries.length >= 1000) throw new Error('Archive processed inbox files: GitHub directory listings are limited to 1,000 entries.')
  const activePaths = new Set(files.map((file) => file.path))
  for (const path of cache.files.keys()) if (!activePaths.has(path)) { cache.files.delete(path); cache.responses.delete(fileUrl(path)) }
  const result: { path: string; text: string }[] = []
  // Small batches avoid flooding GitHub with simultaneous requests.
  for (let i = 0; i < files.length; i += 5) {
    const batch = await Promise.all(files.slice(i, i + 5).map(async (file) => {
      if (file.size > 200_000) return { path: file.path, text: '{}' }
      const existing = cache.files.get(file.path)
      if (file.sha && existing?.sha === file.sha) return { path: file.path, text: existing.text }
      const body = await getJson<ContentsFile>(config, fileUrl(file.path), cache)
      const text = decodeBase64(body!.content)
      const sha = body!.sha ?? file.sha
      if (sha) cache.files.set(file.path, { sha, text })
      return { path: file.path, text }
    }))
    result.push(...batch)
  }
  return result
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function friendlyError(status: number, message?: string): string {
  if (status === 401) return 'GitHub rejected the token. Replace it with a valid fine-grained token.'
  if (status === 403) return 'The token cannot write this repository, or its rate limit was reached. Check Contents: Read and write.'
  if (status === 404) return 'The repository or workspace file was not found. Check owner, private repository name, main branch, data/workspace.json, token repository access, Contents: Read and write, and that the file exists.'
  if (status === 409) return 'The workspace changed on another device. Forgeboard will merge it and retry.'
  return message ? `GitHub error: ${message}` : `GitHub returned ${status}.`
}

export async function fetchWorkspace(config: ConnectionConfig): Promise<{ workspace: Workspace; sha: string }> {
  const body = (await getJson<{ content: string; sha: string }>(config, `${endpoint(config)}?ref=${encodeURIComponent(config.branch)}`, cacheFor(config)))!
  try {
    return { workspace: JSON.parse(decodeBase64(body.content)) as Workspace, sha: body.sha }
  } catch {
    throw new GitHubSyncError('The workspace file exists, but it is not valid Forgeboard JSON.')
  }
}

export async function putWorkspace(config: ConnectionConfig, workspace: Workspace, sha: string): Promise<string> {
  const response = await fetch(endpoint(config), {
    method: 'PUT',
    headers: { ...headers(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `[Forgeboard] sync ${new Date().toISOString()}`,
      content: encodeBase64(`${JSON.stringify(workspace, null, 2)}\n`),
      sha,
      branch: config.branch,
    }),
  })
  if (!response.ok) {
    throw await responseError(response)
  }
  const body = await response.json() as { content: { sha: string } }
  cacheFor(config).responses.delete(`${endpoint(config)}?ref=${encodeURIComponent(config.branch)}`)
  return body.content.sha
}
