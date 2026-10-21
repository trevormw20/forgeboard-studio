import { ChevronRight, FileText } from 'lucide-react'
import type { Workspace } from '../types'

export function HandoffInbox({ workspace, openReview }: { workspace: Workspace; openReview: (id: string) => void }) {
  const summaries = (workspace.handoffSummaries ?? []).slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  return <section className="handoff-inbox" aria-label="Incoming chat handoffs">
    <div className="section-title"><div><p className="eyebrow">Files arrive. Nothing gets lost.</p><h2>From your chats</h2></div><FileText size={20} /></div>
    <p className="helper-copy">Haiku summarizes reported work. Your original checklists and checkmarks stay separate and unchanged.</p>
    {summaries.length ? <div className="handoff-cards">{summaries.slice(0, 6).map((item) => {
      const project = workspace.projects.find((entry) => entry.id === item.projectId)
      const tasks = workspace.tasks.filter((task) => !task.deletedAt && task.submission && item.recordIds.includes(task.submission.id))
      const steps = tasks.flatMap((task) => task.subtasks?.filter((step) => !step.deletedAt) ?? [])
      const remaining = steps.filter((step) => !step.completedAt).length
      return <article className="handoff-card" key={item.id}>
        <header><span style={{ color: project?.color }}>{project?.icon} {project?.name ?? 'Project'}</span><span className={`handoff-label ${item.state}`}>{item.state === 'ai' ? 'Haiku summary' : item.state === 'pending' ? 'Summary queued' : 'Saved · AI unavailable'}</span></header>
        <h3>{item.title}</h3><p>{item.summary}</p>
        <div className="handoff-next"><strong>Needs you</strong><p>{item.needsYou}</p><strong>One next step</strong><p>{item.nextStep}</p></div>
        {!!steps.length && <p className="handoff-live">Now: {remaining}/{steps.length} review steps still unchecked{remaining === 0 ? ' · all checked' : ''}</p>}
        {item.warning && <p className="helper-copy">{item.warning}</p>}
        <small>{item.sourceFile} · Received {new Date(item.receivedAt).toLocaleString()}{item.state === 'ai' ? ` · ${item.model ?? 'Claude Haiku'}` : ''}</small>
        {tasks.map((task) => <button key={task.id} className="secondary-button" onClick={() => openReview(task.id)}>Open {tasks.length > 1 ? task.title : 'original checklist'}<ChevronRight size={14} /></button>)}
      </article>
    })}</div> : <p className="handoff-empty">No handoffs yet. Start the desktop inbox bridge, then let Cowork save a file into your Forgeboard Inbox folder. It will appear here after syncing.</p>}
    {summaries.length > 6 && <details className="older-handoffs"><summary>{summaries.length - 6} earlier handoffs</summary>{summaries.slice(6).map((item) => <p key={item.id}><strong>{workspace.projects.find((project) => project.id === item.projectId)?.name}:</strong> {item.summary}</p>)}</details>}
  </section>
}
