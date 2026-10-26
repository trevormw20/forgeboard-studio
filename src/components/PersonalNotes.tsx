import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Check, ChevronRight, FolderPlus, Layers3, ListChecks, NotebookPen, Palette, Pin, Plus, Search, Tag, Trash2, Type, Undo2, X } from 'lucide-react'
import type { useForgeboard } from '../hooks/useForgeboard'
import type { NoteChecklistItem, PersonalNote } from '../types'
import { deletedPersonalNoteRoots } from '../lib/personalNotes'
import { orderedChecklist } from '../lib/noteChecklist'
import { createId, isoNow } from '../lib/ids'
import { NoteConflictCopies } from './NoteConflictCopies'
import { NoteChecklist } from './NoteChecklist'
import { NoteChecklistPreview } from './NoteChecklistPreview'
import './personal-notes.css'

type Forge = ReturnType<typeof useForgeboard>
type NoteChanges = Partial<Pick<PersonalNote, 'title' | 'body' | 'color' | 'labelIds' | 'pinned'>>
const COLORS = [
  { name: 'Slate', color: '#8094ad' },
  { name: 'Blue', color: '#73a7ed' },
  { name: 'Lavender', color: '#b59be8' },
  { name: 'Rose', color: '#df9ab6' },
  { name: 'Peach', color: '#e2aa7b' },
  { name: 'Honey', color: '#d6bc74' },
  { name: 'Sage', color: '#8bbca7' },
  { name: 'Aqua', color: '#7bbec7' },
]
const noteTitle = (note: PersonalNote) => note.title.trim() || orderedChecklist(note.checklist ?? []).find(({ item }) => item.text.trim())?.item.text.trim() || 'Untitled note'
function firstCheckbox(text = ''): NoteChecklistItem {
  const at = isoNow()
  return { id: createId('note-check'), text, order: 0, createdAt: at, updatedAt: at }
}
const scopeKey = (id?: string) => id ?? ''
const sameScope = (left?: string, right?: string) => scopeKey(left) === scopeKey(right)

// Broken, cross-project, or deleted parent links become roots rather than hiding
// surviving notes after a concurrent change on another device.
function parentOf(note: PersonalNote, notes: PersonalNote[]): PersonalNote | undefined {
  if (!note.parentId || note.parentId === note.id) return undefined
  const parent = notes.find((item) => item.id === note.parentId && !item.deletedAt && sameScope(item.projectId, note.projectId))
  if (!parent) return undefined
  const visited = new Set([note.id])
  let current: PersonalNote | undefined = parent
  while (current) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    current = notes.find((item) => item.id === current?.parentId && !item.deletedAt && sameScope(item.projectId, note.projectId))
  }
  return parent
}

