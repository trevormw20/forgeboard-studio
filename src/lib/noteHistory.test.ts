import { describe, expect, it } from 'vitest'
import type { NoteChecklistItem, PersonalNote } from '../types'
import { hasNoteHistoryChanges, NOTE_HISTORY_LIMIT, NOTE_TYPING_GROUP_MS, NoteHistoryConflictError, replayNoteHistory, snapshotNote } from './noteHistory'

const start = '2026-10-27T12:00:00.000Z', edit = '2026-10-27T12:01:00.000Z', undoAt = '2026-10-27T12:02:00.000Z', redoAt = '2026-10-27T12:03:00.000Z'
const row = (id: string, extra: Partial<NoteChecklistItem> = {}): NoteChecklistItem => ({ id, text: id, order: 0, createdAt: start, updatedAt: start, ...extra })
const note = (extra: Partial<PersonalNote> = {}): PersonalNote => ({ id: 'note', projectId: 'project', title: 'Plan', body: '', createdAt: start, updatedAt: start, checklist: [row('a'), row('b', { order: 1 })], ...extra })
const copy = snapshotNote

describe('safe note history', () => {
  it('uses bounded history and a short typing group and makes detached snapshots', () => {
    expect(NOTE_HISTORY_LIMIT).toBe(100)
    expect(NOTE_TYPING_GROUP_MS).toBe(1500)
    const original = note({ labelIds: ['one'] }), snapshot = copy(original)
    original.checklist![0].text = 'Later typing'
    original.labelIds!.push('two')
    expect(snapshot.checklist![0].text).toBe('a')
    expect(snapshot.labelIds).toEqual(['one'])
  })

  it('ignores save timestamps and storage order, but detects every editable field', () => {
    const original = note()
    expect(hasNoteHistoryChanges(original, note({ updatedAt: edit, checklist: [row('b', { order: 1, updatedAt: edit }), row('a')] }))).toBe(false)
    for (const patch of [{ title: 'New' }, { body: 'New' }, { color: 'blue' }, { labelIds: ['label'] }, { pinned: true }]) expect(hasNoteHistoryChanges(original, note(patch))).toBe(true)
    for (const patch of [{ text: 'New' }, { parentId: 'b' }, { order: 2 }, { completedAt: edit }, { deletedAt: edit }]) expect(hasNoteHistoryChanges(original, note({ checklist: [row('a', patch), row('b', { order: 1 })] }))).toBe(true)
    expect(hasNoteHistoryChanges(original, note({ checklist: [row('a')] }))).toBe(true)
    expect(hasNoteHistoryChanges(original, note({ checklist: [row('a'), row('c')] }))).toBe(true)
  })

  it('undoes and redoes title, body, labels, color and pin without changing identity', () => {
    const before = note(), after = note({ title: 'Shopping', body: 'Keep text', color: '#aabbcc', labelIds: ['one', 'two'], pinned: true, updatedAt: edit })
    const undone = replayNoteHistory(after, after, before, undoAt)
    expect(undone).toEqual({ ...before, updatedAt: undoAt })
    const redone = replayNoteHistory(undone, undone, after, redoAt)
    expect(redone).toEqual({ ...after, updatedAt: redoAt })
    expect(before).toEqual(note())
    expect(after.updatedAt).toBe(edit)
  })

  it('preserves independent remote note fields and rows while undoing text', () => {
    const before = note(), after = note({ title: 'My edit', updatedAt: edit }), current = copy(after)
    current.body = 'Phone writing'
    current.pinned = true
    current.checklist!.push(row('phone'))
    const undone = replayNoteHistory(current, after, before, undoAt)
    expect(undone).toMatchObject({ title: 'Plan', body: 'Phone writing', pinned: true })
    expect(undone.checklist!.at(-1)?.id).toBe('phone')
    const redone = replayNoteHistory(undone, undone, current, redoAt)
    expect(redone).toMatchObject({ title: 'My edit', body: 'Phone writing', pinned: true })
    expect(redone.checklist!.at(-1)?.id).toBe('phone')
  })

  it('preserves a remote checkmark when undoing typing on the same row', () => {
    const before = note(), after = copy(before)
    after.checklist![0].text = 'Edited a'
    const current = copy(after)
    current.checklist![0].completedAt = edit
    current.checklist![1].text = 'Phone b'
    const undone = replayNoteHistory(current, after, before, undoAt)
    expect(undone.checklist![0]).toMatchObject({ text: 'a', completedAt: edit, updatedAt: undoAt })
    expect(undone.checklist![1]).toMatchObject({ text: 'Phone b', updatedAt: start })
  })

  it('undoes checkmarks, order and nesting together, preserving unrelated remote text', () => {
    const before = note(), after = copy(before)
    Object.assign(after.checklist![1], { parentId: 'a', order: 5, completedAt: edit, updatedAt: edit })
    const current = copy(after)
    current.checklist![1].text = 'Phone text'
    const undone = replayNoteHistory(current, after, before, undoAt)
    expect(undone.checklist![1]).toMatchObject({ text: 'Phone text', order: 1, updatedAt: undoAt })
    expect(undone.checklist![1].parentId).toBeUndefined()
    expect(undone.checklist![1].completedAt).toBeUndefined()
  })

  it('undoes additions with tombstones and redoes the actual replay result', () => {
    const before = note(), after = copy(before)
    after.checklist!.push(row('child', { parentId: 'a', createdAt: edit, updatedAt: edit }))
    const undone = replayNoteHistory(after, after, before, undoAt)
    expect(undone.checklist).toHaveLength(3)
    expect(undone.checklist![2]).toMatchObject({ id: 'child', parentId: 'a', deletedAt: undoAt, updatedAt: undoAt })
    const redone = replayNoteHistory(undone, undone, after, redoAt)
    expect(redone.checklist![2]).toMatchObject({ id: 'child', parentId: 'a', createdAt: edit, updatedAt: redoAt })
    expect(redone.checklist![2].deletedAt).toBeUndefined()
    const again = replayNoteHistory(redone, redone, undone, redoAt)
    expect(again.checklist![2].deletedAt).toBe(undoAt)
    expect(before.checklist).toHaveLength(2)
  })

  it('supports replaying insertion directly when the expected row is absent', () => {
    const before = note({ checklist: undefined }), after = copy(before)
    after.checklist = [row('new')]
    const result = replayNoteHistory(before, before, after, undoAt)
    expect(result.checklist).toEqual([row('new', { updatedAt: undoAt })])
    expect(before.checklist).toBeUndefined()
  })

  it('undoes and redoes deletion and restore batches without resurrecting older trash', () => {
    const before = note({ checklist: [row('a'), row('b', { parentId: 'a' }), row('old', { parentId: 'a', deletedAt: start })] }), after = copy(before)
    for (const item of after.checklist!.slice(0, 2)) item.deletedAt = edit
    const undone = replayNoteHistory(after, after, before, undoAt)
    expect(undone.checklist!.map((item) => item.deletedAt)).toEqual([undefined, undefined, start])
    const redone = replayNoteHistory(undone, undone, after, redoAt)
    expect(redone.checklist!.map((item) => item.deletedAt)).toEqual([edit, edit, start])
    const restored = replayNoteHistory(redone, after, before, redoAt)
    expect(restored.checklist!.map((item) => item.deletedAt)).toEqual([undefined, undefined, start])
  })

  it('rejects a conflicting note field atomically', () => {
    const before = note(), after = note({ title: 'Local title', body: 'Local body' }), current = copy(after)
    current.body = 'Phone body'
    const original = copy(current)
    expect(() => replayNoteHistory(current, after, before, undoAt)).toThrow(NoteHistoryConflictError)
    expect(current).toEqual(original)
  })

  it('rejects a conflicting row field without partially reverting earlier rows', () => {
    const before = note(), after = copy(before)
    for (const item of after.checklist!) item.text += ' edited'
    const current = copy(after)
    current.checklist![1].text = 'Phone changed b'
    const original = copy(current)
    expect(() => replayNoteHistory(current, after, before, undoAt)).toThrow(/changed elsewhere/)
    expect(current).toEqual(original)
  })

  it('refuses to overwrite edits on a newly-created row or strand a remote child', () => {
    const before = note(), after = copy(before)
    after.checklist!.push(row('new'))
    const edited = copy(after)
    edited.checklist![2].text = 'Phone changed new'
    expect(() => replayNoteHistory(edited, after, before, undoAt)).toThrow(NoteHistoryConflictError)
    const withChild = copy(after)
    withChild.checklist!.push(row('phone-child', { parentId: 'new' }))
    expect(() => replayNoteHistory(withChild, after, before, undoAt)).toThrow(NoteHistoryConflictError)
    expect(withChild.checklist![2].deletedAt).toBeUndefined()
  })

  it('rejects missing, moved, deleted and replaced notes or rows', () => {
    const before = note(), after = note({ title: 'Edited' })
    for (const current of [undefined, note({ id: 'other' }), note({ projectId: 'other' }), note({ parentId: 'other' }), note({ createdAt: edit }), note({ deletedAt: edit })]) expect(() => replayNoteHistory(current, after, before, undoAt)).toThrow(/moved, deleted, or replaced/)
    expect(() => replayNoteHistory(after, after, note({ projectId: 'other' }), undoAt)).toThrow(NoteHistoryConflictError)
    const checked = note()
    checked.checklist![0].completedAt = edit
    for (const checklist of [[row('b', { order: 1 })], [row('a', { completedAt: edit, deletedAt: edit }), row('b')], [row('a', { completedAt: edit, createdAt: edit }), row('b')]]) expect(() => replayNoteHistory(note({ checklist }), checked, before, undoAt)).toThrow(NoteHistoryConflictError)
  })

  it('rejects duplicate row identities and conflicting new identities', () => {
    const before = note(), after = copy(before)
    after.checklist!.push(row('new'))
    expect(() => replayNoteHistory(note({ checklist: [...before.checklist!, row('new')] }), before, after, undoAt)).toThrow(NoteHistoryConflictError)
    expect(() => replayNoteHistory(note({ checklist: [row('a'), row('a')] }), before, after, undoAt)).toThrow(/duplicate/)
  })

  it('does not revive under a missing/deleted parent or introduce a cycle', () => {
    const before = note({ checklist: [row('a'), row('b', { parentId: 'a', deletedAt: edit })] }), target = copy(before)
    target.checklist![1].deletedAt = undefined
    const deletedParent = copy(before)
    deletedParent.checklist![0].deletedAt = undoAt
    expect(() => replayNoteHistory(deletedParent, before, target, redoAt)).toThrow(/hierarchy changed/)
    const current = note(), nested = copy(current)
    nested.checklist![1].parentId = 'a'
    current.checklist![0].parentId = 'b'
    expect(() => replayNoteHistory(current, note(), nested, undoAt)).toThrow(/hierarchy changed/)
    const missing = copy(before)
    missing.checklist = missing.checklist!.filter((item) => item.id !== 'a')
    expect(() => replayNoteHistory(missing, before, target, redoAt)).toThrow(/hierarchy changed/)
  })

  it('allows an unrelated edit despite an already-broken remote hierarchy', () => {
    const before = note(), after = note({ title: 'Edited' }), current = copy(after)
    current.checklist![1].parentId = 'missing-remote-parent'
    expect(replayNoteHistory(current, after, before, undoAt).checklist![1].parentId).toBe('missing-remote-parent')
  })

  it('uses a distinct tombstone batch time and rejects invalid save time', () => {
    const before = note({ checklist: [row('old', { deletedAt: undoAt })] }), after = copy(before)
    after.checklist!.push(row('new'))
    expect(replayNoteHistory(after, after, before, undoAt).checklist![1].deletedAt).toBe('2026-10-27T12:02:00.001Z')
    expect(() => replayNoteHistory(after, after, before, 'invalid')).toThrow(/valid save time/)
  })
})
