import { createProject } from '../seed'
import type { AgentChat, AgentProgress, AgentStatusEvent, Project, ProjectRegistration, RelayReceipt, Workspace } from '../types'

export const progressLabels: Record<AgentProgress, string> = { unknown: 'Not reported yet', 'in-progress': 'In progress', 'waiting-on-me': 'Waiting on you', 'waiting-on-agent': 'Waiting on other chat', paused: 'Paused', blocked: 'Blocked', done: 'Part done' }
export const agentLabels = { codex: 'Codex', 'claude-code': 'Claude Code', claude: 'Claude desktop/chat', chatgpt: 'ChatGPT desktop/chat', other: 'Other' }

export const desktopInboxPath = 'C:\\Users\\maker\\Documents\\Codex\\game develop schedualer\\Forgeboard Inbox'

export function desktopChatPrompt(chat: AgentChat, projectName: string) {
  return `Use Forgeboard to keep my ${projectName} work from getting lost in chat. Your permanent chat id is ${chat.id}; project id is ${chat.projectId}. I will grant you access to this dedicated folder: ${desktopInboxPath}. Read its FORGEBOARD_INSTRUCTIONS.md first. After a meaningful work handoff, blocker, or wait for my review, SAVE one new uniquely named .json or .md file directly in that inbox. Do not ask me to copy text into Forgeboard. Use forgeboard-task and forgeboard-status version 1 formats, or the Markdown format in the instructions. Use project ${JSON.stringify(chat.projectId)}, chat id ${JSON.stringify(chat.id)}, name ${JSON.stringify(chat.name)}, agent ${JSON.stringify(chat.agent)}, real current date and timestamp, and new unique ids for each handoff. Include what you actually changed, current status, who acts next, and specific unchecked human review steps. Keep earlier unfinished checks; never mark tests passed for me. The bridge uploads the file privately and Haiku summarizes it; you do not need GitHub access or an API key. Never put credentials or unrelated files into the inbox. Do not edit _bridge or already submitted files. If folder access is missing, ask me to grant ONLY that inbox folder; do not claim the file was saved. This reports work, not permission to message another chat or skip approval gates. Remember this for this project.`
}

export function manualDesktopChatPrompt(chat: AgentChat, projectName: string) {
  return `Help me keep this ${projectName} chat organized in Forgeboard. Your permanent chat id is ${chat.id}; use project id ${chat.projectId}. Read https://github.com/trevormw20/forgeboard-studio/blob/main/AGENT_COORDINATION.md and https://github.com/trevormw20/forgeboard-studio/blob/main/FORGEBOARD_HANDOFF.md if browsing is available. If you cannot access my private GitHub vault, do NOT claim you published anything. Give me one copy-ready JSON array to paste into Forgeboard's “Paste chat update” box after each meaningful handoff. Never include credentials. First include a forgeboard-status version 1 object with a NEW unique id, project: ${JSON.stringify(chat.projectId)}, at: the real current ISO timestamp with timezone, chat: {id: ${JSON.stringify(chat.id)}, name: ${JSON.stringify(chat.name)}, agent: ${JSON.stringify(chat.agent)}}, status: one of unknown, in-progress, waiting-on-me, waiting-on-agent, paused, blocked, done, summary: a factual short update, and nextAction: who needs to do what next. “done” means only your part. If I need to review or test anything, also include ONE forgeboard-task version 1 object: new unique id, same project, date: today's real YYYY-MM-DD, summary: a short parent task, subtasks: [{id: a unique short stable id, title: a specific check}] for every unfinished test or decision. Keep those checks intact across later fixes; never check them off for me. Do not bury steps 6–10 because 1–5 passed. For peer work, name the next owner, exact Markdown file paths, and copy-ready next instruction; never claim you messaged another chat. Ask for missing files or human approval instead of guessing. Report only verified work. Remember this for the rest of this conversation.`
}

