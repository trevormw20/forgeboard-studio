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
  agent: 'codex' | 'claude-code' | 'other'
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
