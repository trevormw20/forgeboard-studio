import type { NoteLabel, PersonalNote, Workspace } from '../types'
import { validateNoteChecklist } from './noteChecklist'

export type PersonalNoteInput = Pick<PersonalNote, 'title' | 'body'> & Partial<Pick<PersonalNote, 'projectId' | 'parentId' | 'color' | 'labelIds' | 'pinned' | 'checklist'>>
export type PersonalNoteUpdate = Partial<PersonalNoteInput>
export type NoteLabelInput = Pick<NoteLabel, 'name' | 'color'> & Partial<Pick<NoteLabel, 'id' | 'projectId'>>

export function normalizeNoteColor(color?: string): string | undefined {
  if (!color) return undefined
  const clean = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(clean)) return clean
  if (/^#[0-9a-f]{3}$/.test(clean)) return `#${[...clean.slice(1)].map((character) => character.repeat(2)).join('')}`
  throw new Error('Choose a hex color such as #6d8cff.')
}

function assertProject(workspace: Workspace, projectId?: string) {
  if (projectId !== undefined && !workspace.projects.some((project) => project.id === projectId && !project.deletedAt)) {
    throw new Error('Choose an existing project for this note.')
  }
}

function descendants(notes: PersonalNote[], id: string): Set<string> {
  const found = new Set([id])
  const projectId = notes.find((note) => note.id === id)?.projectId
  let changed = true
  while (changed) {
    changed = false
    for (const note of notes) {
      if (note.projectId === projectId && note.parentId && found.has(note.parentId) && !found.has(note.id)) {
        found.add(note.id)
        changed = true
      }
    }
  }
  return found
}

function validateNote(workspace: Workspace, note: PersonalNote, checkChecklist = true): PersonalNote {
  assertProject(workspace, note.projectId)
  if (typeof note.title !== 'string' || typeof note.body !== 'string') throw new Error('A note needs a text title and body.')
  const normalized = { ...note, color: normalizeNoteColor(note.color), labelIds: [...new Set(note.labelIds ?? [])] }
  if (checkChecklist && note.checklist !== undefined) normalized.checklist = validateNoteChecklist(note.checklist)
  if (normalized.title.length > 300) throw new Error('Keep the note title under 300 characters.')
  if (normalized.body.length > 100_000) throw new Error('Split notes larger than 100,000 characters into sub-notes.')
  const notes = workspace.personalNotes ?? []
  if (note.parentId) {
    const parent = notes.find((item) => item.id === note.parentId && !item.deletedAt)
    if (!parent) throw new Error('The parent note is unavailable. Choose another parent or make this a top-level note.')
    if (parent.projectId !== note.projectId) throw new Error('A sub-note must stay in the same project as its parent.')
    const seen = new Set([note.id])
    let cursor: PersonalNote | undefined = parent
    while (cursor) {
      if (seen.has(cursor.id)) throw new Error('A note cannot be nested inside itself or its descendants.')
      if (cursor.deletedAt) throw new Error('Restore the parent note before adding a sub-note.')
      seen.add(cursor.id)
      cursor = notes.find((item) => item.id === cursor?.parentId)
    }
  }
  for (const id of normalized.labelIds) {
    const label = workspace.noteLabels?.find((item) => item.id === id)
    if (!label) throw new Error('One of these labels is unavailable. Remove it or choose another label.')
    if (label.deletedAt) continue
    if (label.projectId && label.projectId !== note.projectId) throw new Error('A project label can only be used on that project’s notes.')
  }
  return normalized
}

export function createPersonalNote(workspace: Workspace, input: PersonalNoteInput, id: string, now: string): PersonalNote {
  if (workspace.personalNotes?.some((note) => note.id === id)) throw new Error('This note identity is already in use.')
  const note = validateNote(workspace, { ...input, id, createdAt: now, updatedAt: now })
  workspace.personalNotes ??= []
  workspace.personalNotes.push(note)
  return note
}

export function editPersonalNote(workspace: Workspace, id: string, input: PersonalNoteUpdate, now: string): void {
  const note = workspace.personalNotes?.find((item) => item.id === id && !item.deletedAt)
  if (!note) throw new Error('This note is unavailable. Restore it before editing.')
  if ('projectId' in input && input.projectId !== note.projectId && descendants(workspace.personalNotes ?? [], id).size > 1) {
    throw new Error('This note has sub-notes. Keep the group in its current project, or move the sub-notes out first.')
  }
  // Explicit fields keep identity, timestamps and deletion state out of editable input.
  const editable: PersonalNoteUpdate = {}
  for (const key of ['title', 'body', 'projectId', 'parentId', 'color', 'labelIds', 'pinned', 'checklist'] as const) {
    if (key in input) Object.assign(editable, { [key]: input[key] })
  }
  if (!('parentId' in input) && note.parentId && !personalNoteParent(note, visiblePersonalNotes(workspace))) editable.parentId = undefined
  Object.assign(note, validateNote(workspace, { ...note, ...editable, updatedAt: now }, 'checklist' in input))
}

export function removePersonalNote(workspace: Workspace, id: string, now: string): void {
  const notes = workspace.personalNotes ?? []
  const root = notes.find((item) => item.id === id && !item.deletedAt)
  if (!root) return
  const ids = descendants(notes, id)
  for (const note of notes) {
    if (ids.has(note.id) && !note.deletedAt) Object.assign(note, { deletedAt: now, updatedAt: now })
  }
}

