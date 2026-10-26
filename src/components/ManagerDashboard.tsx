import { useEffect, useRef, useState } from 'react'
import { Bell, Check, ChevronRight, ClipboardCopy, Clock3, Flag, Heart, Inbox, Link2, Pause, Play, Sparkles, X } from 'lucide-react'
import type { useForgeboard } from '../hooks/useForgeboard'
import { buildManagerPlan, feedbackForChat, managerDefaults, reviewReason } from '../lib/manager'
import { fromLocalInputValue, toLocalInputValue } from '../lib/ids'
import type { Task, WorkStatus } from '../types'
import { ProjectProgressPanel } from './ProjectProgressPanel'
import { ExperimentPanel } from './ExperimentPanel'
import { HandoffInbox } from './HandoffInbox'

type Forge = ReturnType<typeof useForgeboard>
export type ManagerSection = 'today' | 'tasks' | 'progress' | 'handoffs' | 'checkpoints'
const labels: Record<WorkStatus, string> = { 'needs-review': 'Needs my review', 'in-progress': 'Ready to work', waiting: 'Waiting on someone', blocked: 'Blocked', later: 'Parked for later' }
const GUIDE = 'https://github.com/trevormw20/forgeboard-studio/blob/main/FORGEBOARD_HANDOFF.md'
const chatPrompt = `Use Forgeboard as my project manager. Read C:/Users/maker/Documents/Codex/game develop schedualer/Forgeboard Inbox/FORGEBOARD_INSTRUCTIONS.md. After meaningful work that needs my review, testing, decision, or follow-up, SAVE one new uniquely named JSON or Markdown handoff directly into that Forgeboard Inbox folder. Use the existing exact project name or id; never mix projects. Include current status, reported changes, who acts next, and specific unchecked human review steps. Keep all earlier unfinished work; never mark tests passed for me. The local bridge handles private GitHub delivery and Haiku summaries. You do not need an API key or GitHub access. If you lack folder access, ask me to grant this dedicated inbox folder; do not claim the file was saved. Never include credentials, edit _bridge, or overwrite an existing submission. Read ${GUIDE} for detailed formats. This does not authorize messaging other chats or bypassing human approval. Remember these instructions for this project without replacing its existing instructions.`

async function copy(text: string) { await navigator.clipboard.writeText(text) }

