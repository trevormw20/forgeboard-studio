import { describe, expect, it } from 'vitest'
import { createSeedWorkspace } from '../seed'
import { mergeWorkspaces, sameWorkspaceContent } from './merge'
import {
  createPersonalNote, deletedPersonalNoteRoots, editPersonalNote, normalizeNoteColor, personalNoteParent,
  removeNoteLabel, removePersonalNote, restorePersonalNoteTree, upsertNoteLabel, visiblePersonalNotes,
} from './personalNotes'

const start = '2026-10-21T12:00:00.000Z'
const later = '2026-10-21T12:01:00.000Z'
const latest = '2026-10-21T12:02:00.000Z'

describe('personal notes', () => {
  it('keeps new collections optional without rewriting an older workspace', () => {
    const base = createSeedWorkspace()
    Object.assign(base, { agentChats: [], agentEvents: [], relayReceipts: [], experiments: [], handoffSummaries: [] })
    const merged = mergeWorkspaces(base, structuredClone(base), structuredClone(base))
    expect(merged.personalNotes).toBeUndefined()
    expect(merged.noteLabels).toBeUndefined()
    expect(sameWorkspaceContent(base, merged)).toBe(true)
  })

  it('supports personal notes and nested project notes without duplicating project sections', () => {
    const workspace = createSeedWorkspace()
    const projectId = workspace.projects[0].id
    const labels = upsertNoteLabel(workspace, { name: 'Reference', color: '#AbC' }, 'global-label', start)
    expect(labels.color).toBe('#aabbcc')
    createPersonalNote(workspace, { title: '', body: '' }, 'personal', start)
    createPersonalNote(workspace, { projectId, title: 'Plan', body: 'First line\nSecond line', labelIds: [labels.id], color: '#ABCDEF' }, 'parent', start)
    createPersonalNote(workspace, { projectId, parentId: 'parent', title: 'Scene', body: '' }, 'child', start)
    createPersonalNote(workspace, { projectId, parentId: 'child', title: 'Detail', body: '' }, 'grandchild', start)
    expect(workspace.personalNotes).toHaveLength(4)
    expect(workspace.personalNotes?.find((note) => note.id === 'parent')?.color).toBe('#abcdef')
    expect(personalNoteParent(workspace.personalNotes![3], visiblePersonalNotes(workspace))).toBe('child')
    editPersonalNote(workspace, 'parent', { title: '', body: '  preserved spacing  ', pinned: true }, later)
    expect(workspace.personalNotes?.[1]).toMatchObject({ title: '', body: '  preserved spacing  ', pinned: true })
    expect(workspace.projects).toHaveLength(5)
  })

  it('validates project/parent scope, cycles and label scope before mutating data', () => {
    const workspace = createSeedWorkspace()
    const one = workspace.projects[0].id, two = workspace.projects[1].id
    createPersonalNote(workspace, { projectId: one, title: 'Root', body: '' }, 'root', start)
    createPersonalNote(workspace, { projectId: one, parentId: 'root', title: 'Child', body: '' }, 'child', start)
    upsertNoteLabel(workspace, { projectId: two, name: 'Other', color: '#123456' }, 'other-label', start)
    expect(() => createPersonalNote(workspace, { projectId: 'unknown', title: '', body: '' }, 'bad', start)).toThrow(/existing project/)
    expect(() => createPersonalNote(workspace, { projectId: two, parentId: 'root', title: '', body: '' }, 'bad', start)).toThrow(/same project/)
    expect(() => editPersonalNote(workspace, 'root', { parentId: 'child' }, later)).toThrow(/inside itself/)
    expect(() => editPersonalNote(workspace, 'root', { projectId: two }, later)).toThrow(/has sub-notes/)
    expect(() => editPersonalNote(workspace, 'child', { labelIds: ['other-label'] }, later)).toThrow(/project label/)
    expect(() => editPersonalNote(workspace, 'child', { color: 'red; background:url(x)' }, later)).toThrow(/hex color/)
    expect(workspace.personalNotes).toHaveLength(2)
    expect(workspace.personalNotes?.[0].parentId).toBeUndefined()
    expect(() => normalizeNoteColor('#fffff')).toThrow()
    expect(normalizeNoteColor('')).toBeUndefined()
  })

  it('deletes a whole subtree, preserves earlier trash, and restores only the matching group', () => {
    const workspace = createSeedWorkspace()
    createPersonalNote(workspace, { title: 'Root', body: '' }, 'root', start)
    createPersonalNote(workspace, { parentId: 'root', title: 'Child', body: '' }, 'child', start)
    createPersonalNote(workspace, { parentId: 'child', title: 'Grandchild', body: '' }, 'grandchild', start)
    createPersonalNote(workspace, { parentId: 'root', title: 'Old trash', body: '' }, 'old-trash', start)
    removePersonalNote(workspace, 'old-trash', start)
    removePersonalNote(workspace, 'root', later)
    expect(visiblePersonalNotes(workspace)).toHaveLength(0)
    expect(() => restorePersonalNoteTree(workspace, 'child', latest)).toThrow(/parent note first/)
    restorePersonalNoteTree(workspace, 'root', latest)
    expect(visiblePersonalNotes(workspace).map((note) => note.id)).toEqual(['root', 'child', 'grandchild'])
    expect(workspace.personalNotes?.find((note) => note.id === 'old-trash')?.deletedAt).toBe(start)
  })

  it('keeps label tombstones and note content editable after a label is removed', () => {
    const workspace = createSeedWorkspace()
    upsertNoteLabel(workspace, { name: 'Ideas', color: '#f00' }, 'label', start)
    createPersonalNote(workspace, { title: '', body: 'Keep this', labelIds: ['label', 'label'] }, 'note', start)
    removeNoteLabel(workspace, 'label', later)
    editPersonalNote(workspace, 'note', { body: 'Still editable' }, latest)
    expect(workspace.noteLabels?.[0].deletedAt).toBe(later)
    expect(workspace.personalNotes?.[0]).toMatchObject({ body: 'Still editable', labelIds: ['label'] })
    expect(() => upsertNoteLabel(workspace, { id: 'label', name: 'Return', color: '#000' }, 'label', latest)).toThrow(/unavailable/)
  })

  it('merges independent device notes and labels, preserving conflicting body snapshots and tombstones', () => {
    const base = createSeedWorkspace()
    createPersonalNote(base, { title: 'Shared', body: 'Original' }, 'shared', start)
    const local = structuredClone(base), remote = structuredClone(base)
    createPersonalNote(local, { title: 'Local', body: 'Offline note' }, 'local', later)
    createPersonalNote(remote, { projectId: remote.projects[0].id, title: 'Remote', body: 'Phone note' }, 'remote', later)
    upsertNoteLabel(remote, { name: 'Phone label', color: '#321' }, 'remote-label', later)
    editPersonalNote(local, 'shared', { body: 'Laptop content' }, later)
    editPersonalNote(remote, 'shared', { body: 'Phone content' }, latest)
    const merged = mergeWorkspaces(base, local, remote)
    expect(merged.personalNotes).toHaveLength(3)
    expect(merged.noteLabels?.[0].id).toBe('remote-label')
    expect(merged.personalNotes?.find((note) => note.id === 'shared')?.body).toBe('Phone content')
    expect(merged.conflicts.at(-1)).toMatchObject({ entityType: 'personal-note', local: { body: 'Laptop content' }, remote: { body: 'Phone content' } })
    const deleted = structuredClone(base)
    removePersonalNote(deleted, 'shared', later)
    const preserved = mergeWorkspaces(base, deleted, remote)
    expect(preserved.personalNotes?.find((note) => note.id === 'shared')).toMatchObject({ body: 'Phone content', deletedAt: later })
    expect(visiblePersonalNotes(preserved).some((note) => note.id === 'shared')).toBe(false)
  })

  it('never hides or recurses forever through concurrent orphaned, moved or cyclic notes', () => {
    const base = createSeedWorkspace(), projectId = base.projects[0].id
    createPersonalNote(base, { projectId, title: 'A', body: '' }, 'a', start)
    createPersonalNote(base, { projectId, title: 'B', body: '' }, 'b', start)
    const local = structuredClone(base), remote = structuredClone(base)
    editPersonalNote(local, 'a', { parentId: 'b' }, later)
    editPersonalNote(remote, 'b', { parentId: 'a' }, later)
    const cyclic = mergeWorkspaces(base, local, remote)
    const visible = visiblePersonalNotes(cyclic)
    expect(visible).toHaveLength(2)
    expect(visible.map((note) => personalNoteParent(note, visible))).toEqual([undefined, undefined])

    const moved = structuredClone(base), added = structuredClone(base)
    editPersonalNote(moved, 'a', { projectId: base.projects[1].id }, later)
    createPersonalNote(added, { projectId, parentId: 'a', title: 'New child', body: 'Do not lose' }, 'child', later)
    const merged = mergeWorkspaces(base, moved, added)
    expect(visiblePersonalNotes(merged)).toHaveLength(3)
    expect(personalNoteParent(merged.personalNotes!.find((note) => note.id === 'child')!, visiblePersonalNotes(merged))).toBeUndefined()
    removePersonalNote(merged, 'a', latest)
    expect(visiblePersonalNotes(merged).find((note) => note.id === 'child')?.body).toBe('Do not lose')
    editPersonalNote(merged, 'child', { body: 'Editable recovered child' }, latest)
    expect(merged.personalNotes?.find((note) => note.id === 'child')).toMatchObject({ body: 'Editable recovered child', parentId: undefined })

    const deleted = structuredClone(base), newChild = structuredClone(base)
    removePersonalNote(deleted, 'a', later)
    createPersonalNote(newChild, { projectId, parentId: 'a', title: 'Concurrent child', body: 'Recover as root' }, 'concurrent', later)
    const concurrent = mergeWorkspaces(base, deleted, newChild)
    const recovered = visiblePersonalNotes(concurrent)
    expect(recovered.some((note) => note.id === 'concurrent')).toBe(true)
    expect(personalNoteParent(recovered.find((note) => note.id === 'concurrent')!, recovered)).toBeUndefined()
    editPersonalNote(concurrent, 'concurrent', { body: 'Still editable after recovery' }, latest)
    expect(concurrent.personalNotes?.find((note) => note.id === 'concurrent')?.parentId).toBeUndefined()
  })

  it('offers and restores every deleted cycle alongside normal roots without reviving older trash', () => {
    const workspace = createSeedWorkspace(), projectId = workspace.projects[0].id
    for (const id of ['a', 'b', 'c', 'old', 'normal']) createPersonalNote(workspace, { projectId, title: id, body: id }, id, start)
    const notes = workspace.personalNotes!
    notes.find((note) => note.id === 'a')!.parentId = 'b'
    notes.find((note) => note.id === 'b')!.parentId = 'c'
    notes.find((note) => note.id === 'c')!.parentId = 'a'
    notes.find((note) => note.id === 'old')!.parentId = 'b'
    removePersonalNote(workspace, 'old', start)
    removePersonalNote(workspace, 'b', later)
    removePersonalNote(workspace, 'normal', latest)
    expect(deletedPersonalNoteRoots(notes).map((note) => note.id).sort()).toEqual(['a', 'normal'])
    // Undo can restore the actual deleted member, not only the displayed representative.
    restorePersonalNoteTree(workspace, 'b', latest)
    expect(visiblePersonalNotes(workspace).map((note) => note.id).sort()).toEqual(['a', 'b', 'c'])
    expect(notes.find((note) => note.id === 'b')?.parentId).toBeUndefined()
    expect(notes.find((note) => note.id === 'old')?.deletedAt).toBe(start)
    expect(notes.find((note) => note.id === 'normal')?.deletedAt).toBe(latest)
    expect(deletedPersonalNoteRoots(notes).map((note) => note.id).sort()).toEqual(['normal', 'old'])
    restorePersonalNoteTree(workspace, 'old', latest)
    expect(notes.find((note) => note.id === 'old')?.parentId).toBe('b')
  })

  it('handles self-cycles and treats cross-project deleted parent links as separate trash roots', () => {
    const workspace = createSeedWorkspace()
    createPersonalNote(workspace, { projectId: workspace.projects[0].id, title: 'One', body: '' }, 'one', start)
    createPersonalNote(workspace, { projectId: workspace.projects[1].id, title: 'Two', body: '' }, 'two', start)
    const notes = workspace.personalNotes!
    notes[0].parentId = 'one'
    notes[1].parentId = 'one'
    removePersonalNote(workspace, 'one', later)
    removePersonalNote(workspace, 'two', later)
    expect(deletedPersonalNoteRoots(notes).map((note) => note.id).sort()).toEqual(['one', 'two'])
    restorePersonalNoteTree(workspace, 'one', latest)
    expect(notes[0]).toMatchObject({ deletedAt: undefined, parentId: undefined })
    expect(notes[1].deletedAt).toBe(later)
  })
})
