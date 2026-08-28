import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearConnection,
  clearMutations,
  countMutations,
  enqueueMutation,
  loadBaseWorkspace,
  loadCachedWorkspace,
  loadConnection,
  saveBaseWorkspace,
  saveCachedWorkspace,
  saveConnection,
  saveSha,
} from '../lib/db'
import { fetchWorkspace, GitHubSyncError, putWorkspace } from '../lib/github'
import { createId, isoNow } from '../lib/ids'
import { mergeWorkspaces } from '../lib/merge'
import { DEFAULT_ESCALATION } from '../lib/priority'
import { routeNote } from '../lib/routing'
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
} from '../types'

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
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({
    dirty: false,
    syncing: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendingWrites: 0,
  })
  const workspaceRef = useRef(workspace)
  const connectionRef = useRef(connection)
  const syncingRef = useRef(false)

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

  const commit = useCallback((type: string, entityId: string | undefined, change: (draft: Workspace, now: string) => void) => {
    const now = isoNow()
    const next = structuredClone(workspaceRef.current)
    change(next, now)
    next.updatedAt = now
    workspaceRef.current = next
    setWorkspace(next)
    void saveCachedWorkspace(next)
    const mutation = { id: createId('mutation'), at: now, type, entityId }
    void enqueueMutation(mutation).then(async () => {
      const pendingWrites = await countMutations()
      setSyncMeta((meta) => ({ ...meta, dirty: true, pendingWrites }))
    })
  }, [])

  const syncNow = useCallback(async (override?: ConnectionConfig): Promise<boolean> => {
    if (syncingRef.current) return false
    const config = override ?? connectionRef.current
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
      let attempt = 0
      while (attempt < 3) {
        attempt += 1
        const [{ workspace: remote, sha }, base, pending] = await Promise.all([
          fetchWorkspace(config),
          loadBaseWorkspace(),
          countMutations(),
        ])
        const local = workspaceRef.current
        const merged = !base && pending === 0 ? remote : mergeWorkspaces(base, local, remote)
        let finalSha = sha
        if (pending > 0 || JSON.stringify(merged) !== JSON.stringify(remote)) {
          try {
            finalSha = await putWorkspace(config, merged, sha)
          } catch (error) {
            if (error instanceof GitHubSyncError && error.status === 409 && attempt < 3) continue
            throw error
          }
        }
        workspaceRef.current = merged
        setWorkspace(merged)
        await Promise.all([saveCachedWorkspace(merged), saveBaseWorkspace(merged), saveSha(finalSha), clearMutations()])
        const lastSyncedAt = isoNow()
        setSyncMeta({ dirty: false, syncing: false, online: true, pendingWrites: 0, lastSyncedAt })
        return true
      }
      throw new Error('The workspace changed repeatedly. Try Sync now again.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed unexpectedly.'
      setSyncMeta((meta) => ({ ...meta, syncing: false, lastError: message }))
      return false
    } finally {
      syncingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const online = () => {
      setSyncMeta((meta) => ({ ...meta, online: true }))
      void syncNow()
    }
    const offline = () => setSyncMeta((meta) => ({ ...meta, online: false }))
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    const timer = window.setInterval(() => { if (navigator.onLine) void syncNow() }, 120_000)
    if (isConfigured(connectionRef.current) && navigator.onLine) void syncNow()
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.clearInterval(timer)
    }
  }, [ready, syncNow])

  const updateConnection = useCallback(async (next: ConnectionConfig): Promise<boolean> => {
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

  return {
    workspace,
    connection,
    ready,
    syncMeta,
    configured: isConfigured(connection),
    actions: {
      syncNow,
      updateConnection,
      disconnect,
      addProject,
      setProjectStage,
      setBoardCollapsed,
      addTask,
      toggleTask,
      addSubtask,
      toggleSubtask,
      setTaskColor,
      rescheduleTask,
      addMilestone,
      toggleMilestone,
      addDeadline,
      quickCapture,
    },
  }
}
