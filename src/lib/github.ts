import type { ConnectionConfig, Workspace } from '../types'

const API_VERSION = '2022-11-28'

export class GitHubSyncError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubSyncError'
    this.status = status
  }
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
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/`
  const response = await fetch(`${root}data/task-inbox?ref=${encodeURIComponent(config.branch)}`, { headers: headers(config), cache: 'no-store' })
  if (response.status === 404) return []
  if (!response.ok) throw new GitHubSyncError(friendlyError(response.status), response.status)
  const entries = await response.json() as { type: string; path: string; size: number }[]
  if (!Array.isArray(entries)) throw new Error('data/task-inbox must be a folder.')
  const files = entries.filter((entry) => entry.type === 'file' && entry.path.endsWith('.json'))
  if (entries.length >= 1000) throw new Error('Archive processed inbox files: GitHub directory listings are limited to 1,000 entries.')
  const result: { path: string; text: string }[] = []
  // Small batches avoid flooding GitHub with simultaneous requests.
  for (let i = 0; i < files.length; i += 5) {
    const batch = await Promise.all(files.slice(i, i + 5).map(async (file) => {
      if (file.size > 200_000) return { path: file.path, text: '{}' }
      const path = file.path.split('/').map(encodeURIComponent).join('/')
      const reply = await fetch(`${root}${path}?ref=${encodeURIComponent(config.branch)}`, { headers: headers(config), cache: 'no-store' })
      if (!reply.ok) throw new GitHubSyncError(friendlyError(reply.status), reply.status)
      const body = await reply.json() as { content: string }
      return { path: file.path, text: decodeBase64(body.content) }
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
  const response = await fetch(`${endpoint(config)}?ref=${encodeURIComponent(config.branch)}`, { headers: headers(config), cache: 'no-store' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new GitHubSyncError(friendlyError(response.status, body.message), response.status)
  }
  const body = await response.json() as { content: string; sha: string }
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
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new GitHubSyncError(friendlyError(response.status, body.message), response.status)
  }
  const body = await response.json() as { content: { sha: string } }
  return body.content.sha
}
