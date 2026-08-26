import type { EffectivePriority, EscalationPolicy, Project, StartingPriority, Task } from '../types'

export const DEFAULT_ESCALATION: EscalationPolicy = {
  lowToMediumDays: 7,
  mediumToHighDays: 5,
  highToUrgentDays: 3,
}

const levels: EffectivePriority[] = ['low', 'medium', 'high', 'urgent']

function elapsedDays(from: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(from).getTime()) / 86_400_000)
}

export function effectivePriority(task: Task, project?: Project, now = new Date()): EffectivePriority {
  const policy = task.escalation ?? project?.settings.escalation ?? DEFAULT_ESCALATION
  const age = elapsedDays(task.touchedAt || task.updatedAt || task.createdAt, now)
  let index = levels.indexOf(task.startingPriority as EffectivePriority)
  let remaining = age

  const thresholds = [policy.lowToMediumDays, policy.mediumToHighDays, policy.highToUrgentDays]
  while (index < levels.length - 1 && remaining >= thresholds[index]) {
    remaining -= thresholds[index]
    index += 1
  }

  if (task.dueAt && new Date(task.dueAt).getTime() < now.getTime()) {
    index = Math.min(levels.length - 1, index + 1)
  }

  return levels[index]
}

export function priorityRank(priority: EffectivePriority): number {
  return { urgent: 4, high: 3, medium: 2, low: 1 }[priority]
}

export function daysUntil(iso: string, now = new Date()): number {
  const due = new Date(iso)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  return Math.ceil((dueDay.getTime() - today.getTime()) / 86_400_000)
}

export function countdownLabel(iso: string, now = new Date()): string {
  const days = daysUntil(iso, now)
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

export function bumpPriority(priority: StartingPriority): EffectivePriority {
  return priority === 'low' ? 'medium' : priority === 'medium' ? 'high' : 'urgent'
}
