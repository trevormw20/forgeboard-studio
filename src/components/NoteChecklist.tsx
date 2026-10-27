import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CornerDownRight, GripVertical, ListChecks, MoreHorizontal, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { useForgeboard } from '../hooks/useForgeboard'
import { canMoveChecklistItem, deletedChecklistRoots, orderedChecklist } from '../lib/noteChecklist'
import type { PersonalNote } from '../types'
import './note-checklist.css'

type Forge = ReturnType<typeof useForgeboard>
type Direction = 'indent' | 'outdent' | 'up' | 'down'
type Drag = { id: string; pointerId: number; startX: number; startY: number; x: number; y: number }

export function NoteChecklist({ forge, note, autoFocus = false, focusItemId }: { forge: Forge; note: PersonalNote; autoFocus?: boolean; focusItemId?: string }) {
  const descriptionId = useId()
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const pendingFocus = useRef<string | undefined>(undefined)
  const initialFocusChecked = useRef(false)
  const lastFocusRequest = useRef<string | undefined>(undefined)
  const requestedFocus = useRef<string | undefined>(undefined)
  const drag = useRef<Drag | undefined>(undefined)
  const [dragging, setDragging] = useState<{ id: string; x: number }>()
  const [optionsId, setOptionsId] = useState<string>()
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastDeleted, setLastDeleted] = useState<{ id: string; text: string }>()
  const items = note.checklist ?? []
  const rows = useMemo(() => orderedChecklist(note.checklist ?? []), [note.checklist])
  const groups = useMemo(() => {
    const grouped: (typeof rows)[] = []
    for (const row of rows) {
      if (row.depth === 0 || grouped.length === 0) grouped.push([])
      grouped[grouped.length - 1].push(row)
    }
    return grouped
  }, [rows])
  const completed = rows.filter(({ item }) => item.completedAt).length
  const deleted = items.filter((item) => item.deletedAt)
  const deletedRoots = deletedChecklistRoots(items)
  const nameOf = (text: string) => text.trim() || 'New item'

  // Consume each explicit request once. A requested row can arrive in the next
  // workspace snapshot, but ordinary autosaves must never move the cursor back.
  useLayoutEffect(() => {
    if (lastFocusRequest.current !== focusItemId) {
      lastFocusRequest.current = focusItemId
      requestedFocus.current = focusItemId
    }
    if (!initialFocusChecked.current) {
      initialFocusChecked.current = true
      if (autoFocus && !requestedFocus.current && !pendingFocus.current) pendingFocus.current = rows[0]?.item.id
    }
    const id = pendingFocus.current ?? requestedFocus.current
    if (!id) return
    const group = groups.find((group) => group.some(({ item }) => item.id === id))
    if (group && group[0].item.id !== id && collapsedIds.has(group[0].item.id)) {
      setCollapsedIds((current) => { const next = new Set(current); next.delete(group[0].item.id); return next })
      return
    }
    const input = id && inputs.current.get(id)
    if (input) {
      input.focus()
      if (pendingFocus.current === id) pendingFocus.current = undefined
      if (requestedFocus.current === id) requestedFocus.current = undefined
    }
  }, [autoFocus, focusItemId, rows, groups, collapsedIds])

  function attempt(action: () => void) {
    try { action(); setError(''); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this checklist change. Please try again.'); return false }
  }

  function add(input: { text: string; parentId?: string; afterId?: string }) {
    return attempt(() => {
      pendingFocus.current = forge.actions.addNoteChecklistItem(note.id, input)
      const parentGroup = input.parentId && groups.find((group) => group.some(({ item }) => item.id === input.parentId))
      if (parentGroup) setCollapsedIds((current) => { const next = new Set(current); next.delete(parentGroup[0].item.id); return next })
      setOptionsId(undefined)
      setNotice('Checklist item added.')
    })
  }

  function move(id: string, direction: Direction) {
    if (!canMoveChecklistItem(items, id, direction)) return
    const expand = new Set([id])
    const group = groups.find((group) => group.some(({ item }) => item.id === id))
    if (group) expand.add(group[0].item.id)
    if (direction === 'indent') {
      const index = rows.findIndex(({ item }) => item.id === id)
      const previous = rows.slice(0, index).reverse().find((row) => row.depth <= rows[index].depth)
      const destination = previous && groups.find((group) => group.some(({ item }) => item.id === previous.item.id))
      if (destination) expand.add(destination[0].item.id)
    }
    attempt(() => {
      forge.actions.moveNoteChecklistItem(note.id, id, direction)
      setCollapsedIds((current) => { const next = new Set(current); for (const root of expand) next.delete(root); return next })
      setNotice(direction === 'indent' ? 'Moved into the item above.' : direction === 'outdent' ? 'Moved out one level.' : `Moved ${direction}.`)
    })
  }

  function toggleGroup(id: string) {
    setCollapsedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
    setOptionsId(undefined)
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
    <p id={descriptionId} className="sr-only">Slide the dotted handle right to nest, left to unnest. Enter adds an item; Tab / Shift+Tab changes its level.</p>
    {groups.length > 0 && <ul className="nc-list" aria-label="Checklist items">{groups.flatMap((group) => {
      const root = group[0].item
      const collapsed = collapsedIds.has(root.id)
      const childCount = group.length - 1
      const visible = group.filter(({ depth }) => !collapsed || depth === 0)
      // Keep every row under one keyed list so nesting/reordering preserves the
      // actual input element, its focus, and the cursor position while typing.
      return visible.map(({ item, depth }) => {
      const name = nameOf(item.text)
      const expanded = optionsId === item.id
      return <li key={item.id} className={`nc-item ${depth === 0 ? 'nc-root' : ''} ${item.completedAt ? 'is-complete' : ''} ${dragging?.id === item.id ? 'is-sliding' : ''}`} aria-label={`Checklist item: ${name}`} aria-level={depth + 1} style={{ '--check-depth': depth, '--check-slide': dragging?.id === item.id ? `${dragging.x}px` : '0px' } as CSSProperties}>
        <div className="nc-row">
          <button type="button" className="nc-grip" aria-label={`Move ${name}`} aria-describedby={descriptionId} title="Slide right or left to change nesting. Arrow keys also move this item." onKeyDown={(event) => gripKey(event, item.id)} onPointerDown={(event) => startDrag(event, item.id)} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)}><GripVertical size={18} /></button>
          <label className="nc-check"><input type="checkbox" aria-label={name} checked={Boolean(item.completedAt)} onChange={() => attempt(() => forge.actions.toggleNoteChecklistItem(note.id, item.id))} /><span className="sr-only">{name}</span></label>
          <input className="nc-text" ref={(element) => { if (element) inputs.current.set(item.id, element); else inputs.current.delete(item.id) }} aria-label={`Edit ${name}`} value={item.text} placeholder="List item" maxLength={10000} onChange={(event) => attempt(() => forge.actions.updateNoteChecklistItem(note.id, item.id, { text: event.target.value }))} onKeyDown={(event) => rowKey(event, item.id)} />
          {depth === 0 && <button type="button" className="nc-icon nc-toggle" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${name} list`} aria-expanded={!collapsed} title={`${collapsed ? 'Expand' : 'Collapse'} list${childCount ? ` · ${childCount} sub-items` : ''}`} onClick={() => toggleGroup(item.id)}>{collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}{collapsed && childCount > 0 && <span className="nc-child-count" aria-hidden="true">{childCount}</span>}</button>}
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
      })
    })}</ul>}
    <button type="button" className="nc-add-main" data-note-checklist-add-start="" onClick={() => add({ text: '' })}><Plus size={17} /><span>Add item</span></button>
    <span className="sr-only" role="status">{notice}</span>
    {lastDeleted && <div className="nc-undo"><span>“{lastDeleted.text}” deleted with its sub-items.</span><button type="button" onClick={() => restore(lastDeleted.id)}><Undo2 size={14} />Undo</button><button type="button" className="nc-icon" aria-label="Dismiss checklist delete notice" onClick={() => setLastDeleted(undefined)}><X size={14} /></button></div>}
    {error && <p className="nc-error" role="alert">{error}</p>}
    {deleted.length > 0 && <details className="nc-trash"><summary>Deleted checklist items · {deleted.length}</summary><p>Restore brings back this item and the sub-items deleted with it.</p>{deletedRoots.map((item) => <div key={item.id}><span>{nameOf(item.text)}</span><button type="button" aria-label={`Restore checklist item: ${nameOf(item.text)}`} onClick={() => restore(item.id)}><Undo2 size={14} />Restore</button></div>)}</details>}
  </section>
}
