import type { NoteChecklistItem } from '../types'

export type ChecklistDragRow = { item: NoteChecklistItem; depth: number }
export type ChecklistRowRect = { id: string; top: number; bottom: number }
export type ChecklistDrop = {
  parentId?: string
  beforeId?: string
  depth: number
  markerBeforeId?: string
  markerAfterId?: string
  changed: boolean
  label: string
}

/** A row and every descendant are one unit, including children hidden by a
 * collapsed group. The display tree, rather than possibly stale parent links,
 * is the same safe hierarchy that the user can see. */
export function checklistDragBranch(rows: ChecklistDragRow[], id: string): Set<string> {
  const start = rows.findIndex(({ item }) => item.id === id)
  const branch = new Set<string>()
  if (start < 0) return branch
  for (let index = start; index < rows.length; index++) {
    if (index > start && rows[index].depth <= rows[start].depth) break
    branch.add(rows[index].item.id)
  }
  return branch
}

function parentsOf(rows: ChecklistDragRow[]) {
  const stack: string[] = [], parents = new Map<string, string | undefined>()
  for (const { item, depth } of rows) {
    stack.length = depth
    parents.set(item.id, depth > 0 ? stack[depth - 1] : undefined)
    stack[depth] = item.id
  }
  return parents
}

function afterBranch(rows: ChecklistDragRow[], index: number): number {
  const depth = rows[index].depth
  let next = index + 1
  while (next < rows.length && rows[next].depth > depth) next++
  return next
}

/** Project a pointer gap into a valid tree edit without changing saved data.
 * Horizontal distance explicitly chooses the depth; vertical-only movement
 * never turns a root into a child merely by hovering over its descendants.
 * Completed-last partitioning is applied before choosing the visible marker,
 * so the preview is the exact location the atomic data operation will use. */
export function projectChecklistDrop(
  rows: ChecklistDragRow[], rectangles: ChecklistRowRect[], id: string, pointerY: number, deltaX: number,
): ChecklistDrop | undefined {
  const source = rows.find(({ item }) => item.id === id)
  if (!source || !Number.isFinite(pointerY) || !Number.isFinite(deltaX)) return undefined
  const branch = checklistDragBranch(rows, id)
  const remaining = rows.filter(({ item }) => !branch.has(item.id))
  const indexes = new Map(remaining.map(({ item }, index) => [item.id, index]))
  const rectMap = new Map(rectangles.filter(({ top, bottom }) => Number.isFinite(top) && Number.isFinite(bottom) && bottom > top).map((rect) => [rect.id, rect]))
  const visible = remaining.filter(({ item }) => rectMap.has(item.id))
  if (visible.length === 0) return undefined
  const slot = visible.findIndex(({ item }) => {
    const rect = rectMap.get(item.id)!
    return pointerY < (rect.top + rect.bottom) / 2
  })
  const next = slot < 0 ? undefined : visible[slot]
  const previous = slot < 0 ? visible.at(-1) : visible[slot - 1]
  let gap = next ? indexes.get(next.item.id)! : remaining.length
  let depth = Math.max(0, Math.min(source.depth + Math.trunc(deltaX / 30), previous ? previous.depth + 1 : 0))

  // A same-level drop must not split someone else's parent/child branch. Move
  // its insertion gap to the end of that branch instead of silently nesting.
  while (gap < remaining.length && remaining[gap].depth > depth) gap++
  let parentId: string | undefined
  if (depth > 0) {
    for (let index = gap - 1; index >= 0; index--) {
      if (remaining[index].depth === depth - 1) { parentId = remaining[index].item.id; break }
    }
    if (!parentId) depth = 0
  }

  const parents = parentsOf(remaining)
  const siblings = remaining.filter(({ item }) => parents.get(item.id) === parentId)
  const bucket = siblings.filter(({ item }) => Boolean(item.completedAt) === Boolean(source.item.completedAt))
  const before = bucket.find(({ item }) => indexes.get(item.id)! >= gap)
  const beforeId = before?.item.id
  let actualGap: number
  if (before) actualGap = indexes.get(before.item.id)!
  else if (bucket.length > 0) actualGap = afterBranch(remaining, indexes.get(bucket.at(-1)!.item.id)!)
  else if (siblings.length > 0) actualGap = source.item.completedAt
    ? afterBranch(remaining, indexes.get(siblings.at(-1)!.item.id)!)
    : indexes.get(siblings[0].item.id)!
  else actualGap = parentId ? indexes.get(parentId)! + 1 : 0

  const markerBefore = visible.find(({ item }) => indexes.get(item.id)! >= actualGap)
  const markerAfter = markerBefore ? undefined : visible.at(-1)
  const originalParents = parentsOf(rows)
  const originalSiblings = rows.filter(({ item }) => originalParents.get(item.id) === originalParents.get(id) && Boolean(item.completedAt) === Boolean(source.item.completedAt))
  const originalIndex = originalSiblings.findIndex(({ item }) => item.id === id)
  const changed = originalParents.get(id) !== parentId || originalSiblings[originalIndex + 1]?.item.id !== beforeId
  const parent = remaining.find(({ item }) => item.id === parentId)
  const name = (row: ChecklistDragRow) => row.item.text.trim() || 'New item'
  const location = before ? `Before ${name(before)}` : parent ? `Last sub-item of ${name(parent)}` : 'End of list'
  return {
    parentId, beforeId, depth, markerBeforeId: markerBefore?.item.id, markerAfterId: markerAfter?.item.id, changed,
    label: `${location} · Level ${depth + 1}${source.item.completedAt ? ' · Checked' : ''}`,
  }
}
