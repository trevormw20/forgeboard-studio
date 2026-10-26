// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { useForgeboard } from '../hooks/useForgeboard'
import { createSeedWorkspace } from '../seed'
import { PersonalNotes } from './PersonalNotes'
import type { PersonalNote, Workspace } from '../types'

function seed(): Workspace {
  const workspace = createSeedWorkspace()
  workspace.projects[0] = { ...workspace.projects[0], id: 'snail', name: 'Snail Mail' }
  workspace.projects[1] = { ...workspace.projects[1], id: 'tactics', name: 'Tactics game' }
  return workspace
}

let cached: Workspace | undefined
vi.mock('../lib/db', () => ({
  loadCachedWorkspace: async () => cached,
  loadConnection: async () => undefined,
  countMutations: async () => 0,
  saveWorkspaceChanges: async (workspace: Workspace) => { cached = structuredClone(workspace) },
}))

afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve() }); cached = undefined; vi.useRealTimers() })

function Harness({ initialProjectId = 'snail', onAdd = () => {}, controlledSearch = false }: { initialProjectId?: string; onAdd?: () => void; controlledSearch?: boolean }) {
  const forge = useForgeboard()
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId)
  const [query, setQuery] = useState('')
  if (!forge.ready) return <p>Loading</p>
  return <>{controlledSearch && <><label>Sidebar note search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button onClick={() => setProjectId('tactics')}>Navigate to Tactics notebook</button></>}<PersonalNotes forge={forge} initialProjectId={projectId} onProjectChange={setProjectId} searchQuery={controlledSearch ? query : undefined} onSearchQueryChange={controlledSearch ? setQuery : undefined} onAddProject={() => { onAdd(); forge.actions.addProject({ name: 'New venture', color: '#73a7ed', icon: '✦' }) }} /><output aria-label="Saved notes">{JSON.stringify(forge.workspace.personalNotes ?? [])}</output></>
}

async function start() {
  cached = seed()
  render(<Harness />)
  await screen.findByRole('button', { name: 'New note' })
}

function setNoteTitle(title: string) {
  if (!screen.queryByLabelText('Note title')) fireEvent.click(screen.getByRole('button', { name: 'Add title' }))
  fireEvent.change(screen.getByLabelText('Note title'), { target: { value: title } })
}

function createNote(title: string) {
  fireEvent.click(screen.getByRole('button', { name: 'New note' }))
  setNoteTitle(title)
}

function savedNotes(): PersonalNote[] { return JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]') }

