import { useState } from 'react'
import type { PersonalNote } from '../types'
import type { useForgeboard } from '../hooks/useForgeboard'
import { displayChecklist } from '../lib/noteChecklist'

export function NoteChecklistPreview({ note, forge }: { note: PersonalNote; forge: ReturnType<typeof useForgeboard> }) {
  const [error, setError] = useState('')
  const rows = displayChecklist(note.checklist ?? [])
  if (!rows.length) return null
  const completed = rows.filter(({ item }) => item.completedAt).length
  const toggle = (itemId: string) => {
    try { forge.actions.toggleNoteChecklistItem(note.id, itemId); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'This item could not be saved. Open the note to try again.') }
  }
  return <div className="pn-checklist-preview" aria-label={`Checklist in ${note.title || 'Untitled note'}`}>
    {rows.slice(0, 5).map(({ item, depth }) => <label key={item.id} className={item.completedAt ? 'is-checked' : ''} style={{ paddingLeft: `${Math.min(depth, 3) * 14}px` }}>
      <input type="checkbox" checked={Boolean(item.completedAt)} onChange={() => toggle(item.id)} aria-label={`Check ${item.text || 'untitled item'}`} />
      <span>{item.text || 'Untitled item'}</span>
    </label>)}
    <small>{completed}/{rows.length} checked{rows.length > 5 ? ` · ${rows.length - 5} more inside` : ''}</small>
    {error && <p className="pn-error" role="alert">{error}</p>}
  </div>
}
