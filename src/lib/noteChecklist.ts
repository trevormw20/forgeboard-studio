import type { NoteChecklistItem, PersonalNote, Workspace } from '../types'

export type ChecklistDirection = 'indent' | 'outdent' | 'up' | 'down'
export interface ChecklistItemInput { text: string; parentId?: string; afterId?: string }
export interface ChecklistDropPosition { parentId?: string; beforeId?: string }

const MAX_ITEMS = 5_000
const MAX_TEXT = 10_000

function validText(text: string): string {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Keep each checklist item under 10,000 characters.')
  return text
}

/** Snapshot recovery accepts content, never arbitrary item/project identity fields. */
export function validateNoteChecklist(input: NoteChecklistItem[]): NoteChecklistItem[] {
  if (!Array.isArray(input) || input.length > MAX_ITEMS) throw new Error('A note can contain up to 5,000 checklist items.')
  const ids = new Set<string>()
  const items = input.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || ids.has(item.id)) throw new Error('Each checklist item needs its own valid identity.')
    ids.add(item.id)
    if (!Number.isFinite(item.order) || Math.abs(item.order) > 1_000_000_000) throw new Error('This checklist has an invalid item order.')
    for (const at of [item.createdAt, item.updatedAt]) if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error('This checklist has an invalid date.')
    for (const at of [item.completedAt, item.deletedAt]) if (at !== undefined && (typeof at !== 'string' || !Number.isFinite(Date.parse(at)))) throw new Error('This checklist has an invalid date.')
    if (item.parentId !== undefined && (typeof item.parentId !== 'string' || !item.parentId)) throw new Error('Choose a valid parent checklist item.')
    return { id: item.id, text: validText(item.text), parentId: item.parentId, order: item.order, createdAt: item.createdAt, updatedAt: item.updatedAt, completedAt: item.completedAt, deletedAt: item.deletedAt }
  })
  const map = new Map(items.map((item) => [item.id, item]))
  for (const item of items) {
    const seen = new Set([item.id])
    let cursor = item.parentId ? map.get(item.parentId) : undefined
    if (item.parentId && !cursor) throw new Error('A checklist parent must belong to the same note.')
    while (cursor) {
      if (seen.has(cursor.id)) throw new Error('A checklist item cannot be nested inside itself or its descendants.')
      seen.add(cursor.id)
      cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
    }
  }
  return items
}

