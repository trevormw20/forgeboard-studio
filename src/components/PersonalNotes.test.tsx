// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  enqueueMutation: async () => {},
  saveCachedWorkspace: async () => {},
}))

afterEach(() => { cleanup(); cached = undefined })

function Harness({ initialProjectId = 'snail', onAdd = () => {} }: { initialProjectId?: string; onAdd?: () => void }) {
  const forge = useForgeboard()
  if (!forge.ready) return <p>Loading</p>
  return <><PersonalNotes forge={forge} initialProjectId={initialProjectId} onAddProject={() => { onAdd(); forge.actions.addProject({ name: 'New venture', color: '#73a7ed', icon: '✦' }) }} /><output aria-label="Saved notes">{JSON.stringify(forge.workspace.personalNotes ?? [])}</output></>
}

async function start() {
  cached = seed()
  render(<Harness />)
  await screen.findByRole('button', { name: 'New note' })
}

function createNote(title: string, body?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'New note' }))
  fireEvent.change(screen.getByLabelText('Note title'), { target: { value: title } })
  if (body) fireEvent.change(screen.getByLabelText('Note text'), { target: { value: body } })
}

describe('Personal notes', () => {
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
    expect(screen.getAllByText(/Connect GitHub to sync/).length).toBeGreaterThan(0)
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
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Audience')
    expect(screen.getByRole('button', { name: 'Open note: Reader feedback' })).toBeTruthy()
    fireEvent.click(breadcrumbs.getByRole('button', { name: 'Launch plan' }))
    expect(screen.getByRole('button', { name: 'Open note: Audience' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All notes' }))
    expect(screen.getByRole('button', { name: 'Open note: Launch plan' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Snail Mail' }), { target: { value: 'approval' } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
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
