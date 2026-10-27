import { Fragment, useState } from 'react'
import type { PersonalNote } from '../types'
import type { useForgeboard } from '../hooks/useForgeboard'
import { checklistCompletionSections, displayChecklist } from '../lib/noteChecklist'

export function NoteChecklistPreview({ note, forge }: { note: PersonalNote; forge: ReturnType<typeof useForgeboard> }) {
  const [error, setError] = useState('')
  const rows = displayChecklist(note.checklist ?? [])
  if (!rows.length) return null
  const completed = rows.filter(({ item }) => item.completedAt).length
  const sections = checklistCompletionSections(rows)
  const toggle = (itemId: string) => {
    try { forge.actions.toggleNoteChecklistItem(note.id, itemId); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'This item could not be saved. Open the note to try again.') }
  }
  return <div className="pn-checklist-preview" aria-label={`Checklist in ${note.title || 'Untitled note'}`}>
    {rows.slice(0, 5).map(({ item, depth }) => <Fragment key={item.id}>
      {sections.get(item.id)?.startsCheckedSection && <div className="pn-checklist-checked-divider" role="separator" aria-label={depth === 0 ? 'Checked items' : 'Checked items in this group'} style={{ marginLeft: `${Math.min(depth, 3) * 14}px` }}>{depth === 0 ? 'Checked items' : 'Checked'}</div>}
      <label className={`${item.completedAt ? 'is-checked' : ''} ${sections.get(item.id)?.inCheckedSection ? 'is-checked-section' : ''}`} style={{ paddingLeft: `${Math.min(depth, 3) * 14}px` }}>
      <input type="checkbox" checked={Boolean(item.completedAt)} onChange={() => toggle(item.id)} aria-label={`Check ${item.text || 'untitled item'}`} />
      <span>{item.text || 'Untitled item'}</span>
    </label></Fragment>)}
    <small>{completed}/{rows.length} checked{rows.length > 5 ? ` · ${rows.length - 5} more inside` : ''}</small>
    {error && <p className="pn-error" role="alert">{error}</p>}
  </div>
}
