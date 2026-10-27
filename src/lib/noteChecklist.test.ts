import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import type { NoteChecklistItem, PersonalNote } from '../types'
import { createPersonalNote, editPersonalNote } from './personalNotes'
import { mergeWorkspaces } from './merge'
import {
  addChecklistItem, canMoveChecklistItem, checklistCompletionSections, deletedChecklistRoots, displayChecklist, editChecklistItem, moveChecklistItem, orderedChecklist,
  removeChecklistItem, repositionChecklistItem, restoreChecklistItem, toggleChecklistItem, validateNoteChecklist,
} from './noteChecklist'

const start = '2026-10-21T12:00:00.000Z', later = '2026-10-21T12:01:00.000Z', latest = '2026-10-21T12:02:00.000Z'

function fixture() {
  const workspace = createSeedWorkspace()
  createPersonalNote(workspace, { title: 'Plan', body: 'Keep my writing' }, 'note', start)
  for (const [id, text] of [['a', 'Tuesday'], ['b', 'Wed'], ['c', 'Thu']]) addChecklistItem(workspace, 'note', { text }, id, start)
  return workspace
}

const checklist = (workspace: ReturnType<typeof fixture>) => workspace.personalNotes![0].checklist!
const rows = (items: NoteChecklistItem[]) => orderedChecklist(items).map(({ item, depth }) => [item.id, depth])
const visibleRows = (items: NoteChecklistItem[]) => displayChecklist(items).map(({ item, depth }) => [item.id, depth])

describe('checklist completion section presentation', () => {
  function items(entries: [id: string, parentId?: string, checked?: boolean][]): NoteChecklistItem[] {
    return entries.map(([id, parentId, checked], order) => ({ id, parentId, text: id, order, createdAt: start, updatedAt: start, completedAt: checked ? later : undefined }))
  }

  function sections(checklistItems: NoteChecklistItem[]) {
    const flattened = displayChecklist(checklistItems), metadata = checklistCompletionSections(flattened)
    return flattened.map(({ item }) => [item.id, metadata.get(item.id)?.inCheckedSection, metadata.get(item.id)?.startsCheckedSection])
  }

  it('starts one checked region per sibling group at root, child, and grandchild levels', () => {
    const checklistItems = items([
      ['a'], ['a-done', 'a', true], ['a-open', 'a'],
      ['g-done', 'a-open', true], ['g-open', 'a-open'], ['a-done-two', 'a', true],
      ['b'], ['b-done', 'b', true], ['b-open', 'b'],
      ['root-done', undefined, true], ['root-done-two', undefined, true],
    ])
    const flattened = displayChecklist(checklistItems), before = structuredClone(checklistItems), rowsBefore = structuredClone(flattened)
    expect(sections(checklistItems)).toEqual([
      ['a', false, false], ['a-open', false, false], ['g-open', false, false],
      ['g-done', true, true], ['a-done', true, true], ['a-done-two', true, false],
      ['b', false, false], ['b-open', false, false], ['b-done', true, true],
      ['root-done', true, true], ['root-done-two', true, false],
    ])
    checklistCompletionSections(flattened)
    expect(flattened).toEqual(rowsBefore)
    expect(checklistItems).toEqual(before)
  })

  it('dims a checked parent branch without checking unfinished descendants or repeating dividers', () => {
    const checklistItems = items([
      ['open'], ['done', undefined, true], ['child-open', 'done'], ['child-done', 'done', true],
      ['grand-open', 'child-open'], ['grand-done', 'child-open', true],
    ])
    expect(sections(checklistItems)).toEqual([
      ['open', false, false], ['done', true, true], ['child-open', true, false],
      ['grand-open', true, false], ['grand-done', true, false], ['child-done', true, false],
    ])
    expect(checklistItems.filter((item) => !item.completedAt).map((item) => item.id)).toEqual(['open', 'child-open', 'grand-open'])
  })

  it('keeps unrelated parent groups at the same depth independent', () => {
    expect(sections(items([
      ['a'], ['a-done', 'a', true], ['a-leaf', 'a-done', true],
      ['b'], ['b-done', 'b', true], ['c'], ['c-open', 'c'], ['c-done', 'c', true],
    ]))).toEqual([
      ['a', false, false], ['a-done', true, true], ['a-leaf', true, false],
      ['b', false, false], ['b-done', true, true],
      ['c', false, false], ['c-open', false, false], ['c-done', true, true],
    ])
  })

  it('supports empty, all-open, and all-checked lists with a single all-checked divider', () => {
    expect(checklistCompletionSections([])).toEqual(new Map())
    expect(sections(items([['a'], ['b', 'a'], ['c']]))).toEqual([
      ['a', false, false], ['b', false, false], ['c', false, false],
    ])
    expect(sections(items([['a', undefined, true], ['b', 'a', true], ['c', undefined, true]]))).toEqual([
      ['a', true, true], ['b', true, false], ['c', true, false],
    ])
  })

  it('uses filtered display rows without mutating or exposing checked trash', () => {
    const checklistItems = items([['open'], ['trash', undefined, true], ['done', undefined, true]])
    checklistItems[1].deletedAt = latest
    const flattened = displayChecklist(checklistItems), metadata = checklistCompletionSections(flattened)
    expect([...metadata]).toEqual([
      ['open', { inCheckedSection: false, startsCheckedSection: false }],
      ['done', { inCheckedSection: true, startsCheckedSection: true }],
    ])
    expect(metadata.has('trash')).toBe(false)
    expect(checklistItems[1].deletedAt).toBe(latest)
  })
})