/** One recoverable root per deleted tree or cycle, without mixing project scopes. */
export function deletedPersonalNoteRoots(notes: PersonalNote[]): PersonalNote[] {
  const deleted = notes.filter((note) => note.deletedAt)
  const map = new Map(deleted.map((note) => [note.id, note]))
  const roots = new Map<string, PersonalNote>()
  const visited = new Set<string>()
  for (const note of deleted) {
    if (visited.has(note.id)) continue
    const path: PersonalNote[] = []
    const indexes = new Map<string, number>()
    let cursor: PersonalNote | undefined = note
    while (cursor && !visited.has(cursor.id)) {
      const cycleStart = indexes.get(cursor.id)
      if (cycleStart !== undefined) {
        const root = path.slice(cycleStart).sort((left, right) => left.id.localeCompare(right.id))[0]
        roots.set(root.id, root)
        break
      }
      indexes.set(cursor.id, path.length)
      path.push(cursor)
      const parent: PersonalNote | undefined = cursor.parentId ? map.get(cursor.parentId) : undefined
      if (!parent || parent.projectId !== cursor.projectId) {
        roots.set(cursor.id, cursor)
        break
      }
      cursor = parent
    }
    for (const item of path) visited.add(item.id)
  }
  return [...roots.values()]
}

function isInDeletedCycle(note: PersonalNote, notes: PersonalNote[]): boolean {
  const map = new Map(notes.filter((item) => item.deletedAt && item.projectId === note.projectId).map((item) => [item.id, item]))
  const seen = new Set<string>()
  let cursor = note.parentId ? map.get(note.parentId) : undefined
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id === note.id) return true
    seen.add(cursor.id)
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  return false
}

export function restorePersonalNoteTree(workspace: Workspace, id: string, now: string): void {
  const notes = workspace.personalNotes ?? []
  const root = notes.find((item) => item.id === id)
  if (!root?.deletedAt) return
  assertProject(workspace, root.projectId)
  const cycleRoot = isInDeletedCycle(root, notes)
  if (!cycleRoot && root.parentId && notes.some((item) => item.id === root.parentId && item.projectId === root.projectId && item.deletedAt)) {
    throw new Error('Restore the parent note first.')
  }
  const deletion = root.deletedAt
  const ids = descendants(notes, id)
  // Concurrent parent moves can form a cycle. Break only the selected root's
  // invalid link; keep every note and earlier deletion batch intact.
  if (cycleRoot) root.parentId = undefined
  for (const note of notes) {
    if (ids.has(note.id) && note.deletedAt === deletion) Object.assign(note, { deletedAt: undefined, updatedAt: now })
  }
}

export function upsertNoteLabel(workspace: Workspace, input: NoteLabelInput, id: string, now: string): NoteLabel {
  assertProject(workspace, input.projectId)
  const name = input.name.trim()
  if (!name || name.length > 80) throw new Error('Give the label a name of 1–80 characters.')
  const color = normalizeNoteColor(input.color)
  if (!color) throw new Error('Choose a color for the label.')
  const labels = workspace.noteLabels ?? []
  const existing = input.id ? labels.find((label) => label.id === input.id && !label.deletedAt) : undefined
  if (input.id && !existing) throw new Error('This label is unavailable.')
  if (labels.some((label) => !label.deletedAt && label.id !== existing?.id && label.projectId === input.projectId && label.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('This section already has a label with that name.')
  }
  if (existing?.projectId !== input.projectId && existing && workspace.personalNotes?.some((note) => note.labelIds?.includes(existing.id))) {
    throw new Error('This label is in use. Create a new label in the other project instead.')
  }
  const label: NoteLabel = { id: existing?.id ?? id, projectId: input.projectId, name, color, createdAt: existing?.createdAt ?? now, updatedAt: now }
  if (existing) Object.assign(existing, label)
  else { workspace.noteLabels ??= []; workspace.noteLabels.push(label) }
  return label
}

export function removeNoteLabel(workspace: Workspace, id: string, now: string): void {
  const label = workspace.noteLabels?.find((item) => item.id === id && !item.deletedAt)
  if (label) Object.assign(label, { deletedAt: now, updatedAt: now })
  // Keep references in note snapshots so removing a label never destroys note data.
}

/** All active content, including new children created concurrently with a parent deletion. */
export function visiblePersonalNotes(workspace: Pick<Workspace, 'personalNotes'>): PersonalNote[] {
  return (workspace.personalNotes ?? []).filter((note) => !note.deletedAt)
}

/** Invalid links from concurrent moves become display roots instead of losing their content. */
export function personalNoteParent(note: PersonalNote, notes: PersonalNote[]): string | undefined {
  const map = new Map(notes.map((item) => [item.id, item]))
  const seen = new Set([note.id])
  let cursor = note.parentId ? map.get(note.parentId) : undefined
  while (cursor) {
    if (cursor.deletedAt || cursor.projectId !== note.projectId || seen.has(cursor.id)) return undefined
    seen.add(cursor.id)
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined
  }
  return note.parentId && map.has(note.parentId) ? note.parentId : undefined
}