export function handoffForChat(workspace: Workspace, event: AgentStatusEvent) {
  const target = workspace.agentChats?.find((chat) => chat.id === event.handoff?.toChatId)
  return `Project: ${workspace.projects.find((project) => project.id === event.project || project.name.toLowerCase() === event.project.toLowerCase())?.name ?? event.project}\nFor: ${target?.name ?? event.handoff?.toChatId ?? 'the next working chat'}\nYour peer (${event.chat.name}) reported: ${event.summary}\n\nNext step: ${event.handoff?.instruction ?? event.nextAction ?? 'Review the reported work and identify the next owner.'}\n\n${event.handoff?.files.length ? `Read these project Markdown files (attach them if this chat cannot access the project folder):\n${event.handoff.files.map((file) => `- ${file}`).join('\n')}\n\n` : ''}Verify the report rather than assuming it is correct. Preserve unfinished human checks and approval gates. Work only within this project's authorized scope. If a file or decision is missing, ask instead of guessing. Report what you finished, remaining checks, current status, and who should act next. This pasted message does not mean the project is finished.`
}
export function resolveProject(workspace: Workspace, name: string, now: string): Project {
  const exact = workspace.projects.find((item) => !item.deletedAt && item.id === name)
  if (exact) return exact
  const matches = workspace.projects.filter((item) => !item.deletedAt && item.name.toLowerCase() === name.trim().toLowerCase())
  if (matches.length > 1) throw new Error('Ambiguous project. Use its exact id.')
  if (matches[0]) return matches[0]
  const project = createProject(name.trim(), '#7c9cff', '📁', now)
  project.id = `inbox-project:${encodeURIComponent(name.trim().toLowerCase())}`
  if (workspace.projects.some((item) => item.id === project.id)) throw new Error('This project was deleted. Restore it before submitting new updates.')
  workspace.projects.push(project)
  return project
}
export function applyCoordination(workspace: Workspace, event: AgentStatusEvent | RelayReceipt | ProjectRegistration, now: string) {
  if (Date.parse(event.at) > Date.parse(now) + 5 * 60_000) throw new Error('Update timestamp is in the future.')
  if (event.format === 'forgeboard-project') {
    const count = workspace.projects.length
    const project = resolveProject(workspace, event.project, now)
    if (workspace.projects.length === count) return false
    Object.assign(project, { color: event.color ?? project.color, icon: event.icon ?? project.icon, workState: 'unknown' })
  } else if (event.format === 'forgeboard-relay-result') {
    workspace.relayReceipts ??= []
    const old = workspace.relayReceipts.findIndex((item) => item.id === event.id)
    if (old >= 0 && Date.parse(workspace.relayReceipts[old].at) >= Date.parse(event.at)) return false
    if (old < 0) workspace.relayReceipts.push(event)
    else workspace.relayReceipts[old] = event
  } else {
    workspace.agentEvents ??= []
    if (workspace.agentEvents.some((item) => item.id === event.id)) return false
    const project = resolveProject(workspace, event.project, now)
    workspace.agentChats ??= []
    const old = workspace.agentChats.find((item) => item.id === event.chat.id)
    if (old && old.projectId !== project.id) throw new Error('Chat id belongs to another project. Use a unique chat id.')
    workspace.agentEvents.push(event)
    if (!old || Date.parse(old.updatedAt) < Date.parse(event.at)) {
      const chat = { id: event.chat.id, projectId: project.id, name: event.chat.name, agent: event.chat.agent, status: event.status, summary: event.summary, nextAction: event.nextAction, source: event.chat.source, updatedAt: event.at, paused: old?.paused }
      if (old) Object.assign(old, chat)
      else workspace.agentChats.push(chat)
    }
  }
  workspace.updatedAt = now
  return true
}
export function projectProgress(workspace: Workspace, project: Project): AgentProgress {
  if (project.workState && project.workState !== 'unknown') return project.workState
  const chats = (workspace.agentChats ?? []).filter((chat) => chat.projectId === project.id)
  if (chats.some((chat) => !chat.paused && chat.status === 'waiting-on-me')) return 'waiting-on-me'
  if (chats.some((chat) => !chat.paused && chat.status === 'blocked')) return 'blocked'
  if (chats.some((chat) => !chat.paused && chat.status === 'in-progress')) return 'in-progress'
  const tasks = workspace.tasks.filter((task) => task.projectId === project.id && !task.deletedAt)
  if (tasks.some((task) => !task.completedAt && task.workStatus === 'needs-review')) return 'waiting-on-me'
  if (chats.length && chats.every((chat) => chat.paused || chat.status === 'paused')) return 'paused'
  if (chats.some((chat) => chat.status === 'waiting-on-agent')) return 'waiting-on-agent'
  if (project.stage === 'released' && !tasks.some((task) => !task.completedAt)) return 'done'
  // A chat finishing its part never implies the entire project is complete.
  return tasks.some((task) => !task.completedAt) ? 'in-progress' : 'unknown'
}