describe('note-internal checklists', () => {
  it('nests and moves independent checkboxes and preserves text alongside the list', () => {
    const workspace = fixture()
    addChecklistItem(workspace, 'note', { text: 'Orange chicken', parentId: 'b' }, 'meal', later)
    addChecklistItem(workspace, 'note', { text: 'Sauce', parentId: 'meal' }, 'sauce', later)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['b', 0], ['meal', 1], ['sauce', 2], ['c', 0]])
    toggleChecklistItem(workspace, 'note', 'b', later)
    toggleChecklistItem(workspace, 'note', 'sauce', later)
    expect(checklist(workspace).find((item) => item.id === 'meal')?.completedAt).toBeUndefined()
    expect(checklist(workspace).find((item) => item.id === 'sauce')?.completedAt).toBe(later)
    toggleChecklistItem(workspace, 'note', 'b', latest)
    moveChecklistItem(workspace, 'note', 'b', 'indent', latest)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['b', 1], ['meal', 2], ['sauce', 3], ['c', 0]])
    moveChecklistItem(workspace, 'note', 'meal', 'outdent', latest)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['b', 1], ['meal', 1], ['sauce', 2], ['c', 0]])
    moveChecklistItem(workspace, 'note', 'meal', 'up', latest)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['meal', 1], ['sauce', 2], ['b', 1], ['c', 0]])
    moveChecklistItem(workspace, 'note', 'meal', 'down', latest)
    moveChecklistItem(workspace, 'note', 'c', 'up', latest)
    expect(rows(checklist(workspace))).toEqual([['c', 0], ['a', 0], ['b', 1], ['meal', 1], ['sauce', 2]])
    expect(canMoveChecklistItem(checklist(workspace), 'c', 'up')).toBe(false)
    expect(canMoveChecklistItem(checklist(workspace), 'c', 'indent')).toBe(false)
    expect(canMoveChecklistItem(checklist(workspace), 'c', 'outdent')).toBe(false)
    expect(workspace.personalNotes![0].body).toBe('Keep my writing')
  })

  it('adds after a sibling with a stable identity and refuses cross-note parent identities', () => {
    const workspace = fixture()
    addChecklistItem(workspace, 'note', { text: 'Inserted', afterId: 'a' }, 'new', later)
    addChecklistItem(workspace, 'note', { text: 'Child', parentId: 'b' }, 'child', later)
    addChecklistItem(workspace, 'note', { text: 'Another', afterId: 'child' }, 'child-two', later)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['new', 0], ['b', 0], ['child', 1], ['child-two', 1], ['c', 0]])
    createPersonalNote(workspace, { title: 'Other', body: '' }, 'other', start)
    addChecklistItem(workspace, 'other', { text: 'Other note' }, 'other-item', start)
    expect(() => addChecklistItem(workspace, 'note', { text: 'Wrong', parentId: 'other-item' }, 'bad', later)).toThrow(/unavailable in this note/)
    expect(() => editChecklistItem(workspace, 'other', 'child', { text: 'Wrong note' }, later)).toThrow(/unavailable in this note/)
    expect(() => addChecklistItem(workspace, 'note', { text: 'Wrong group', parentId: 'b', afterId: 'a' }, 'bad', later)).toThrow(/same group/)
    expect(() => addChecklistItem(workspace, 'note', { text: 'Duplicate' }, 'a', later)).toThrow(/already in use/)
    expect(checklist(workspace)).toHaveLength(6)
  })

  it('soft-deletes a subtree and restores that batch without older deleted descendants', () => {
    const workspace = fixture()
    addChecklistItem(workspace, 'note', { text: 'Child', parentId: 'b' }, 'child', start)
    addChecklistItem(workspace, 'note', { text: 'Grandchild', parentId: 'child' }, 'grandchild', start)
    addChecklistItem(workspace, 'note', { text: 'Old trash', parentId: 'child' }, 'old', start)
    toggleChecklistItem(workspace, 'note', 'grandchild', start)
    removeChecklistItem(workspace, 'note', 'old', start)
    removeChecklistItem(workspace, 'note', 'b', later)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['c', 0]])
    expect(() => restoreChecklistItem(workspace, 'note', 'grandchild', latest)).toThrow(/parent checklist item first/)
    restoreChecklistItem(workspace, 'note', 'b', latest)
    expect(rows(checklist(workspace))).toEqual([['a', 0], ['b', 0], ['child', 1], ['grandchild', 2], ['c', 0]])
    expect(checklist(workspace).find((item) => item.id === 'old')?.deletedAt).toBe(start)
    expect(checklist(workspace).find((item) => item.id === 'grandchild')?.completedAt).toBe(start)
  })

  it('merges separate device item edits and a text/checkbox edit on the same item field by field', () => {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base)
    toggleChecklistItem(local, 'note', 'a', later)
    editChecklistItem(remote, 'note', 'a', { text: 'Tuesday updated on phone' }, latest)
    editChecklistItem(local, 'note', 'b', { text: 'Local Wednesday' }, later)
    toggleChecklistItem(remote, 'note', 'c', latest)
    addChecklistItem(local, 'note', { text: 'Laptop new', parentId: 'a' }, 'laptop', later)
    addChecklistItem(remote, 'note', { text: 'Phone new', parentId: 'a' }, 'phone', latest)
    const merged = mergeWorkspaces(base, local, remote), items = checklist(merged)
    expect(items).toHaveLength(5)
    expect(items.find((item) => item.id === 'a')).toMatchObject({ text: 'Tuesday updated on phone', completedAt: later })
    expect(items.find((item) => item.id === 'b')?.text).toBe('Local Wednesday')
    expect(items.find((item) => item.id === 'c')?.completedAt).toBe(latest)
    expect(orderedChecklist(items).filter(({ depth }) => depth === 1)).toHaveLength(2)
    const conflict = merged.conflicts.find((item) => item.entityType === 'personal-note')!
    expect(conflict.local).toMatchObject({ checklist: expect.arrayContaining([expect.objectContaining({ id: 'laptop' })]) })
    expect(conflict.remote).toMatchObject({ checklist: expect.arrayContaining([expect.objectContaining({ id: 'phone' })]) })
  })

  it('preserves complete snapshots of conflicting item text and accepts a complete recovery copy', () => {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base)
    editChecklistItem(local, 'note', 'a', { text: 'Laptop text' }, later)
    editChecklistItem(remote, 'note', 'a', { text: 'Phone text' }, latest)
    const merged = mergeWorkspaces(base, local, remote)
    expect(checklist(merged)[0].text).toBe('Phone text')
    const conflict = merged.conflicts.at(-1)!
    const snapshot = conflict.local as PersonalNote
    createPersonalNote(merged, { title: 'Recovered', body: '', checklist: snapshot.checklist }, 'recovered', latest)
    expect(merged.personalNotes?.[1].checklist?.[0].text).toBe('Laptop text')
    editPersonalNote(merged, 'recovered', { checklist: (conflict.remote as typeof snapshot).checklist }, latest)
    expect(merged.personalNotes?.[1].checklist?.[0].text).toBe('Phone text')
  })

  it('surfaces cyclic, missing-parent and deleted-parent items as roots after concurrent edits', () => {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base)
    moveChecklistItem(local, 'note', 'b', 'indent', later)
    moveChecklistItem(remote, 'note', 'a', 'down', later)
    moveChecklistItem(remote, 'note', 'a', 'indent', latest)
    const merged = mergeWorkspaces(base, local, remote)
    expect(rows(checklist(merged))).toEqual([['a', 0], ['b', 0], ['c', 0]])
    editPersonalNote(merged, 'note', { body: 'Still editable despite a concurrent cycle' }, latest)
    moveChecklistItem(merged, 'note', 'b', 'indent', latest)
    expect(rows(checklist(merged))).toEqual([['a', 0], ['b', 1], ['c', 0]])
    const deleted = structuredClone(base), added = structuredClone(base)
    removeChecklistItem(deleted, 'note', 'a', later)
    addChecklistItem(added, 'note', { text: 'Child created while parent deleted', parentId: 'a' }, 'child', latest)
    const orphan = mergeWorkspaces(base, deleted, added)
    expect(rows(checklist(orphan)).some(([id, depth]) => id === 'child' && depth === 0)).toBe(true)
    const item = checklist(orphan).find((item) => item.id === 'child')!
    item.parentId = 'missing'
    expect(rows(checklist(orphan)).some(([id, depth]) => id === 'child' && depth === 0)).toBe(true)
  })

  it('rejects malformed recovery lists without mutating the existing note', () => {
    const workspace = fixture(), snapshot = structuredClone(checklist(workspace))
    expect(() => editPersonalNote(workspace, 'note', { checklist: [{ ...snapshot[0], parentId: 'foreign' }] }, later)).toThrow(/same note/)
    expect(() => validateNoteChecklist([{ ...snapshot[0], parentId: 'a' }])).toThrow(/inside itself/)
    expect(() => validateNoteChecklist([snapshot[0], snapshot[0]])).toThrow(/own valid identity/)
    expect(() => validateNoteChecklist([{ ...snapshot[0], order: Infinity }])).toThrow(/invalid item order/)
    expect(() => validateNoteChecklist([{ ...snapshot[0], text: 'x'.repeat(10_001) }])).toThrow(/10,000/)
    expect(() => validateNoteChecklist([{ ...snapshot[0], updatedAt: 'not-a-date' }])).toThrow(/invalid date/)
    expect(() => validateNoteChecklist(Array(5_001).fill(snapshot[0]))).toThrow(/5,000/)
    expect(checklist(workspace)).toEqual(snapshot)
  })

  it('keeps multiple deleted cycles recoverable and preserves older trash even for same-millisecond deletes', () => {
    const workspace = fixture()
    for (const id of ['d', 'e', 'old']) addChecklistItem(workspace, 'note', { text: id }, id, start)
    const items = checklist(workspace)
    items.find((item) => item.id === 'a')!.parentId = 'b'
    items.find((item) => item.id === 'b')!.parentId = 'a'
    items.find((item) => item.id === 'd')!.parentId = 'e'
    items.find((item) => item.id === 'e')!.parentId = 'd'
    items.find((item) => item.id === 'old')!.parentId = 'b'
    removeChecklistItem(workspace, 'note', 'old', later)
    removeChecklistItem(workspace, 'note', 'a', later)
    removeChecklistItem(workspace, 'note', 'd', later)
    expect(deletedChecklistRoots(items).map((item) => item.id).sort()).toEqual(['a', 'd', 'old'])
    restoreChecklistItem(workspace, 'note', 'b', latest)
    expect(items.find((item) => item.id === 'b')?.parentId).toBeUndefined()
    expect(rows(items)).toHaveLength(3)
    expect(items.find((item) => item.id === 'old')?.deletedAt).toBe(later)
    restoreChecklistItem(workspace, 'note', 'e', latest)
    expect(rows(items)).toHaveLength(5)
    expect(deletedChecklistRoots(items).map((item) => item.id)).toEqual(['old'])
  })

  it('repairs an orphan hierarchy when adding children or editing an orphan item', () => {
    const workspace = fixture(), items = checklist(workspace)
    items[0].parentId = 'missing'
    addChecklistItem(workspace, 'note', { text: 'New child', parentId: 'a' }, 'child', later)
    expect(items[0].parentId).toBeUndefined()
    expect(rows(items)).toContainEqual(['child', 1])
    items[1].parentId = 'missing'
    editChecklistItem(workspace, 'note', 'b', { text: 'Recovered by editing' }, later)
    expect(items[1].parentId).toBeUndefined()
  })

  it('derives a stable pending-first display without rewriting saved order or other rows', () => {
    const workspace = fixture(), items = checklist(workspace)
    const savedOrders = items.map((item) => item.order)
    const firstBefore = structuredClone(items[0]), thirdBefore = structuredClone(items[2])
    toggleChecklistItem(workspace, 'note', 'b', later)
    expect(visibleRows(items)).toEqual([['a', 0], ['c', 0], ['b', 0]])
    expect(rows(items)).toEqual([['a', 0], ['b', 0], ['c', 0]])
    expect(items.map((item) => item.order)).toEqual(savedOrders)
    expect(items[0]).toEqual(firstBefore)
    expect(items[2]).toEqual(thirdBefore)
    const beforeDisplay = structuredClone(items)
    displayChecklist(items)
    expect(items).toEqual(beforeDisplay)
    toggleChecklistItem(workspace, 'note', 'a', later)
    expect(visibleRows(items)).toEqual([['c', 0], ['a', 0], ['b', 0]])
    toggleChecklistItem(workspace, 'note', 'b', latest)
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['a', 0]])
    toggleChecklistItem(workspace, 'note', 'a', latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['b', 0], ['c', 0]])
    expect(items.map((item) => item.order)).toEqual(savedOrders)
  })

  it('partitions every sibling level while checked parents carry their entire unchecked subtree', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const id of ['x', 'y', 'z']) addChecklistItem(workspace, 'note', { text: id, parentId: 'a' }, id, start)
    addChecklistItem(workspace, 'note', { text: 'First grandchild', parentId: 'z' }, 'g1', start)
    addChecklistItem(workspace, 'note', { text: 'Second grandchild', parentId: 'z' }, 'g2', start)
    toggleChecklistItem(workspace, 'note', 'a', later)
    toggleChecklistItem(workspace, 'note', 'y', later)
    toggleChecklistItem(workspace, 'note', 'g1', later)
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['a', 0], ['x', 1], ['z', 1], ['g2', 2], ['g1', 2], ['y', 1]])
    expect(rows(items)).toEqual([['a', 0], ['x', 1], ['y', 1], ['z', 1], ['g1', 2], ['g2', 2], ['b', 0], ['c', 0]])
    expect(items.find((item) => item.id === 'x')?.completedAt).toBeUndefined()
    expect(items.find((item) => item.id === 'z')?.completedAt).toBeUndefined()
    toggleChecklistItem(workspace, 'note', 'a', latest)
    expect(visibleRows(items)[0]).toEqual(['a', 0])
  })

  it('keeps all-checked sibling order stable and omits checked trash without hiding orphaned work', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const id of ['c', 'a', 'b']) toggleChecklistItem(workspace, 'note', id, later)
    expect(visibleRows(items)).toEqual([['a', 0], ['b', 0], ['c', 0]])
    removeChecklistItem(workspace, 'note', 'b', latest)
    items.push({ id: 'orphan', text: 'Concurrent child', parentId: 'b', order: 5, createdAt: latest, updatedAt: latest })
    expect(visibleRows(items)).toEqual([['orphan', 0], ['a', 0], ['c', 0]])
    expect(items.find((item) => item.id === 'orphan')?.parentId).toBe('b')
    restoreChecklistItem(workspace, 'note', 'b', latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['b', 0], ['orphan', 1], ['c', 0]])
  })

  it('appends new open rows before checked siblings and handles Enter after either bucket', () => {
    const workspace = fixture(), items = checklist(workspace)
    toggleChecklistItem(workspace, 'note', 'b', later)
    const checkedOrder = items[1].order
    addChecklistItem(workspace, 'note', { text: 'Appended' }, 'd', later)
    expect(visibleRows(items)).toEqual([['a', 0], ['c', 0], ['d', 0], ['b', 0]])
    addChecklistItem(workspace, 'note', { text: 'After first open', afterId: 'a' }, 'e', later)
    expect(visibleRows(items)).toEqual([['a', 0], ['e', 0], ['c', 0], ['d', 0], ['b', 0]])
    addChecklistItem(workspace, 'note', { text: 'After checked', afterId: 'b' }, 'f', latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['e', 0], ['c', 0], ['d', 0], ['f', 0], ['b', 0]])
    expect(items[1].order).toBe(checkedOrder)
    expect(items.find((item) => item.id === 'f')?.completedAt).toBeUndefined()
    addChecklistItem(workspace, 'note', { text: 'Checked child', parentId: 'b' }, 'child1', later)
    toggleChecklistItem(workspace, 'note', 'child1', later)
    addChecklistItem(workspace, 'note', { text: 'New nested open', parentId: 'b' }, 'child2', latest)
    expect(displayChecklist(items).filter(({ depth }) => depth === 1).map(({ item }) => item.id)).toEqual(['child2', 'child1'])
  })

  it('can append to an entirely checked list without changing any existing order', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const id of ['a', 'b', 'c']) toggleChecklistItem(workspace, 'note', id, later)
    const before = structuredClone(items)
    addChecklistItem(workspace, 'note', { text: 'Open first' }, 'new1', latest)
    addChecklistItem(workspace, 'note', { text: 'Open after checked', afterId: 'b' }, 'new2', latest)
    expect(visibleRows(items)).toEqual([['new1', 0], ['new2', 0], ['a', 0], ['b', 0], ['c', 0]])
    expect(items.slice(0, 3)).toEqual(before)
  })

  it('indents under the previous visible sibling rather than the previous canonical sibling', () => {
    const workspace = fixture(), items = checklist(workspace)
    toggleChecklistItem(workspace, 'note', 'a', later)
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['a', 0]])
    expect(canMoveChecklistItem(items, 'b', 'indent')).toBe(false)
    expect(canMoveChecklistItem(items, 'a', 'indent')).toBe(true)
    moveChecklistItem(workspace, 'note', 'a', 'indent', latest)
    expect(items[0].parentId).toBe('c')
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['a', 1]])
    expect(items[0].completedAt).toBe(later)
    moveChecklistItem(workspace, 'note', 'a', 'outdent', latest)
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['a', 0]])
    expect(items[0].completedAt).toBe(later)
  })

  it('moves up and down only within a completion bucket using visual neighbor order', () => {
    const workspace = fixture(), items = checklist(workspace)
    addChecklistItem(workspace, 'note', { text: 'Fourth' }, 'd', start)
    toggleChecklistItem(workspace, 'note', 'b', later)
    toggleChecklistItem(workspace, 'note', 'd', later)
    expect(visibleRows(items)).toEqual([['a', 0], ['c', 0], ['b', 0], ['d', 0]])
    expect(canMoveChecklistItem(items, 'c', 'down')).toBe(false)
    expect(canMoveChecklistItem(items, 'b', 'up')).toBe(false)
    const before = structuredClone(items)
    moveChecklistItem(workspace, 'note', 'c', 'down', latest)
    moveChecklistItem(workspace, 'note', 'b', 'up', latest)
    expect(items).toEqual(before)
    moveChecklistItem(workspace, 'note', 'c', 'up', latest)
    expect(visibleRows(items)).toEqual([['c', 0], ['a', 0], ['b', 0], ['d', 0]])
    moveChecklistItem(workspace, 'note', 'd', 'up', latest)
    expect(visibleRows(items)).toEqual([['c', 0], ['a', 0], ['d', 0], ['b', 0]])
    moveChecklistItem(workspace, 'note', 'd', 'down', latest)
    expect(visibleRows(items)).toEqual([['c', 0], ['a', 0], ['b', 0], ['d', 0]])
    expect(items.find((item) => item.id === 'b')?.completedAt).toBe(later)
    expect(items.find((item) => item.id === 'd')?.completedAt).toBe(later)
  })

  it('outdents an open child of a checked parent into the open root bucket with its subtree intact', () => {
    const workspace = fixture(), items = checklist(workspace)
    addChecklistItem(workspace, 'note', { text: 'Open child', parentId: 'a' }, 'child', later)
    addChecklistItem(workspace, 'note', { text: 'Checked grandchild', parentId: 'child' }, 'grandchild', later)
    toggleChecklistItem(workspace, 'note', 'a', later)
    toggleChecklistItem(workspace, 'note', 'grandchild', later)
    moveChecklistItem(workspace, 'note', 'child', 'outdent', latest)
    expect(visibleRows(items)).toEqual([['b', 0], ['c', 0], ['child', 0], ['grandchild', 1], ['a', 0]])
    expect(items.find((item) => item.id === 'child')?.parentId).toBeUndefined()
    expect(items.find((item) => item.id === 'child')?.completedAt).toBeUndefined()
    expect(items.find((item) => item.id === 'grandchild')).toMatchObject({ parentId: 'child', completedAt: later })
    expect(items[0].completedAt).toBe(later)
  })

  it('repositions a row several places up or down and appends within its current group', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const id of ['d', 'e', 'f']) addChecklistItem(workspace, 'note', { text: id }, id, start)
    repositionChecklistItem(workspace, 'note', 'f', { beforeId: 'b' }, later)
    expect(visibleRows(items)).toEqual([['a', 0], ['f', 0], ['b', 0], ['c', 0], ['d', 0], ['e', 0]])
    repositionChecklistItem(workspace, 'note', 'a', { beforeId: 'e' }, latest)
    expect(visibleRows(items)).toEqual([['f', 0], ['b', 0], ['c', 0], ['d', 0], ['a', 0], ['e', 0]])
    repositionChecklistItem(workspace, 'note', 'b', {}, latest)
    expect(visibleRows(items)).toEqual([['f', 0], ['c', 0], ['d', 0], ['a', 0], ['e', 0], ['b', 0]])
    expect(items.find((item) => item.id === 'b')).toMatchObject({ updatedAt: latest, text: 'Wed' })
    expect(workspace.personalNotes![0].updatedAt).toBe(latest)
  })

  it('reparents an entire branch into another group and back to a precise root position', () => {
    const workspace = fixture(), items = checklist(workspace)
    addChecklistItem(workspace, 'note', { text: 'Child', parentId: 'b' }, 'child', start)
    addChecklistItem(workspace, 'note', { text: 'Grandchild', parentId: 'child' }, 'grandchild', start)
    addChecklistItem(workspace, 'note', { text: 'Existing child', parentId: 'a' }, 'existing', start)
    toggleChecklistItem(workspace, 'note', 'grandchild', later)
    const descendantsBefore = structuredClone(items.filter((item) => ['child', 'grandchild'].includes(item.id)))
    repositionChecklistItem(workspace, 'note', 'b', { parentId: 'a', beforeId: 'existing' }, latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['b', 1], ['child', 2], ['grandchild', 3], ['existing', 1], ['c', 0]])
    expect(items.filter((item) => ['child', 'grandchild'].includes(item.id))).toEqual(descendantsBefore)
    repositionChecklistItem(workspace, 'note', 'b', { beforeId: 'a' }, latest)
    expect(visibleRows(items)).toEqual([['b', 0], ['child', 1], ['grandchild', 2], ['a', 0], ['existing', 1], ['c', 0]])
    expect(items.filter((item) => ['child', 'grandchild'].includes(item.id))).toEqual(descendantsBefore)
    expect(items.find((item) => item.id === 'b')?.completedAt).toBeUndefined()
  })

  it('moves a nested branch between unrelated groups without touching any descendant', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const [id, parentId] of [['x', 'a'], ['y', 'a'], ['leaf', 'x'], ['z', 'c']]) {
      addChecklistItem(workspace, 'note', { text: id, parentId }, id, start)
    }
    const before = structuredClone(items.find((item) => item.id === 'leaf'))
    repositionChecklistItem(workspace, 'note', 'x', { parentId: 'c', beforeId: 'z' }, later)
    expect(visibleRows(items)).toEqual([['a', 0], ['y', 1], ['b', 0], ['c', 0], ['x', 1], ['leaf', 2], ['z', 1]])
    expect(items.find((item) => item.id === 'leaf')).toEqual(before)
    repositionChecklistItem(workspace, 'note', 'x', { parentId: 'c' }, latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['y', 1], ['b', 0], ['c', 0], ['z', 1], ['x', 1], ['leaf', 2]])
  })

  it('keeps checked rows at the bottom while reordering their own completion bucket', () => {
    const workspace = fixture(), items = checklist(workspace)
    for (const id of ['d', 'e']) addChecklistItem(workspace, 'note', { text: id }, id, start)
    toggleChecklistItem(workspace, 'note', 'b', later)
    toggleChecklistItem(workspace, 'note', 'd', later)
    repositionChecklistItem(workspace, 'note', 'e', { beforeId: 'a' }, latest)
    expect(visibleRows(items)).toEqual([['e', 0], ['a', 0], ['c', 0], ['b', 0], ['d', 0]])
    repositionChecklistItem(workspace, 'note', 'd', { beforeId: 'b' }, latest)
    expect(visibleRows(items)).toEqual([['e', 0], ['a', 0], ['c', 0], ['d', 0], ['b', 0]])
    repositionChecklistItem(workspace, 'note', 'a', {}, latest)
    expect(visibleRows(items)).toEqual([['e', 0], ['c', 0], ['a', 0], ['d', 0], ['b', 0]])
    repositionChecklistItem(workspace, 'note', 'd', {}, latest)
    expect(visibleRows(items)).toEqual([['e', 0], ['c', 0], ['a', 0], ['b', 0], ['d', 0]])
    expect(items.find((item) => item.id === 'b')?.completedAt).toBe(later)
    expect(items.find((item) => item.id === 'd')?.completedAt).toBe(later)
  })

  it('allows completed roots to be nested below open children without changing checkmarks', () => {
    const workspace = fixture(), items = checklist(workspace)
    addChecklistItem(workspace, 'note', { text: 'Open child', parentId: 'a' }, 'open', start)
    addChecklistItem(workspace, 'note', { text: 'Checked child', parentId: 'a' }, 'checked', start)
    addChecklistItem(workspace, 'note', { text: 'Open descendant', parentId: 'b' }, 'leaf', start)
    toggleChecklistItem(workspace, 'note', 'b', later)
    toggleChecklistItem(workspace, 'note', 'checked', later)
    repositionChecklistItem(workspace, 'note', 'b', { parentId: 'a', beforeId: 'checked' }, latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['open', 1], ['b', 1], ['leaf', 2], ['checked', 1], ['c', 0]])
    expect(items.find((item) => item.id === 'b')?.completedAt).toBe(later)
    expect(items.find((item) => item.id === 'leaf')?.completedAt).toBeUndefined()
    repositionChecklistItem(workspace, 'note', 'b', {}, latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['open', 1], ['checked', 1], ['c', 0], ['b', 0], ['leaf', 1]])
  })

  it('leaves the entire workspace unchanged on invalid drop identities or relationships', () => {
    const workspace = fixture(), items = checklist(workspace)
    addChecklistItem(workspace, 'note', { text: 'Child', parentId: 'a' }, 'child', start)
    addChecklistItem(workspace, 'note', { text: 'Grandchild', parentId: 'child' }, 'grandchild', start)
    createPersonalNote(workspace, { title: 'Other', body: '' }, 'other', start)
    addChecklistItem(workspace, 'other', { text: 'Foreign item' }, 'foreign', start)
    addChecklistItem(workspace, 'note', { text: 'Trash' }, 'trash', start)
    removeChecklistItem(workspace, 'note', 'trash', later)
    toggleChecklistItem(workspace, 'note', 'c', later)
    // An invalid drop must not opportunistically repair unrelated bad links.
    items.find((item) => item.id === 'b')!.parentId = 'missing'
    const before = structuredClone(workspace)
    const invalid = [
      { parentId: 'a' }, { parentId: 'child' }, { parentId: 'grandchild' },
      { parentId: 'foreign' }, { parentId: 'trash' }, { parentId: 'missing' },
      { beforeId: 'foreign' }, { beforeId: 'trash' }, { beforeId: 'missing' },
      { beforeId: 'child' }, { parentId: 'b', beforeId: 'child' }, { beforeId: 'c' },
    ]
    for (const position of invalid) {
      expect(() => repositionChecklistItem(workspace, 'note', 'a', position, latest)).toThrow()
      expect(workspace).toEqual(before)
    }
    for (const itemId of ['foreign', 'trash', 'missing']) {
      expect(() => repositionChecklistItem(workspace, 'note', itemId, {}, latest)).toThrow(/unavailable/)
      expect(workspace).toEqual(before)
    }
    expect(() => repositionChecklistItem(workspace, 'other', 'a', {}, latest)).toThrow(/unavailable/)
    expect(() => repositionChecklistItem(workspace, 'missing-note', 'a', {}, latest)).toThrow(/unavailable/)
    expect(workspace).toEqual(before)
  })

  it('does not stamp or rewrite an item dropped at its current visible position', () => {
    const workspace = fixture(), items = checklist(workspace)
    toggleChecklistItem(workspace, 'note', 'b', later)
    const before = structuredClone(workspace)
    repositionChecklistItem(workspace, 'note', 'a', { beforeId: 'c' }, latest)
    repositionChecklistItem(workspace, 'note', 'c', {}, latest)
    repositionChecklistItem(workspace, 'note', 'b', {}, latest)
    repositionChecklistItem(workspace, 'note', 'a', { beforeId: 'a' }, latest)
    expect(workspace).toEqual(before)
    expect(visibleRows(items)).toEqual([['a', 0], ['c', 0], ['b', 0]])
  })

  it('repairs visible orphan roots and rebalances exhausted order spacing only after valid drops', () => {
    const workspace = fixture(), items = checklist(workspace)
    items[0].order = 1
    items[1].order = 1 + Number.EPSILON
    items[2].order = 2
    addChecklistItem(workspace, 'note', { text: 'Descendant', parentId: 'c' }, 'child', start)
    const childBefore = structuredClone(items.find((item) => item.id === 'child'))
    repositionChecklistItem(workspace, 'note', 'c', { beforeId: 'b' }, later)
    expect(visibleRows(items)).toEqual([['a', 0], ['c', 0], ['child', 1], ['b', 0]])
    expect(items.filter((item) => !item.parentId).map((item) => item.order).sort((a, b) => a - b)).toEqual([0, 1, 2])
    expect(items.find((item) => item.id === 'child')).toEqual(childBefore)
    items[1].parentId = 'missing'
    repositionChecklistItem(workspace, 'note', 'b', { parentId: 'a' }, latest)
    expect(visibleRows(items)).toEqual([['a', 0], ['b', 1], ['c', 0], ['child', 1]])
    expect(items[1].parentId).toBe('a')
  })
})
