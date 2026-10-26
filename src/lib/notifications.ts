import type { AgentStatusEvent, HandoffSummary, Task, Workspace } from '../types'

export interface ActivityNotification {
  id: string
  /** One incoming file stays one card as its summary becomes ready. */
  groupId: string
  kind: 'handoff' | 'summary' | 'chat' | 'relay'
  title: string
  body: string
  at: string
  projectId?: string
  taskId?: string
  chatId?: string
  ai?: boolean
  needsYou?: string
  nextStep?: string
}

export interface NotificationReadReceipt { id: string; readAt: string }

const compact = (text: string | undefined, fallback: string) => text?.trim().replace(/\s+/g, ' ') || fallback
const validTime = (at: string | undefined) => Boolean(at && Number.isFinite(Date.parse(at)))
const fileName = (path: string) => path.replaceAll('\\', '/').split('/').at(-1) || path
const fileGroup = (projectId: string, path: string) => `handoff:${encodeURIComponent(projectId)}:${encodeURIComponent(fileName(path))}`
const recordGroup = (projectId: string, id: string) => `handoff:${encodeURIComponent(projectId)}:${encodeURIComponent(id)}`
const recordKey = (projectId: string | undefined, id: string) => `${projectId ?? ''}\n${id}`

interface DesktopDelivery { id: string; recordIds: string[] }
interface DeliveryGroup { groupId: string; delivery: DesktopDelivery }
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value)

function deliveryGroups(workspace: Workspace) {
  const byRecord = new Map<string, DeliveryGroup>()
  const ambiguous = new Set<string>()
  for (const event of workspace.agentEvents ?? []) {
    const projectId = projectIdFor(workspace, event.project)
    if (!projectId) continue
    // parseCoordination preserves the bridge's metadata. It is still untrusted
    // input, so only this explicitly validated link may combine separate files.
    const raw = (event as AgentStatusEvent & { desktopDelivery?: unknown }).desktopDelivery
    if (!raw || typeof raw !== 'object') continue
    const meta = raw as Partial<DesktopDelivery>
    if (!safeId(meta.id) || !Array.isArray(meta.recordIds) || !meta.recordIds.length || meta.recordIds.length > 25 || !meta.recordIds.every(safeId) || new Set(meta.recordIds).size !== meta.recordIds.length || !meta.recordIds.includes(event.id)) continue
    const group: DeliveryGroup = { groupId: `delivery:${encodeURIComponent(projectId)}:${meta.id}`, delivery: { id: meta.id, recordIds: meta.recordIds } }
    for (const id of meta.recordIds) {
      const key = recordKey(projectId, id)
      const previous = byRecord.get(key)
      if (previous && (previous.groupId !== group.groupId || previous.delivery.recordIds.slice().sort().join('\n') !== group.delivery.recordIds.slice().sort().join('\n'))) ambiguous.add(key)
      else byRecord.set(key, group)
    }
  }
  for (const key of ambiguous) byRecord.delete(key)
  return byRecord
}

function taskGroup(task: Task, tasks: Task[], deliveries: ReadonlyMap<string, DeliveryGroup>) {
  const explicit = deliveries.get(recordKey(task.projectId, task.submission!.id))
  if (explicit) return explicit.groupId
  // The desktop bridge creates per-record JSON names; the AI keeps the original
  // .md filename. Record IDs are the authoritative link across both versions.
  const file = fileGroup(task.projectId, task.submission!.sourceFile || task.submission!.id)
  const ids = tasks.filter((entry) => entry.projectId === task.projectId && entry.submission && fileGroup(entry.projectId, entry.submission.sourceFile || entry.submission.id) === file).map((entry) => entry.submission!.id).sort()
  return recordGroup(task.projectId, ids[0] || task.submission!.id)
}

function projectIdFor(workspace: Workspace, project: string) {
  return workspace.projects.find((entry) => !entry.deletedAt && (entry.id === project || entry.name.toLowerCase() === project.trim().toLowerCase()))?.id
}

function summaryNotification(summary: HandoffSummary, tasks: Task[], deliveries: ReadonlyMap<string, DeliveryGroup>): ActivityNotification {
  const originalTasks = tasks.filter((entry) => entry.projectId === summary.projectId && entry.submission && summary.recordIds.includes(entry.submission.id)).sort((a, b) => a.submission!.id.localeCompare(b.submission!.id))
  const task = originalTasks.find((entry) => !entry.deletedAt)
  const explicit = summary.recordIds.map((id) => deliveries.get(recordKey(summary.projectId, id))).find((group) => group?.delivery.id === summary.id)
  const groupId = explicit?.groupId ?? (originalTasks[0] ? taskGroup(originalTasks[0], tasks, deliveries) : recordGroup(summary.projectId, summary.recordIds.slice().sort()[0] || summary.id))
  const ready = summary.state === 'ai'
  // Retry timestamps/attempt counts are not new work. Only a new input or the
  // first real AI result re-lights an already-read incoming handoff.
  const revision = ready ? `summary:${summary.inputHash || summary.id}` : 'received'
  return {
    id: `${groupId}:${revision}`, groupId, kind: ready ? 'summary' : 'handoff',
    title: compact(summary.title, 'Chat handoff received'),
    body: compact(ready ? summary.summary : task?.handoff?.review || summary.needsYou || summary.summary, 'A chat sent an update. Open it to see the original review steps.'),
    at: ready && validTime(summary.generatedAt) ? summary.generatedAt! : summary.receivedAt,
    projectId: summary.projectId, taskId: task?.id, ai: ready,
    needsYou: compact(summary.needsYou, task?.handoff?.review ?? 'Review the reported work.'),
    nextStep: compact(summary.nextStep, 'Open the original handoff and choose one unfinished check.'),
  }
}

