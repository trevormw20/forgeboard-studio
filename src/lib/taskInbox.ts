import { BOARD_DEFINITIONS, type BoardKey, type StartingPriority, type Workspace } from '../types'
import { createProject, createTask } from '../seed'

export interface TaskSubmission {
  format: 'forgeboard-task'; version: 1; id: string; project: string; date: string
  summary: string; notes?: string; board?: BoardKey; priority?: StartingPriority
  subtasks: { id: string; title: string }[]
}

export function parseSubmission(text: string): TaskSubmission {
  if (new TextEncoder().encode(text).length > 200_000) throw new Error('File exceeds 200 KB.')
  const value = JSON.parse(text) as TaskSubmission
  if (!value || value.format !== 'forgeboard-task' || value.version !== 1) throw new Error('Expected forgeboard-task version 1.')
  for (const key of ['id', 'project', 'date', 'summary'] as const) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 500) throw new Error(`Invalid ${key}.`)
  }
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value.id)) throw new Error('Use a stable id with letters, numbers, dots, underscores or dashes.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date) throw new Error('Invalid calendar date.')
  if (value.board && !BOARD_DEFINITIONS.some((board) => board.key === value.board)) throw new Error('Unknown board.')
  if (value.priority && !['low', 'medium', 'high'].includes(value.priority)) throw new Error('Unknown priority.')
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 20_000)) throw new Error('Invalid notes.')
  if (!Array.isArray(value.subtasks) || !value.subtasks.length || value.subtasks.length > 200) throw new Error('Include 1–200 subtasks.')
  const ids = new Set<string>()
  for (const step of value.subtasks) {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(step.id) || ids.has(step.id)) throw new Error('Subtask ids must be unique.')
    if (typeof step.title !== 'string' || !step.title.trim() || step.title.length > 1000) throw new Error('Invalid subtask title.')
    ids.add(step.id)
  }
  return value
}

// Submissions are immutable. Keeping their deterministic parent IDs also prevents
// re-import after completion, deletion, simultaneous device imports, or file renames.
export function importSubmissions(workspace: Workspace, files: { path: string; text: string }[], now: string) {
  const next = structuredClone(workspace)
  const errors: string[] = []
  let added = 0
  for (const file of files) {
    try {
      const submission = parseSubmission(file.text)
      const id = `submission:${submission.id}`
      if (next.tasks.some((task) => task.id === id)) continue
      const projectName = submission.project.trim()
      let project = next.projects.find((item) => !item.deletedAt && (item.id === projectName || item.name.toLowerCase() === projectName.toLowerCase()))
      if (!project) {
        project = createProject(projectName, '#7c9cff', '🎮', now)
        project.id = `inbox-project:${encodeURIComponent(projectName.toLowerCase())}`
        if (next.projects.some((item) => item.id === project!.id)) throw new Error('This project was deleted; restore it or use a new project name.')
        next.projects.push(project)
      }
      const task = createTask({ projectId: project.id, board: submission.board ?? 'myTodo', title: `${submission.date} · ${submission.summary.trim()}`, priority: submission.priority ?? 'medium' }, now)
      task.id = id
      task.notes = submission.notes
      task.submission = { id: submission.id, date: submission.date, sourceFile: file.path }
      task.subtasks = submission.subtasks.map((step) => ({ id: `${id}:${step.id}`, title: step.title.trim(), createdAt: now, updatedAt: now }))
      next.tasks.push(task)
      next.activity.push({ id: `event:${id}`, type: 'created', at: now, projectId: project.id, taskId: id, title: task.title, details: `Imported ${file.path}` })
      added++
    } catch (error) { errors.push(`${file.path}: ${error instanceof Error ? error.message : 'Invalid file.'}`) }
  }
  if (added) next.updatedAt = now
  return { workspace: next, added, errors }
}
