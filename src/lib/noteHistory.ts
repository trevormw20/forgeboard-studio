import type { NoteChecklistItem, PersonalNote } from '../types'

export const NOTE_HISTORY_LIMIT = 100
export const NOTE_TYPING_GROUP_MS = 1_500

const noteFields = ['title', 'body', 'color', 'labelIds', 'pinned'] as const
const itemFields = ['text', 'parentId', 'order', 'completedAt', 'deletedAt'] as const

export class NoteHistoryConflictError extends Error {
  constructor(message = 'This part of the note changed elsewhere. Undo or redo was not applied, so the newer work stays safe.') {
    super(message)
    this.name = 'NoteHistoryConflictError'
  }
}

/** History is session-local and detached from both live state and future edits. */
export function snapshotNote(note: PersonalNote): PersonalNote {
  return structuredClone(note)
}

function equal(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => equal(value, right[index]))
  return left === right
}

function itemsById(note: PersonalNote): Map<string, NoteChecklistItem> {
  const items = note.checklist ?? []
  const map = new Map(items.map((item) => [item.id, item]))
  if (map.size !== items.length) throw new NoteHistoryConflictError('This checklist has duplicate item identities. History was not applied.')
  return map
}

/** Timestamps and array storage order are not edits a user should undo. */
export function hasNoteHistoryChanges(before: PersonalNote, after: PersonalNote): boolean {
  if (noteFields.some((field) => !equal(before[field], after[field]))) return true
  const earlier = itemsById(before), later = itemsById(after)
  if (earlier.size !== later.size) return true
  for (const [id, item] of earlier) {
    const next = later.get(id)
    if (!next || itemFields.some((field) => !equal(item[field], next[field]))) return true
  }
  return false
}

function sameScope(left: PersonalNote, right: PersonalNote): boolean {
  return left.id === right.id && left.projectId === right.projectId && left.parentId === right.parentId && left.createdAt === right.createdAt
}

function sameItem(left: NoteChecklistItem, right: NoteChecklistItem): boolean {
  return left.createdAt === right.createdAt && itemFields.every((field) => equal(left[field], right[field]))
}

/** Apply only fields changed by one local action, never an old whole-note or
 * workspace snapshot. A conflicting touched field aborts the entire action.
 * The caller records the actual current/result pair for the reverse operation:
 * an undone insertion now exists as a tombstone, not as a missing item. */
export function replayNoteHistory(current: PersonalNote | undefined, expected: PersonalNote, target: PersonalNote, now: string): PersonalNote {
  if (!current || current.deletedAt || expected.deletedAt || target.deletedAt || !sameScope(current, expected) || !sameScope(expected, target)) {
    throw new NoteHistoryConflictError('This note was moved, deleted, or replaced. Its history was not applied.')
  }
  if (!Number.isFinite(Date.parse(now))) throw new NoteHistoryConflictError('History needs a valid save time.')
  const result = snapshotNote(current)
  const previous = itemsById(expected), desired = itemsById(target), live = itemsById(result)
  const hierarchyChanged = new Set<string>(), removed = new Set<string>()
  let changed = false
  for (const field of noteFields) {
    if (equal(expected[field], target[field])) continue
    if (!equal(current[field], expected[field])) throw new NoteHistoryConflictError()
    // These properties have different value types; copying one field at a time
    // retains the current note's unrelated fields and its permanent identity.
    Object.assign(result, { [field]: structuredClone(target[field]) })
    changed = true
  }
  let deletion = now
  const usedDeletions = new Set([...live.values()].map((item) => item.deletedAt))
  while (usedDeletions.has(deletion)) deletion = new Date(Date.parse(deletion) + 1).toISOString()
  for (const id of new Set([...previous.keys(), ...desired.keys()])) {
    const before = previous.get(id), after = desired.get(id), item = live.get(id)
    if (!before && after) {
      if (item) throw new NoteHistoryConflictError()
      const added = { ...after, updatedAt: now }
      result.checklist ??= []
      result.checklist.push(added)
      live.set(id, added)
      hierarchyChanged.add(id)
      changed = true
      continue
    }
    if (before && !after) {
      // Undoing creation must not discard edits or children added on a second
      // device. Keep a tombstone so subsequent GitHub merges cannot revive it.
      if (!item || !sameItem(item, before)) throw new NoteHistoryConflictError()
      item.deletedAt = deletion
      item.updatedAt = now
      removed.add(id)
      changed = true
      continue
    }
    if (!before || !after || !itemFields.some((field) => !equal(before[field], after[field]))) continue
    if (!item || before.createdAt !== after.createdAt || item.createdAt !== before.createdAt || item.deletedAt !== before.deletedAt) throw new NoteHistoryConflictError()
    for (const field of itemFields) {
      if (equal(before[field], after[field])) continue
      if (!equal(item[field], before[field])) throw new NoteHistoryConflictError()
      Object.assign(item, { [field]: after[field] })
      if (field === 'parentId' || field === 'deletedAt') hierarchyChanged.add(id)
    }
    if (after.deletedAt) removed.add(id)
    item.updatedAt = now
    changed = true
  }
  // An independent remote child is not part of the original deletion batch.
  // Refuse to strand it by undoing a newly-created parent or replaying trash.
  for (const item of live.values()) {
    if (!item.deletedAt && item.parentId && removed.has(item.parentId)) throw new NoteHistoryConflictError()
  }
  for (const id of hierarchyChanged) {
    const item = live.get(id)!
    if (item.deletedAt) continue
    const seen = new Set([id])
    let parentId = item.parentId
    while (parentId) {
      const parent = live.get(parentId)
      if (!parent || parent.deletedAt || seen.has(parentId)) throw new NoteHistoryConflictError('The checklist hierarchy changed elsewhere. History was not applied.')
      seen.add(parentId)
      parentId = parent.parentId
    }
  }
  if (changed) result.updatedAt = now
  return result
}
