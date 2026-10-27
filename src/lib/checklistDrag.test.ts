import { describe, expect, it } from 'vitest'
import type { NoteChecklistItem } from '../types'
import { displayChecklist } from './noteChecklist'
import { checklistDragBranch, projectChecklistDrop, type ChecklistRowRect } from './checklistDrag'

const at = '2026-10-27T12:00:00Z'
function item(id: string, parentId?: string, order = 0, checked = false): NoteChecklistItem {
  return { id, text: id, parentId, order, createdAt: at, updatedAt: at, completedAt: checked ? at : undefined }
}
function setup(items: NoteChecklistItem[], hidden: string[] = []) {
  const rows = displayChecklist(items)
  const rectangles: ChecklistRowRect[] = rows.filter(({ item }) => !hidden.includes(item.id)).map(({ item }, index) => ({ id: item.id, top: 100 + index * 40, bottom: 140 + index * 40 }))
  return { rows, rectangles, drop: (id: string, y: number, x = 0) => projectChecklistDrop(rows, rectangles, id, y, x) }
}

describe('checklist pointer projection', () => {
  it('moves whole branches across arbitrary vertical distances without nesting by accident', () => {
    const { rows, drop } = setup([item('A'), item('Child', 'A'), item('Deep', 'Child'), item('B', undefined, 1), item('C', undefined, 2)])
    expect([...checklistDragBranch(rows, 'A')]).toEqual(['A', 'Child', 'Deep'])
    expect(drop('C', 135)).toMatchObject({ depth: 0, parentId: undefined, beforeId: 'B', markerBeforeId: 'B', changed: true })
    expect(drop('A', 999)).toMatchObject({ depth: 0, parentId: undefined, beforeId: undefined, markerAfterId: 'C', changed: true })
    expect(drop('C', 10)).toMatchObject({ depth: 0, parentId: undefined, beforeId: 'A', markerBeforeId: 'A' })
  })

  it('requires horizontal intent to nest and supports both sub-items and sub-sub-items', () => {
    const { drop } = setup([item('A'), item('Child', 'A'), item('B', undefined, 1), item('C', undefined, 2)])
    expect(drop('C', 140, 29)).toMatchObject({ depth: 0, parentId: undefined, beforeId: 'B' })
    expect(drop('C', 140, 35)).toMatchObject({ depth: 1, parentId: 'A', beforeId: 'Child', markerBeforeId: 'Child' })
    expect(drop('C', 180, 65)).toMatchObject({ depth: 2, parentId: 'Child', beforeId: undefined, markerBeforeId: 'B' })
  })

  it('preserves an existing child depth vertically and allows explicit outdenting', () => {
    const { drop } = setup([item('A'), item('Child', 'A'), item('B', undefined, 1), item('C', undefined, 2)])
    expect(drop('Child', 225)).toMatchObject({ depth: 1, parentId: 'B', beforeId: undefined, markerBeforeId: 'C' })
    expect(drop('Child', 999, -35)).toMatchObject({ depth: 0, parentId: undefined, beforeId: undefined, markerAfterId: 'C' })
  })

  it('excludes descendants and does not choose a hidden child as the destination', () => {
    const { drop } = setup([item('A'), item('Hidden', 'A'), item('Deep', 'Hidden'), item('B', undefined, 1)], ['Hidden', 'Deep'])
    expect(drop('B', 130, 70)).toMatchObject({ depth: 1, parentId: 'A', beforeId: undefined, markerAfterId: 'A' })
    const onlyBranch = setup([item('A'), item('Child', 'A')])
    expect(onlyBranch.drop('A', 140, 100)).toBeUndefined()
  })

  it('clamps open and checked drops to their own buckets and marks the actual location', () => {
    const { drop } = setup([item('Open1'), item('Done1', undefined, 1, true), item('Open2', undefined, 2), item('Done2', undefined, 3, true)])
    expect(drop('Open1', 999)).toMatchObject({ beforeId: undefined, markerBeforeId: 'Done1', changed: true })
    expect(drop('Done2', 0)).toMatchObject({ beforeId: 'Done1', markerBeforeId: 'Done1', changed: true })
    expect(drop('Open2', 999)).toMatchObject({ beforeId: undefined, markerBeforeId: 'Done1', changed: false })
  })

  it('rejects missing measurements and does not mutate the supplied tree', () => {
    const { rows, rectangles } = setup([item('A'), item('B', undefined, 1)])
    const copy = structuredClone(rows)
    expect(projectChecklistDrop(rows, [], 'A', 200, 0)).toBeUndefined()
    expect(projectChecklistDrop(rows, rectangles, 'missing', 200, 0)).toBeUndefined()
    expect(projectChecklistDrop(rows, rectangles, 'A', Number.NaN, 0)).toBeUndefined()
    expect(rows).toEqual(copy)
  })
})
