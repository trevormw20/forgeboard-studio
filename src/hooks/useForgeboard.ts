import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearConnection,
  clearMutations,
  countMutations,
  loadBaseWorkspace,
  loadCachedWorkspace,
  loadConnection,
  mutationIds,
  saveBaseWorkspace,
  saveWorkspaceChanges,
  saveConnection,
  saveSha,
} from '../lib/db'
import { fetchWorkspace, fetchTaskInbox, GitHubSyncError, putWorkspace } from '../lib/github'
import { importSubmissions } from '../lib/taskInbox'
import { applyCoordination } from '../lib/coordination'
import { createId, isoNow } from '../lib/ids'
import { createWorkspaceAutosave, type WorkspaceAutosaveState } from '../lib/workspaceAutosave'
import { mergeWorkspaces, sameWorkspaceContent } from '../lib/merge'
import { DEFAULT_ESCALATION } from '../lib/priority'
import { routeNote } from '../lib/routing'
import { createPersonalNote, editPersonalNote, removePersonalNote, restorePersonalNoteTree, upsertNoteLabel, removeNoteLabel } from '../lib/personalNotes'
import type { PersonalNoteInput, PersonalNoteUpdate, NoteLabelInput } from '../lib/personalNotes'
import { addChecklistItem, editChecklistItem, toggleChecklistItem, moveChecklistItem, repositionChecklistItem, removeChecklistItem, restoreChecklistItem } from '../lib/noteChecklist'
import type { ChecklistDirection, ChecklistDropPosition, ChecklistItemInput } from '../lib/noteChecklist'
import { hasNoteHistoryChanges, NOTE_HISTORY_LIMIT, NOTE_TYPING_GROUP_MS, replayNoteHistory, snapshotNote } from '../lib/noteHistory'
import { createProject, createSeedWorkspace, createTask } from '../seed'
import type {
  BoardKey,
  ConnectionConfig,
  Deadline,
  ProjectStage,
  Recurrence,
  StartingPriority,
  SyncMeta,
  TaskColor,
  Workspace,
  ManagerSettings,
  WorkStatus,
  AgentProgress,
  AgentChat,
  ProjectExperiment,
  PersonalNote,
} from '../types'

interface NoteHistoryEntry { before: PersonalNote; after: PersonalNote; at: number; group?: string }
interface NoteHistoryStack { undo: NoteHistoryEntry[]; redo: NoteHistoryEntry[] }

function noteTypingGroup(before: PersonalNote, after: PersonalNote, type: string): string | undefined {
  if (type === 'personal-note.checklist.update') {
    const earlier = new Map((before.checklist ?? []).map((item) => [item.id, item.text]))
    const changed = (after.checklist ?? []).filter((item) => earlier.get(item.id) !== item.text)
    return changed.length === 1 ? `checklist:${changed[0].id}:text` : undefined
  }
  if (type === 'personal-note.update') {
    const changed = (['title', 'body'] as const).filter((field) => before[field] !== after[field])
    return changed.length === 1 ? changed[0] : undefined
  }
}

const defaultConnection: ConnectionConfig = {
  owner: 'trevormw20',
  repo: 'forgeboard-studio-vault',
  branch: 'main',
  path: 'data/workspace.json',
  token: '',
  rememberToken: false,
}

function nextOccurrence(iso: string, recurrence: Recurrence): string {
  const next = new Date(iso)
  if (recurrence.frequency === 'daily') next.setDate(next.getDate() + recurrence.interval)
  if (recurrence.frequency === 'weekly') next.setDate(next.getDate() + recurrence.interval * 7)
  if (recurrence.frequency === 'monthly') next.setMonth(next.getMonth() + recurrence.interval)
  return next.toISOString()
}

function isConfigured(connection: ConnectionConfig): boolean {
  return Boolean(connection.owner && connection.repo && connection.branch && connection.path && connection.token)
}

