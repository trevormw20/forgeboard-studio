import { BOARD_DEFINITIONS, type BoardKey, type Project, type Task } from '../types'

const boardKeywords: Array<[BoardKey, RegExp]> = [
  ['bugs', /\b(bugs?|errors?|crash(?:es|ed|ing)?|broken|fix(?:es|ed|ing)?|glitch(?:es)?|issues?)\b/i],
  ['assets', /\b(asset|art|audio|music|sprite|model|texture|icon|capsule|trailer)\b/i],
  ['playtest', /\b(playtest|feedback|player|testing|confusing|difficulty)\b/i],
  ['ideas', /\b(idea|maybe|consider|concept|backlog|someday)\b/i],
  ['aiTodo', /\b(ai|chatgpt|prompt|generate|automation)\b/i],
]

export function routeNote(text: string, projects: Project[], activeProjectId?: string): { projectId: string; board: BoardKey } {
  const lower = text.toLowerCase()
  const namedProject = projects.find((project) => lower.includes(project.name.toLowerCase()))
  const projectId = namedProject?.id ?? activeProjectId ?? projects[0]?.id
  const board = boardKeywords.find(([, expression]) => expression.test(text))?.[0] ?? 'myTodo'
  return { projectId, board }
}

export function practicalTip(task: Task): string {
  const title = task.title.toLowerCase()
  if (/build|upload|submit/.test(title)) return 'Make a release checklist, freeze scope, upload early, then run one clean smoke test from the downloaded build.'
  if (/trailer|video/.test(title)) return 'Cut a 20–30 second proof first: hook, core loop, payoff. Polish timing only after the story reads without sound.'
  if (/art|asset|capsule/.test(title)) return 'Define the exact dimensions and acceptance criteria, make one strong pass, then export every required size together.'
  if (/bug|error|crash|fix/.test(title)) return 'Write the shortest reliable reproduction, change one thing, and verify the original reproduction plus one nearby case.'
  if (/email|organizer/.test(title)) return 'Use three lines: context, one clear ask, and the date you need an answer by.'
  return 'Define the smallest visible done state, work for 25 focused minutes, then either finish it or record the exact blocker.'
}

export function boardLabel(key: BoardKey): string {
  return BOARD_DEFINITIONS.find((board) => board.key === key)?.label ?? key
}
