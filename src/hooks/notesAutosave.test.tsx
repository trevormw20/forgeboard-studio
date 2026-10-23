// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { PersonalNotes } from '../components/PersonalNotes'
import { createSeedWorkspace } from '../seed'
import type { MutationRecord, Workspace } from '../types'
import { fetchWorkspace, putWorkspace } from '../lib/github'
import { useForgeboard } from './useForgeboard'

const storage = vi.hoisted(() => ({
  cached: undefined as Workspace | undefined,
  base: undefined as Workspace | undefined,
  mutations: new Map<string, MutationRecord>(),
  save: vi.fn<(workspace: Workspace, mutations: MutationRecord[]) => Promise<void>>(),
}))
vi.mock('../lib/db', () => ({
  loadCachedWorkspace: async () => storage.cached,
  loadBaseWorkspace: async () => storage.base,
  loadConnection: async () => undefined,
  countMutations: async () => storage.mutations.size,
  mutationIds: async () => [...storage.mutations.keys()],
  saveWorkspaceChanges: (...args: [Workspace, MutationRecord[]]) => storage.save(...args),
  clearMutations: async (ids: string[]) => { ids.forEach((id) => storage.mutations.delete(id)) },
  saveBaseWorkspace: async (workspace: Workspace) => { storage.base = structuredClone(workspace) },
  saveSha: async () => {}, saveConnection: async () => {}, clearConnection: async () => {},
}))
vi.mock('../lib/github', async (original) => ({
  ...await original<object>(), fetchWorkspace: vi.fn(), putWorkspace: vi.fn(), fetchTaskInbox: async () => [],
}))

const config = { owner: 'test', repo: 'private-vault', branch: 'main', path: 'data/workspace.json', token: 'test-token', rememberToken: false }

beforeEach(() => {
  const workspace = createSeedWorkspace()
  const at = workspace.updatedAt
  workspace.personalNotes = [
    { id: 'first-note', projectId: workspace.projects[0].id, title: 'First project', body: 'Original thought', createdAt: at, updatedAt: at, checklist: [
      { id: 'parent', text: 'Tuesday', order: 0, createdAt: at, updatedAt: at },
      { id: 'child', text: 'Orange chicken', parentId: 'parent', order: 0, createdAt: at, updatedAt: at },
    ] },
    { id: 'second-note', projectId: workspace.projects[1].id, title: 'Second project', body: 'Other project thought', createdAt: at, updatedAt: at },
  ]
  storage.cached = structuredClone(workspace)
  storage.base = structuredClone(workspace)
  storage.mutations.clear()
  storage.save.mockReset().mockImplementation(async (snapshot, mutations) => {
    storage.cached = structuredClone(snapshot)
    for (const mutation of mutations) storage.mutations.set(mutation.id, mutation)
  })
  vi.mocked(fetchWorkspace).mockReset().mockResolvedValue({ workspace, sha: 'remote-sha' })
  vi.mocked(putWorkspace).mockReset().mockResolvedValue('saved-sha')
})

