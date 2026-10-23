import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeedWorkspace } from '../seed'
import type { MutationRecord, Workspace } from '../types'
import { AUTOSAVE_IDLE_MS, AUTOSAVE_MAX_WAIT_MS, createWorkspaceAutosave } from './workspaceAutosave'

const mutation = (id: string, entityId = 'note', type = 'personal-note.update'): MutationRecord => ({ id, at: '2026-10-23T12:00:00Z', type, entityId })
const snapshot = (name: string): Workspace => ({ ...createSeedWorkspace(), name })

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('workspace autosave', () => {
  it('saves the latest snapshot after a one-second typing pause, coalescing letters by entity/type', async () => {
    const persist = vi.fn(async () => {})
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('f'), mutation('one'), true)
    await vi.advanceTimersByTimeAsync(700)
    queue.queue(snapshot('first word'), mutation('two'), true)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS - 1)
    expect(persist).not.toHaveBeenCalled()
    expect(queue.getState()).toMatchObject({ pending: true, saving: false })
    await vi.advanceTimersByTimeAsync(1)
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'first word' }), [mutation('two')])
    expect(queue.getState()).toMatchObject({ pending: false, saving: false, error: undefined })
  })

  it('checkpoints at five seconds even when typing never pauses', async () => {
    const persist = vi.fn(async () => {})
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('start'), mutation('zero'), true)
    for (let time = 800; time < AUTOSAVE_MAX_WAIT_MS; time += 800) {
      await vi.advanceTimersByTimeAsync(800)
      queue.queue(snapshot(String(time)), mutation(String(time)), true)
    }
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: '4800' }), [mutation('4800')])
  })

  it('flushes on leaving immediately, includes different notes, and cancels old timers', async () => {
    const persist = vi.fn(async () => {})
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('first'), mutation('one'), true)
    queue.queue(snapshot('both'), mutation('two', 'other-note'), true)
    await queue.flush()
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'both' }), [mutation('one'), mutation('two', 'other-note')])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('a checkbox or other discrete action flushes preceding typing without waiting', async () => {
    const persist = vi.fn(async () => {})
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('typing'), mutation('one'), true)
    queue.queue(snapshot('checked'), mutation('two', 'note', 'personal-note.checklist.toggle'), false)
    await queue.flush()
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'checked' }), [mutation('one'), mutation('two', 'note', 'personal-note.checklist.toggle')])
  })

  it('serializes slow writes and waits for edits that arrive during persistence', async () => {
    const first = deferred()
    const persist = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('first'), mutation('one'), true)
    const flushed = queue.flush()
    await Promise.resolve()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(queue.getState()).toMatchObject({ pending: false, saving: true })
    queue.queue(snapshot('second'), mutation('two'), true)
    expect(persist).toHaveBeenCalledTimes(1)
    first.resolve()
    await flushed
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1]).toEqual([expect.objectContaining({ name: 'second' }), [mutation('two')]])
    expect(queue.getState()).toMatchObject({ pending: false, saving: false })
  })

  it('a merged sync checkpoint replaces pending stale snapshots without discarding their mutations', async () => {
    const first = deferred()
    const persist = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('old cache'), mutation('one'), false)
    await Promise.resolve()
    queue.queue(snapshot('local typing'), mutation('two'), true)
    const checkpoint = queue.checkpoint(snapshot('local plus remote changes'))
    expect(persist).toHaveBeenCalledTimes(1)
    first.resolve()
    await checkpoint
    expect(persist.mock.calls[1]).toEqual([expect.objectContaining({ name: 'local plus remote changes' }), [mutation('two')]])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('can persist a clean checkpoint without adding an outbox mutation', async () => {
    const persist = vi.fn(async () => {})
    const queue = createWorkspaceAutosave({ persist })
    await queue.checkpoint(snapshot('downloaded changes'))
    expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'downloaded changes' }), [])
  })

  it('retains failed typing and retries explicitly without an unhandled timer rejection', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('Storage is full')).mockResolvedValue(undefined)
    const onState = vi.fn()
    const queue = createWorkspaceAutosave({ persist, onState })
    queue.queue(snapshot('important draft'), mutation('one'), true)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_MS)
    expect(queue.getState()).toMatchObject({ pending: true, saving: false, error: 'Storage is full' })
    expect(onState).toHaveBeenLastCalledWith({ pending: true, saving: false, error: 'Storage is full' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(persist).toHaveBeenCalledTimes(1)
    await queue.flush()
    expect(persist.mock.calls[1]).toEqual([expect.objectContaining({ name: 'important draft' }), [mutation('one')]])
    expect(queue.getState()).toMatchObject({ pending: false, saving: false, error: undefined })
  })

  it('explicit failure rejects and keeps the newest snapshot plus every distinct unsaved entity', async () => {
    const first = deferred()
    const persist = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('old'), mutation('one'), true)
    queue.queue(snapshot('old and other'), mutation('other', 'other-note'), true)
    const failed = queue.flush()
    const rejected = expect(failed).rejects.toThrow('Unavailable')
    await Promise.resolve()
    queue.queue(snapshot('newest'), mutation('two'), true)
    first.reject(new Error('Unavailable'))
    await rejected
    expect(queue.getState()).toMatchObject({ pending: true, saving: false, error: 'Unavailable' })
    await queue.flush()
    expect(persist.mock.calls[1]).toEqual([expect.objectContaining({ name: 'newest' }), [mutation('two'), mutation('other', 'other-note')]])
  })

  it('flush callers also drain a discrete action queued just as a write resolves', async () => {
    const first = deferred()
    const persist = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined)
    const queue = createWorkspaceAutosave({ persist })
    queue.queue(snapshot('first'), mutation('one'), true)
    const flushed = queue.flush()
    await Promise.resolve()
    first.resolve()
    await Promise.resolve()
    queue.queue(snapshot('last'), mutation('two', 'note', 'toggle'), false)
    await flushed
    expect(persist.mock.calls[1]).toEqual([expect.objectContaining({ name: 'last' }), [mutation('two', 'note', 'toggle')]])
    expect(queue.getState()).toMatchObject({ pending: false, saving: false })
  })
})
