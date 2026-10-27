// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from './App'
import { createSeedWorkspace, createTask } from './seed'
import { fetchWorkspace, putWorkspace } from './lib/github'
import type { AgentStatusEvent, ConnectionConfig, MutationRecord, Workspace } from './types'

// The app and hook stay real. Only the browser cache and the private GitHub
// transport are replaced: no token lookup, requests, or real user data occur.
const memory = vi.hoisted(() => ({
  cache: undefined as Workspace | undefined,
  base: undefined as Workspace | undefined,
  remote: undefined as Workspace | undefined,
  mutations: new Map<string, MutationRecord>(),
  sha: 0,
}))
const connection: ConnectionConfig = { owner: 'integration-fixture', repo: 'private-fixture-vault', branch: 'main', path: 'data/workspace.json', token: 'test-placeholder-not-a-credential', rememberToken: false }

vi.mock('./lib/db', () => ({
  loadCachedWorkspace: async () => structuredClone(memory.cache),
  loadConnection: async () => ({ owner: 'integration-fixture', repo: 'private-fixture-vault', branch: 'main', path: 'data/workspace.json', token: 'test-placeholder-not-a-credential', rememberToken: false }),
  loadBaseWorkspace: async () => structuredClone(memory.base),
  countMutations: async () => memory.mutations.size,
  mutationIds: async () => [...memory.mutations.keys()],
  saveWorkspaceChanges: async (workspace: Workspace, records: MutationRecord[]) => {
    memory.cache = structuredClone(workspace)
    records.forEach((record) => memory.mutations.set(record.id, structuredClone(record)))
  },
  clearMutations: async (ids: string[]) => { ids.forEach((id) => memory.mutations.delete(id)) },
  saveBaseWorkspace: async (workspace: Workspace) => { memory.base = structuredClone(workspace) },
  saveSha: async () => {}, saveConnection: async () => {}, clearConnection: async () => {},
  loadAppScale: async () => undefined, saveAppScale: async () => {},
}))
vi.mock('./lib/github', async (original) => ({
  ...await original<object>(), fetchWorkspace: vi.fn(), putWorkspace: vi.fn(), fetchTaskInbox: async () => [],
}))

const at = '2026-10-26T18:00:00.000Z'

function fixture(): Workspace {
  const workspace = createSeedWorkspace()
  workspace.id = 'isolated-integration-workspace'
  workspace.projects = [
    { ...workspace.projects[0], id: 'snail', name: 'Snail Mail' },
    { ...workspace.projects[1], id: 'tactics', name: 'Tactics game' },
  ]
  Object.assign(workspace, { tasks: [], deadlines: [], milestones: [], activity: [], agentChats: [], agentEvents: [], handoffSummaries: [], notificationReads: [], reports: [], inboxNotes: [], conflicts: [] })
  workspace.personalNotes = [
    { id: 'snail-list', projectId: 'snail', title: 'Shopping letters', body: '', checklist: [], createdAt: at, updatedAt: at },
    { id: 'tactics-list', projectId: 'tactics', title: 'Combat supplies', body: 'Shopping context kept from an older note.', createdAt: at, updatedAt: at, checklist: [
      { id: 'tactics-main', text: 'Demo', order: 0, createdAt: at, updatedAt: at },
      { id: 'tactics-child', text: 'Shopping playtest checklist', parentId: 'tactics-main', order: 0, createdAt: at, updatedAt: at },
    ] },
  ]
  workspace.createdAt = at
  workspace.updatedAt = at
  return workspace
}

function report(id: string, name: string, summary: string): AgentStatusEvent {
  return { format: 'forgeboard-status', version: 1, id, project: 'tactics', at: new Date().toISOString(), chat: { id: `${id}-chat`, name, agent: 'claude' }, status: 'done', summary }
}

