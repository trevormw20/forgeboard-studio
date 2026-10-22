import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import type { NoteChecklistItem, PersonalNote } from '../types'
import { createPersonalNote, editPersonalNote } from './personalNotes'
import { mergeWorkspaces } from './merge'
import {
  addChecklistItem, canMoveChecklistItem, deletedChecklistRoots, editChecklistItem, moveChecklistItem, orderedChecklist,
  removeChecklistItem, restoreChecklistItem, toggleChecklistItem, validateNoteChecklist,
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
})
