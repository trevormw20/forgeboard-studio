import { openDB, type DBSchema } from 'idb'
import type { ConnectionConfig, MutationRecord, Workspace } from '../types'

interface ForgeboardDb extends DBSchema {
  state: {
    key: string
    value: unknown
  }
  outbox: {
    key: string
    value: MutationRecord
    indexes: { at: string }
  }
}

const dbPromise = openDB<ForgeboardDb>('forgeboard-device-cache', 1, {
  upgrade(db) {
    db.createObjectStore('state')
    const outbox = db.createObjectStore('outbox', { keyPath: 'id' })
    outbox.createIndex('at', 'at')
  },
})

export async function loadCachedWorkspace(): Promise<Workspace | undefined> {
  return (await (await dbPromise).get('state', 'workspace')) as Workspace | undefined
}

export async function saveCachedWorkspace(workspace: Workspace): Promise<void> {
  await (await dbPromise).put('state', workspace, 'workspace')
}

// The recoverable workspace and its sync queue must reach disk together.
export async function saveWorkspaceChanges(workspace: Workspace, mutations: MutationRecord[]): Promise<void> {
  const transaction = (await dbPromise).transaction(['state', 'outbox'], 'readwrite')
  await Promise.all([
    transaction.objectStore('state').put(workspace, 'workspace'),
    ...mutations.map((mutation) => transaction.objectStore('outbox').put(mutation)),
    transaction.done,
  ])
}

export async function loadBaseWorkspace(): Promise<Workspace | undefined> {
  return (await (await dbPromise).get('state', 'baseWorkspace')) as Workspace | undefined
}

export async function saveBaseWorkspace(workspace: Workspace): Promise<void> {
  await (await dbPromise).put('state', workspace, 'baseWorkspace')
}

export async function loadConnection(): Promise<ConnectionConfig | undefined> {
  return (await (await dbPromise).get('state', 'connection')) as ConnectionConfig | undefined
}

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  const stored = config.rememberToken ? config : { ...config, token: '' }
  await (await dbPromise).put('state', stored, 'connection')
}

export async function clearConnection(): Promise<void> {
  await (await dbPromise).delete('state', 'connection')
}

// Display preferences belong to this browser, not the shared planner workspace.
export async function loadAppScale(): Promise<unknown> {
  return (await dbPromise).get('state', 'appScale')
}

export async function saveAppScale(scale: number): Promise<void> {
  await (await dbPromise).put('state', scale, 'appScale')
}

export async function loadSha(): Promise<string | undefined> {
  return (await (await dbPromise).get('state', 'sha')) as string | undefined
}

export async function saveSha(sha: string): Promise<void> {
  await (await dbPromise).put('state', sha, 'sha')
}

export async function enqueueMutation(record: MutationRecord): Promise<void> {
  await (await dbPromise).put('outbox', record)
}

export async function countMutations(): Promise<number> {
  return (await dbPromise).count('outbox')
}

export async function mutationIds(): Promise<string[]> {
  return (await dbPromise).getAllKeys('outbox')
}

export async function clearMutations(ids: string[]): Promise<void> {
  const transaction = (await dbPromise).transaction('outbox', 'readwrite')
  for (const id of ids) void transaction.store.delete(id)
  await transaction.done
}
