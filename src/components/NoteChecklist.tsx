import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CornerDownRight, GripVertical, ListChecks, MoreHorizontal, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { useForgeboard } from '../hooks/useForgeboard'
import { canMoveChecklistItem, deletedChecklistRoots, orderedChecklist } from '../lib/noteChecklist'
import type { PersonalNote } from '../types'
import './note-checklist.css'

type Forge = ReturnType<typeof useForgeboard>
type Direction = 'indent' | 'outdent' | 'up' | 'down'
type Drag = { id: string; pointerId: number; startX: number; startY: number; x: number; y: number }

export function NoteChecklist({ forge, note }: { forge: Forge; note: PersonalNote }) {
  const descriptionId = useId()
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const pendingFocus = useRef<string | undefined>(undefined)
  const drag = useRef<Drag | undefined>(undefined)
  const [dragging, setDragging] = useState<{ id: string; x: number }>()
  const [optionsId, setOptionsId] = useState<string>()
  const [newText, setNewText] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastDeleted, setLastDeleted] = useState<{ id: string; text: string }>()
  const items = note.checklist ?? []
  const rows = orderedChecklist(items)
  const completed = rows.filter(({ item }) => item.completedAt).length
  const deleted = items.filter((item) => item.deletedAt)
  const deletedRoots = deletedChecklistRoots(items)
  const nameOf = (text: string) => text.trim() || 'New item'

  useLayoutEffect(() => {
    const id = pendingFocus.current
    const input = id && inputs.current.get(id)
    if (input) { input.focus(); pendingFocus.current = undefined }
  }, [note.checklist])

  function attempt(action: () => void) {
    try { action(); setError(''); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this checklist change. Please try again.'); return false }
  }

  function add(input: { text: string; parentId?: string; afterId?: string }) {
    return attempt(() => {
      pendingFocus.current = forge.actions.addNoteChecklistItem(note.id, input)
      setOptionsId(undefined)
      setNotice('Checklist item added.')
    })
  }

  function move(id: string, direction: Direction) {
    if (!canMoveChecklistItem(items, id, direction)) return
    attempt(() => {
      forge.actions.moveNoteChecklistItem(note.id, id, direction)
      setNotice(direction === 'indent' ? 'Moved into the item above.' : direction === 'outdent' ? 'Moved out one level.' : `Moved ${direction}.`)
    })
  }

  function rowKey(event: KeyboardEvent<HTMLInputElement>, id: string) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      add({ text: '', afterId: id })
    } else if (event.key === 'Tab') {
      const direction = event.shiftKey ? 'outdent' : 'indent'
      if (canMoveChecklistItem(items, id, direction)) { event.preventDefault(); move(id, direction) }
    }
  }

  function gripKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const direction = ({ ArrowRight: 'indent', ArrowLeft: 'outdent', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowRight']
    if (direction) { event.preventDefault(); move(id, direction) }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 && event.pointerType !== 'touch') return
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: 0, y: 0 }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function updateDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    current.x = event.clientX - current.startX
    current.y = event.clientY - current.startY
    if (Math.abs(current.x) > 6 && Math.abs(current.x) > Math.abs(current.y)) {
      setDragging({ id: current.id, x: Math.max(-40, Math.min(40, current.x)) })
    }
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = undefined
    setDragging(undefined)
    if (cancelled) return
    const x = event.clientX - current.startX
    const y = event.clientY - current.startY
    if (Math.abs(x) >= 30 && Math.abs(x) > Math.abs(y) * 1.2) move(current.id, x > 0 ? 'indent' : 'outdent')
  }

  function restore(id: string) {
    attempt(() => {
      forge.actions.restoreNoteChecklistItem(note.id, id)
      if (lastDeleted?.id === id) setLastDeleted(undefined)
      setNotice('Checklist item and its deleted sub-items restored.')
    })
  }

  return <section className="note-checklist" aria-label="Note checklist">
    <div className="nc-heading"><h3><ListChecks size={16} />Checklist</h3>{rows.length > 0 && <span>{completed} of {rows.length} done</span>}</div>
    <p id={descriptionId} className="nc-help">Slide the dotted handle right to nest, left to unnest. Enter adds an item; Tab / Shift+Tab changes its level.</p>
    {rows.length > 0 && <ul className="nc-list" aria-label="Checklist items">{rows.map(({ item, depth }) => {
      const name = nameOf(item.text)
      const expanded = optionsId === item.id
      return <li key={item.id} className={`nc-item ${item.completedAt ? 'is-complete' : ''} ${dragging?.id === item.id ? 'is-sliding' : ''}`} aria-label={`Checklist item: ${name}`} aria-level={depth + 1} style={{ '--check-depth': depth, '--check-slide': dragging?.id === item.id ? `${dragging.x}px` : '0px' } as CSSProperties}>
        <div className="nc-row">
          <button type="button" className="nc-grip" aria-label={`Move ${name}`} aria-describedby={descriptionId} title="Slide right or left to change nesting. Arrow keys also move this item." onKeyDown={(event) => gripKey(event, item.id)} onPointerDown={(event) => startDrag(event, item.id)} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)}><GripVertical size={18} /></button>
          <label className="nc-check"><input type="checkbox" aria-label={name} checked={Boolean(item.completedAt)} onChange={() => attempt(() => forge.actions.toggleNoteChecklistItem(note.id, item.id))} /><span className="sr-only">{name}</span></label>
          <input className="nc-text" ref={(element) => { if (element) inputs.current.set(item.id, element); else inputs.current.delete(item.id) }} aria-label={`Edit ${name}`} value={item.text} placeholder="List item" maxLength={10000} onChange={(event) => attempt(() => forge.actions.updateNoteChecklistItem(note.id, item.id, { text: event.target.value }))} onKeyDown={(event) => rowKey(event, item.id)} />
          <button type="button" className={`nc-icon ${expanded ? 'is-open' : ''}`} aria-label={`Options for ${name}`} aria-expanded={expanded} onClick={() => setOptionsId(expanded ? undefined : item.id)}><MoreHorizontal size={18} /></button>
        </div>
        {expanded && <div className="nc-actions" aria-label={`Actions for ${name}`}>
          <button type="button" onClick={() => add({ text: '', parentId: item.id })} aria-label={`Add sub-item to ${name}`}><CornerDownRight size={15} />Sub-item</button>
          <button type="button" disabled={!canMoveChecklistItem(items, item.id, 'indent')} onClick={() => move(item.id, 'indent')} aria-label={`Indent ${name}`}><ChevronRight size={15} />Indent</button>
          <button type="button" disabled={!canMoveChecklistItem(items, item.id, 'outdent')} onClick={() => move(item.id, 'outdent')} aria-label={`Outdent ${name}`}><ChevronLeft size={15} />Outdent</button>
          <button type="button" disabled={!canMoveChecklistItem(items, item.id, 'up')} onClick={() => move(item.id, 'up')} aria-label={`Move ${name} up`}><ArrowUp size={15} />Up</button>
          <button type="button" disabled={!canMoveChecklistItem(items, item.id, 'down')} onClick={() => move(item.id, 'down')} aria-label={`Move ${name} down`}><ArrowDown size={15} />Down</button>
          <button type="button" className="nc-delete" aria-label={`Delete ${name} and its sub-items`} onClick={() => attempt(() => { forge.actions.deleteNoteChecklistItem(note.id, item.id); setLastDeleted({ id: item.id, text: name }); setOptionsId(undefined); setNotice('Checklist item and its sub-items moved to trash.') })}><Trash2 size={15} />Delete</button>
        </div>}
      </li>
    })}</ul>}
    <form className="nc-add" onSubmit={(event) => { event.preventDefault(); if (add({ text: newText })) setNewText('') }}><Plus size={17} /><input aria-label="New checklist item" value={newText} placeholder={rows.length ? 'Add checklist item…' : 'Add your first checklist item…'} maxLength={3000} onChange={(event) => setNewText(event.target.value)} /><button type="submit" aria-label="Add checklist item">Add</button></form>
    <span className="sr-only" role="status">{notice}</span>
    {lastDeleted && <div className="nc-undo"><span>“{lastDeleted.text}” deleted with its sub-items.</span><button type="button" onClick={() => restore(lastDeleted.id)}><Undo2 size={14} />Undo</button><button type="button" className="nc-icon" aria-label="Dismiss checklist delete notice" onClick={() => setLastDeleted(undefined)}><X size={14} /></button></div>}
    {error && <p className="nc-error" role="alert">{error}</p>}
    {deleted.length > 0 && <details className="nc-trash"><summary>Deleted checklist items · {deleted.length}</summary><p>Restore brings back this item and the sub-items deleted with it.</p>{deletedRoots.map((item) => <div key={item.id}><span>{nameOf(item.text)}</span><button type="button" aria-label={`Restore checklist item: ${nameOf(item.text)}`} onClick={() => restore(item.id)}><Undo2 size={14} />Restore</button></div>)}</details>}
  </section>
}