afterEach(async () => {
  await act(async () => { cleanup() })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function startHook() {
  const hook = renderHook(() => useForgeboard())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  vi.useFakeTimers()
  return hook
}

function NotesHarness() {
  const forge = useForgeboard()
  const [showNotes, setShowNotes] = useState(true)
  if (!forge.ready) return <p>Loading notes</p>
  return <>
    <button onClick={() => setShowNotes(false)}>Go to Today</button>
    {showNotes && <PersonalNotes forge={forge} initialProjectId={forge.workspace.projects[0].id} onAddProject={() => {}} />}
  </>
}

describe('notes autosave integration', () => {
  it('updates the editor immediately and saves the latest title, body, and checklist text once after a typing pause', async () => {
    const { result } = await startHook()
    act(() => { result.current.actions.updatePersonalNote('first-note', { title: 'A' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(storage.save).not.toHaveBeenCalled()
    act(() => {
      result.current.actions.updatePersonalNote('first-note', { title: 'A finished title' })
      result.current.actions.updatePersonalNote('first-note', { body: 'The latest full thought' })
      result.current.actions.updateNoteChecklistItem('first-note', 'child', { text: 'Orange chicken and rice' })
    })
    expect(result.current.workspace.personalNotes?.[0].title).toBe('A finished title')
    expect(result.current.localSave.pending).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(999) })
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.cached?.personalNotes?.[0]).toMatchObject({ title: 'A finished title', body: 'The latest full thought', checklist: expect.arrayContaining([expect.objectContaining({ id: 'child', text: 'Orange chicken and rice' })]) })
    expect(storage.mutations.size).toBe(2)
    expect(result.current.localSave).toMatchObject({ pending: false, saving: false, error: undefined })
  })

  it('saves a checkbox immediately, including nearby unsaved typing, without checking its children', async () => {
    const { result } = await startHook()
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Just typed this' }) })
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => { result.current.actions.toggleNoteChecklistItem('first-note', 'parent') })
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.cached?.personalNotes?.[0].body).toBe('Just typed this')
    expect(storage.cached?.personalNotes?.[0].checklist?.find((item) => item.id === 'parent')?.completedAt).toBeTruthy()
    expect(storage.cached?.personalNotes?.[0].checklist?.find((item) => item.id === 'child')?.completedAt).toBeUndefined()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(storage.save).toHaveBeenCalledTimes(1)
  })

  it('flushes when switching notebooks and leaving Notes, keeping each draft with its original project', async () => {
    render(<NotesHarness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open note: First project' }))
    vi.useFakeTimers()
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close note' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'First project draft' } })
    expect(storage.save).not.toHaveBeenCalled()
    expect(screen.getAllByText('Saving automatically…').length).toBeGreaterThan(0)
    const secondProjectId = storage.cached!.projects[1].id
    await act(async () => { fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: secondProjectId } }) })
    expect(storage.cached?.personalNotes?.[0]).toMatchObject({ id: 'first-note', projectId: storage.cached!.projects[0].id, body: 'First project draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Second project' }))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Second project draft' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to Today' })) })
    expect(screen.queryByRole('region', { name: 'Personal notes' })).toBeNull()
    expect(storage.cached?.personalNotes?.[1]).toMatchObject({ id: 'second-note', projectId: secondProjectId, body: 'Second project draft' })
    expect(storage.cached?.personalNotes?.[0].body).toBe('First project draft')
    expect(storage.save).toHaveBeenCalledTimes(2)
  })

  it('flushes before a tab is hidden or unloaded and when the hook unmounts', async () => {
    const { result, unmount } = await startHook()
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Before backgrounding' }) })
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(storage.cached?.personalNotes?.[0].body).toBe('Before backgrounding')
    visibility.mockReturnValue('visible')
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Before pagehide' }) })
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    expect(storage.cached?.personalNotes?.[0].body).toBe('Before pagehide')
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Before unmount' }) })
    await act(async () => { unmount() })
    expect(storage.cached?.personalNotes?.[0].body).toBe('Before unmount')
    expect(storage.save).toHaveBeenCalledTimes(3)
  })

  it('includes text still inside the debounce window in an explicit GitHub sync', async () => {
    const { result } = await startHook()
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Send this exact draft to my other device' }) })
    expect(storage.save).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.actions.updateConnection(config)).toBe(true) })
    expect(putWorkspace).toHaveBeenCalledTimes(1)
    expect(vi.mocked(putWorkspace).mock.calls[0][1].personalNotes?.[0].body).toBe('Send this exact draft to my other device')
    expect(storage.cached?.personalNotes?.[0].body).toBe('Send this exact draft to my other device')
    expect(storage.mutations.size).toBe(0)
    expect(result.current.syncMeta.dirty).toBe(false)
  })

  it('checkpoints typing received during an upload together with another project’s remote note, then syncs the remaining edit', async () => {
    const { result } = await startHook()
    const remote = structuredClone(storage.base!)
    const remoteNote = { id: 'other-device-note', projectId: remote.projects[1].id, title: 'Written on my phone', body: 'Keep this with the second project', createdAt: remote.updatedAt, updatedAt: remote.updatedAt }
    remote.personalNotes!.push(remoteNote)
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: remote, sha: 'remote-phone-sha' })
    let resolveUpload!: (sha: string) => void
    vi.mocked(putWorkspace).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve }))
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Draft included in the first upload' }) })
    let syncing!: Promise<boolean>
    await act(async () => { syncing = result.current.actions.updateConnection(config) })
    expect(putWorkspace).toHaveBeenCalledTimes(1)
    const firstUpload = structuredClone(vi.mocked(putWorkspace).mock.calls[0][1])
    expect(firstUpload.personalNotes?.find((note) => note.id === remoteNote.id)).toMatchObject(remoteNote)
    expect(storage.mutations.size).toBe(1)

    // This newer draft is queued locally while the earlier snapshot is uploading.
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'New typing while the upload was in flight' }) })
    expect(result.current.localSave.pending).toBe(true)
    expect(storage.cached?.personalNotes?.find((note) => note.id === remoteNote.id)).toBeUndefined()
    await act(async () => { resolveUpload('first-upload-sha'); expect(await syncing).toBe(true) })

    for (const workspace of [result.current.workspace, storage.cached!]) {
      expect(workspace.personalNotes?.find((note) => note.id === 'first-note')).toMatchObject({ projectId: remote.projects[0].id, body: 'New typing while the upload was in flight' })
      expect(workspace.personalNotes?.find((note) => note.id === remoteNote.id)).toMatchObject(remoteNote)
    }
    expect(storage.mutations.size).toBe(1)
    expect(result.current.syncMeta).toMatchObject({ dirty: true, pendingWrites: 1 })
    // A stale debounce timer must not overwrite the merged checkpoint afterward.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(storage.cached?.personalNotes?.find((note) => note.id === remoteNote.id)).toMatchObject(remoteNote)
    expect(storage.cached?.personalNotes?.find((note) => note.id === 'first-note')?.body).toBe('New typing while the upload was in flight')

    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: firstUpload, sha: 'first-upload-sha' })
    await act(async () => { expect(await result.current.actions.syncNow()).toBe(true) })
    expect(putWorkspace).toHaveBeenCalledTimes(2)
    const nextUpload = vi.mocked(putWorkspace).mock.calls[1][1]
    expect(nextUpload.personalNotes?.find((note) => note.id === 'first-note')?.body).toBe('New typing while the upload was in flight')
    expect(nextUpload.personalNotes?.find((note) => note.id === remoteNote.id)).toMatchObject(remoteNote)
    expect(storage.mutations.size).toBe(0)
    expect(result.current.syncMeta).toMatchObject({ dirty: false, pendingWrites: 0 })
  })

  it('retains a failed draft and its outbox entries, surfaces the error, and retries without another keystroke', async () => {
    const { result } = await startHook()
    storage.save.mockRejectedValueOnce(new Error('Device storage is full'))
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Do not lose this draft' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(result.current.localSave).toMatchObject({ pending: true, saving: false, error: 'Device storage is full' })
    expect(result.current.workspace.personalNotes?.[0].body).toBe('Do not lose this draft')
    expect(storage.cached?.personalNotes?.[0].body).toBe('Original thought')
    expect(storage.mutations.size).toBe(0)
    await act(async () => { await result.current.actions.flushLocalSaves() })
    expect(storage.cached?.personalNotes?.[0].body).toBe('Do not lose this draft')
    expect(storage.mutations.size).toBe(1)
    expect(result.current.localSave).toMatchObject({ pending: false, saving: false, error: undefined })
  })

  it('shows an honest editor save error and lets Retry save persist the still-visible text', async () => {
    render(<NotesHarness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open note: First project' }))
    vi.useFakeTimers()
    storage.save.mockRejectedValueOnce(new Error('Device storage is full'))
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Keep this visible while storage recovers' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved on this device/)
    expect(screen.getAllByText(/Not saved yet/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('Note text') as HTMLTextAreaElement).value).toBe('Keep this visible while storage recovers')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry save' })) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(storage.cached?.personalNotes?.[0].body).toBe('Keep this visible while storage recovers')
    expect(screen.getAllByText(/Saved on this device/).length).toBeGreaterThan(0)
  })

  it('does not upload when a local flush fails; Sync now can retry the same draft safely', async () => {
    const { result } = await startHook()
    storage.save.mockRejectedValueOnce(new Error('Device storage unavailable'))
    act(() => { result.current.actions.updatePersonalNote('first-note', { body: 'Retry this draft' }) })
    await act(async () => { expect(await result.current.actions.updateConnection(config)).toBe(false) })
    expect(fetchWorkspace).not.toHaveBeenCalled()
    expect(putWorkspace).not.toHaveBeenCalled()
    expect(result.current.syncMeta.lastError).toMatch(/Could not save changes on this device/)
    await act(async () => { expect(await result.current.actions.syncNow()).toBe(true) })
    expect(vi.mocked(putWorkspace).mock.calls[0][1].personalNotes?.[0].body).toBe('Retry this draft')
    expect(result.current.localSave.error).toBeUndefined()
  })
})