function noteStyle(color?: string): CSSProperties {
  return { '--note-color': /^#[\da-f]{3}([\da-f]{3})?$/i.test(color ?? '') ? color : '#8094ad' } as CSSProperties
}

function NoteDetails({ body, onChange }: { body: string; onChange: (body: string) => void }) {
  const [open, setOpen] = useState(Boolean(body))
  return <details className="pn-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Note details</summary><label className="pn-body-label"><span className="sr-only">Note text</span><textarea aria-label="Note text" value={body} rows={3} maxLength={100000} onChange={(event) => onChange(event.target.value)} /></label></details>
}

export function PersonalNotes({ forge, onAddProject, initialProjectId, onProjectChange, searchQuery, onSearchQueryChange, onCaptureBlockedChange }: {
  forge: Forge
  onAddProject: () => void
  initialProjectId?: string
  onProjectChange?: (projectId?: string) => void
  searchQuery?: string
  onSearchQueryChange?: (query: string) => void
  onCaptureBlockedChange?: (blocked: boolean) => void
}) {
  const [scope, setScope] = useState(initialProjectId ?? '')
  const scopeRef = useRef(scope)
  const [selectedId, setSelectedId] = useState<string>()
  const [localQuery, setLocalQuery] = useState('')
  const query = searchQuery ?? localQuery
  const [capture, setCapture] = useState('')
  const captureTarget = useRef<{ noteId: string; itemId: string } | undefined>(undefined)
  const captureFailed = useRef(false)
  const [captureBlocked, setCaptureBlocked] = useState(false)
  const setCaptureFailure = useCallback((failed: boolean) => { captureFailed.current = failed; setCaptureBlocked(failed) }, [])
  const [focusEditor, setFocusEditor] = useState(true)
  const [focusItemId, setFocusItemId] = useState<string>()
  const [titleOpenId, setTitleOpenId] = useState<string>()
  const [bodyOpenId, setBodyOpenId] = useState<string>()
  const editor = useRef<HTMLElement | null>(null)
  const [labelFilter, setLabelFilter] = useState('')
  const [showLabels, setShowLabels] = useState(false)
  const [labelId, setLabelId] = useState<string>()
  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState('#b59be8')
  const [error, setError] = useState('')
  const [lastDeleted, setLastDeleted] = useState<{ id: string; title: string }>()
  const { flushLocalSaves } = forge.actions
  useEffect(() => { onCaptureBlockedChange?.(captureBlocked && Boolean(capture.trim())) }, [capture, captureBlocked, onCaptureBlockedChange])
  useEffect(() => () => onCaptureBlockedChange?.(false), [onCaptureBlockedChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!captureFailed.current || !capture.trim()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [capture])
  useEffect(() => () => { void flushLocalSaves().catch(() => { /* The draft stays queued for retry. */ }) }, [flushLocalSaves])
  useEffect(() => {
    const incoming = initialProjectId ?? ''
    // A global result updates the App's project context after selecting the note.
    // Keep that selection; only an externally selected notebook resets it.
    if (incoming === scopeRef.current || captureFailed.current) return
    void flushLocalSaves().catch(() => { /* The draft stays queued for retry. */ })
    scopeRef.current = incoming
    setScope(incoming)
    setSelectedId(undefined)
    setLabelFilter('')
    setShowLabels(false)
    setLabelId(undefined)
    setLabelName('')
    setLocalQuery('')
    onSearchQueryChange?.('')
    captureTarget.current = undefined
    setCaptureFailure(false)
    setFocusItemId(undefined)
    setCapture('')
    setError('')
  }, [initialProjectId, flushLocalSaves, onSearchQueryChange, setCaptureFailure])
  function flushNote() { void flushLocalSaves().catch(() => { /* Save errors are shown below the editor. */ }) }
  function setQuery(value: string) { setLocalQuery(value); onSearchQueryChange?.(value) }
  const projects = forge.workspace.projects.filter((project) => !project.deletedAt)
  const project = projects.find((item) => item.id === scope)
  // A removed project must not make an otherwise recoverable notebook invisible.
  const scopeExists = !scope || Boolean(project)
  const allNotes = forge.workspace.personalNotes ?? []
  const notes = allNotes.filter((note) => !note.deletedAt)
  const scopedNotes = notes.filter((note) => sameScope(note.projectId, scope))
  const deletedNotes = allNotes.filter((note) => note.deletedAt && sameScope(note.projectId, scope))
  const deletedRoots = deletedPersonalNoteRoots(deletedNotes)
  const allLabels = (forge.workspace.noteLabels ?? []).filter((label) => !label.deletedAt)
  const labels = allLabels.filter((label) => !label.projectId || label.projectId === scope)
  const selected = scopedNotes.find((note) => note.id === selectedId)
  const scopeName = project?.name ?? (scope ? 'Archived project notes' : 'General notes')
  const breadcrumbs: PersonalNote[] = []
  if (selected) {
    let current: PersonalNote | undefined = selected
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      breadcrumbs.unshift(current)
      current = parentOf(current, notes)
    }
  }
  const globalSearch = Boolean(query.trim())
  const searching = Boolean(globalSearch || labelFilter)
  const shown = (globalSearch ? notes : scopedNotes).filter((note) => {
    const textMatches = !query.trim() || `${note.title}\n${note.body}\n${(note.checklist ?? []).filter((item) => !item.deletedAt).map((item) => item.text).join('\n')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    const labelMatches = globalSearch || !labelFilter || note.labelIds?.includes(labelFilter)
    const locationMatches = searching || (selected ? parentOf(note, notes)?.id === selected.id : !parentOf(note, notes))
    return textMatches && labelMatches && locationMatches
  }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
  const pinned = shown.filter((note) => note.pinned)
  const others = shown.filter((note) => !note.pinned)
  const cloudState = forge.localSave.error ? 'Not saved yet · Keep this tab open and retry' : forge.localSave.pending || forge.localSave.saving ? 'Saving automatically…' : !forge.configured ? 'Saved on this device · Connect GitHub to sync' : !forge.syncMeta.online ? 'Saved on this device · Offline, sync queued' : forge.syncMeta.lastError ? 'Saved on this device · Sync needs attention' : forge.syncMeta.syncing ? 'Saved on this device · Syncing to GitHub…' : forge.syncMeta.dirty ? 'Saved on this device · Waiting to sync' : forge.syncMeta.lastSyncedAt ? 'Synced with your private GitHub vault' : 'Edits save automatically on this device'

  function attempt(action: () => void) {
    try { action(); setError(''); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this change. Please try again.'); return false }
  }

  function changeScope(id: string) {
    if (captureFailed.current) return
    flushNote()
    scopeRef.current = id
    setScope(id)
    setSelectedId(undefined)
    setQuery('')
    setLabelFilter('')
    setShowLabels(false)
    setLabelId(undefined)
    setLabelName('')
    setError('')
    captureTarget.current = undefined
    setCaptureFailure(false)
    setFocusItemId(undefined)
    setCapture('')
    onProjectChange?.(id || undefined)
  }

  function openNote(id?: string) {
    if (captureFailed.current) return
    flushNote()
    const target = id ? notes.find((note) => note.id === id) : undefined
    if (target && !sameScope(target.projectId, scope)) {
      scopeRef.current = target.projectId ?? ''
      setScope(target.projectId ?? '')
      setShowLabels(false)
      setLabelId(undefined)
      setLabelName('')
      onProjectChange?.(target.projectId)
    }
    setSelectedId(id)
    setFocusEditor(true)
    setFocusItemId(undefined)
    setTitleOpenId(target?.title ? id : undefined)
    setBodyOpenId(target?.body ? id : undefined)
    captureTarget.current = undefined
    setCaptureFailure(false)
    setCapture('')
    setQuery('')
    setLabelFilter('')
    setError('')
  }

  function addNote(parentId?: string) {
    if (captureFailed.current) return
    attempt(() => {
      const id = forge.actions.addPersonalNote({ projectId: scope || undefined, parentId, title: '', body: '', checklist: [firstCheckbox()], color: selected?.color ?? '#8094ad', labelIds: labelFilter ? [labelFilter] : [] })
      openNote(id)
    })
  }

  function captureNote(value: string) {
    setCapture(value)
    if (!captureTarget.current && !value.trim()) return
    setCaptureFailure(!attempt(() => {
      if (captureTarget.current) {
        const { noteId, itemId } = captureTarget.current
        forge.actions.updateNoteChecklistItem(noteId, itemId, { text: value })
      } else {
        const item = firstCheckbox(value)
        const id = forge.actions.addPersonalNote({ projectId: scope || undefined, title: '', body: '', checklist: [item], color: '#8094ad', labelIds: labelFilter ? [labelFilter] : [] })
        captureTarget.current = { noteId: id, itemId: item.id }
        setSelectedId(id)
        setFocusEditor(false)
        setFocusItemId(undefined)
        setTitleOpenId(undefined)
        setQuery('')
        setLabelFilter('')
      }
    }))
  }

  function finishCapture() {
    // Keep a failed draft visible for retry instead of clearing the only copy.
    if (captureFailed.current) return
    flushNote()
    captureTarget.current = undefined
    setCapture('')
  }

  function continueCapture() {
    const target = captureTarget.current
    if (!target || captureFailed.current) return
    const okay = attempt(() => {
      const nextId = capture.trim() ? forge.actions.addNoteChecklistItem(target.noteId, { text: '', afterId: target.itemId }) : target.itemId
      setFocusItemId(nextId)
      finishCapture()
    })
    if (!okay) setCaptureFailure(true)
  }

  function recoverCapture() {
    if (!capture.trim()) return
    const okay = attempt(() => {
      const item = firstCheckbox(capture)
      const id = forge.actions.addPersonalNote({ projectId: scope || undefined, title: '', body: '', checklist: [item], color: '#8094ad', labelIds: [] })
      captureTarget.current = { noteId: id, itemId: item.id }
      setCaptureFailure(false)
      setSelectedId(id)
      setFocusEditor(false)
      setFocusItemId(item.id)
      finishCapture()
    })
    if (!okay) setCaptureFailure(true)
  }

  function discardFailedCapture() {
    if (!window.confirm('Discard the unsaved text in quick entry? Already saved notes will stay unchanged.')) return
    setCaptureFailure(false)
    captureTarget.current = undefined
    setCapture('')
    setError('')
  }

  function updateNote(changes: NoteChanges) {
    if (selected) attempt(() => forge.actions.updatePersonalNote(selected.id, { ...(selected.parentId && !parentOf(selected, notes) ? { parentId: undefined } : {}), ...changes }))
  }

  function removeNote(note: PersonalNote) {
    attempt(() => {
      const parent = parentOf(note, notes)
      forge.actions.deletePersonalNote(note.id)
      setLastDeleted({ id: note.id, title: noteTitle(note) })
      if (selectedId === note.id) openNote(parent?.id)
    })
  }

  function saveLabel() {
    attempt(() => {
      const existing = labels.find((label) => label.id === labelId)
      forge.actions.saveNoteLabel({ id: labelId, projectId: existing ? existing.projectId : scope || undefined, name: labelName, color: labelColor })
      setLabelName('')
      setLabelId(undefined)
    })
  }

  function renderCard(note: PersonalNote) {
    const children = notes.filter((child) => parentOf(child, notes)?.id === note.id)
    const parent = parentOf(note, notes)
    const hasChecklist = note.checklist !== undefined
    const cardLabels = globalSearch ? allLabels.filter((label) => !label.projectId || sameScope(label.projectId, note.projectId)) : labels
    const notebookName = projects.find((item) => item.id === note.projectId)?.name ?? (note.projectId ? 'Archived project notes' : 'General notes')
    return <article className={`pn-card ${hasChecklist ? 'pn-checklist-card' : ''}`} key={note.id} style={noteStyle(note.color)}>
      <button className="pn-card-open" onClick={() => openNote(note.id)} aria-label={`Open note: ${noteTitle(note)}`}>
        <h3>{noteTitle(note)}</h3>
        {globalSearch && <span className="pn-result-notebook"><NotebookPen size={12} />{notebookName}</span>}
        {note.body && <p>{note.body}</p>}
        {!note.body && !children.length && !(note.checklist ?? []).some((item) => !item.deletedAt) && <p className="pn-card-placeholder">{hasChecklist ? 'Open to add checklist items.' : 'Open to edit or add a checklist.'}</p>}
        {searching && parent && <span className="pn-card-location"><Layers3 size={12} />Inside {noteTitle(parent)}</span>}
        {children.length > 0 && <span className="pn-child-count"><Layers3 size={13} />{children.length} sub-note{children.length === 1 ? '' : 's'}</span>}
        {(note.labelIds ?? []).some((id) => cardLabels.some((label) => label.id === id)) && <span className="pn-card-labels">{cardLabels.filter((label) => note.labelIds?.includes(label.id)).map((label) => <span className="pn-label" key={label.id} style={noteStyle(label.color)}><i />{label.name}</span>)}</span>}
      </button>
      <NoteChecklistPreview note={note} forge={forge} />
      <div className="pn-card-actions">
        <span>{new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        <button className={`pn-icon ${note.pinned ? 'is-pinned' : ''}`} aria-label={`${note.pinned ? 'Unpin' : 'Pin'} note: ${noteTitle(note)}`} aria-pressed={Boolean(note.pinned)} onClick={() => attempt(() => forge.actions.updatePersonalNote(note.id, { pinned: !note.pinned }))}><Pin size={15} /></button>
        <button className="pn-icon" aria-label={`Delete note: ${noteTitle(note)}`} onClick={() => removeNote(note)}><Trash2 size={15} /></button>
      </div>
    </article>
  }

  return <section className="personal-notes" aria-label="Personal notes">
    <section className="pn-notebooks" aria-label="Project notebooks">
      <div className="pn-notebook-top"><label htmlFor="pn-project">Project notebook</label><button className="pn-text-button" onClick={onAddProject}><FolderPlus size={15} />Add project notes</button></div>
      <select id="pn-project" value={scope} onChange={(event) => changeScope(event.target.value)}><option value="">General notes</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{!scopeExists && <option value={scope}>Archived project notes</option>}</select>
      <div className="pn-project-chips" aria-label="Switch project notebook"><button className={!scope ? 'active' : ''} aria-pressed={!scope} onClick={() => changeScope('')}><NotebookPen size={15} />General</button>{projects.map((item) => <button key={item.id} className={scope === item.id ? 'active' : ''} aria-pressed={scope === item.id} onClick={() => changeScope(item.id)} style={{ '--project-color': item.color } as CSSProperties}><span className="pn-project-dot" />{item.name}</button>)}</div>
      <p>Every Forgeboard project gets a notebook automatically. Notes stay separate from tasks and chat handoffs.</p>
    </section>

    {searchQuery === undefined && <div className="pn-search pn-standalone-search"><Search size={17} /><input aria-label="Search all notes" type="search" placeholder="Search every project’s notes…" value={query} onChange={(event) => { flushNote(); setQuery(event.target.value) }} />{query && <button className="pn-icon" aria-label="Clear note search" onClick={() => setQuery('')}><X size={15} /></button>}</div>}
    <div className="pn-toolbar">
      <div className="pn-capture"><ListChecks size={18} /><input aria-label="Start a checklist note" placeholder={`Type your first checkbox in ${scopeName}…`} value={capture} maxLength={10000} onChange={(event) => captureNote(event.target.value)} onBlur={finishCapture} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && captureTarget.current) { event.preventDefault(); continueCapture() } }} /></div>
      <button className="pn-new-button" onClick={() => addNote(selected?.id)}><Plus size={17} />{selected ? 'Add sub-note' : 'New note'}</button>
    </div>
    {globalSearch && <div className="pn-global-search-state"><Search size={15} /><span>Searching <strong>all project notebooks</strong> for “{query.trim()}”</span><button className="pn-text-button" onClick={() => setQuery('')}><X size={14} />Clear search</button></div>}

    <div className="pn-scope-bar"><div><span className="pn-scope-icon" style={{ color: project?.color ?? '#b59be8' }}>{project?.icon ?? <NotebookPen size={19} />}</span><h2>{scopeName}</h2><span className="pn-total">{scopedNotes.length} note{scopedNotes.length === 1 ? '' : 's'}</span></div><button className="pn-text-button" aria-expanded={showLabels} onClick={() => setShowLabels(!showLabels)}><Tag size={14} />Labels</button></div>

    {!globalSearch && labels.length > 0 && <div className="pn-label-filters" aria-label="Filter notes by label"><button className={`pn-label-filter ${!labelFilter ? 'active' : ''}`} aria-pressed={!labelFilter} onClick={() => setLabelFilter('')}>All labels</button>{labels.map((label) => <button key={label.id} className={`pn-label-filter ${labelFilter === label.id ? 'active' : ''}`} style={noteStyle(label.color)} aria-pressed={labelFilter === label.id} onClick={() => setLabelFilter(labelFilter === label.id ? '' : label.id)}><i />{label.name}</button>)}</div>}

    {showLabels && <section className="pn-label-manager" aria-label="Manage note labels"><div><h3>Make labels your own</h3><p>Labels belong to this notebook. Choose any color.</p></div><form onSubmit={(event) => { event.preventDefault(); saveLabel() }}><label>Label name<input required maxLength={80} value={labelName} placeholder="Ideas, references, launch…" onChange={(event) => setLabelName(event.target.value)} /></label><label className="pn-custom-color">Label color<input type="color" value={labelColor} onChange={(event) => setLabelColor(event.target.value)} /></label><button className="pn-small-button" type="submit">{labelId ? 'Save label' : 'Add label'}</button>{labelId && <button type="button" className="pn-text-button" onClick={() => { setLabelId(undefined); setLabelName('') }}>Cancel edit</button>}</form>{labels.length > 0 && <ul>{labels.map((label) => <li key={label.id}><span className="pn-label" style={noteStyle(label.color)}><i />{label.name}{!label.projectId && scope && <small> · General</small>}</span><button className="pn-text-button" onClick={() => { setLabelId(label.id); setLabelName(label.name); setLabelColor(label.color) }}>Edit<span className="sr-only"> label {label.name}</span></button><button className="pn-icon" aria-label={`Delete label: ${label.name}`} onClick={() => attempt(() => { forge.actions.deleteNoteLabel(label.id); if (labelFilter === label.id) setLabelFilter(''); if (labelId === label.id) { setLabelId(undefined); setLabelName('') } })}><Trash2 size={14} /></button></li>)}</ul>}</section>}

    {lastDeleted && <div className="pn-undo" role="status"><span>“{lastDeleted.title}” and its sub-notes moved to trash.</span><button onClick={() => attempt(() => { forge.actions.restorePersonalNote(lastDeleted.id); setLastDeleted(undefined) })}><Undo2 size={15} />Undo delete</button><button className="pn-icon" aria-label="Dismiss delete notice" onClick={() => setLastDeleted(undefined)}><X size={14} /></button></div>}
    {(error || captureBlocked) && <div className="pn-error" role="alert">{error || 'Your quick-entry draft could not be saved.'}{captureBlocked && <><p>Your quick-entry draft is still here. Copy it or save it as a new checklist before leaving Notes.</p><button className="pn-text-button" onClick={recoverCapture} disabled={!scopeExists || !capture.trim()}>Save draft as new checklist</button><button className="pn-text-button" onClick={discardFailedCapture}>Discard unsaved draft</button></>}</div>}
    {forge.localSave.error && <p className="pn-error" role="alert">Your latest edits are still open here, but could not be saved on this device. Keep this tab open.<button className="pn-text-button" onClick={flushNote}>Retry save</button></p>}

    {selected && !searching && <>
      <nav className="pn-breadcrumbs" aria-label="Note location"><button onClick={() => openNote()}>{scopeName}</button>{breadcrumbs.map((note, index) => <span key={note.id}><ChevronRight size={13} />{index === breadcrumbs.length - 1 ? <span aria-current="page">{noteTitle(note)}</span> : <button onClick={() => openNote(note.id)}>{noteTitle(note)}</button>}</span>)}</nav>
      <section ref={editor} className="pn-editor" aria-label="Note editor" style={noteStyle(selected.color)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) flushNote() }}>
        <div className="pn-editor-top"><button className="pn-text-button" onClick={() => openNote(parentOf(selected, notes)?.id)}><ArrowLeft size={16} />{parentOf(selected, notes) ? 'Back to parent' : 'All notes'}</button><div>{!selected.title && titleOpenId !== selected.id && <button className="pn-icon" aria-label="Add title" title="Add optional title" onClick={() => setTitleOpenId(selected.id)}><Type size={16} /></button>}<button className={`pn-icon ${selected.pinned ? 'is-pinned' : ''}`} aria-label={selected.pinned ? 'Unpin current note' : 'Pin current note'} aria-pressed={Boolean(selected.pinned)} onClick={() => updateNote({ pinned: !selected.pinned })}><Pin size={16} /></button><button className="pn-icon" aria-label="Delete current note and sub-notes" onClick={() => removeNote(selected)}><Trash2 size={16} /></button><button className="pn-small-button" aria-label="Close note" onClick={() => openNote(parentOf(selected, notes)?.id)}><X size={15} />Close</button></div></div>
        {(selected.title || titleOpenId === selected.id) && <label className="pn-title-label"><span className="sr-only">Note title</span><input autoFocus key={selected.id} aria-label="Note title" placeholder="Optional title" value={selected.title} maxLength={300} onChange={(event) => { setTitleOpenId(selected.id); updateNote({ title: event.target.value }) }} /></label>}
        <NoteChecklist key={selected.id} forge={forge} note={selected} autoFocus={focusEditor} focusItemId={focusItemId} />
        {(selected.body || bodyOpenId === selected.id) && <NoteDetails key={`${selected.id}:details`} body={selected.body} onChange={(body) => { setBodyOpenId(selected.id); updateNote({ body }) }} />}
        <div className="pn-editor-options"><fieldset className="pn-colors"><legend><Palette size={14} />Note color</legend><div>{COLORS.map((color) => <button key={color.name} type="button" title={color.name} aria-label={`${color.name} note color`} aria-pressed={selected.color === color.color} style={{ backgroundColor: color.color }} onClick={() => updateNote({ color: color.color })}>{selected.color === color.color && <Check size={15} />}</button>)}<label className="pn-color-picker" title="Custom note color"><Palette size={15} /><span className="sr-only">Custom note color</span><input aria-label="Custom note color" type="color" value={selected.color ?? '#8094ad'} onChange={(event) => updateNote({ color: event.target.value })} /></label></div></fieldset><div className="pn-note-labels"><span><Tag size={14} />Labels</span><div>{labels.map((label) => <label className={`pn-label-check ${selected.labelIds?.includes(label.id) ? 'active' : ''}`} key={label.id} style={noteStyle(label.color)}><input type="checkbox" checked={Boolean(selected.labelIds?.includes(label.id))} onChange={(event) => updateNote({ labelIds: event.target.checked ? [...(selected.labelIds ?? []), label.id] : selected.labelIds?.filter((id) => id !== label.id) })} />{label.name}</label>)}<button className="pn-text-button" onClick={() => setShowLabels(true)}><Plus size={13} />{labels.length ? 'Manage' : 'Create a label'}</button></div></div></div>
        <p className="pn-save-state" role="status"><Check size={12} />{cloudState}</p>
        <p className="pn-autosave-hint">Note text autosaves after a second of no typing, and when you leave. No save button needed.</p>
      </section>
    </>}

    <div className="pn-grid-heading"><h3>{searching ? `${globalSearch ? 'All notebooks' : 'Search results'}${shown.length ? ` · ${shown.length}` : ''}` : selected ? 'Sub-notes' : 'Your notes'}</h3>{selected && !searching && <span>Keep going deeper—each sub-note can have its own sub-notes.</span>}{searching && <button className="pn-text-button" onClick={() => { setQuery(''); setLabelFilter('') }}>Clear filters</button>}</div>
    {!shown.length ? <div className="pn-empty"><span className="pn-empty-icon">{searching ? <Search size={25} /> : selected ? <Layers3 size={25} /> : <NotebookPen size={25} />}</span><h3>{searching ? 'No matching notes' : selected ? 'Give this thought a little room' : `A fresh page for ${scopeName === 'General notes' ? 'you' : scopeName}`}</h3><p>{searching ? 'Try another word or clear your label filter.' : selected ? 'Break it into sub-notes, then go as deep as you need.' : 'Ideas, references, plans, or things you want to remember. No task required.'}</p>{!searching && <button className="pn-new-button" onClick={() => addNote(selected?.id)}><Plus size={16} />{selected ? 'Add first sub-note' : 'Create your first note'}</button>}</div> : <>{pinned.length > 0 && <><h4 className="pn-group-title"><Pin size={13} />Pinned</h4><div className="pn-grid">{pinned.map(renderCard)}</div></>}{others.length > 0 && <>{pinned.length > 0 && <h4 className="pn-group-title">Other notes</h4>}<div className="pn-grid">{others.map(renderCard)}</div></>}</>}
    {deletedNotes.length > 0 && <details className="pn-trash"><summary><Trash2 size={15} />Recently deleted<span>{deletedNotes.length}</span></summary><p>Deleted notes stay in your private workspace until you restore them. Restoring a group brings back the sub-notes deleted with it.</p><ul>{(deletedRoots.length ? deletedRoots : [deletedNotes[0]]).sort((a, b) => Date.parse(b.deletedAt!) - Date.parse(a.deletedAt!)).map((note) => <li key={note.id}><div><strong>{noteTitle(note)}</strong><small>Deleted {new Date(note.deletedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><button className="pn-small-button" aria-label={`Restore note group: ${noteTitle(note)}`} onClick={() => attempt(() => { forge.actions.restorePersonalNote(note.id); if (lastDeleted?.id === note.id) setLastDeleted(undefined) })}><Undo2 size={14} />Restore group</button></li>)}</ul></details>}
    <NoteConflictCopies forge={forge} projectId={scope || undefined} />
    <footer className="pn-footer"><Check size={13} /><span>{cloudState}. Notes are not sent to AI for summaries.</span></footer>
  </section>
}