function chatNotification(event: AgentStatusEvent, projectId: string | undefined, delivery?: DeliveryGroup): ActivityNotification | undefined {
  const label = event.status === 'done' ? 'finished its part' : event.status === 'waiting-on-me' ? 'needs you' : event.status === 'blocked' ? 'reported a blocker' : undefined
  if (!label || !validTime(event.at)) return undefined
  const groupId = delivery?.groupId ?? `chat:${event.id}`
  return { id: `${groupId}:received`, groupId, kind: 'chat', title: `${event.chat.name} ${label}`, body: compact(event.summary, compact(event.nextAction, 'Open project progress to review this reported update.')), at: event.at, projectId, chatId: event.chat.id, nextStep: event.nextAction?.trim() || undefined }
}

/** Only reports delivered by agents/automation create notifications. Editing a
 * note, checking your own tasks, or generating an optimistic UI state never does.
 * Original task/status records covered by a handoff summary are folded into it.
 */
export function deriveActivityNotifications(workspace: Workspace): ActivityNotification[] {
  const result = new Map<string, ActivityNotification>()
  const deletedProjects = new Set(workspace.projects.filter((project) => project.deletedAt).map((project) => project.id))
  const summaries = (workspace.handoffSummaries ?? []).filter((summary) => !deletedProjects.has(summary.projectId) && validTime(summary.receivedAt))
  const deliveries = deliveryGroups(workspace)
  const coveredRecords = new Set(summaries.flatMap((summary) => summary.recordIds.map((id) => recordKey(summary.projectId, id))))
  for (const summary of summaries) {
    const item = summaryNotification(summary, workspace.tasks, deliveries)
    const hasTaskRecord = workspace.tasks.some((task) => task.projectId === summary.projectId && task.submission && summary.recordIds.includes(task.submission.id))
    if (!hasTaskRecord) {
      const status = (workspace.agentEvents ?? []).find((event) => summary.recordIds.includes(event.id) && projectIdFor(workspace, event.project) === summary.projectId)
      if (status) {
        item.groupId = deliveries.get(recordKey(summary.projectId, status.id))?.groupId ?? `chat:${status.id}`
        item.id = `${item.groupId}:${summary.state === 'ai' ? `summary:${summary.inputHash || summary.id}` : 'received'}`
        item.chatId = status.chat.id
      }
    }
    const previous = result.get(item.groupId)
    if (!previous || Date.parse(item.at) >= Date.parse(previous.at)) result.set(item.groupId, item)
  }
  for (const task of workspace.tasks) {
    if (!task.submission || task.deletedAt || deletedProjects.has(task.projectId) || coveredRecords.has(recordKey(task.projectId, task.submission.id)) || !validTime(task.createdAt)) continue
    const groupId = taskGroup(task, workspace.tasks, deliveries)
    if (result.has(groupId)) continue
    result.set(groupId, {
      id: `${groupId}:received`, groupId, kind: 'handoff', title: compact(task.title, 'New review checklist'),
      body: compact(task.handoff?.review, 'A new checklist arrived from your chats. Your review steps are saved.'),
      at: task.createdAt, projectId: task.projectId, taskId: task.id, needsYou: task.handoff?.review,
      nextStep: task.handoff?.resume || task.subtasks?.find((step) => !step.deletedAt && !step.completedAt)?.title,
    })
  }
  for (const event of workspace.agentEvents ?? []) {
    const projectId = projectIdFor(workspace, event.project)
    if (coveredRecords.has(recordKey(projectId, event.id))) continue
    if (!projectId && workspace.projects.some((project) => project.deletedAt && (project.id === event.project || project.name.toLowerCase() === event.project.trim().toLowerCase()))) continue
    const item = chatNotification(event, projectId, deliveries.get(recordKey(projectId, event.id)))
    if (item) {
      const previous = result.get(item.groupId)
      if (previous) previous.chatId ??= item.chatId
      else result.set(item.groupId, item)
    }
  }
  for (const receipt of workspace.relayReceipts ?? []) {
    if (receipt.state === 'claimed' || !validTime(receipt.at)) continue
    const source = workspace.agentEvents?.find((event) => event.id === receipt.handoffId)
    const projectId = source ? projectIdFor(workspace, source.project) : undefined
    if (source && !projectId && workspace.projects.some((project) => project.deletedAt && (project.id === source.project || project.name.toLowerCase() === source.project.trim().toLowerCase()))) continue
    const groupId = `relay:${receipt.id}`
    result.set(groupId, {
      id: `${groupId}:${receipt.state}`, groupId, kind: 'relay',
      title: receipt.state === 'delivered' ? 'Handoff delivered' : receipt.state === 'failed' ? 'Handoff could not be delivered' : 'Handoff needs your check',
      body: compact(receipt.detail, 'Open project progress to check the handoff.'), at: receipt.at, projectId, chatId: source?.chat.id,
    })
  }
  return [...result.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
}

export function unreadNotificationIds(items: readonly ActivityNotification[], reads: readonly NotificationReadReceipt[] = []): Set<string> {
  const read = new Set(reads.map((receipt) => receipt.id))
  return new Set(items.filter((item) => !read.has(item.id)).map((item) => item.id))
}