describe('Personal notes', () => {
  it('creates one untitled note with the capture text in its first checkbox, without stealing focus or requiring Enter', async () => {
    await start()
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Personal notes' })).toBeNull()
    const capture = screen.getByRole('textbox', { name: 'Start a checklist note' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: '   ' } })
    expect(JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')).toHaveLength(0)
    fireEvent.change(capture, { target: { value: 'Shop' } })
    fireEvent.change(capture, { target: { value: 'Shopping' } })
    fireEvent.change(capture, { target: { value: 'Shopping list' } })
    const saved = savedNotes()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ projectId: 'snail', title: '', body: '' })
    expect(saved[0].checklist).toHaveLength(1)
    expect(saved[0].checklist?.[0]).toMatchObject({ text: 'Shopping list', order: 0 })
    expect(document.activeElement).toBe(capture)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Edit Shopping list' }) as HTMLInputElement).value).toBe('Shopping list')
    fireEvent.keyDown(capture, { key: 'Enter' })
    expect(capture.value).toBe('')
    const nextCheckboxText = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(nextCheckboxText)
    expect(savedNotes()[0].checklist).toHaveLength(2)
    fireEvent.change(nextCheckboxText, { target: { value: 'Walmart' } })
    expect(savedNotes()[0].checklist?.map((item) => item.text)).toEqual(['Shopping list', 'Walmart'])
  })

  it('starts a separate checklist capture after leaving the field and routes it only to the chosen notebook', async () => {
    await start()
    const capture = screen.getByRole('textbox', { name: 'Start a checklist note' }) as HTMLInputElement
    fireEvent.change(capture, { target: { value: 'Letter supplies' } })
    fireEvent.blur(capture)
    expect(capture.value).toBe('')
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'tactics' } })
    fireEvent.change(capture, { target: { value: 'Balance checks' } })
    const saved = savedNotes()
    expect(saved).toHaveLength(2)
    expect(saved.find((note) => note.checklist?.[0]?.text === 'Letter supplies')?.projectId).toBe('snail')
    expect(saved.find((note) => note.checklist?.[0]?.text === 'Balance checks')?.projectId).toBe('tactics')
    expect(saved.every((note) => note.checklist?.length === 1 && !note.body && !note.title)).toBe(true)
  })

  it('saves captured checkbox edits and completion, then restores them after reloading without requiring a title', async () => {
    cached = seed()
    const first = render(<Harness />)
    await screen.findByRole('button', { name: 'New note' })
    vi.useFakeTimers()
    const capture = screen.getByRole('textbox', { name: 'Start a checklist note' }) as HTMLInputElement
    fireEvent.change(capture, { target: { value: 'Fish' } })
    fireEvent.blur(capture)
    expect(capture.value).toBe('')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fish' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit Fish' }), { target: { value: 'Fish fillets' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(cached?.personalNotes).toHaveLength(1)
    expect(cached?.personalNotes?.[0]).toMatchObject({ title: '', body: '' })
    expect(cached?.personalNotes?.[0].checklist?.[0]).toMatchObject({ text: 'Fish fillets' })
    expect(cached?.personalNotes?.[0].checklist?.[0].completedAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    expect(screen.getByRole('button', { name: 'Open note: Fish fillets' })).toBeTruthy()
    first.unmount()
    await act(async () => { render(<Harness />); await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Fish fillets' }))
    expect((screen.getByRole('checkbox', { name: 'Fish fillets' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getAllByRole('listitem', { name: /^Checklist item:/ })).toHaveLength(1)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    expect(savedNotes()[0].title).toBe('')
  })

  it('opens new notes and sub-notes directly on a blank checkbox, with a title only when requested', async () => {
    await start()
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    const first = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(first)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    expect(screen.queryByText('Add optional details')).toBeNull()
    fireEvent.change(first, { target: { value: 'Walmart' } })
    const parentId = savedNotes()[0].id
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    const child = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(child)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    fireEvent.change(child, { target: { value: 'Fish' } })
    expect(savedNotes().find((note) => note.parentId === parentId)).toMatchObject({ title: '', body: '', checklist: [{ text: 'Fish' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add title' }))
    const title = screen.getByLabelText('Note title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Optional groceries title' } })
    expect(savedNotes().find((note) => note.parentId === parentId)?.title).toBe('Optional groceries title')
  })

  it('searches all notebooks from the sidebar, includes nested checklist text, and opens the exact project without losing selection', async () => {
    cached = seed()
    const at = '2026-10-26T18:00:00Z'
    cached.personalNotes = [
      { id: 'snail-note', projectId: 'snail', title: 'Launch letters', body: 'Keep this older paragraph', createdAt: at, updatedAt: at },
      { id: 'tactics-note', projectId: 'tactics', title: 'Combat review', body: '', createdAt: at, updatedAt: at, checklist: [
        { id: 'tactics-parent', text: 'Demo', order: 0, createdAt: at, updatedAt: at },
        { id: 'tactics-child', parentId: 'tactics-parent', text: 'Launch playtest', order: 0, createdAt: at, updatedAt: at, completedAt: at },
        { id: 'removed-child', text: 'Secret archived search word', order: 1, createdAt: at, updatedAt: at, deletedAt: at },
      ] },
      { id: 'deleted-note', projectId: 'tactics', title: 'Launch discarded', body: '', createdAt: at, updatedAt: at, deletedAt: at },
    ]
    render(<Harness controlledSearch />)
    const search = await screen.findByRole('searchbox', { name: 'Sidebar note search' })
    expect(screen.queryByRole('searchbox', { name: 'Search all notes' })).toBeNull()
    fireEvent.change(search, { target: { value: 'Launch' } })
    expect(screen.getByRole('button', { name: 'Open note: Launch letters' })).toBeTruthy()
    const result = screen.getByRole('button', { name: 'Open note: Combat review' })
    expect(within(result).getByText('Tactics game')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open note: Launch discarded' })).toBeNull()
    fireEvent.click(result)
    expect((screen.getByLabelText('Project notebook') as HTMLSelectElement).value).toBe('tactics')
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Combat review')
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('region', { name: 'Note editor' })).toBeTruthy()
    const completed = screen.getByRole('checkbox', { name: 'Launch playtest' }) as HTMLInputElement
    expect(completed.checked).toBe(true)
    fireEvent.click(completed)
    expect(completed.checked).toBe(false)
    fireEvent.change(search, { target: { value: 'Secret archived' } })
    expect(screen.getByText('No matching notes')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'older paragraph' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Launch letters' }))
    expect((screen.getByLabelText('Project notebook') as HTMLSelectElement).value).toBe('snail')
    expect(screen.getByText('Note details').closest('details')?.open).toBe(true)
    expect((screen.getByLabelText('Note text') as HTMLTextAreaElement).value).toBe('Keep this older paragraph')
  })

  it('resets editor selection for an external notebook navigation while retaining checklist defaults on reopen', async () => {
    cached = seed()
    render(<Harness controlledSearch />)
    await screen.findByRole('button', { name: 'New note' })
    createNote('A saved list')
    expect(screen.queryByLabelText('Note text')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note: A saved list' }))
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'A changed list' } })
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Tactics notebook' }))
    expect((screen.getByLabelText('Project notebook') as HTMLSelectElement).value).toBe('tactics')
    expect(screen.queryByRole('region', { name: 'Note editor' })).toBeNull()
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    expect(saved[0]).toMatchObject({ title: 'A changed list', projectId: 'snail', checklist: [{ text: '' }] })
  })

  it('finds nested checklist wording and checks an item straight from its note card', async () => {
    cached = seed()
    const at = '2026-10-21T18:00:00Z'
    cached.personalNotes = [{ id: 'list-note', projectId: 'snail', title: 'Reader checks', body: '', createdAt: at, updatedAt: at, checklist: [
      { id: 'parent-item', text: 'Story', order: 0, createdAt: at, updatedAt: at },
      { id: 'child-item', text: 'Try the opening', parentId: 'parent-item', order: 0, createdAt: at, updatedAt: at },
    ] }]
    render(<Harness />)
    await screen.findByRole('button', { name: 'Open note: Reader checks' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all notes' }), { target: { value: 'opening' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Check Try the opening' }))
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')[0]
    expect(saved.checklist.find((item: { id: string }) => item.id === 'child-item').completedAt).toBeTruthy()
    expect(saved.checklist.find((item: { id: string }) => item.id === 'parent-item').completedAt).toBeUndefined()
    expect(screen.queryByRole('region', { name: 'Note editor' })).toBeNull()
  })

  it('keeps project notebooks separate, autosaves on switching, and adds sections from real projects', async () => {
    cached = seed()
    const at = '2026-10-26T18:00:00Z'
    cached.personalNotes = [
      { id: 'legacy-letters', projectId: 'snail', title: 'Letter ideas', body: 'Remember the reader.', createdAt: at, updatedAt: at },
      { id: 'legacy-combat', projectId: 'tactics', title: 'Combat ideas', body: 'Make the turn clear.', createdAt: at, updatedAt: at },
    ]
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open note: Letter ideas' }))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Remember the physical reader experience.' } })
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'tactics' } })
    expect(screen.queryByText('Letter ideas')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Combat ideas' }))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Make the next turn legible.' } })
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    expect(screen.getByRole('button', { name: 'Open note: Letter ideas' })).toBeTruthy()
    expect(screen.queryByText('Combat ideas')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Letter ideas' }))
    expect((screen.getByLabelText('Note text') as HTMLTextAreaElement).value).toBe('Remember the physical reader experience.')
    fireEvent.click(screen.getByRole('button', { name: 'Add project notes' }))
    expect(screen.getByRole('option', { name: 'New venture' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New venture' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText(/Connect GitHub to sync/).length).toBeGreaterThan(0))
  })

  it('creates nested sub-notes at multiple levels with breadcrumbs and durable edits', async () => {
    await start()
    createNote('Launch plan')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    setNoteTitle('Audience')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    setNoteTitle('Reader feedback')
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit New item' }), { target: { value: 'Ask for clarity, not approval.' } })
    const breadcrumbs = within(screen.getByRole('navigation', { name: 'Note location' }))
    expect(breadcrumbs.getByRole('button', { name: 'Launch plan' })).toBeTruthy()
    expect(breadcrumbs.getByRole('button', { name: 'Audience' })).toBeTruthy()
    expect(breadcrumbs.getByText('Reader feedback')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Audience')
    expect(screen.getByRole('button', { name: 'Open note: Reader feedback' })).toBeTruthy()
    fireEvent.click(breadcrumbs.getByRole('button', { name: 'Launch plan' }))
    expect(screen.getByRole('button', { name: 'Open note: Audience' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }))
    expect(screen.getByRole('button', { name: 'Open note: Launch plan' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all notes' }), { target: { value: 'approval' } })
    expect(screen.getByRole('button', { name: 'Open note: Reader feedback' })).toBeTruthy()
    expect(screen.getByText('Inside Audience')).toBeTruthy()
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    expect(saved).toHaveLength(3)
    expect(saved.find((note: { title: string }) => note.title === 'Reader feedback').parentId).toBe(saved.find((note: { title: string }) => note.title === 'Audience').id)
  })

  it('edits note and label colors, filters by custom labels, and pins without losing content', async () => {
    cached = seed()
    const at = '2026-10-26T18:00:00Z'
    cached.personalNotes = [{ id: 'legacy-newsletter', projectId: 'snail', title: 'Newsletter', body: '<script>not executable</script>', createdAt: at, updatedAt: at }]
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open note: Newsletter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))
    fireEvent.change(screen.getByLabelText('Label name'), { target: { value: 'Launch' } })
    fireEvent.change(screen.getByLabelText('Label color'), { target: { value: '#de88ac' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Launch' }))
    fireEvent.change(screen.getByLabelText('Custom note color'), { target: { value: '#6789ab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin current note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('<script>not executable</script>')).toBeTruthy()
    expect(document.querySelector('script')).toBeNull()
    const card = screen.getByRole('button', { name: 'Open note: Newsletter' }).closest('article')
    expect(card?.style.getPropertyValue('--note-color')).toBe('#6789ab')
    fireEvent.click(within(screen.getByLabelText('Filter notes by label')).getByRole('button', { name: 'Launch' }))
    expect(screen.getByRole('button', { name: 'Open note: Newsletter' })).toBeTruthy()
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')[0]
    expect(saved.color).toBe('#6789ab')
    expect(saved.pinned).toBe(true)
    expect(saved.labelIds).toHaveLength(1)
  })

  it('soft-deletes a nested group and restores the whole group with undo', async () => {
    await start()
    createNote('References')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    setNoteTitle('Paper stock')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Note location' })).getByRole('button', { name: 'References' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete current note and sub-notes' }))
    expect(screen.queryByRole('button', { name: 'Open note: References' })).toBeNull()
    expect(JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]').every((note: { deletedAt?: string }) => note.deletedAt)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note: References' }))
    expect(screen.getByRole('button', { name: 'Open note: Paper stock' })).toBeTruthy()
  })

  it('recovers orphaned notes as roots and lets them be edited rather than disappearing', async () => {
    cached = seed()
    cached.personalNotes = [{ id: 'orphan', projectId: 'snail', parentId: 'missing-note', title: 'Recovered thought', body: 'Keep this', createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T12:00:00Z' }]
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open note: Recovered thought' }))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Keep this updated thought' } })
    await waitFor(() => expect((screen.getByLabelText('Note text') as HTMLTextAreaElement).value).toBe('Keep this updated thought'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps deleted note groups recoverable after leaving and reopening Notes', async () => {
    cached = seed()
    const first = render(<Harness />)
    await screen.findByRole('button', { name: 'New note' })
    createNote('Keep for later')
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    setNoteTitle('Nested reference')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Note location' })).getByRole('button', { name: 'Keep for later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete current note and sub-notes' }))
    cached.personalNotes = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    first.unmount()
    render(<Harness />)
    const trash = await screen.findByText('Recently deleted')
    fireEvent.click(trash)
    expect(screen.queryByRole('button', { name: 'Undo delete' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore note group: Keep for later' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Keep for later' }))
    expect(screen.getByRole('button', { name: 'Open note: Nested reference' })).toBeTruthy()
    expect(screen.queryByText('Recently deleted')).toBeNull()
  })
})
