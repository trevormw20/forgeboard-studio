import type { MutationRecord, Workspace } from '../types'

export const AUTOSAVE_IDLE_MS = 1_000
export const AUTOSAVE_MAX_WAIT_MS = 5_000

export interface WorkspaceAutosaveState {
  pending: boolean
  saving: boolean
  error?: string
}

export type AutosaveState = WorkspaceAutosaveState

interface AutosaveOptions {
  persist: (workspace: Workspace, mutations: MutationRecord[]) => Promise<void>
  onState?: (state: WorkspaceAutosaveState) => void
  idleMs?: number
  maxWaitMs?: number
}

interface Batch {
  workspace: Workspace
  mutations: Map<string, MutationRecord>
}

/**
 * Keep edits in the live workspace immediately, but batch durable writes during
 * typing. All cache writes, including sync checkpoints, use this single writer.
 */
export function createWorkspaceAutosave({ persist, onState, idleMs = AUTOSAVE_IDLE_MS, maxWaitMs = AUTOSAVE_MAX_WAIT_MS }: AutosaveOptions) {
  let pending: Batch | undefined
  let running: Promise<void> | undefined
  let saving = false
  let error: string | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined

  const getState = (): WorkspaceAutosaveState => ({ pending: Boolean(pending), saving, error })
  const notify = () => onState?.(getState())

  function clearTimers() {
    clearTimeout(idleTimer)
    clearTimeout(maxTimer)
    idleTimer = undefined
    maxTimer = undefined
  }

  function restoreFailed(batch: Batch) {
    if (pending) {
      const mutations = new Map(batch.mutations)
      for (const [key, record] of pending.mutations) mutations.set(key, record)
      pending = { workspace: pending.workspace, mutations }
    } else pending = batch
  }

  function flush(): Promise<void> {
    clearTimers()
    if (!running && pending) {
      saving = true
      error = undefined
      running = Promise.resolve().then(async () => {
        while (pending) {
          const batch = pending
          pending = undefined
          notify()
          try {
            await persist(batch.workspace, [...batch.mutations.values()])
          } catch (reason) {
            restoreFailed(batch)
            clearTimers()
            error = reason instanceof Error ? reason.message : 'Could not save on this device. Please retry.'
            throw reason
          }
        }
      }).finally(() => {
        running = undefined
        saving = false
        notify()
      })
      notify()
    }
    // A new edit can arrive between the last write and its promise settling.
    // Every caller waits for that edit too, rather than returning a false flush.
    return (running ?? Promise.resolve()).then(() => pending ? flush() : undefined)
  }

  function backgroundFlush() {
    // Timer/navigation-triggered saves report errors through state. Explicit
    // flush/checkpoint callers still receive a rejection and can stop syncing.
    void flush().catch(() => {})
  }

  function queue(workspace: Workspace, mutation: MutationRecord, debounce: boolean) {
    pending ??= { workspace, mutations: new Map() }
    pending.workspace = workspace
    // Text bursts need one outbox entry per edited entity/type, not per letter.
    // Discrete actions retain their individual mutation IDs.
    const key = debounce ? JSON.stringify([mutation.type, mutation.entityId ?? null]) : mutation.id
    pending.mutations.set(key, mutation)
    notify()
    if (!debounce) {
      backgroundFlush()
      return
    }
    clearTimeout(idleTimer)
    idleTimer = setTimeout(backgroundFlush, idleMs)
    maxTimer ??= setTimeout(backgroundFlush, maxWaitMs)
  }

  function checkpoint(workspace: Workspace): Promise<void> {
    pending ??= { workspace, mutations: new Map() }
    pending.workspace = workspace
    notify()
    return flush()
  }

  return { queue, flush, checkpoint, getState }
}
