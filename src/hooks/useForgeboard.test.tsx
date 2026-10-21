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
  enqueueMutation: async (record: { id: string }) => { memory.mutations.set(record.id, record) },
  clearMutations: async (ids: string[]) => { ids.forEach((id) => memory.mutations.delete(id)) },
  saveCachedWorkspace: async () => {}, saveConnection: async () => {}, saveBaseWorkspace: async () => {}, saveSha: async () => {}, clearConnection: async () => {},
}))
vi.mock('../lib/github', async (original) => ({ ...await original<object>(), fetchWorkspace: vi.fn(), putWorkspace: vi.fn(), fetchTaskInbox: async () => [] }))
const config = { owner: 'test', repo: 'vault', branch: 'main', path: 'data/workspace.json', token: 'test-token', rememberToken: false }
afterEach(cleanup)
beforeEach(() => { memory.mutations.clear(); vi.mocked(fetchWorkspace).mockReset(); vi.mocked(putWorkspace).mockReset() })

describe('review changes during sync', () => {
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
