import { createId } from './lib/ids'
import { DEFAULT_ESCALATION } from './lib/priority'
import type { BoardKey, Project, StartingPriority, Task, TaskColor, Workspace } from './types'

const projectSeeds = [
  ['calculator-quest', 'Calculator Quest', '#ffb45d', '🧮'],
  ['caseduko', 'Caseduko', '#65d6a6', '🔢'],
  ['quadro', 'Quadro', '#7c9cff', '◈'],
  ['leather-crafter', 'Leather Crafter', '#d18b62', '🧵'],
  ['regency-mansion', 'Regency Mansion', '#c88cff', '🏛️'],
] as const

function atOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(17, 0, 0, 0)
  return date.toISOString()
}

function steamDeadline(): string {
  const now = new Date()
  let year = now.getFullYear()
  const date = new Date(year, 7, 31, 23, 59, 0)
  if (date.getTime() < now.getTime()) year += 1
  return new Date(year, 7, 31, 23, 59, 0).toISOString()
}

export function createProject(name: string, color: string, icon: string, now = new Date().toISOString()): Project {
  return {
    id: createId('project'),
    name,
    color,
    icon,
    stage: 'prototype',
    settings: { escalation: { ...DEFAULT_ESCALATION }, defaultBoard: 'myTodo', collapsedBoards: {} },
    createdAt: now,
    updatedAt: now,
  }
}

export function createTask(input: {
  projectId: string
  board: BoardKey
  title: string
  priority?: StartingPriority
  dueAt?: string
  kind?: 'checkbox' | 'scheduled'
  scheduledAt?: string
  deadlineId?: string
  sourceNoteId?: string
  color?: TaskColor
}, now = new Date().toISOString()): Task {
  return {
    id: createId('task'),
    projectId: input.projectId,
    board: input.board,
    title: input.title,
    kind: input.kind ?? 'checkbox',
    startingPriority: input.priority ?? 'medium',
    dueAt: input.dueAt,
    scheduledAt: input.scheduledAt,
    deadlineId: input.deadlineId,
    sourceNoteId: input.sourceNoteId,
    color: input.color,
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    touchedAt: now,
    rescheduleLog: [],
  }
}

export function createSeedWorkspace(): Workspace {
  const now = new Date().toISOString()
  const projects: Project[] = projectSeeds.map(([id, name, color, icon], index) => ({
    id,
    name,
    color,
    icon,
    stage: index === 0 ? 'in-development' : index === 1 ? 'polish' : 'prototype',
    settings: {
      escalation: { ...DEFAULT_ESCALATION },
      defaultBoard: 'myTodo',
      collapsedBoards: {},
    },
    createdAt: now,
    updatedAt: now,
  }))

  const deadlineId = 'deadline-steam-next-fest'
  const deadlineDueAt = steamDeadline()
  const calculatorId = projects[0].id
  const checklist = [
    ['Store page live', 'high'],
    ['Build uploaded and tested', 'high'],
    ['Capsule art ready', 'medium'],
    ['Trailer exported and uploaded', 'medium'],
    ['Age rating completed', 'medium'],
    ['Pricing set', 'medium'],
    ['Submit with Valve review buffer', 'high'],
  ] as const

  const tasks: Task[] = checklist.map(([title, priority], index) => createTask({
    projectId: calculatorId,
    board: 'myTodo',
    title,
    priority,
    dueAt: index === checklist.length - 1 ? atOffset(1) : deadlineDueAt,
    kind: index === checklist.length - 1 ? 'scheduled' : 'checkbox',
    scheduledAt: index === checklist.length - 1 ? atOffset(1) : undefined,
    deadlineId,
  }, now))

  tasks.push(
    createTask({ projectId: projects[1].id, board: 'bugs', title: 'Verify puzzle validation on a full grid', priority: 'high', dueAt: atOffset(2) }, now),
    createTask({ projectId: projects[2].id, board: 'ideas', title: 'Prototype the four-panel transition', priority: 'low' }, now),
    createTask({ projectId: projects[3].id, board: 'assets', title: 'Photograph three leather grain references', priority: 'medium', dueAt: atOffset(5) }, now),
    createTask({ projectId: projects[4].id, board: 'playtest', title: 'Test whether the first room teaches interaction clearly', priority: 'medium' }, now),
  )

  return {
    schemaVersion: 1,
    id: 'forgeboard-workspace',
    name: 'Forgeboard Studio',
    createdAt: now,
    updatedAt: now,
    projects,
    tasks,
    milestones: projects.map((project, index) => ({
      id: createId('milestone'),
      projectId: project.id,
      title: index === 0 ? 'Festival-ready demo' : 'Next playable build',
      dueDate: atOffset(7 + index * 3).slice(0, 10),
      createdAt: now,
      updatedAt: now,
    })),
    deadlines: [{
      id: deadlineId,
      projectId: calculatorId,
      title: 'Steam Next Fest submission',
      dueAt: deadlineDueAt,
      hard: true,
      external: true,
      pinned: true,
      createdAt: now,
      updatedAt: now,
    }],
    inboxNotes: [],
    activity: [],
    reports: [],
    conflicts: [],
    ai: {
      lastRunStatus: 'not-configured',
      dailySummary: 'Five games are active. Calculator Quest has the nearest external deadline; finish the submission checklist before expanding lower-priority prototypes.',
      suggestedTaskId: tasks.find((task) => task.title === 'Build uploaded and tested')?.id,
      suggestedReason: 'It protects the closest hard deadline and leaves time to fix upload issues.',
    },
  }
}
