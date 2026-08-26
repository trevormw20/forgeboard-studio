import { createId, isoNow } from './ids'
import type { ConflictRecord, Workspace } from '../types'

type Entity = { id: string; updatedAt?: string; deletedAt?: string }

const unionArrayKeys = new Set(['rescheduleLog'])

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function unionById(left: unknown[], right: unknown[]): unknown[] {
  const map = new Map<string, unknown>()
  for (const item of [...left, ...right]) {
    const id = typeof item === 'object' && item && 'id' in item ? String((item as { id: unknown }).id) : JSON.stringify(item)
    map.set(id, item)
  }
  return [...map.values()]
}

function mergeEntity(
  entityType: string,
  base: Entity | undefined,
  local: Entity,
  remote: Entity,
  conflicts: ConflictRecord[],
): Entity {
  if (same(local, remote)) return local
  if (base && same(local, base)) return remote
  if (base && same(remote, base)) return local

  const localNewer = (local.updatedAt ?? '') >= (remote.updatedAt ?? '')
  const winner = localNewer ? local : remote
  const merged: Record<string, unknown> = { ...winner }
  const baseRecord = (base ?? {}) as Record<string, unknown>
  const localRecord = local as Record<string, unknown>
  const remoteRecord = remote as Record<string, unknown>
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})])

  for (const key of keys) {
    if (key === 'id') continue
    const baseValue = baseRecord[key]
    const localValue = localRecord[key]
    const remoteValue = remoteRecord[key]
    if (same(localValue, remoteValue)) {
      merged[key] = localValue
    } else if (same(localValue, baseValue)) {
      merged[key] = remoteValue
    } else if (same(remoteValue, baseValue)) {
      merged[key] = localValue
    } else if (unionArrayKeys.has(key) && Array.isArray(localValue) && Array.isArray(remoteValue)) {
      merged[key] = unionById(localValue, remoteValue)
    }
  }

  conflicts.push({
    id: createId('conflict'),
    entityType,
    entityId: local.id,
    detectedAt: isoNow(),
    local,
    remote,
    resolution: `Kept the ${(localNewer ? 'local' : 'remote')} version and preserved both snapshots here.`,
  })
  return merged as Entity
}

function mergeCollection<T extends Entity>(
  entityType: string,
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
  conflicts: ConflictRecord[],
): T[] {
  const base = new Map(baseItems.map((item) => [item.id, item]))
  const local = new Map(localItems.map((item) => [item.id, item]))
  const remote = new Map(remoteItems.map((item) => [item.id, item]))
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()])
  const merged: T[] = []

  for (const id of ids) {
    const b = base.get(id)
    const l = local.get(id)
    const r = remote.get(id)
    if (l && r) merged.push(mergeEntity(entityType, b, l, r, conflicts) as T)
    else if (l) merged.push(l)
    else if (r) merged.push(r)
  }
  return merged
}

export function mergeWorkspaces(base: Workspace | undefined, local: Workspace, remote: Workspace): Workspace {
  const conflicts = [...local.conflicts, ...remote.conflicts]
  const merged: Workspace = {
    ...remote,
    id: remote.id || local.id,
    name: (local.updatedAt >= remote.updatedAt ? local.name : remote.name) || 'Forgeboard Studio',
    updatedAt: isoNow(),
    projects: mergeCollection('project', base?.projects ?? [], local.projects, remote.projects, conflicts),
    tasks: mergeCollection('task', base?.tasks ?? [], local.tasks, remote.tasks, conflicts),
    milestones: mergeCollection('milestone', base?.milestones ?? [], local.milestones, remote.milestones, conflicts),
    deadlines: mergeCollection('deadline', base?.deadlines ?? [], local.deadlines, remote.deadlines, conflicts),
    inboxNotes: mergeCollection('inbox-note', base?.inboxNotes ?? [], local.inboxNotes, remote.inboxNotes, conflicts),
    activity: unionById(local.activity, remote.activity) as Workspace['activity'],
    reports: unionById(local.reports, remote.reports) as Workspace['reports'],
    conflicts: unionById(conflicts, []) as ConflictRecord[],
    ai: (local.ai.updatedAt ?? '') >= (remote.ai.updatedAt ?? '') ? local.ai : remote.ai,
  }
  return merged
}