export function ReviewPanel({ forge, task, onClose }: { forge: Forge; task: Task; onClose: () => void }) {
  const project = forge.workspace.projects.find((item) => item.id === task.projectId)
  const [notes, setNotes] = useState(task.reviewNotes ?? '')
  const [when, setWhen] = useState(toLocalInputValue(task.reviewAt))
  const [status, setStatus] = useState<WorkStatus>(task.workStatus ?? 'needs-review')
  const [message, setMessage] = useState('')
  const [blockStep, setBlockStep] = useState('')
  const [reason, setReason] = useState('')
  const steps = (task.subtasks ?? []).filter((step) => !step.deletedAt)
  const remaining = steps.filter((step) => !step.completedAt).length
  const save = () => { forge.actions.updateWork(task.id, { workStatus: status, reviewNotes: notes.trim(), reviewAt: fromLocalInputValue(when) }); setMessage('Saved. Your remaining steps are kept.') }
  const close = () => { forge.actions.updateWork(task.id, { workStatus: status, reviewNotes: notes.trim(), reviewAt: fromLocalInputValue(when) }); onClose() }
  const feedback = async () => {
    save()
    try { await copy(feedbackForChat({ ...task, workStatus: status, reviewNotes: notes }, project?.name ?? 'Project')); setMessage('Copied. Paste this into the working chat.') }
    catch { setMessage('Clipboard unavailable. Your feedback is saved here; select and copy it below.') }
  }
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape) })
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card modal-wide review-panel" role="dialog" aria-modal="true" aria-label="Review work"><header className="modal-header"><div><p className="eyebrow">{project?.name} · {task.handoff?.agent ?? 'Checklist'}</p><h2>{task.title}</h2></div><button className="icon-button" onClick={close} aria-label="Close review"><X size={18} /></button></header><div className="review-body">
    <div className="review-purpose"><strong>What you’re checking</strong><p>{reviewReason(task)}</p>{task.handoff?.resume && <p><strong>Where to resume:</strong> {task.handoff.resume}</p>}{task.notes && <p className="preserve-lines">{task.notes}</p>}</div>
    {task.handoff?.source && <p className="source-reference"><Link2 size={15} />{task.handoff.source}</p>}
    {!!task.handoff?.completedWork.length && <details><summary>What the agent finished</summary><ul>{task.handoff.completedWork.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {task.handoff?.relatedSubmissionId && <p className="source-reference">Continues submission: {task.handoff.relatedSubmissionId}. Earlier unfinished work remains in your queue.</p>}
    <div className="section-title"><h3>Review checklist</h3><span className="item-count">{steps.length - remaining}/{steps.length} checked</span></div>
    {!steps.length && <p>Do the smallest useful next step, then record the result below.</p>}
    <div className="review-steps">{steps.map((step, index) => <div className={`review-step ${step.completedAt ? 'checked' : ''}`} key={step.id}><label><input type="checkbox" checked={Boolean(step.completedAt)} onChange={() => forge.actions.toggleSubtask(task.id, step.id)} /><span>{index + 1}. {step.title}</span></label>{step.blockedReason && <p className="blocked-note">Blocked: {step.blockedReason}</p>}{!step.completedAt && <button className="text-button" onClick={() => { setBlockStep(step.id); setReason(step.blockedReason ?? '') }}>{step.blockedReason ? 'Edit blocker' : 'Something failed'}</button>}{blockStep === step.id && <form className="blocker-form" onSubmit={(event) => { event.preventDefault(); forge.actions.blockSubtask(task.id, step.id, reason); setBlockStep('') }}><label>What happened?<input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Expected result, actual result, error…" /></label><button className="secondary-button">Save blocker</button><button type="button" className="text-button" onClick={() => setBlockStep('')}>Cancel</button></form>}</div>)}</div>
    <div className="modal-form review-form"><label>My results, errors, or questions<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="I finished 1–5. Step 6 fails with… Steps 7–10 still need checking." /></label><div className="form-grid"><label>Where this stands<select value={status} onChange={(event) => setStatus(event.target.value as WorkStatus)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Remind me to check again<input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /></label></div><p className="helper-copy">Use “Ready to work” or “Needs my review” with a reminder to bring it back when due. Blocked, waiting, and parked items stay off Next up until you make them ready.</p><div className="review-actions"><button className="primary-button" onClick={save}>Save review</button><button className="secondary-button" onClick={() => void feedback()}><ClipboardCopy size={15} />Copy feedback for chat</button><button className="secondary-button" disabled={remaining > 0 || Boolean(task.completedAt)} onClick={() => { save(); forge.actions.toggleTask(task.id); onClose() }}><Check size={15} />Finish task</button></div>{remaining > 0 && <small>{remaining} unchecked steps are saved. Finish is enabled when all steps are checked.</small>}{message && <p role="status" className="form-success">{message}</p>}<details><summary>Feedback text to copy manually</summary><pre className="feedback-preview">{feedbackForChat({ ...task, workStatus: status, reviewNotes: notes }, project?.name ?? 'Project')}</pre></details></div>
  </div></section></div>
}

export function ManagerDashboard({ forge, section = 'today' }: { forge: Forge; section?: ManagerSection }) {
  const plan = buildManagerPlan(forge.workspace)
  const settings = { ...managerDefaults, ...forge.workspace.manager }
  const [selected, setSelected] = useState<string>()
  const [queue, setQueue] = useState<'review' | 'waiting' | 'all'>('review')
  const [copied, setCopied] = useState('')
  const [notifications, setNotifications] = useState('')
  const notified = useRef(new Set<string>())
  const reviewTask = forge.workspace.tasks.find((task) => task.id === selected)
  const queueTasks = queue === 'waiting' ? plan.waiting : queue === 'all' ? [...plan.available, ...plan.waiting] : plan.reviews
  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    for (const task of plan.reminders) {
      const key = `${task.id}:${task.reviewAt}`
      if (notified.current.has(key)) continue
      notified.current.add(key)
      try { new Notification('Forgeboard · time to check in', { body: task.title, tag: key, icon: './icon-192.png' }) } catch { /* Mobile platforms may disallow the constructor. The visible reminder remains. */ }
    }
  }, [plan.reminders])
  const enableNotifications = async () => {
    if (!('Notification' in window)) { setNotifications('This browser does not support desktop notifications. Due reminders still appear here.'); return }
    const permission = await Notification.requestPermission()
    setNotifications(permission === 'granted' ? 'Enabled while Forgeboard is open. Due reminders also appear here.' : 'Notifications not enabled. Due reminders still appear here.')
  }
  return <section className="manager-home" aria-label="Your project manager">
    {section === 'today' && <>
    <div className="manager-intro"><div><p className="eyebrow">Your project manager</p><h2>One next step. Everything else is saved.</h2><p>Keep the work moving without keeping it all in your head.</p></div><div className="manager-day"><label>Today’s pace<select aria-label="Today's pace" value={settings.energy} onChange={(event) => forge.actions.updateManager({ energy: event.target.value as typeof settings.energy })}><option value="light">Light · one thing</option><option value="steady">Steady · up to three</option><option value="focused">Focused · up to three</option></select></label><label>Time available<select aria-label="Time available" value={settings.dailyMinutes} onChange={(event) => forge.actions.updateManager({ dailyMinutes: Number(event.target.value) })}>{[15, 30, 60, 90, 120, 180, 240].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}</select></label></div></div>
    <div className="manager-brief"><Sparkles size={20} /><div><strong>Manager’s brief</strong><p>{forge.workspace.ai.dailySummary ?? `${plan.reviews.length} items need your review. Start with one below; you can leave the rest for later.`}</p><small>{forge.workspace.ai.provider === 'anthropic' ? 'Claude' : forge.workspace.ai.provider === 'openai' ? 'OpenAI' : 'Built-in planner'} · {forge.workspace.ai.updatedAt ? `Updated ${new Date(forge.workspace.ai.updatedAt).toLocaleString()}` : 'Ready without an API key'}</small>{forge.workspace.ai.notice && <p role="status" className="helper-copy">{forge.workspace.ai.notice}</p>}</div></div>
    {plan.reminders.length > 0 && <div className="manager-reminders" role="status"><Bell size={19} /><div><strong>{plan.reminders.length} check-in{plan.reminders.length === 1 ? '' : 's'} due</strong>{plan.reminders.slice(0, 3).map((task) => <button key={task.id} onClick={() => setSelected(task.id)}>{task.title}<ChevronRight size={14} /></button>)}</div></div>}
    <div className="section-title"><div><p className="eyebrow">Keep it manageable</p><h2>Next up</h2></div><span className="item-count">{plan.minutes ? `About ${plan.minutes} min total` : 'Room to breathe'}</span></div>
    <div className="next-cards">{plan.next.length ? plan.next.map((task, index) => { const project = forge.workspace.projects.find((item) => item.id === task.projectId); const step = task.subtasks?.find((item) => !item.deletedAt && !item.completedAt); return <article className="next-card" key={task.id}><div className="next-card-top"><span className="next-number">{index + 1}</span><span>{project?.icon} {project?.name}</span><small><Clock3 size={12} />{task.estimateMinutes ?? 15} min</small></div><h3>{task.title}</h3><p>{step ? `Next: ${step.title}` : reviewReason(task)}</p>{task.id === forge.workspace.ai.suggestedTaskId && <p className="helper-copy">{forge.workspace.ai.suggestedReason}</p>}<div className="next-card-actions"><button className="primary-button" onClick={() => { forge.actions.updateManager({ focusTaskId: task.id }); setSelected(task.id) }}><Play size={14} />{settings.focusTaskId === task.id ? 'Continue' : 'Start here'}</button><button className="text-button" onClick={() => forge.actions.updateWork(task.id, { workStatus: 'later' })}><Pause size={14} />Park it</button></div></article> }) : <div className="manager-empty"><Check size={24} /><p>No ready work right now. Your waiting and parked items are saved in All tasks.</p></div>}</div>
    <section className="momentum-card"><Heart size={22} /><div><strong>Progress you can control</strong><p>{forge.workspace.ai.encouragement ?? (plan.wins.length ? `${plan.wins.length} completed steps or milestones in the last seven days. Each one is evidence of work moving forward.` : 'A small finished step counts. Choose one check, record the result, and let that be enough for this session.')}</p><small>Sales and leads are outcomes to learn from, not a grade for today.</small>{plan.wins.length > 0 && <details><summary>See recent wins</summary><ul>{plan.wins.slice(0, 8).map((win) => <li key={win.id}>{win.title}</li>)}</ul></details>}</div></section>
    </>}
    {section === 'handoffs' && <HandoffInbox workspace={forge.workspace} openReview={setSelected} />}
    {section === 'progress' && <ProjectProgressPanel forge={forge} />}
    {section === 'checkpoints' && <ExperimentPanel forge={forge} />}
    {section === 'tasks' && <details className="review-queue"><summary><span>Review checklists &amp; waiting work</span><span>{plan.reviews.length + plan.waiting.length} saved</span></summary><div className="section-title"><div><p className="eyebrow">Nothing lost in chat</p><h2>Review & follow-up</h2></div></div><div className="manager-tabs" role="group" aria-label="Work queue"><button aria-pressed={queue === 'review'} onClick={() => setQueue('review')}><Inbox size={16} />Needs review <span>{plan.reviews.length}</span></button><button aria-pressed={queue === 'waiting'} onClick={() => setQueue('waiting')}><Pause size={16} />Waiting / parked <span>{plan.waiting.length}</span></button><button aria-pressed={queue === 'all'} onClick={() => setQueue('all')}><Flag size={16} />All saved work</button></div><div className="manager-queue-list">{queueTasks.length ? queueTasks.map((task) => { const steps = task.subtasks?.filter((step) => !step.deletedAt) ?? []; const done = steps.filter((step) => step.completedAt).length; const project = forge.workspace.projects.find((item) => item.id === task.projectId); return <button key={task.id} className="manager-queue-item" onClick={() => setSelected(task.id)}><span className="queue-project">{project?.icon}</span><span><strong>{task.title}</strong><small>{project?.name} · {labels[task.workStatus ?? 'needs-review']} · {task.handoff?.agent ?? 'Task'}{steps.length ? ` · ${done}/${steps.length} steps` : ''}{task.reviewAt ? ` · Check ${new Date(task.reviewAt).toLocaleString()}` : ''}</small></span><ChevronRight size={18} /></button> }) : <p className="manager-empty">Nothing in this queue.</p>}</div></details>}
    {(section === 'handoffs' || section === 'progress') &&
    <details className="connect-chats"><summary><Link2 size={17} />File-enabled chat setup</summary><p>Give Cowork or another file-enabled chat access to your dedicated Forgeboard Inbox, then give it this instruction once. The shared guide resolves project identities and separate reporting IDs for new chats. Existing tracked chats also have a “Copy folder setup” button in Project progress.</p><button className="secondary-button" onClick={async () => { try { await copy(chatPrompt); setCopied('Copied. Give this to each file-enabled chat once.') } catch { setCopied('Select and copy the prompt below.') } }}><ClipboardCopy size={15} />Copy setup prompt</button><p role="status">{copied}</p><textarea readOnly aria-label="Setup prompt for chats" value={chatPrompt} rows={7} /><a href={GUIDE} target="_blank" rel="noreferrer">Open shared handoff instructions</a><p className="helper-copy">The computer and desktop inbox bridge must be running to upload local files. The private vault processes uploaded files without the browser being open.</p></details>
    }
    {section === 'today' && <details className="manager-notifications"><summary><Bell size={17} />Reminder & AI settings</summary><p>Check-ins appear on launch and while open. Desktop notifications work while the app is running; this static app cannot guarantee alerts when closed.</p><button className="secondary-button" onClick={() => void enableNotifications()}>Enable open-app notifications</button><p role="status">{notifications}</p><p>For Claude, add <code>ANTHROPIC_API_KEY</code> under Actions secrets in your private vault. Never enter an AI key into the public app. Claude runs in the morning and after synced changes, subject to the configured cooldown.</p><a href={`https://github.com/${encodeURIComponent(forge.connection.owner)}/${encodeURIComponent(forge.connection.repo)}/settings/secrets/actions`} target="_blank" rel="noreferrer">Open private vault secrets</a><p className="helper-copy">The planner works without AI. API usage is billed by the provider separately from chat subscriptions.</p></details>}
    {reviewTask && <ReviewPanel key={reviewTask.id} forge={forge} task={reviewTask} onClose={() => setSelected(undefined)} />}
  </section>
}
