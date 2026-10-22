import { useState } from 'react'
import type { ConflictRecord, PersonalNote } from '../types'
import type { useForgeboard } from '../hooks/useForgeboard'
import { orderedChecklist, recoverChecklistSnapshot } from '../lib/noteChecklist'
import './note-conflicts.css'

function noteSnapshot(value: unknown): Partial<PersonalNote> | undefined {
  if (!value || typeof value !== 'object' || !('body' in value) || typeof value.body !== 'string') return undefined
  return value as Partial<PersonalNote>
}

function savedText(note: Partial<PersonalNote>): string {
  const checklist = orderedChecklist(note.checklist ?? []).map(({ item, depth }) => `${'  '.repeat(Math.min(depth, 20))}[${item.completedAt ? 'x' : ' '}] ${item.text}`).join('\n')
  return [note.body, checklist].filter(Boolean).join('\n\n') || '(Empty note)'
}

export function NoteConflictCopies({ forge, projectId }: { forge: ReturnType<typeof useForgeboard>; projectId?: string }) {
  const [message, setMessage] = useState('')
  const [restored, setRestored] = useState<string[]>([])
  const activeProject = (note?: Partial<PersonalNote>) => forge.workspace.projects.find((item) => item.id === note?.projectId && !item.deletedAt)
  const inNotebook = (value: unknown) => {
    const note = noteSnapshot(value)
    return note && activeProject(note)?.id === projectId
  }
  const copies = forge.workspace.conflicts.filter((conflict) => conflict.entityType === 'personal-note' && (inNotebook(conflict.local) || inNotebook(conflict.remote)))
  if (!copies.length) return null

  const restore = (conflict: ConflictRecord, side: 'local' | 'remote') => {
    const note = noteSnapshot(conflict[side])
    if (!note) return
    const project = activeProject(note)
    try {
      forge.actions.addPersonalNote({
        projectId: project?.id,
        title: `${note.title || 'Untitled note'} (saved copy)`.slice(0, 300),
        body: note.body ?? '',
        ...(note.checklist ? { checklist: recoverChecklistSnapshot(note.checklist) } : {}),
        color: /^#[0-9a-f]{6}$/i.test(note.color ?? '') ? note.color : undefined,
        labelIds: (note.labelIds ?? []).filter((id) => forge.workspace.noteLabels?.some((label) => label.id === id && !label.deletedAt && (!label.projectId || label.projectId === project?.id))),
      })
      setRestored((previous) => [...previous, `${conflict.id}:${side}`])
      setMessage(`Copy saved in ${project?.name ?? 'General'}. The original note and both saved versions are unchanged.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not restore this copy. The saved version is still here.') }
  }

  return <details className="note-conflict-copies">
    <summary>Saved conflict copies <span>{copies.length}</span></summary>
    <p>Two devices edited the same note. Both versions are kept here. Save either as a separate note to recover any wording.</p>
    {message && <p role="status">{message}</p>}
    {copies.map((conflict) => {
      const title = noteSnapshot(inNotebook(conflict.local) ? conflict.local : conflict.remote)?.title || 'Untitled note'
      return <section key={conflict.id} aria-label={`Saved versions of ${title}`}>
      <h3>{title}</h3>
      <small>{new Date(conflict.detectedAt).toLocaleString()}</small>
      <div className="note-conflict-versions">{(['local', 'remote'] as const).map((side) => {
        const note = noteSnapshot(conflict[side])
        if (!note || !inNotebook(note)) return null
        const project = activeProject(note)
        const archived = Boolean(note.projectId && !project)
        const saved = restored.includes(`${conflict.id}:${side}`)
        return <div key={side}><strong>{side === 'local' ? 'This device’s version' : 'Other device’s version'}</strong><p>{project?.name ?? 'General'}{archived ? ` · Original project is unavailable (${note.projectId}). Recovery will create a copy in General.` : ''}</p><pre>{savedText(note)}</pre><button type="button" className="secondary-button" onClick={() => restore(conflict, side)} disabled={saved}>{saved ? 'Copy saved' : archived ? `Save ${side === 'local' ? 'this' : 'other'} version to General` : `Save ${side === 'local' ? 'this' : 'other'} version as a note`}</button></div>
      })}</div>
    </section>})}
  </details>
}