function compare(left: NoteChecklistItem, right: NoteChecklistItem): number {
  const order = (Number.isFinite(left.order) ? left.order : 0) - (Number.isFinite(right.order) ? right.order : 0)
  return order || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

/** Broken links from concurrent edits become visible roots, not missing work. */
function safeParent(item: NoteChecklistItem, map: Map<string, NoteChecklistItem>, includeDeleted = false): string | undefined {
  const seen = new Set([item.id])
  let cursor = item.parentId ? map.get(item.parentId) : undefined
  if (item.parentId && !cursor) return undefined
  while (cursor) {
    if ((!includeDeleted && cursor.deletedAt) || seen.has(cursor.id)) return undefined
    seen.add(cursor.id)
    if (cursor.parentId && !map.has(cursor.parentId)) return undefined
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  return item.parentId
}

/** Recover a whole saved version without carrying merge-created broken links
 * into a new note. Content/checkmarks/trash remain unchanged; only invalid
 * nesting is promoted to the same visible roots shown in the editor. */
export function recoverChecklistSnapshot(items: NoteChecklistItem[]): NoteChecklistItem[] {
  const map = new Map(items.map((item) => [item.id, item]))
  return validateNoteChecklist(items.map((item) => ({ ...item, parentId: safeParent(item, map, Boolean(item.deletedAt)) })))
}

function tree(items: NoteChecklistItem[], completedLast = false) {
  const active = items.filter((item) => !item.deletedAt)
  const map = new Map(active.map((item) => [item.id, item]))
  const parents = new Map(active.map((item) => [item.id, safeParent(item, map)]))
  const children = new Map<string | undefined, NoteChecklistItem[]>()
  for (const item of active) {
    const parent = parents.get(item.id)
    const siblings = children.get(parent) ?? []
    siblings.push(item)
    children.set(parent, siblings)
  }
  for (const siblings of children.values()) siblings.sort((left, right) => (completedLast ? Number(Boolean(left.completedAt)) - Number(Boolean(right.completedAt)) : 0) || compare(left, right))
  return { map, parents, children }
}

function flattenChecklist(items: NoteChecklistItem[], completedLast = false): { item: NoteChecklistItem; depth: number }[] {
  const { children } = tree(items, completedLast)
  const output: { item: NoteChecklistItem; depth: number }[] = []
  const stack = [...(children.get(undefined) ?? [])].reverse().map((item) => ({ item, depth: 0 }))
  const seen = new Set<string>()
  while (stack.length) {
    const row = stack.pop()!
    if (seen.has(row.item.id)) continue
    seen.add(row.item.id)
    output.push(row)
    for (const item of [...(children.get(row.item.id) ?? [])].reverse()) stack.push({ item, depth: row.depth + 1 })
  }
  return output
}

/** Canonical saved order is independent of checking and remains useful for
 * note titles, snapshots, and restoring an unchecked item's original place. */
export function orderedChecklist(items: NoteChecklistItem[]): { item: NoteChecklistItem; depth: number }[] {
  return flattenChecklist(items)
}

/** Keep each subtree together while moving checked siblings below open ones.
 * This is derived only: checking never rewrites another item's saved order. */
export function displayChecklist(items: NoteChecklistItem[]): { item: NoteChecklistItem; depth: number }[] {
  return flattenChecklist(items, true)
}

export function canMoveChecklistItem(items: NoteChecklistItem[], id: string, direction: ChecklistDirection): boolean {
  const { map, parents, children } = tree(items, true)
  const item = map.get(id)
  if (!item) return false
  const siblings = children.get(parents.get(id)) ?? []
  const index = siblings.findIndex((item) => item.id === id)
  if (direction === 'outdent') return Boolean(parents.get(id))
  if (direction === 'indent') return index > 0
  const neighbor = siblings[index + (direction === 'up' ? -1 : 1)]
  return Boolean(neighbor && Boolean(neighbor.completedAt) === Boolean(item.completedAt))
}

function getNote(workspace: Workspace, noteId: string): PersonalNote {
  const note = workspace.personalNotes?.find((note) => note.id === noteId && !note.deletedAt)
  if (!note) throw new Error('This note is unavailable. Restore it before editing its checklist.')
  return note
}

function getItem(note: PersonalNote, itemId: string): NoteChecklistItem {
  const item = note.checklist?.find((item) => item.id === itemId && !item.deletedAt)
  if (!item) throw new Error('This checklist item is unavailable in this note.')
  return item
}

function place(item: NoteChecklistItem, siblings: NoteChecklistItem[], index: number, now: string) {
  const before = siblings[index - 1]?.order, after = siblings[index]?.order
  let order = before === undefined ? (after === undefined ? 0 : after - 1) : after === undefined ? before + 1 : (before + after) / 2
  if (!Number.isFinite(order) || Math.abs(order) > 999_999_999 || (before !== undefined && after !== undefined && (order <= before || order >= after))) {
    siblings.forEach((sibling, i) => { sibling.order = i * 2; sibling.updatedAt = now })
    order = index === 0 ? -1 : index === siblings.length ? siblings.length * 2 : index * 2 - 1
  }
  item.order = order
  item.updatedAt = now
}

function repairParents(items: NoteChecklistItem[], parents: Map<string, string | undefined>, now: string) {
  for (const item of items.filter((entry) => !entry.deletedAt)) {
    if (item.parentId !== parents.get(item.id)) { item.parentId = parents.get(item.id); item.updatedAt = now }
  }
}

export function addChecklistItem(workspace: Workspace, noteId: string, input: ChecklistItemInput, id: string, now: string): string {
  const note = getNote(workspace, noteId)
  const text = validText(input.text)
  if ((note.checklist?.length ?? 0) >= MAX_ITEMS) throw new Error('This note already has 5,000 checklist items. Start another note.')
  if (note.checklist?.some((item) => item.id === id)) throw new Error('This checklist item identity is already in use.')
  if (input.parentId) getItem(note, input.parentId)
  const { parents, children } = tree(note.checklist ?? [])
  const after = input.afterId ? getItem(note, input.afterId) : undefined
  const parentId = input.parentId ?? (after ? parents.get(after.id) : undefined)
  if (after && parents.get(after.id) !== parentId) throw new Error('Place the new checklist item beside another item in the same group.')
  repairParents(note.checklist ?? [], parents, now)
  // Every newly captured row is unchecked. Place it among open siblings, not
  // against a checked boundary whose saved order may lie anywhere in the list.
  const siblings = (children.get(parentId) ?? []).filter((sibling) => !sibling.completedAt)
  const item: NoteChecklistItem = { id, text, parentId, order: 0, createdAt: now, updatedAt: now }
  place(item, siblings, after && !after.completedAt ? siblings.findIndex((sibling) => sibling.id === after.id) + 1 : siblings.length, now)
  note.checklist ??= []
  note.checklist.push(item)
  note.updatedAt = now
  return id
}

export function editChecklistItem(workspace: Workspace, noteId: string, itemId: string, input: { text: string }, now: string): void {
  const note = getNote(workspace, noteId), item = getItem(note, itemId)
  item.text = validText(input.text)
  item.parentId = tree(note.checklist!).parents.get(item.id)
  item.updatedAt = now
  note.updatedAt = now
}

export function toggleChecklistItem(workspace: Workspace, noteId: string, itemId: string, now: string): void {
  const note = getNote(workspace, noteId), item = getItem(note, itemId)
  item.completedAt = item.completedAt ? undefined : now
  item.updatedAt = now
  note.updatedAt = now
}

/** Move a whole branch to a precise visible position without changing its
 * checkmarks or the descendants' identities, nesting, or saved order. */
export function repositionChecklistItem(workspace: Workspace, noteId: string, itemId: string, position: ChecklistDropPosition, now: string): void {
  const note = getNote(workspace, noteId), item = getItem(note, itemId), items = note.checklist!
  const { parents, children } = tree(items, true)
  const { parentId, beforeId } = position
  if (parentId !== undefined) {
    getItem(note, parentId)
    if (descendants(items, itemId).has(parentId)) throw new Error('A checklist item cannot be nested inside itself or its descendants.')
  }
  const before = beforeId !== undefined ? getItem(note, beforeId) : undefined
  if (before && (parents.get(before.id) !== parentId || Boolean(before.completedAt) !== Boolean(item.completedAt))) {
    throw new Error('Place the checklist item beside another item in the same group and completion state.')
  }
  // Resolve and validate every destination before repairing or mutating any
  // row: invalid drops must leave the original note completely unchanged.
  if (before?.id === itemId) return
  const bucket = (children.get(parentId) ?? []).filter((sibling) => Boolean(sibling.completedAt) === Boolean(item.completedAt))
  const target = bucket.filter((sibling) => sibling.id !== itemId)
  const index = before ? target.findIndex((sibling) => sibling.id === before.id) : target.length
  const currentIndex = bucket.findIndex((sibling) => sibling.id === itemId)
  if (item.parentId === parentId && currentIndex === index) return
  repairParents(items, parents, now)
  item.parentId = parentId
  place(item, target, index, now)
  note.updatedAt = now
}

export function moveChecklistItem(workspace: Workspace, noteId: string, itemId: string, direction: ChecklistDirection, now: string): void {
  const note = getNote(workspace, noteId), item = getItem(note, itemId), items = note.checklist!
  if (!canMoveChecklistItem(items, itemId, direction)) return
  const { parents, children } = tree(items, true)
  // Concurrent parent moves can leave broken/cyclic links. Use the visible
  // hierarchy as the edit baseline, so an ordinary move can repair those rows.
  repairParents(items, parents, now)
  const parentId = parents.get(itemId), siblings = children.get(parentId)!
  const index = siblings.findIndex((sibling) => sibling.id === itemId)
  if (direction === 'indent') {
    item.parentId = siblings[index - 1].id
    const target = (children.get(item.parentId) ?? []).filter((sibling) => Boolean(sibling.completedAt) === Boolean(item.completedAt))
    place(item, target, target.length, now)
  } else if (direction === 'outdent') {
    const nextParent = parents.get(parentId!)
    const target = (children.get(nextParent) ?? []).filter((sibling) => Boolean(sibling.completedAt) === Boolean(item.completedAt))
    item.parentId = nextParent
    const parentIndex = target.findIndex((sibling) => sibling.id === parentId)
    place(item, target, parentIndex >= 0 ? parentIndex + 1 : target.length, now)
  } else {
    item.parentId = parentId
    const bucket = siblings.filter((sibling) => Boolean(sibling.completedAt) === Boolean(item.completedAt))
    const bucketIndex = bucket.findIndex((sibling) => sibling.id === itemId)
    const target = bucket.filter((sibling) => sibling.id !== itemId)
    place(item, target, direction === 'up' ? bucketIndex - 1 : bucketIndex + 1, now)
  }
  note.updatedAt = now
}

function descendants(items: NoteChecklistItem[], id: string): Set<string> {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true }
  }
  return ids
}

