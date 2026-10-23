// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createSeedWorkspace } from '../seed'
import type { Workspace } from '../types'
import { useForgeboard } from './useForgeboard'
import { fetchWorkspace, putWorkspace } from '../lib/github'

const memory = vi.hoisted(() => ({ mutations: new Map<string, unknown>() }))
vi.mock('../lib/db', () => ({
  loadCachedWorkspace: async () => undefined, loadConnection: async () => undefined, loadBaseWorkspace: async () => undefined,
  countMutations: async () => memory.mutations.size, mutationIds: async () => [...memory.mutations.keys()],
  saveWorkspaceChanges: async (_workspace: unknown, records: { id: string }[]) => { records.forEach((record) => memory.mutations.set(record.id, record)) },
  clearMutations: async (ids: string[]) => { ids.forEach((id) => memory.mutations.delete(id)) },
  saveConnection: async () => {}, saveBaseWorkspace: async () => {}, saveSha: async () => {}, clearConnection: async () => {},
}))
vi.mock('../lib/github', async (original) => ({ ...await original<object>(), fetchWorkspace: vi.fn(), putWorkspace: vi.fn(), fetchTaskInbox: async () => [] }))
const config = { owner: 'test', repo: 'vault', branch: 'main', path: 'data/workspace.json', token: 'test-token', rememberToken: false }
afterEach(cleanup)
beforeEach(() => { memory.mutations.clear(); vi.mocked(fetchWorkspace).mockReset(); vi.mocked(putWorkspace).mockReset() })