function setInitial(workspace: Workspace) {
  memory.cache = structuredClone(workspace)
  memory.remote = structuredClone(workspace)
  memory.base = undefined
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

async function mount() {
  const view = render(<App />)
  await settle()
  expect(screen.getByRole('heading', { name: 'Next up' })).toBeTruthy()
  expect(fetchWorkspace).toHaveBeenCalledWith(connection)
  expect(screen.getByRole('button', { name: 'Sync now' }).hasAttribute('disabled')).toBe(false)
  return view
}

function mainNav() { return within(screen.getByRole('navigation', { name: 'Main navigation' })) }
function popups() { return screen.getByLabelText('Live project updates') }
function search(value: string) { fireEvent.change(screen.getByRole('searchbox', { name: 'Search all notes' }), { target: { value } }) }
async function poll(milliseconds = 15_000) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(at))
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Integration fixtures must never make a network request.') }))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  memory.mutations.clear()
  memory.sha = 0
  setInitial(fixture())
  vi.mocked(fetchWorkspace).mockReset().mockImplementation(async () => ({ workspace: structuredClone(memory.remote!), sha: `fixture-sha-${memory.sha}` }))
  vi.mocked(putWorkspace).mockReset().mockImplementation(async (_config, workspace) => {
    memory.remote = structuredClone(workspace)
    return `fixture-sha-${++memory.sha}`
  })
})