/** One recoverable root for every deletion batch, including disconnected cycles. */
export function deletedChecklistRoots(items: NoteChecklistItem[]): NoteChecklistItem[] {
  const deleted = items.filter((item) => item.deletedAt)
  const map = new Map(deleted.map((item) => [item.id, item]))
  const roots = new Map<string, NoteChecklistItem>(), visited = new Set<string>()
  for (const item of deleted) {
    if (visited.has(item.id)) continue
    const path: NoteChecklistItem[] = [], indexes = new Map<string, number>()
    let cursor: NoteChecklistItem | undefined = item
    while (cursor && !visited.has(cursor.id)) {
      const cycleStart = indexes.get(cursor.id)
      if (cycleStart !== undefined) {
        const root = path.slice(cycleStart).sort((left, right) => left.id.localeCompare(right.id))[0]
        roots.set(root.id, root)
        break
      }
      indexes.set(cursor.id, path.length)
      path.push(cursor)
      const parent: NoteChecklistItem | undefined = cursor.parentId ? map.get(cursor.parentId) : undefined
      if (!parent || parent.deletedAt !== cursor.deletedAt) { roots.set(cursor.id, cursor); break }
      cursor = parent
    }
    for (const member of path) visited.add(member.id)
  }
  return [...roots.values()].sort(compare)
}