describe('review changes during sync', () => {
  it('queues nested checklist changes, scopes actions to their note, and uploads complete note content', async () => {
    const remote = createSeedWorkspace()
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: remote, sha: 'sha' })
    vi.mocked(putWorkspace).mockResolvedValue('checklist-sha')
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    let note = '', parent = '', child = '', grandchild = ''
    act(() => {
      note = result.current.actions.addPersonalNote({ title: 'Meal plan', body: 'Still a text note' })
      parent = result.current.actions.addNoteChecklistItem(note, { text: 'Tuesday' })
      child = result.current.actions.addNoteChecklistItem(note, { text: 'Orange chicken', parentId: parent })
      grandchild = result.current.actions.addNoteChecklistItem(note, { text: 'Make sauce', parentId: child })
      result.current.actions.updateNoteChecklistItem(note, grandchild, { text: 'Taste sauce' })
      result.current.actions.toggleNoteChecklistItem(note, parent)
      result.current.actions.moveNoteChecklistItem(note, grandchild, 'outdent')
    })
    const items = result.current.workspace.personalNotes![0].checklist!
    expect(items.find((item) => item.id === grandchild)).toMatchObject({ text: 'Taste sauce', parentId: parent })
    expect(items.find((item) => item.id === child)?.completedAt).toBeUndefined()
    const before = result.current.workspace
    expect(() => result.current.actions.toggleNoteChecklistItem('wrong-note', parent)).toThrow(/unavailable/)
    expect(result.current.workspace).toBe(before)
    await waitFor(() => expect(memory.mutations.size).toBe(7))
    await act(async () => { await result.current.actions.updateConnection(config) })
    expect(vi.mocked(putWorkspace).mock.calls[0][1].personalNotes?.[0]).toMatchObject({ body: 'Still a text note', checklist: expect.arrayContaining([expect.objectContaining({ id: grandchild, text: 'Taste sauce' })]) })
    act(() => { result.current.actions.deleteNoteChecklistItem(note, parent) })
    expect(result.current.workspace.personalNotes![0].checklist!.every((item) => item.deletedAt)).toBe(true)
    act(() => { result.current.actions.restoreNoteChecklistItem(note, parent) })
    expect(result.current.workspace.personalNotes![0].checklist!.every((item) => !item.deletedAt)).toBe(true)
    await waitFor(() => expect(result.current.syncMeta.dirty).toBe(true))
  })
  it('queues nested personal notes and labels and syncs them alongside another device’s notes', async () => {
    const remote = createSeedWorkspace()
    remote.personalNotes = [{ id: 'phone-note', projectId: remote.projects[1].id, title: 'Phone note', body: 'Keep separate', createdAt: remote.updatedAt, updatedAt: remote.updatedAt }]
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: remote, sha: 'sha' })
    vi.mocked(putWorkspace).mockResolvedValue('notes-sha')
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    let root = '', child = '', label = ''
    act(() => {
      label = result.current.actions.saveNoteLabel({ name: 'Research', color: '#fa3' })
      root = result.current.actions.addPersonalNote({ projectId: remote.projects[0].id, title: 'Desktop note', body: '', labelIds: [label] })
      child = result.current.actions.addPersonalNote({ projectId: remote.projects[0].id, parentId: root, title: 'Sub-note', body: 'Nested detail' })
      result.current.actions.updatePersonalNote(root, { body: 'Changed offline', color: '#123456' })
    })
    await waitFor(() => expect(memory.mutations.size).toBe(4))
    await waitFor(() => expect(result.current.syncMeta.dirty).toBe(true))
    await act(async () => { await result.current.actions.updateConnection(config) })
    const uploaded = vi.mocked(putWorkspace).mock.calls[0][1]
    expect(uploaded.personalNotes).toHaveLength(3)
    expect(uploaded.personalNotes?.find((note) => note.id === root)).toMatchObject({ body: 'Changed offline', color: '#123456', labelIds: [label] })
    expect(uploaded.personalNotes?.find((note) => note.id === child)?.parentId).toBe(root)
    expect(uploaded.noteLabels?.[0]).toMatchObject({ name: 'Research', color: '#ffaa33' })
    expect(result.current.syncMeta.pendingWrites).toBe(0)
    act(() => { result.current.actions.deletePersonalNote(root) })
    expect(result.current.workspace.personalNotes?.filter((note) => note.deletedAt)).toHaveLength(2)
    act(() => { result.current.actions.restorePersonalNote(root); result.current.actions.deleteNoteLabel(label) })
    expect(result.current.workspace.personalNotes?.find((note) => note.id === child)?.deletedAt).toBeUndefined()
    expect(result.current.workspace.noteLabels?.[0].deletedAt).toBeTruthy()
    const before = result.current.workspace
    expect(() => result.current.actions.updatePersonalNote(child, { projectId: remote.projects[1].id })).toThrow(/same project/)
    expect(result.current.workspace).toBe(before)
  })
  it('downloads new remote summaries without uploading a no-op workspace on each poll', async () => {
    const remote = createSeedWorkspace()
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: remote, sha: 'sha' })
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await result.current.actions.updateConnection(config) })
    await act(async () => { await result.current.actions.syncNow() })
    expect(putWorkspace).not.toHaveBeenCalled()
    const incoming = structuredClone(remote)
    incoming.handoffSummaries = [{ id: 'file', projectId: remote.projects[0].id, recordIds: ['review'], sourceFile: 'review.md', title: 'Review', inputHash: 'hash', receivedAt: remote.updatedAt, updatedAt: remote.updatedAt, state: 'ai', summary: 'Reported changes', needsYou: 'Test', nextStep: 'Open', attempts: 1 }]
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: incoming, sha: 'summary-sha' })
    await act(async () => { await result.current.actions.syncNow() })
    expect(result.current.workspace.handoffSummaries?.[0].summary).toBe('Reported changes')
    expect(putWorkspace).not.toHaveBeenCalled()
  })
  it('imports a desktop status and checklist together, retains checks on repeat, and rejects malformed batches atomically', async () => {
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    const at = new Date().toISOString()
    const status = { format: 'forgeboard-status', version: 1, id: 'desktop-report-1', project: 'Snail Mail', at, chat: { id: 'snail-claude', name: 'Story planning', agent: 'claude' }, status: 'waiting-on-me', summary: 'Draft ready for review.' }
    const task = { format: 'forgeboard-task', version: 1, id: 'desktop-check-1', project: 'Snail Mail', date: at.slice(0, 10), summary: 'Review draft', subtasks: [{ id: 'one', title: 'Read the opening.' }, { id: 'two', title: 'Check the ending.' }] }
    act(() => { result.current.actions.importChatUpdate(JSON.stringify([status, task])) })
    const parent = result.current.workspace.tasks.find((item) => item.id === 'submission:desktop-check-1')!
    expect(result.current.workspace.agentChats?.[0].status).toBe('waiting-on-me')
    act(() => { result.current.actions.toggleSubtask(parent.id, parent.subtasks![0].id) })
    act(() => { result.current.actions.importChatUpdate(JSON.stringify([status, task])) })
    expect(result.current.workspace.tasks.filter((item) => item.id === parent.id)).toHaveLength(1)
    expect(result.current.workspace.tasks.find((item) => item.id === parent.id)?.subtasks?.[0].completedAt).toBeTruthy()
    const before = result.current.workspace
    expect(() => result.current.actions.importChatUpdate(JSON.stringify([{ ...status, id: 'not-imported' }, { format: 'invalid' }]))).toThrow()
    expect(result.current.workspace).toBe(before)
    act(() => { result.current.actions.saveChatReport({ id: 'snail-claude', projectId: parent.projectId, name: 'Story planning', agent: 'claude', status: 'blocked', summary: 'Need a revised ending.' }) })
    expect(result.current.workspace.agentChats?.[0].status).toBe('blocked')
  })
  it('keeps a task created after the first sync began but before the remote read finished', async () => {
    const remote = createSeedWorkspace()
    let resolveRead!: (value: { workspace: Workspace; sha: string }) => void
    vi.mocked(fetchWorkspace).mockReturnValue(new Promise((resolve) => { resolveRead = resolve }))
    vi.mocked(putWorkspace).mockResolvedValue('new-sha')
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    let syncing!: Promise<boolean>
    act(() => { syncing = result.current.actions.updateConnection(config) })
    await waitFor(() => expect(fetchWorkspace).toHaveBeenCalled())
    act(() => { result.current.actions.addTask({ projectId: 'calculator-quest', board: 'myTodo', title: 'Review created during sync', priority: 'medium', kind: 'checkbox' }) })
    await act(async () => { resolveRead({ workspace: remote, sha: 'old-sha' }); await syncing })
    expect(result.current.workspace.tasks.some((task) => task.title === 'Review created during sync')).toBe(true)
    expect(vi.mocked(putWorkspace).mock.calls[0][1].tasks.some((task) => task.title === 'Review created during sync')).toBe(true)
  })
  it('does not clear writes created while a GitHub upload was in flight', async () => {
    vi.mocked(fetchWorkspace).mockResolvedValue({ workspace: createSeedWorkspace(), sha: 'sha' })
    let resolvePut!: (value: string) => void
    vi.mocked(putWorkspace).mockReturnValue(new Promise((resolve) => { resolvePut = resolve }))
    const { result } = renderHook(() => useForgeboard())
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => { result.current.actions.addTask({ projectId: 'calculator-quest', board: 'myTodo', title: 'First review', priority: 'medium', kind: 'checkbox' }) })
    await waitFor(() => expect(memory.mutations.size).toBe(1))
    let syncing!: Promise<boolean>
    act(() => { syncing = result.current.actions.updateConnection(config) })
    await waitFor(() => expect(putWorkspace).toHaveBeenCalled())
    act(() => { result.current.actions.addTask({ projectId: 'calculator-quest', board: 'myTodo', title: 'Feedback entered during upload', priority: 'medium', kind: 'checkbox' }) })
    await act(async () => { resolvePut('new-sha'); await syncing })
    expect(memory.mutations.size).toBe(1)
    expect(result.current.syncMeta.pendingWrites).toBe(1)
    expect(result.current.workspace.tasks.some((task) => task.title === 'Feedback entered during upload')).toBe(true)
  })
})
