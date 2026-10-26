export const BOARD_DEFINITIONS = [
  { key: 'bugs', label: 'Bugs and Errors', shortLabel: 'Bugs' },
  { key: 'aiTodo', label: 'AI Todo', shortLabel: 'AI Todo' },
  { key: 'myTodo', label: 'My Todo', shortLabel: 'My Todo' },
  { key: 'ideas', label: 'Ideas and Backlog', shortLabel: 'Ideas' },
  { key: 'playtest', label: 'Playtest Feedback', shortLabel: 'Playtest' },
  { key: 'assets', label: 'Assets Needed', shortLabel: 'Assets' },
] as const

export type BoardKey = (typeof BOARD_DEFINITIONS)[number]['key']
export type ProjectStage = 'prototype' | 'in-development' | 'polish' | 'submitted' | 'released'
export type StartingPriority = 'low' | 'medium' | 'high'
export type EffectivePriority = StartingPriority | 'urgent'
export type TaskKind = 'checkbox' | 'scheduled'
export type AgentProgress = 'unknown' | 'in-progress' | 'waiting-on-me' | 'waiting-on-agent' | 'paused' | 'blocked' | 'done'
export interface AgentChat {
  id: string
  projectId: string
  name: string
  agent: 'codex' | 'claude-code' | 'claude' | 'chatgpt' | 'other'
  status: AgentProgress
  summary: string
  nextAction?: string
  source?: string
  updatedAt: string
  paused?: boolean
}
export interface AgentStatusEvent {
  format: 'forgeboard-status'
  version: 1
  id: string
  project: string
  at: string
  chat: { id: string; name: string; agent: AgentChat['agent']; source?: string }
  status: AgentProgress
  summary: string
  nextAction?: string
  handoff?: { toChatId: string; instruction: string; files: string[]; chainId: string; hop: number }
}
export interface RelayReceipt {
  format: 'forgeboard-relay-result'
  version: 1
  id: string
  handoffId: string
  at: string
  state: 'claimed' | 'delivered' | 'failed' | 'needs-check'
  detail: string
}
export interface ProjectRegistration {
  format: 'forgeboard-project'
  version: 1
  id: string
  at: string
  project: string
  color?: string
  icon?: string
}
export interface ProjectExperiment {
  id: string
  projectId: string
  hypothesis: string
  action: string
  target: number
  unit: string
  reviewDate: string
  decisionRule: string
  observations: { id: string; at: string; amount: number; evidence: string }[]
  status: 'running' | 'continue' | 'adjust' | 'stop'
  conclusion?: string
  createdAt: string
  updatedAt: string
}

export interface EscalationPolicy {
  lowToMediumDays: number
  mediumToHighDays: number
  highToUrgentDays: number
}

