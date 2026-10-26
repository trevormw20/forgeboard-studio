import { Bell, CheckCheck, ChevronRight, FileCheck2, MessageCircle, Sparkles, X } from 'lucide-react'
import type { ActivityNotification } from '../lib/notifications'
import type { Project } from '../types'
import './notifications.css'

interface NotificationCenterProps {
  items: readonly ActivityNotification[]
  unreadIds: ReadonlySet<string>
  projects: readonly Project[]
  onRead: (ids: string[]) => void
  onOpen: (item: ActivityNotification) => void
}

function NotificationIcon({ item }: { item: ActivityNotification }) {
  return item.ai ? <Sparkles size={18} /> : item.kind === 'chat' ? <MessageCircle size={18} /> : item.kind === 'handoff' ? <FileCheck2 size={18} /> : <Bell size={18} />
}

function dateLabel(at: string) { return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }

export function NotificationCenter({ items, unreadIds, projects, onRead, onOpen }: NotificationCenterProps) {
  const unread = items.filter((item) => unreadIds.has(item.id))
  return <section className="notification-center" aria-label="Notifications">
    <header className="notification-heading"><div><p className="eyebrow">Updates without chasing chats</p><h1>Notifications</h1><p>Reported work, review checklists, and Haiku summaries in one place.</p></div>
      <button className="secondary-button" disabled={!unread.length} onClick={() => onRead(unread.map((item) => item.id))}><CheckCheck size={16} />Mark all read</button>
    </header>
    <div className="notification-summary"><Bell size={16} /><span>{unread.length ? `${unread.length} unread update${unread.length === 1 ? '' : 's'}` : 'You’re caught up'}</span><small>Updates arrive after the source file uploads and syncs. AI summaries may follow a little later.</small></div>
    {items.length ? <div className="notification-list">{items.map((item) => {
      const project = projects.find((entry) => entry.id === item.projectId)
      const isUnread = unreadIds.has(item.id)
      return <article key={item.id} className={`notification-item${isUnread ? ' is-unread' : ''}`} aria-label={`${isUnread ? 'Unread: ' : ''}${item.title}`}>
        <div className="notification-kind"><NotificationIcon item={item} /></div>
        <div className="notification-copy"><div className="notification-meta"><span style={{ color: project?.color }}>{project?.icon} {project?.name ?? 'Forgeboard'}</span><time dateTime={item.at}>{dateLabel(item.at)}</time>{isUnread && <span className="notification-unread-tag">Unread</span>}</div>
          <h2>{item.title}</h2><p>{item.body}</p>{(item.needsYou || item.nextStep) && <dl className="notification-next">{item.needsYou && <><dt>Needs you</dt><dd>{item.needsYou}</dd></>}{item.nextStep && <><dt>Next step</dt><dd>{item.nextStep}</dd></>}</dl>}<div className="notification-item-actions"><button className="text-button" onClick={() => { onRead([item.id]); onOpen(item) }}>{item.taskId ? 'Open checklist' : item.kind === 'summary' || item.kind === 'handoff' ? 'Open handoff' : 'View progress'}<ChevronRight size={14} /></button>{isUnread && <button className="text-button notification-mark-read" onClick={() => onRead([item.id])}>Mark read</button>}{item.ai && <small><Sparkles size={12} />Haiku summary · verify the original work</small>}</div>
        </div>
      </article>
    })}</div> : <div className="notification-empty"><Bell size={30} /><h2>Nothing to check yet</h2><p>When your chats send a handoff, finish their part, or need you, the update will appear here. Typing notes and checking your own tasks won’t create notifications.</p></div>}
    <p className="notification-help">The unread light stays on until you check your updates. Popups work while Forgeboard is open; they do not mean the entire project is finished.</p>
  </section>
}

export function ActivityToastStack({ items, projects, onOpen, onDismiss }: { items: readonly ActivityNotification[]; projects: readonly Project[]; onOpen: (item: ActivityNotification) => void; onDismiss: (id: string) => void }) {
  return <div className="activity-toast-stack" aria-label="Live project updates" aria-live="polite" aria-relevant="additions">
    {items.map((item) => {
      const project = projects.find((entry) => entry.id === item.projectId)
      return <article className="activity-toast" key={item.id}><div className="activity-toast-icon"><NotificationIcon item={item} /></div><div className="activity-toast-copy"><small>{project?.name ?? 'Forgeboard'} · {item.ai ? 'Haiku summary ready' : 'New update'}</small><strong>{item.title}</strong><p>{item.nextStep ? `Next: ${item.nextStep}` : item.body}</p><button className="text-button" onClick={() => onOpen(item)}>View update<ChevronRight size={14} /></button></div><button className="icon-button activity-toast-close" aria-label={`Dismiss popup: ${item.title}`} onClick={() => onDismiss(item.id)}><X size={16} /></button></article>
    })}
  </div>
}