export function removeChecklistItem(workspace: Workspace, noteId: string, itemId: string, now: string): void {
  const note = getNote(workspace, noteId)
  getItem(note, itemId)
  const ids = descendants(note.checklist!, itemId)
  // Date.now can repeat between rapid UI actions. Give each delete batch a
  // distinct timestamp so undo cannot accidentally revive earlier trash.
  const used = new Set(note.checklist!.map((item) => item.deletedAt))
  let deletion = now
  while (used.has(deletion)) deletion = new Date(Date.parse(deletion) + 1).toISOString()
  for (const item of note.checklist!) if (ids.has(item.id) && !item.deletedAt) { item.deletedAt = deletion; item.updatedAt = now }
  note.updatedAt = now
}

export function restoreChecklistItem(workspace: Workspace, noteId: string, itemId: string, now: string): void {
  const note = getNote(workspace, noteId)
  const root = note.checklist?.find((item) => item.id === itemId)
  if (!root?.deletedAt) return
  const items = note.checklist!, map = new Map(items.map((item) => [item.id, item]))
  const seen = new Set([root.id])
  let cursor = root.parentId ? map.get(root.parentId) : undefined, cycle = false
  while (cursor) {
    if (seen.has(cursor.id)) { cycle = true; break }
    seen.add(cursor.id)
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  const parent = root.parentId ? map.get(root.parentId) : undefined
  if (!cycle && parent?.deletedAt) throw new Error('Restore the parent checklist item first.')
  if (cycle || (root.parentId && !parent)) root.parentId = undefined
  const deletion = root.deletedAt, ids = descendants(items, itemId)
  for (const item of items) if (ids.has(item.id) && item.deletedAt === deletion) { item.deletedAt = undefined; item.updatedAt = now }
  note.updatedAt = now
}
