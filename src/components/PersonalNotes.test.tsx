// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { useForgeboard } from '../hooks/useForgeboard'
import { createSeedWorkspace } from '../seed'
import { PersonalNotes } from './PersonalNotes'
import type { Workspace } from '../types'

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
  saveWorkspaceChanges: async () => {},
}))

afterEach(() => { cleanup(); cached = undefined })

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

function createNote(title: string, body?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'New note' }))
  fireEvent.change(screen.getByLabelText('Note title'), { target: { value: title } })
  if (body) {
    fireEvent.click(screen.getByText('Add optional details'))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: body } })
  }
}

describe('Personal notes', () => {
  it('creates one checklist note as capture typing starts without stealing focus or requiring Enter', async () => {
    await start()
    const capture = screen.getByRole('textbox', { name: 'Start a checklist note' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: '   ' } })
    expect(JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')).toHaveLength(0)
    fireEvent.change(capture, { target: { value: 'Shop' } })
    fireEvent.change(capture, { target: { value: 'Shopping' } })
    fireEvent.change(capture, { target: { value: 'Shopping list' } })
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ projectId: 'snail', title: 'Shopping list', body: '', checklist: [] })
    expect(document.activeElement).toBe(capture)
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Shopping list')
    expect(screen.getByText('Add optional details').closest('details')?.open).toBe(false)
    fireEvent.keyDown(capture, { key: 'Enter' })
    expect(capture.value).toBe('')
    const firstCheckboxText = screen.getByRole('region', { name: 'Note checklist' }).querySelector<HTMLInputElement>('input:not([type="checkbox"])')
    expect(firstCheckboxText).not.toBeNull()
    expect(document.activeElement).toBe(firstCheckboxText)
    fireEvent.change(firstCheckboxText!, { target: { value: 'Walmart' } })
    expect(JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')[0].checklist[0].text).toBe('Walmart')
  })

  it('starts a separate checklist capture after leaving the field and routes it only to the chosen notebook', async () => {
    await start()
    const capture = screen.getByRole('textbox', { name: 'Start a checklist note' }) as HTMLInputElement
    fireEvent.change(capture, { target: { value: 'Letter supplies' } })
    fireEvent.blur(capture)
    expect(capture.value).toBe('')
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'tactics' } })
    fireEvent.change(capture, { target: { value: 'Balance checks' } })
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    expect(saved).toHaveLength(2)
    expect(saved.find((note: { title: string }) => note.title === 'Letter supplies').projectId).toBe('snail')
    expect(saved.find((note: { title: string }) => note.title === 'Balance checks').projectId).toBe('tactics')
    expect(saved.every((note: { checklist?: unknown[]; body: string }) => Array.isArray(note.checklist) && !note.body)).toBe(true)
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
    expect(screen.getByText('Add optional details').closest('details')?.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note: A saved list' }))
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'A changed list' } })
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Tactics notebook' }))
    expect((screen.getByLabelText('Project notebook') as HTMLSelectElement).value).toBe('tactics')
    expect(screen.queryByRole('region', { name: 'Note editor' })).toBeNull()
    const saved = JSON.parse(screen.getByLabelText('Saved notes').textContent ?? '[]')
    expect(saved[0]).toMatchObject({ title: 'A changed list', projectId: 'snail', checklist: [] })
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
    await start()
    createNote('Letter ideas', 'Remember the physical reader experience.')
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'tactics' } })
    expect(screen.queryByText('Letter ideas')).toBeNull()
    createNote('Combat ideas', 'Make the next turn legible.')
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
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Audience' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-note' }))
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Reader feedback' } })
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Ask for clarity, not approval.' } })
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
    await start()
    createNote('Newsletter', '<script>not executable</script>')
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
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Paper stock' } })
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
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Nested reference' } })
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