export function useForgeboard() {
  const [workspace, setWorkspace] = useState<Workspace>(() => createSeedWorkspace())
  const [connection, setConnection] = useState<ConnectionConfig>(defaultConnection)
  const [ready, setReady] = useState(false)
  const [inboxStatus, setInboxStatus] = useState('Inbox checks when connected.')
  const [localSave, setLocalSave] = useState<WorkspaceAutosaveState>({ pending: false, saving: false })
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({
    dirty: false,
    syncing: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendingWrites: 0,
  })
  const workspaceRef = useRef(workspace)
  const connectionRef = useRef(connection)
  const syncingRef = useRef(false)
  const revisionRef = useRef(0)
  const syncBackoffRef = useRef(0)
  // History is session-only and per-note. Only replayed edits enter the normal
  // durable outbox; historical snapshots never enter GitHub or AI context.
  const noteHistoryRef = useRef(new Map<string, NoteHistoryStack>())
  const [noteHistory, setNoteHistory] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({})
  const publishNoteHistory = useCallback(() => {
    setNoteHistory(Object.fromEntries([...noteHistoryRef.current].map(([id, stack]) => [id, { canUndo: stack.undo.length > 0, canRedo: stack.redo.length > 0 }])))
  }, [])
  const [autosave] = useState(() => createWorkspaceAutosave({
    persist: async (snapshot, mutations) => {
      await saveWorkspaceChanges(snapshot, mutations)
      const pendingWrites = await countMutations()
      setSyncMeta((meta) => ({ ...meta, pendingWrites, dirty: meta.dirty || pendingWrites > 0 }))
    },
    onState: setLocalSave,
  }))
  const flushLocalSaves = useCallback(() => autosave.flush(), [autosave])

  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  useEffect(() => { connectionRef.current = connection }, [connection])

  useEffect(() => {
    let active = true
    Promise.all([loadCachedWorkspace(), loadConnection(), countMutations()]).then(([cached, savedConnection, pending]) => {
      if (!active) return
      if (cached) {
        workspaceRef.current = cached
        setWorkspace(cached)
      }
      if (savedConnection) {
        connectionRef.current = { ...defaultConnection, ...savedConnection }
        setConnection({ ...defaultConnection, ...savedConnection })
      }
      setSyncMeta((meta) => ({ ...meta, dirty: pending > 0, pendingWrites: pending }))
      setReady(true)
    })
    return () => { active = false }
  }, [])

  const commit = useCallback((type: string, entityId: string | undefined, change: (draft: Workspace, now: string) => void, debounce = false, trackHistory = true) => {
    const now = isoNow()
    const previous = workspaceRef.current
    const next = structuredClone(previous)
    change(next, now)
    if (trackHistory && entityId && type.startsWith('personal-note.')) {
      const before = previous.personalNotes?.find((note) => note.id === entityId)
      const after = next.personalNotes?.find((note) => note.id === entityId)
      if (before && after && !before.deletedAt && !after.deletedAt && before.projectId === after.projectId && before.parentId === after.parentId && hasNoteHistoryChanges(before, after)) {
        const stack = noteHistoryRef.current.get(entityId) ?? { undo: [], redo: [] }
        const group = debounce ? noteTypingGroup(before, after, type) : undefined
        const last = stack.undo.at(-1)
        if (group && last?.group === group && !stack.redo.length && Date.now() - last.at <= NOTE_TYPING_GROUP_MS && last.after.projectId === before.projectId && last.after.parentId === before.parentId && last.after.createdAt === before.createdAt && !hasNoteHistoryChanges(last.after, before)) {
          last.after = snapshotNote(after)
          last.at = Date.now()
        } else {
          stack.undo.push({ before: snapshotNote(before), after: snapshotNote(after), at: Date.now(), group })
          if (stack.undo.length > NOTE_HISTORY_LIMIT) stack.undo.shift()
        }
        stack.redo = []
        noteHistoryRef.current.set(entityId, stack)
        publishNoteHistory()
      } else if (before && after && (before.deletedAt !== after.deletedAt || before.projectId !== after.projectId || before.parentId !== after.parentId)) {
        // Deleting/moving a note is handled by its existing explicit Restore,
        // not by replaying content history against a different notebook.
        for (const note of next.personalNotes ?? []) {
          const old = previous.personalNotes?.find((item) => item.id === note.id)
          if (old && (old.deletedAt !== note.deletedAt || old.projectId !== note.projectId || old.parentId !== note.parentId)) noteHistoryRef.current.delete(note.id)
        }
        publishNoteHistory()
      }
    }
    revisionRef.current += 1
    next.updatedAt = now
    workspaceRef.current = next
    setWorkspace(next)
    const mutation = { id: createId('mutation'), at: now, type, entityId }
    autosave.queue(next, mutation, debounce)
    setSyncMeta((meta) => ({ ...meta, dirty: true }))
  }, [autosave, publishNoteHistory])

  const navigateNoteHistory = useCallback((id: string, direction: 'undo' | 'redo'): PersonalNote | undefined => {
    const stack = noteHistoryRef.current.get(id)
    const entry = stack?.[direction].at(-1)
    if (!stack || !entry) return undefined
    let restored: PersonalNote | undefined
    let beforeReplay: PersonalNote | undefined
    commit(`personal-note.${direction}`, id, (draft, now) => {
      const current = draft.personalNotes?.find((note) => note.id === id)
      beforeReplay = current ? snapshotNote(current) : undefined
      restored = replayNoteHistory(current, direction === 'undo' ? entry.after : entry.before, direction === 'undo' ? entry.before : entry.after, now)
      const index = draft.personalNotes!.findIndex((note) => note.id === id)
      draft.personalNotes![index] = restored
    }, false, false)
    // Advance only after a completely successful replay. A remote conflict
    // leaves both the workspace and history available for explicit review.
    stack[direction].pop()
    const inverse: NoteHistoryEntry = direction === 'undo'
      ? { before: snapshotNote(restored!), after: beforeReplay!, at: Date.now() }
      : { before: beforeReplay!, after: snapshotNote(restored!), at: Date.now() }
    stack[direction === 'undo' ? 'redo' : 'undo'].push(inverse)
    publishNoteHistory()
    return restored
  }, [commit, publishNoteHistory])
  const undoPersonalNote = useCallback((id: string) => navigateNoteHistory(id, 'undo'), [navigateNoteHistory])
  const redoPersonalNote = useCallback((id: string) => navigateNoteHistory(id, 'redo'), [navigateNoteHistory])

  const syncNow = useCallback(async (override?: ConnectionConfig): Promise<boolean> => {
    if (syncingRef.current) return false
    try { await flushLocalSaves() }
    catch {
      setSyncMeta((meta) => ({ ...meta, lastError: 'Could not save changes on this device. Keep this tab open and try Sync now again.' }))
      return false
    }
    if (syncingRef.current) return false
    const config = override ?? connectionRef.current
    if (Date.now() < syncBackoffRef.current) {
      setSyncMeta((meta) => ({ ...meta, lastError: 'GitHub asked us to pause requests. Your edits are saved locally; syncing will retry after the pause.' }))
      return false
    }
    if (!isConfigured(config)) {
      setSyncMeta((meta) => ({ ...meta, lastError: 'Connect the private GitHub data repository before syncing.' }))
      return false
    }
    if (!navigator.onLine) {
      setSyncMeta((meta) => ({ ...meta, online: false, lastError: 'You are offline. Changes are queued safely on this device.' }))
      return false
    }

    syncingRef.current = true
    setSyncMeta((meta) => ({ ...meta, syncing: true, lastError: undefined }))
    try {
      let inboxFiles: { path: string; text: string }[] = []
      let inboxError = ''
      try { inboxFiles = await fetchTaskInbox(config) }
      catch (error) {
        if (error instanceof GitHubSyncError && error.retryAt) throw error
        inboxError = error instanceof Error ? error.message : 'Inbox could not be read.'
      }
      let attempt = 0
      while (attempt < 3) {
        attempt += 1
        await flushLocalSaves()
        const [{ workspace: remote, sha }, base, acknowledgedIds] = await Promise.all([
          fetchWorkspace(config),
          loadBaseWorkspace(),
          mutationIds(),
        ])
        const local = workspaceRef.current
        const pending = acknowledgedIds.length
        const importResult = importSubmissions(!base && pending === 0 && revisionRef.current === 0 ? remote : mergeWorkspaces(base, local, remote), inboxFiles, isoNow())
        const merged = importResult.workspace
        let finalSha = sha
        if (pending > 0 || !sameWorkspaceContent(merged, remote)) {
          try {
            finalSha = await putWorkspace(config, merged, sha)
          } catch (error) {
            if (error instanceof GitHubSyncError && error.status === 409 && attempt < 3) continue
            throw error
          }
        } else merged.updatedAt = remote.updatedAt
        const changedDuringWrite = workspaceRef.current !== local
        const displayed = changedDuringWrite ? mergeWorkspaces(local, workspaceRef.current, merged) : merged
        workspaceRef.current = displayed
        setWorkspace(displayed)
        await Promise.all([autosave.checkpoint(displayed), saveBaseWorkspace(merged), saveSha(finalSha)])
        await clearMutations(acknowledgedIds)
        const remaining = await countMutations()
        setInboxStatus(inboxError ? `Inbox: ${inboxError}` : importResult.errors.length ? `Inbox needs attention: ${importResult.errors.join(' · ')}` : importResult.added || importResult.updates ? `Imported ${importResult.added} checklists and ${importResult.updates} chat updates.` : 'Inbox checked. No new submissions.')
        const lastSyncedAt = isoNow()
        setSyncMeta({ dirty: changedDuringWrite || remaining > 0, syncing: false, online: true, pendingWrites: remaining, lastSyncedAt })
        return true
      }
      throw new Error('The workspace changed repeatedly. Try Sync now again.')
    } catch (error) {
      if (error instanceof GitHubSyncError && error.retryAt) syncBackoffRef.current = error.retryAt
      const message = error instanceof Error ? error.message : 'Sync failed unexpectedly.'
      setSyncMeta((meta) => ({ ...meta, syncing: false, lastError: message }))
      return false
    } finally {
      syncingRef.current = false
    }
  }, [autosave, flushLocalSaves])

  useEffect(() => {
    const flush = () => { void flushLocalSaves().catch(() => { /* The visible save error keeps the draft recoverable for retry. */ }) }
    const hidden = () => { if (document.visibilityState !== 'visible') flush() }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = autosave.getState()
      if (!state.pending && !state.saving) return
      flush()
      // Async IndexedDB writes are not guaranteed to finish during navigation.
      // Let the browser warn instead of silently discarding a still-open draft.
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', hidden)
      flush()
    }
  }, [autosave, flushLocalSaves])

  useEffect(() => {
    if (!ready) return
    const online = () => {
      setSyncMeta((meta) => ({ ...meta, online: true }))
      void syncNow()
    }
    const offline = () => setSyncMeta((meta) => ({ ...meta, online: false }))
    const visible = () => { if (document.visibilityState === 'visible' && navigator.onLine && isConfigured(connectionRef.current)) void syncNow() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    const timer = window.setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible' && isConfigured(connectionRef.current)) void syncNow() }, 15_000)
    if (isConfigured(connectionRef.current) && navigator.onLine) void syncNow()
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
      window.clearInterval(timer)
    }
  }, [ready, syncNow])

  const updateConnection = useCallback(async (next: ConnectionConfig): Promise<boolean> => {
    syncBackoffRef.current = 0
    connectionRef.current = next
    setConnection(next)
    await saveConnection(next)
    return syncNow(next)
  }, [syncNow])

  const disconnect = useCallback(async () => {
    await clearConnection()
    const next = { ...defaultConnection }
    connectionRef.current = next
    setConnection(next)
    setSyncMeta((meta) => ({ ...meta, lastError: undefined, lastSyncedAt: undefined }))
  }, [])

  const markNotificationsRead = useCallback((ids: string[]) => {
    const read = new Set((workspaceRef.current.notificationReads ?? []).map((receipt) => receipt.id))
    const unread = [...new Set(ids)].filter((id) => id && !read.has(id))
    if (!unread.length) return
    commit('notification.read', undefined, (draft, now) => {
      draft.notificationReads ??= []
      draft.notificationReads.push(...unread.map((id) => ({ id, readAt: now })))
    })
  }, [commit])

  const addProject = useCallback((input: { name: string; color: string; icon: string; escalation?: typeof DEFAULT_ESCALATION }) => {
    const project = createProject(input.name.trim(), input.color, input.icon)
    if (input.escalation) project.settings.escalation = input.escalation
    commit('project.create', project.id, (draft) => {
      draft.projects.push(project)
      draft.milestones.push({
        id: createId('milestone'), projectId: project.id, title: 'First playable build', createdAt: project.createdAt, updatedAt: project.createdAt,
      })
      draft.activity.push({ id: createId('event'), type: 'created', at: project.createdAt, projectId: project.id, title: `Created ${project.name}` })
    })
    return project.id
  }, [commit])

  const setProjectStage = useCallback((projectId: string, stage: ProjectStage) => {
    commit('project.stage', projectId, (draft, now) => {
      const project = draft.projects.find((item) => item.id === projectId)
      if (!project) return
      project.stage = stage
      project.updatedAt = now
      draft.activity.push({ id: createId('event'), type: 'stage-changed', at: now, projectId, title: `${project.name} moved to ${stage.replace('-', ' ')}` })
    })
  }, [commit])

  const setBoardCollapsed = useCallback((projectId: string, board: BoardKey, collapsed: boolean) => {
    commit('project.board', projectId, (draft, now) => {
      const project = draft.projects.find((item) => item.id === projectId)
      if (!project) return
      project.settings.collapsedBoards[board] = collapsed
      project.updatedAt = now
    })
  }, [commit])

  const setProjectWorkState = useCallback((projectId: string, workState?: AgentProgress) => {
    commit('project.work-state', projectId, (draft, now) => {
      const project = draft.projects.find((item) => item.id === projectId)
      if (project) Object.assign(project, { workState, updatedAt: now })
    })
  }, [commit])

  const setChatPaused = useCallback((chatId: string, paused: boolean) => {
    commit('chat.pause', chatId, (draft, now) => {
      const chat = draft.agentChats?.find((item) => item.id === chatId)
      if (chat) Object.assign(chat, { paused, updatedAt: now })
    })
  }, [commit])

  const saveChatReport = useCallback((input: Pick<AgentChat, 'projectId' | 'name' | 'agent' | 'status' | 'summary' | 'nextAction'> & { id?: string }) => {
    if (!input.name.trim() || !input.summary.trim()) return
    commit('chat.report', input.id, (draft, now) => {
      if (!draft.projects.some((project) => project.id === input.projectId && !project.deletedAt)) return
      applyCoordination(draft, { format: 'forgeboard-status', version: 1, id: createId('status'), project: input.projectId, at: now, chat: { id: input.id ?? createId('chat'), name: input.name.trim(), agent: input.agent, source: 'Manually recorded in Forgeboard; not a live connection' }, status: input.status, summary: input.summary.trim(), nextAction: input.nextAction?.trim() || undefined }, now)
    })
  }, [commit])

  const importChatUpdate = useCallback((text: string) => {
    if (new TextEncoder().encode(text).length > 200_000) throw new Error('Update exceeds 200 KB. Ask for a shorter handoff.')
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    const updates = Array.isArray(value) ? value : [value]
    if (!updates.length || updates.length > 25) throw new Error('Paste 1–25 update objects at a time.')
    const files = updates.map((update, index) => ({ path: `desktop-chat-update-${index + 1}.json`, text: JSON.stringify(update) }))
    const preview = importSubmissions(workspaceRef.current, files, isoNow())
    if (preview.errors.length) throw new Error(preview.errors.join(' '))
    if (!preview.added && !preview.updates) return 'Already imported. Your saved checks are unchanged.'
    commit('chat.import', undefined, (draft, now) => { Object.assign(draft, importSubmissions(draft, files, now).workspace) })
    return `Saved ${preview.added} checklist(s) and ${preview.updates} status update(s). Sync will save them to your private vault.`
  }, [commit])

  const addExperiment = useCallback((input: Pick<ProjectExperiment, 'projectId' | 'hypothesis' | 'action' | 'target' | 'unit' | 'reviewDate' | 'decisionRule'>) => {
    if (!input.hypothesis.trim() || !input.action.trim() || !input.decisionRule.trim() || !Number.isFinite(input.target) || input.target < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDate) || !Number.isFinite(Date.parse(`${input.reviewDate}T00:00:00Z`)) || new Date(`${input.reviewDate}T00:00:00Z`).toISOString().slice(0, 10) !== input.reviewDate) return
    const id = createId('experiment')
    commit('experiment.create', id, (draft, now) => {
      draft.experiments ??= []
      draft.experiments.push({ ...input, id, observations: [], status: 'running', createdAt: now, updatedAt: now })
    })
  }, [commit])

  const recordExperiment = useCallback((id: string, amount: number, evidence: string) => {
    if (!Number.isFinite(amount) || amount < 0 || !evidence.trim()) return
    commit('experiment.observe', id, (draft, now) => {
      const experiment = draft.experiments?.find((item) => item.id === id)
      if (!experiment) return
      experiment.observations.push({ id: createId('observation'), at: now, amount, evidence: evidence.trim() })
      experiment.updatedAt = now
    })
  }, [commit])

  const decideExperiment = useCallback((id: string, status: 'continue' | 'adjust' | 'stop', conclusion: string) => {
    if (!conclusion.trim()) return
    commit('experiment.decide', id, (draft, now) => {
      const experiment = draft.experiments?.find((item) => item.id === id)
      if (experiment) Object.assign(experiment, { status, conclusion: conclusion.trim(), updatedAt: now })
    })
  }, [commit])

  const addTask = useCallback((input: {
    projectId: string
    board: BoardKey
    title: string
    priority: StartingPriority
    kind: 'checkbox' | 'scheduled'
    dueAt?: string
    scheduledAt?: string
    recurrence?: Recurrence
    escalation?: typeof DEFAULT_ESCALATION
    notes?: string
    color?: TaskColor
  }) => {
    const task = createTask(input)
    task.recurrence = input.recurrence
    task.escalation = input.escalation
    task.notes = input.notes
    task.color = input.color
    commit('task.create', task.id, (draft, now) => {
      draft.tasks.push(task)
      draft.activity.push({ id: createId('event'), type: 'created', at: now, projectId: task.projectId, taskId: task.id, title: task.title })
    })
    return task.id
  }, [commit])

  const toggleTask = useCallback((taskId: string) => {
    commit('task.toggle', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) return
      if (task.completedAt) {
        task.completedAt = undefined
      } else {
        if (task.subtasks?.some((step) => !step.deletedAt && !step.completedAt)) return
        task.completedAt = now
        draft.activity.push({ id: createId('event'), type: 'completed', at: now, projectId: task.projectId, taskId: task.id, title: task.title })
        const occurrence = task.scheduledAt ?? task.dueAt
        if (task.recurrence && occurrence) {
          const nextAt = nextOccurrence(occurrence, task.recurrence)
          const nextTask = createTask({
            projectId: task.projectId,
            board: task.board,
            title: task.title,
            priority: task.startingPriority,
            kind: task.kind,
            scheduledAt: task.scheduledAt ? nextAt : undefined,
            dueAt: task.dueAt ? nextAt : undefined,
          }, now)
          nextTask.recurrence = task.recurrence
          nextTask.escalation = task.escalation
          nextTask.notes = task.notes
          nextTask.color = task.color
          nextTask.subtasks = (task.subtasks ?? []).filter((subtask) => !subtask.deletedAt).map((subtask) => ({
            id: createId('subtask'),
            title: subtask.title,
            createdAt: now,
            updatedAt: now,
          }))
          draft.tasks.push(nextTask)
        }
      }
      task.updatedAt = now
      task.touchedAt = now
    })
  }, [commit])

  const addSubtask = useCallback((taskId: string, title: string) => {
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    commit('subtask.create', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.subtasks ??= []
      task.subtasks.push({ id: createId('subtask'), title: cleanTitle, createdAt: now, updatedAt: now })
      task.updatedAt = now
      task.touchedAt = now
    })
  }, [commit])

  const toggleSubtask = useCallback((taskId: string, subtaskId: string) => {
    commit('subtask.toggle', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      const subtask = task?.subtasks?.find((item) => item.id === subtaskId)
      if (!task || !subtask) return
      subtask.completedAt = subtask.completedAt ? undefined : now
      if (subtask.completedAt) {
        subtask.blockedReason = undefined
        draft.activity.push({ id: createId('event'), type: 'subtask-completed', at: now, projectId: task.projectId, taskId, title: subtask.title, details: task.title })
      }
      subtask.updatedAt = now
      task.updatedAt = now
      task.touchedAt = now
    })
  }, [commit])

  const setTaskColor = useCallback((taskId: string, color?: TaskColor) => {
    commit('task.color', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) return
      task.color = color
      task.updatedAt = now
      task.touchedAt = now
    })
  }, [commit])

  const updateManager = useCallback((settings: Partial<Pick<ManagerSettings, 'energy' | 'dailyMinutes' | 'focusTaskId'>>) => {
    commit('manager.update', 'manager', (draft, now) => {
      draft.manager = { id: 'manager', energy: 'steady', dailyMinutes: 60, ...draft.manager, ...settings, updatedAt: now }
    })
  }, [commit])

  const updateWork = useCallback((taskId: string, input: { workStatus?: WorkStatus; reviewAt?: string; reviewNotes?: string; estimateMinutes?: number }) => {
    commit('task.review', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) return
      Object.assign(task, input, { updatedAt: now, touchedAt: now })
    })
  }, [commit])

  const blockSubtask = useCallback((taskId: string, subtaskId: string, reason: string) => {
    commit('subtask.block', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      const step = task?.subtasks?.find((item) => item.id === subtaskId)
      if (!task || !step) return
      step.blockedReason = reason.trim() || undefined
      step.updatedAt = now
      task.updatedAt = now
    })
  }, [commit])

  const rescheduleTask = useCallback((taskId: string, to: string) => {
    commit('task.reschedule', taskId, (draft, now) => {
      const task = draft.tasks.find((item) => item.id === taskId)
      if (!task) return
      const from = task.scheduledAt ?? task.dueAt ?? now
      task.rescheduleLog.push({ id: createId('push'), from, to, at: now })
      if (task.kind === 'scheduled') task.scheduledAt = to
      task.dueAt = to
      task.updatedAt = now
      task.touchedAt = now
      draft.activity.push({ id: createId('event'), type: 'rescheduled', at: now, projectId: task.projectId, taskId, title: task.title, details: `${from} → ${to}` })
    })
  }, [commit])

  const addMilestone = useCallback((projectId: string, title: string, dueDate?: string) => {
    const id = createId('milestone')
    commit('milestone.create', id, (draft, now) => {
      draft.milestones.push({ id, projectId, title, dueDate, createdAt: now, updatedAt: now })
    })
  }, [commit])

  const toggleMilestone = useCallback((id: string) => {
    commit('milestone.toggle', id, (draft, now) => {
      const milestone = draft.milestones.find((item) => item.id === id)
      if (!milestone) return
      milestone.completedAt = milestone.completedAt ? undefined : now
      milestone.updatedAt = now
    })
  }, [commit])

  const addDeadline = useCallback((input: Omit<Deadline, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = createId('deadline')
    commit('deadline.create', id, (draft, now) => {
      draft.deadlines.push({ ...input, id, createdAt: now, updatedAt: now })
      draft.activity.push({ id: createId('event'), type: 'deadline-created', at: now, projectId: input.projectId, title: input.title })
      if (input.external && input.projectId) {
        const checklist = [
          'Store page live', 'Build uploaded and tested', 'Capsule art ready', 'Trailer exported and uploaded',
          'Age rating completed', 'Pricing set', 'Submit with Valve review buffer',
        ]
        checklist.forEach((title, index) => {
          const dueAt = index === checklist.length - 1
            ? new Date(new Date(input.dueAt).getTime() - 7 * 86_400_000).toISOString()
            : input.dueAt
          draft.tasks.push(createTask({ projectId: input.projectId!, board: 'myTodo', title, priority: index < 2 || index === 6 ? 'high' : 'medium', dueAt, deadlineId: id }, now))
        })
      }
    })
    return id
  }, [commit])

  const quickCapture = useCallback((text: string, activeProjectId?: string) => {
    const noteId = createId('note')
    const route = routeNote(text, workspaceRef.current.projects.filter((project) => !project.deletedAt), activeProjectId)
    const task = createTask({ projectId: route.projectId, board: route.board, title: text.trim(), priority: 'medium', sourceNoteId: noteId })
    commit('note.capture', noteId, (draft, now) => {
      draft.inboxNotes.push({ id: noteId, text: text.trim(), createdAt: now, updatedAt: now, routingStatus: 'fallback', routedTaskId: task.id })
      draft.tasks.push(task)
      draft.activity.push({ id: createId('event'), type: 'created', at: now, projectId: task.projectId, taskId: task.id, title: task.title, details: 'Quick capture' })
    })
    return { taskId: task.id, ...route }
  }, [commit])

  const addPersonalNote = useCallback((input: PersonalNoteInput): string => {
    const id = createId('personal-note')
    commit('personal-note.create', id, (draft, now) => { createPersonalNote(draft, input, id, now) })
    return id
  }, [commit])

  const updatePersonalNote = useCallback((id: string, input: PersonalNoteUpdate): void => {
    const typing = ('title' in input || 'body' in input) && Object.keys(input).every((key) => ['title', 'body', 'parentId'].includes(key))
    commit('personal-note.update', id, (draft, now) => { editPersonalNote(draft, id, input, now) }, typing)
  }, [commit])

  const deletePersonalNote = useCallback((id: string): void => {
    commit('personal-note.delete', id, (draft, now) => { removePersonalNote(draft, id, now) })
  }, [commit])

  const restorePersonalNote = useCallback((id: string): void => {
    commit('personal-note.restore', id, (draft, now) => { restorePersonalNoteTree(draft, id, now) })
  }, [commit])

  const saveNoteLabel = useCallback((input: NoteLabelInput): string => {
    const id = input.id ?? createId('note-label')
    commit('note-label.save', id, (draft, now) => { upsertNoteLabel(draft, input, id, now) })
    return id
  }, [commit])

  const deleteNoteLabel = useCallback((id: string): void => {
    commit('note-label.delete', id, (draft, now) => { removeNoteLabel(draft, id, now) })
  }, [commit])

  const addNoteChecklistItem = useCallback((noteId: string, input: ChecklistItemInput): string => {
    const id = createId('note-check')
    commit('personal-note.checklist.create', noteId, (draft, now) => { addChecklistItem(draft, noteId, input, id, now) })
    return id
  }, [commit])

  const updateNoteChecklistItem = useCallback((noteId: string, itemId: string, input: { text: string }): void => {
    commit('personal-note.checklist.update', noteId, (draft, now) => { editChecklistItem(draft, noteId, itemId, input, now) }, true)
  }, [commit])

  const toggleNoteChecklistItem = useCallback((noteId: string, itemId: string): void => {
    commit('personal-note.checklist.toggle', noteId, (draft, now) => { toggleChecklistItem(draft, noteId, itemId, now) })
  }, [commit])

  const moveNoteChecklistItem = useCallback((noteId: string, itemId: string, direction: ChecklistDirection): void => {
    commit('personal-note.checklist.move', noteId, (draft, now) => { moveChecklistItem(draft, noteId, itemId, direction, now) })
  }, [commit])

  const repositionNoteChecklistItem = useCallback((noteId: string, itemId: string, position: ChecklistDropPosition): void => {
    commit('personal-note.checklist.reposition', noteId, (draft, now) => { repositionChecklistItem(draft, noteId, itemId, position, now) })
  }, [commit])

  const deleteNoteChecklistItem = useCallback((noteId: string, itemId: string): void => {
    commit('personal-note.checklist.delete', noteId, (draft, now) => { removeChecklistItem(draft, noteId, itemId, now) })
  }, [commit])

  const restoreNoteChecklistItem = useCallback((noteId: string, itemId: string): void => {
    commit('personal-note.checklist.restore', noteId, (draft, now) => { restoreChecklistItem(draft, noteId, itemId, now) })
  }, [commit])

  return {
    workspace,
    connection,
    ready,
    inboxStatus,
    syncMeta,
    localSave,
    noteHistory,
    configured: isConfigured(connection),
    actions: {
      syncNow,
      flushLocalSaves,
      updateConnection,
      disconnect,
      markNotificationsRead,
      addProject,
      setProjectStage,
      setProjectWorkState,
      setChatPaused,
      saveChatReport,
      importChatUpdate,
      addExperiment,
      recordExperiment,
      decideExperiment,
      setBoardCollapsed,
      addTask,
      toggleTask,
      addSubtask,
      toggleSubtask,
      blockSubtask,
      updateManager,
      updateWork,
      setTaskColor,
      rescheduleTask,
      addMilestone,
      toggleMilestone,
      addDeadline,
      quickCapture,
      addPersonalNote,
      updatePersonalNote,
      undoPersonalNote,
      redoPersonalNote,
      deletePersonalNote,
      restorePersonalNote,
      saveNoteLabel,
      deleteNoteLabel,
      addNoteChecklistItem,
      updateNoteChecklistItem,
      toggleNoteChecklistItem,
      moveNoteChecklistItem,
      repositionNoteChecklistItem,
      deleteNoteChecklistItem,
      restoreNoteChecklistItem,
    },
  }
}
