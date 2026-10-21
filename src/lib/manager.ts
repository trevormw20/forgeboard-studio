import type { Project, Task, Workspace } from '../types'
import { effectivePriority, priorityRank } from './priority'

export const managerDefaults = { id: 'manager' as const, updatedAt: '', energy: 'steady' as const, dailyMinutes: 60 }
export function isWaiting(task: Task, now = new Date()) {
  return task.workStatus === 'blocked' || task.workStatus === 'waiting' || task.workStatus === 'later' || (Boolean(task.reviewAt) && Date.parse(task.reviewAt!) > now.getTime())
}
export function openWork(workspace: Workspace) {
  const projects = new Set(workspace.projects.filter((project) => !project.deletedAt).map((project) => project.id))
  return workspace.tasks.filter((task) => !task.completedAt && !task.deletedAt && projects.has(task.projectId))
}
export function reviewReason(task: Task) {
  if (task.workStatus === 'blocked') return task.reviewNotes || 'Record what failed, then send it back to the working chat.'
  if (task.handoff) return task.handoff.review
  if (task.submission) return 'Work through the submitted checklist. Unfinished steps will stay here.'
  return 'Finish the next unchecked step, or record what is blocking it.'
}
export function buildManagerPlan(workspace: Workspace, now = new Date()) {
  const settings = { ...managerDefaults, ...workspace.manager }
  const tasks = openWork(workspace)
  const projects = new Map(workspace.projects.map((project) => [project.id, project]))
  const score = (task: Task) => {
    const project = projects.get(task.projectId) as Project | undefined
    const deadline = workspace.deadlines.find((item) => item.id === task.deadlineId && !item.completedAt && !item.deletedAt)
    const due = task.dueAt ?? deadline?.dueAt
    return priorityRank(effectivePriority(task, project, now)) * 10
      + (due && Date.parse(due) <= now.getTime() + 2 * 86_400_000 ? 60 : 0)
      + (task.reviewAt && Date.parse(task.reviewAt) <= now.getTime() ? 45 : 0)
      + (task.workStatus === 'needs-review' ? 12 : 0)
      + (settings.focusTaskId === task.id ? 200 : 0)
      + (workspace.ai.lastRunStatus === 'ai' && workspace.ai.suggestedTaskId === task.id ? 25 : 0)
  }
  const available = tasks.filter((task) => !isWaiting(task, now)).sort((a, b) => score(b) - score(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const max = settings.energy === 'light' ? 1 : 3
  const next: Task[] = []
  let minutes = 0
  for (const task of available) {
    const estimate = task.estimateMinutes ?? 15
    if (next.length >= max) break
    if (next.length && minutes + estimate > settings.dailyMinutes) continue
    next.push(task)
    minutes += Math.min(estimate, Math.max(0, settings.dailyMinutes - minutes))
  }
  const cutoff = now.getTime() - 7 * 86_400_000
  const wins = workspace.activity.filter((event) => ['completed', 'subtask-completed', 'stage-changed'].includes(event.type) && Date.parse(event.at) >= cutoff && Date.parse(event.at) <= now.getTime()).sort((a, b) => b.at.localeCompare(a.at))
  return { next, available, waiting: tasks.filter((task) => isWaiting(task, now)), reviews: tasks.filter((task) => task.workStatus === 'needs-review' || (!task.workStatus && task.submission)), reminders: tasks.filter((task) => task.workStatus !== 'blocked' && task.workStatus !== 'waiting' && task.workStatus !== 'later' && task.reviewAt && Date.parse(task.reviewAt) <= now.getTime()), wins, minutes }
}

export function feedbackForChat(task: Task, projectName: string) {
  const steps = (task.subtasks ?? []).filter((step) => !step.deletedAt)
  return [`Forgeboard review: ${projectName}`, task.title, `Submission: ${task.submission?.id ?? task.id}`, `Status: ${task.workStatus ?? 'in-progress'}`, '', 'Completed:', ...steps.filter((step) => step.completedAt).map((step) => `- [x] ${step.title}`), '', 'Still to do (retain these):', ...steps.filter((step) => !step.completedAt).map((step) => `- [ ] ${step.title}${step.blockedReason ? ` — BLOCKED: ${step.blockedReason}` : ''}`), '', `My feedback: ${task.reviewNotes || 'No feedback recorded yet.'}`, '', 'Fix the reported problems and give me the exact next step. Keep the unfinished checklist above. Publish new review work as a new Forgeboard handoff with relatedSubmissionId pointing to this submission.'].join('\n')
}