afterEach(async () => {
  cleanup()
  await settle()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('notes and live notifications through the real application', () => {
  it('keeps the first search character when typing from Today and finds notes in every project', async () => {
    await mount()
    const field = screen.getByRole('searchbox', { name: 'Search all notes' }) as HTMLInputElement
    expect(field.closest('aside')).not.toBeNull()
    field.focus()
    search('S')
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Personal notes' })).toBeNull()
    expect(field.value).toBe('S')
    expect(document.activeElement).toBe(field)
    search('Shopping')
    expect(field.value).toBe('Shopping')
    expect(screen.getByRole('button', { name: 'Open note: Shopping letters' })).toBeTruthy()
    const tactics = screen.getByRole('button', { name: 'Open note: Combat supplies' })
    expect(within(tactics).getByText('Tactics game')).toBeTruthy()
    expect(screen.getByText('all project notebooks')).toBeTruthy()
    expect(within(popups()).queryByRole('article')).toBeNull()
  })

  it('opens a cross-project search result, edits it, and uses that notebook for the next direct checklist', async () => {
    await mount()
    search('Shopping')
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Combat supplies' }))
    const notebook = screen.getByRole('combobox', { name: 'Project notebook' }) as HTMLSelectElement
    expect(notebook.value).toBe('tactics')
    expect((screen.getByRole('searchbox', { name: 'Search all notes' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('region', { name: 'Note editor' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Combat supplies revised' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close note' }))
    const capture = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: 'One more tactics list' } })
    expect(document.activeElement).toBe(capture)
    await poll(1_000)
    expect(memory.cache?.personalNotes?.find((note) => note.id === 'tactics-list')).toMatchObject({ title: 'Combat supplies revised', projectId: 'tactics', body: 'Shopping context kept from an older note.' })
    const captureNote = memory.cache?.personalNotes?.find((note) => note.checklist?.some((item) => item.text === 'One more tactics list'))
    expect(captureNote).toMatchObject({ projectId: 'tactics', title: '', body: '' })
    expect(captureNote?.checklist).toHaveLength(1)
    expect(captureNote?.checklist?.[0]).toMatchObject({ text: 'One more tactics list' })
    expect(memory.cache?.personalNotes?.find((note) => note.id === 'snail-list')?.title).toBe('Shopping letters')
  })

  it('types in the default checkbox, continues on Enter without replacing it, and syncs the untitled checklist through an app reload', async () => {
    const first = await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    expect(screen.queryByRole('textbox', { name: 'Start a checklist note' })).toBeNull()
    const capture = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: 'M' } })
    await settle()
    const firstRowId = memory.cache?.personalNotes?.find((note) => !note.title)?.checklist?.[0].id
    expect(firstRowId).toBeTruthy()
    fireEvent.change(capture, { target: { value: 'Milk' } })
    expect(screen.getByRole('textbox', { name: 'Edit Milk' })).toBe(capture)
    expect(document.activeElement).toBe(capture)
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    await poll(1_000)
    const captured = memory.cache?.personalNotes?.find((note) => note.checklist?.some((item) => item.text === 'Milk'))
    expect(captured).toMatchObject({ projectId: 'snail', title: '', body: '', checklist: [{ id: firstRowId, text: 'Milk' }] })
    expect(memory.cache?.personalNotes).toHaveLength(3)
    fireEvent.keyDown(capture, { key: 'Enter' })
    expect(capture.value).toBe('Milk')
    expect(screen.getByRole('textbox', { name: 'Edit Milk' })).toBe(capture)
    const next = screen.getByRole('textbox', { name: 'Edit New item' })
    expect(document.activeElement).toBe(next)
    fireEvent.change(next, { target: { value: 'Bread' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Milk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    const remote = memory.remote?.personalNotes?.find((note) => note.id === captured?.id)
    expect(remote?.checklist?.map((item) => item.text)).toEqual(['Milk', 'Bread'])
    expect(remote?.checklist?.map(({ text, order }) => ({ text, order }))).toEqual([{ text: 'Milk', order: 0 }, { text: 'Bread', order: 1 }])
    expect(screen.getAllByRole('listitem', { name: /^Checklist item:/ }).map((item) => item.getAttribute('aria-label'))).toEqual(['Checklist item: Bread', 'Checklist item: Milk'])
    expect(remote?.checklist?.[0].completedAt).toBeTruthy()
    expect(remote?.checklist?.[1].completedAt).toBeUndefined()
    expect(remote).toMatchObject({ title: '', body: '', projectId: 'snail' })
    first.unmount()
    await settle()
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    const card = screen.getByRole('button', { name: 'Open note: Milk' }).closest('article')!
    expect(within(card).getAllByRole('checkbox').map((item) => item.getAttribute('aria-label'))).toEqual(['Check Bread', 'Check Milk'])
    fireEvent.click(within(card).getByRole('button', { name: 'Open note: Milk' }))
    expect((screen.getByRole('checkbox', { name: 'Milk' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Bread' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getAllByRole('listitem', { name: /^Checklist item:/ }).map((item) => item.getAttribute('aria-label'))).toEqual(['Checklist item: Bread', 'Checklist item: Milk'])
    expect(memory.cache?.personalNotes?.find((note) => note.id === captured?.id)?.checklist?.map(({ text, order }) => ({ text, order }))).toEqual([{ text: 'Milk', order: 0 }, { text: 'Bread', order: 1 }])
    expect(screen.queryByLabelText('Note title')).toBeNull()
    expect(screen.queryByLabelText('Note text')).toBeNull()
    expect(memory.cache?.personalNotes?.find((note) => note.id === 'tactics-list')).toMatchObject({ title: 'Combat supplies', body: 'Shopping context kept from an older note.' })
  })

  it.each(['note', 'checkbox'] as const)('keeps failed checkbox text when its %s is deleted remotely, blocks navigation, and recovers it only into the original project', async (deleted) => {
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    const capture = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    capture.focus()
    fireEvent.change(capture, { target: { value: 'Review build' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    const original = memory.remote?.personalNotes?.find((note) => !note.title && note.checklist?.[0]?.text === 'Review build')
    expect(original).toBeTruthy()
    const originalId = original!.id
    const originalItemId = original!.checklist![0].id
    await poll(1_000)
    const incoming = structuredClone(memory.remote!)
    const remotelyDeleted = incoming.personalNotes!.find((note) => note.id === originalId)!
    const changedAt = new Date().toISOString()
    remotelyDeleted.updatedAt = changedAt
    if (deleted === 'note') remotelyDeleted.deletedAt = changedAt
    else Object.assign(remotelyDeleted.checklist!.find((item) => item.id === originalItemId)!, { deletedAt: changedAt, updatedAt: changedAt })
    incoming.updatedAt = changedAt
    memory.remote = incoming
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    const localDeleted = memory.cache!.personalNotes!.find((note) => note.id === originalId)!
    expect(deleted === 'note' ? localDeleted.deletedAt : localDeleted.checklist?.find((item) => item.id === originalItemId)?.deletedAt).toBeTruthy()

    const fullDraft = 'Review build and verify the opening battle before release'
    fireEvent.change(capture, { target: { value: fullDraft } })
    expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: `Edit ${fullDraft}` })).toBe(capture)
    fireEvent.blur(capture)
    expect(capture.value).toBe(fullDraft)
    const leaving = new Event('beforeunload', { cancelable: true })
    fireEvent(window, leaving)
    expect(leaving.defaultPrevented).toBe(true)
    fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Next up' })).toBeNull()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: /Tactics game/ }))
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'tactics' } })
    expect((screen.getByLabelText('Project notebook') as HTMLSelectElement).value).toBe('snail')
    expect(capture.value).toBe(fullDraft)
    if (deleted === 'checkbox') {
      // An unrelated successful edit can clear the transient error, but must not
      // hide the recovery controls or lift protection for the unsaved draft.
      fireEvent.click(screen.getByRole('button', { name: 'Blue note color' }))
      expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Discard unsaved draft' })).toBeTruthy()
      expect(capture.value).toBe(fullDraft)
      fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
      expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Next up' })).toBeNull()
      expect(capture.value).toBe(fullDraft)
    }
    const countBeforeNew = memory.cache?.personalNotes?.length
    fireEvent.click(screen.getByRole('button', { name: /^(New note|Add sub-note)$/ }))
    await settle()
    expect(memory.cache?.personalNotes).toHaveLength(countBeforeNew!)
    expect(capture.value).toBe(fullDraft)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsaved draft' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(capture.value).toBe(fullDraft)
    expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save draft as new checklist' }))
    await settle()
    expect((screen.getByRole('textbox', { name: `Edit ${fullDraft}` }) as HTMLInputElement).value).toBe(fullDraft)
    const recovered = memory.cache?.personalNotes?.find((note) => note.id !== originalId && note.checklist?.[0]?.text === fullDraft)
    expect(recovered).toMatchObject({ title: '', body: '', projectId: 'snail', checklist: [{ text: fullDraft }] })
    expect(recovered?.checklist).toHaveLength(1)
    const oldRecord = memory.cache!.personalNotes!.find((note) => note.id === originalId)!
    expect(deleted === 'note' ? oldRecord.deletedAt : oldRecord.checklist?.find((item) => item.id === originalItemId)?.deletedAt).toBeTruthy()
    const safeToLeave = new Event('beforeunload', { cancelable: true })
    fireEvent(window, safeToLeave)
    expect(safeToLeave.defaultPrevented).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    expect(memory.remote?.personalNotes?.find((note) => note.id === recovered?.id)).toMatchObject({ title: '', body: '', projectId: 'snail', checklist: [{ text: fullDraft }] })
    fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
    expect(screen.getByRole('heading', { name: 'Next up' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Personal notes' })).toBeNull()
  })

  it('keeps a failed row edit protected after a different row saves successfully and recovers both full texts', async () => {
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    const firstRow = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    fireEvent.change(firstRow, { target: { value: 'Keep A' } })
    fireEvent.keyDown(firstRow, { key: 'Enter' })
    const secondRow = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    fireEvent.change(secondRow, { target: { value: 'Failed B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    const original = memory.remote!.personalNotes!.find((note) => note.checklist?.[0]?.text === 'Keep A')!
    expect(original.checklist).toHaveLength(2)
    await poll(1_000)
    const incoming = structuredClone(memory.remote!)
    const changedAt = new Date().toISOString()
    const changed = incoming.personalNotes!.find((note) => note.id === original.id)!
    changed.updatedAt = changedAt
    Object.assign(changed.checklist![1], { deletedAt: changedAt, updatedAt: changedAt })
    incoming.updatedAt = changedAt
    memory.remote = incoming
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    fireEvent.change(secondRow, { target: { value: 'Failed B needs this entire review' } })
    expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()
    fireEvent.change(firstRow, { target: { value: 'Keep A with its successful update' } })
    expect(screen.getByRole('textbox', { name: 'Edit Failed B needs this entire review' })).toBe(secondRow)
    expect(secondRow.value).toBe('Failed B needs this entire review')
    expect(firstRow.value).toBe('Keep A with its successful update')
    expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard unsaved draft' })).toBeTruthy()
    const leaving = new Event('beforeunload', { cancelable: true })
    fireEvent(window, leaving)
    expect(leaving.defaultPrevented).toBe(true)
    fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft as new checklist' }))
    await settle()
    const recovered = memory.cache!.personalNotes!.find((note) => note.id !== original.id && note.checklist?.some((item) => item.text === 'Failed B needs this entire review'))!
    expect(recovered.projectId).toBe('snail')
    expect(recovered.checklist?.map((item) => item.text)).toEqual(['Keep A with its successful update', 'Failed B needs this entire review'])
    const savedOriginal = memory.cache!.personalNotes!.find((note) => note.id === original.id)!
    expect(savedOriginal.checklist?.[0].text).toBe('Keep A with its successful update')
    expect(savedOriginal.checklist?.[1].deletedAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    expect(memory.remote!.personalNotes!.find((note) => note.id === recovered.id)?.checklist?.map((item) => item.text)).toEqual(['Keep A with its successful update', 'Failed B needs this entire review'])
    fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
    expect(screen.getByRole('heading', { name: 'Next up' })).toBeTruthy()
  })

  it('does not apply an open editor draft to a note moved remotely into another project and recovers it in the original project', async () => {
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    const row = screen.getByRole('textbox', { name: 'Edit New item' }) as HTMLInputElement
    fireEvent.change(row, { target: { value: 'Original project review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    const original = memory.remote!.personalNotes!.find((note) => note.checklist?.[0]?.text === 'Original project review')!
    await poll(1_000)
    const incoming = structuredClone(memory.remote!)
    const moved = incoming.personalNotes!.find((note) => note.id === original.id)!
    moved.projectId = 'tactics'
    moved.updatedAt = new Date().toISOString()
    incoming.updatedAt = moved.updatedAt
    memory.remote = incoming
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    expect(memory.cache!.personalNotes!.find((note) => note.id === original.id)?.projectId).toBe('tactics')
    const fullDraft = 'Original project review plus my unfinished instructions'
    fireEvent.change(row, { target: { value: fullDraft } })
    expect(screen.getByRole('textbox', { name: `Edit ${fullDraft}` })).toBe(row)
    expect(screen.getByRole('button', { name: 'Save draft as new checklist' })).toBeTruthy()
    expect(memory.cache!.personalNotes!.find((note) => note.id === original.id)).toMatchObject({ projectId: 'tactics', checklist: [{ text: 'Original project review' }] })
    fireEvent.click(mainNav().getByRole('button', { name: /^Today/ }))
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save draft as new checklist' }))
    await settle()
    const recovered = memory.cache!.personalNotes!.find((note) => note.id !== original.id && note.checklist?.[0]?.text === fullDraft)!
    expect(recovered).toMatchObject({ projectId: 'snail', title: '', body: '', checklist: [{ text: fullDraft }] })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    expect(memory.remote!.personalNotes!.find((note) => note.id === original.id)).toMatchObject({ projectId: 'tactics', checklist: [{ text: 'Original project review' }] })
    expect(memory.remote!.personalNotes!.find((note) => note.id === recovered.id)).toMatchObject({ projectId: 'snail', checklist: [{ text: fullDraft }] })
  })

  it('does not popup historical reports and durably clears the unread light when the feed is checked', async () => {
    const historical = fixture()
    historical.agentEvents = [report('historic', 'Earlier builder', 'An earlier handoff is ready.')]
    setInitial(historical)
    const first = await mount()
    expect(within(popups()).queryByRole('article')).toBeNull()
    expect(screen.getByLabelText('1 unread updates')).toBeTruthy()
    expect(mainNav().getByRole('button', { name: /^Notifications/ }).classList.contains('has-unread')).toBe(true)
    fireEvent.click(mainNav().getByRole('button', { name: /^Notifications/ }))
    await settle()
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy()
    expect(screen.getByText('You’re caught up')).toBeTruthy()
    expect(mainNav().getByRole('button', { name: /^Notifications/ }).classList.contains('has-unread')).toBe(false)
    expect(memory.cache?.notificationReads).toContainEqual({ id: 'chat:historic:received', readAt: at })
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await settle()
    expect(memory.remote?.notificationReads?.map((receipt) => receipt.id)).toContain('chat:historic:received')
    first.unmount()
    await settle()
    await mount()
    expect(screen.getByLabelText('0 unread updates')).toBeTruthy()
    expect(within(popups()).queryByRole('article')).toBeNull()
  })

  it('polls a new report into a popup while notes stay editable and dismissing it leaves the unread light on', async () => {
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    fireEvent.change(screen.getByLabelText('Project notebook'), { target: { value: 'snail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open note: Shopping letters' }))
    await poll(14_500)
    const title = screen.getByLabelText('Note title') as HTMLInputElement
    title.focus()
    fireEvent.change(title, { target: { value: 'My still-in-progress shopping draft' } })
    const incoming = structuredClone(memory.remote!)
    incoming.agentEvents = [report('fresh', 'Tactics renderer', 'The new graphics are ready to inspect.')]
    incoming.updatedAt = new Date().toISOString()
    memory.remote = incoming
    await poll(500)
    expect(fetchWorkspace).toHaveBeenCalledTimes(2)
    expect(within(popups()).getByText('Tactics renderer finished its part')).toBeTruthy()
    expect(within(popups()).getByText('The new graphics are ready to inspect.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    expect(title.value).toBe('My still-in-progress shopping draft')
    expect(document.activeElement).toBe(title)
    expect(memory.cache?.personalNotes?.find((note) => note.id === 'snail-list')?.title).toBe(title.value)
    expect(screen.getByLabelText('1 unread updates')).toBeTruthy()
    fireEvent.click(within(popups()).getByRole('button', { name: 'Dismiss popup: Tactics renderer finished its part' }))
    expect(within(popups()).queryByRole('article')).toBeNull()
    expect(screen.getByLabelText('1 unread updates')).toBeTruthy()
    expect(memory.cache?.notificationReads ?? []).toHaveLength(0)
    expect(title.value).toBe('My still-in-progress shopping draft')
  })

  it('opens the actual incoming task checklist from its popup and records it read without completing unfinished steps', async () => {
    await mount()
    fireEvent.click(mainNav().getByRole('button', { name: 'Personal notes' }))
    const incoming = structuredClone(memory.remote!)
    const task = createTask({ projectId: 'tactics', board: 'myTodo', title: 'Review tactics build', priority: 'high' }, at)
    task.id = 'submission:review-build'
    task.submission = { id: 'review-build', date: '2026-10-26', sourceFile: 'review-build.json' }
    task.workStatus = 'needs-review'
    task.handoff = { agent: 'claude', completedWork: ['Updated the battle menu.'], review: 'Verify both the menu and the first battle.' }
    task.subtasks = [
      { id: 'menu', title: 'Open the battle menu', createdAt: at, updatedAt: at, completedAt: at },
      { id: 'battle', title: 'Play the first battle', createdAt: at, updatedAt: at },
    ]
    incoming.tasks.push(task)
    memory.remote = incoming
    await poll()
    expect(screen.getByLabelText('1 unread updates')).toBeTruthy()
    expect(within(popups()).getByText('Review tactics build')).toBeTruthy()
    fireEvent.click(within(popups()).getByRole('button', { name: 'View update' }))
    const review = screen.getByRole('dialog', { name: 'Review work' })
    expect(within(review).getByRole('heading', { name: 'Review tactics build' })).toBeTruthy()
    expect(within(review).getByText('Verify both the menu and the first battle.')).toBeTruthy()
    expect((within(review).getByRole('checkbox', { name: '1. Open the battle menu' }) as HTMLInputElement).checked).toBe(true)
    expect((within(review).getByRole('checkbox', { name: '2. Play the first battle' }) as HTMLInputElement).checked).toBe(false)
    expect(within(review).getByRole('button', { name: 'Finish task' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('0 unread updates')).toBeTruthy()
    await settle()
    expect(memory.cache?.notificationReads?.map((receipt) => receipt.id)).toContain('handoff:tactics:review-build:received')
    expect(memory.cache?.tasks.find((entry) => entry.id === task.id)?.subtasks?.find((step) => step.id === 'battle')?.completedAt).toBeUndefined()
    expect(screen.getByRole('region', { name: 'Personal notes' })).toBeTruthy()
    expect(within(popups()).queryByRole('article')).toBeNull()
  })
})