export interface Project {
  id: string
  name: string
  color: string
  icon: string
  stage: ProjectStage
  workState?: AgentProgress
  settings: {
    escalation: EscalationPolicy
    defaultBoard: BoardKey
    collapsedBoards: Partial<Record<BoardKey, boolean>>
  }
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface Recurrence {
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number
}

export interface RescheduleEntry {
  id: string
  from: string
  to: string
  at: string
}

export type TaskColor = 'slate' | 'blue' | 'violet' | 'pink' | 'red' | 'orange' | 'green' | 'yellow'

export interface Subtask {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  deletedAt?: string
  blockedReason?: string
}

export type WorkStatus = 'needs-review' | 'in-progress' | 'waiting' | 'blocked' | 'later'

export interface HandoffContext {
  agent: AgentChat['agent']
  source?: string
  completedWork: string[]
  review: string
  resume?: string
  relatedSubmissionId?: string
}

export interface Task {
  id: string
  projectId: string
  board: BoardKey
  title: string
  notes?: string
  kind: TaskKind
  startingPriority: StartingPriority
  dueAt?: string
  scheduledAt?: string
  recurrence?: Recurrence
  escalation?: EscalationPolicy
  createdAt: string
  updatedAt: string
  touchedAt: string
  completedAt?: string
  deletedAt?: string
  deadlineId?: string
  sourceNoteId?: string
  tip?: string
  color?: TaskColor
  subtasks?: Subtask[]
  submission?: { id: string; date: string; sourceFile: string }
  handoff?: HandoffContext
  workStatus?: WorkStatus
  reviewAt?: string
  estimateMinutes?: number
  reviewNotes?: string
  rescheduleLog: RescheduleEntry[]
}

export interface Milestone {
  id: string
  projectId: string
  title: string
  dueDate?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface Deadline {
  id: string
  projectId?: string
  title: string
  dueAt: string
  hard: boolean
  external: boolean
  pinned: boolean
  createdAt: string
  updatedAt: string
  completedAt?: string
  deletedAt?: string
}

export interface InboxNote {
  id: string
  text: string
  createdAt: string
  updatedAt: string
  routingStatus: 'pending' | 'routed' | 'fallback'
  routedTaskId?: string
  deletedAt?: string
}

export interface ActivityEvent {
  id: string
  type: 'created' | 'completed' | 'subtask-completed' | 'rescheduled' | 'stage-changed' | 'deadline-created' | 'conflict'
  at: string
  projectId?: string
  taskId?: string
  title: string
  details?: string
}

export interface WeeklyReport {
  id: string
  weekStart: string
  weekEnd: string
  createdAt: string
  shipped: string[]
  fixed: string[]
  slipped: string[]
}

export interface ConflictRecord {
  id: string
  entityType: string
  entityId: string
  detectedAt: string
  local: unknown
  remote: unknown
  resolution: string
}

export interface AiState {
  updatedAt?: string
  dailySummary?: string
  suggestedTaskId?: string
  suggestedReason?: string
  lastRunStatus?: 'ai' | 'fallback' | 'not-configured' | 'error'
  provider?: 'anthropic' | 'openai' | 'fallback'
  encouragement?: string
  notice?: string
  contextHash?: string
  lastAttemptAt?: string
}

export interface ManagerSettings {
  id: 'manager'
  updatedAt: string
  energy: 'light' | 'steady' | 'focused'
  dailyMinutes: number
  focusTaskId?: string
}

export interface HandoffSummary {
  id: string
  projectId: string
  sourceFile: string
  recordIds: string[]
  title: string
  inputHash: string
  receivedAt: string
  updatedAt: string
  state: 'pending' | 'ai' | 'fallback'
  summary: string
  needsYou: string
  nextStep: string
  model?: string
  provider?: 'anthropic'
  generatedAt?: string
  attempts: number
  lastAttemptAt?: string
  retryAfter?: string
  warning?: string
}

export interface InboxAutomation {
  updatedAt: string
  summaryDay: string
  summaryCalls: number
  pending: number
  lastReceivedAt?: string
  errorCount: number
}

export interface NoteChecklistItem {
  id: string
  text: string
  parentId?: string
  order: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  deletedAt?: string
}

export interface PersonalNote {
  id: string
  projectId?: string
  parentId?: string
  title: string
  body: string
  color?: string
  labelIds?: string[]
  pinned?: boolean
  checklist?: NoteChecklistItem[]
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface NoteLabel {
  id: string
  projectId?: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface NotificationRead {
  id: string
  readAt: string
}

export interface Workspace {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  projects: Project[]
  tasks: Task[]
  milestones: Milestone[]
  deadlines: Deadline[]
  inboxNotes: InboxNote[]
  activity: ActivityEvent[]
  reports: WeeklyReport[]
  conflicts: ConflictRecord[]
  ai: AiState
  manager?: ManagerSettings
  agentChats?: AgentChat[]
  agentEvents?: AgentStatusEvent[]
  relayReceipts?: RelayReceipt[]
  experiments?: ProjectExperiment[]
  handoffSummaries?: HandoffSummary[]
  inboxAutomation?: InboxAutomation
  personalNotes?: PersonalNote[]
  noteLabels?: NoteLabel[]
  notificationReads?: NotificationRead[]
}

export interface ConnectionConfig {
  owner: string
  repo: string
  branch: string
  path: string
  token: string
  rememberToken: boolean
}

export interface SyncMeta {
  sha?: string
  lastSyncedAt?: string
  lastError?: string
  dirty: boolean
  syncing: boolean
  online: boolean
  pendingWrites: number
}

export interface MutationRecord {
  id: string
  at: string
  type: string
  entityId?: string
}
