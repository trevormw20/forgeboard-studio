import { useState } from 'react'
import { Activity, Check, ClipboardCopy, Clock3, Pause, Play, Plus } from 'lucide-react'
import type { useForgeboard } from '../hooks/useForgeboard'
import type { AgentChat, AgentProgress } from '../types'
import { agentLabels, desktopChatPrompt, handoffForChat, progressLabels, projectProgress } from '../lib/coordination'

type Forge = ReturnType<typeof useForgeboard>

function ChatReportForm({ forge, chat, close }: { forge: Forge; chat?: AgentChat; close: () => void }) {
  const projects = forge.workspace.projects.filter((project) => !project.deletedAt)
  const [projectId, setProjectId] = useState(chat?.projectId ?? projects[0]?.id ?? '')
  const [name, setName] = useState(chat?.name ?? '')
  const [agent, setAgent] = useState<AgentChat['agent']>(chat?.agent ?? 'claude')
  const [status, setStatus] = useState<AgentProgress>(chat?.status ?? 'unknown')
  const [summary, setSummary] = useState(chat?.summary ?? 'Waiting for a status update from this chat.')
  const [nextAction, setNextAction] = useState(chat?.nextAction ?? '')
  return <form className="modal-form chat-report-form" aria-label="Chat status form" onSubmit={(event) => {
    event.preventDefault()
    forge.actions.saveChatReport({ id: chat?.id, projectId, name, agent, status, summary, nextAction })
    close()
  }}>
    <div className="form-grid"><label>Project<select required disabled={Boolean(chat)} value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Chat app<select value={agent} onChange={(event) => setAgent(event.target.value as AgentChat['agent'])}>{Object.entries(agentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>Chat name or role<input required maxLength={500} value={name} onChange={(event) => setName(event.target.value)} placeholder="Snail Mail · story planning" /></label>
    <label>Chat status<select value={status} onChange={(event) => setStatus(event.target.value as AgentProgress)}>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>What is happening?<textarea required maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    <label>Who acts next, and what should they do?<textarea maxLength={4000} value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="I need to review the first five images, then send feedback to Claude." /></label>
    <div className="review-actions"><button className="primary-button">Save chat status</button><button className="secondary-button" type="button" onClick={close}>Cancel</button></div>
    <small>This records a report. It does not connect to or control the chat window.</small>
  </form>
}

export function ProjectProgressPanel({ forge }: { forge: Forge }) {
  const [filter, setFilter] = useState('tracked')
  const [editing, setEditing] = useState<AgentChat | 'new'>()
  const [pasting, setPasting] = useState(false)
  const [raw, setRaw] = useState('')
  const [message, setMessage] = useState('')
  const [manualCopy, setManualCopy] = useState('')
  const projects = forge.workspace.projects.filter((project) => !project.deletedAt)
  const chats = forge.workspace.agentChats ?? []
  const events = forge.workspace.agentEvents ?? []
  const copy = async (text: string, success: string) => {
    try { await navigator.clipboard.writeText(text); setManualCopy(''); setMessage(success) }
    catch { setManualCopy(text); setMessage('Clipboard unavailable. Select and copy the text below.') }
  }
  const shown = projects.filter((project) => filter === 'all' || (filter === 'tracked' ? chats.some((chat) => chat.projectId === project.id) || Boolean(project.workState) : projectProgress(forge.workspace, project) === filter))
  return <section className="project-progress" aria-label="Project and chat progress">
    <div className="section-title"><div><p className="eyebrow">Who is doing what</p><h2>Project & chat progress</h2></div><Activity size={19} /></div>
    <p className="helper-copy">Desktop chats use reports and copy/paste handoffs—not a live connection. Your API key powers the manager’s brief, not the chat windows.</p>
    <div className="review-actions"><button className="secondary-button" onClick={() => setEditing(editing ? undefined : 'new')}><Plus size={15} />Track a chat</button><button className="secondary-button" onClick={() => setPasting(!pasting)}>Paste chat update</button></div>
    {editing && <ChatReportForm key={editing === 'new' ? 'new' : editing.id} forge={forge} chat={editing === 'new' ? undefined : editing} close={() => setEditing(undefined)} />}
    {pasting && <form className="modal-form chat-report-form" onSubmit={(event) => {
      event.preventDefault()
      try { setMessage(forge.actions.importChatUpdate(raw)); setRaw(''); setPasting(false) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read the update. Your saved work is unchanged.') }
    }}><label>JSON update from your chat<textarea required rows={7} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="Paste a Forgeboard JSON status or checklist, or an array containing both." /></label><label>Or choose its JSON file<input type="file" accept=".json,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 200000) { setMessage('File exceeds 200 KB.'); return }; setRaw(await file.text()) } }} /></label><button className="primary-button">Import update</button><small>Repeated imports do not duplicate tasks or reset checked steps. Connect GitHub to sync across devices.</small></form>}
    {message && <p className="helper-copy" role="status">{message}</p>}
    {manualCopy && <textarea className="manual-chat-copy" readOnly rows={8} aria-label="Chat message to copy" value={manualCopy} />}
    <div className="progress-filter"><label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="tracked">Tracked projects</option><option value="all">All projects</option><option value="waiting-on-me">Waiting on me</option><option value="waiting-on-agent">Waiting on other chat</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="paused">Paused</option><option value="done">Done</option></select></label><span>Last reported state · not live monitoring</span></div>
    <div className="progress-projects">{shown.map((project) => {
      const status = projectProgress(forge.workspace, project)
      const projectChats = chats.filter((chat) => chat.projectId === project.id)
      const tasks = forge.workspace.tasks.filter((task) => task.projectId === project.id && !task.deletedAt)
      const steps = tasks.flatMap((task) => task.subtasks?.filter((step) => !step.deletedAt) ?? [])
      const done = steps.filter((step) => step.completedAt).length
      return <article className="progress-project" key={project.id}>
        <header><span className="progress-icon" style={{ color: project.color }}>{project.icon}</span><div><h3>{project.name}</h3><span className={`work-status state-${status}`}>{status === 'done' ? 'Done' : progressLabels[status]}</span></div><label className="status-control">Project status<select aria-label={`Status for ${project.name}`} value={project.workState === 'unknown' ? '' : project.workState ?? ''} onChange={(event) => forge.actions.setProjectWorkState(project.id, (event.target.value || undefined) as AgentProgress | undefined)}><option value="">Automatic from reports</option>{Object.entries(progressLabels).filter(([key]) => key !== 'unknown').map(([value, label]) => <option key={value} value={value}>{value === 'done' ? 'Done' : label}</option>)}</select></label></header>
        <p className="checklist-measure">{tasks.filter((task) => task.completedAt).length}/{tasks.length} tasks finished{steps.length ? ` · ${done}/${steps.length} review steps checked` : ''}</p>{steps.length > 0 && <progress max={steps.length} value={done} aria-label={`Checklist progress for ${project.name}`} />}
        <div className="project-chat-list">{projectChats.length ? projectChats.map((chat) => {
          const latest = events.filter((event) => event.chat.id === chat.id).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
          const handoff = latest?.handoff ? latest : undefined
          const receipt = handoff && forge.workspace.relayReceipts?.find((item) => item.handoffId === handoff.id)
          return <div className="project-chat" key={chat.id}>
            <div className="chat-status-line"><strong>{chat.name}</strong><span className={`work-status state-${chat.paused ? 'paused' : chat.status}`}>{chat.paused ? 'Paused by you' : progressLabels[chat.status]}</span></div>
            <small>{agentLabels[chat.agent]} · Reported {new Date(latest?.at ?? chat.updatedAt).toLocaleString()}</small><p>{chat.summary}</p>{chat.nextAction && <p><strong>Next:</strong> {chat.nextAction}</p>}{chat.source && <p className="chat-source">Source: {chat.source}</p>}
            {handoff && <><div className="relay-state"><Clock3 size={14} />{receipt?.state === 'delivered' ? 'Handoff delivered; waiting for the next report.' : receipt ? `Handoff ${receipt.state}: ${receipt.detail}` : 'Handoff ready. Copy it to the next chat, or use a separately configured CLI relay.'}</div><button className="secondary-button" onClick={() => void copy(handoffForChat(forge.workspace, handoff), 'Handoff copied. Paste it into the intended chat and attach the listed files if needed.')}><ClipboardCopy size={14} />Copy peer handoff</button></>}
            <div className="chat-controls"><button className="text-button" onClick={() => setEditing(chat)}>Update status</button><button className="text-button" onClick={() => void copy(desktopChatPrompt(chat, project.name), 'Setup copied. Paste it once into this working chat.')}>Copy chat setup</button><button className="text-button" onClick={() => forge.actions.setChatPaused(chat.id, !chat.paused)}>{chat.paused ? <Play size={13} /> : <Pause size={13} />}{chat.paused ? 'Allow future handoffs' : 'Pause future handoffs'}</button></div>
          </div>
        }) : <p className="helper-copy">No chat tracked yet. Use “Track a chat” to add its name and current status.</p>}</div>
      </article>
    })}</div>
    {!shown.length && <p className="helper-copy">No projects match this view. Track a chat or select “All projects.”</p>}
    <p className="helper-copy"><Check size={13} /> “Part done” means the chat finished its part—not the entire project. Pausing stops future relay deliveries; it does not interrupt a running turn.</p>
    <details className="relay-help"><summary>Can the chats talk automatically?</summary><p>Existing Claude and ChatGPT desktop conversations are manual handoffs here. They do not become controllable through an API key. Chats with GitHub access can publish their files directly; otherwise paste their JSON updates above.</p><p>A separately configured local companion supports exact Codex/Claude Code CLI sessions, not those desktop conversations. It is optional and not enabled by default. API-connected workers would be separate conversations with their own context and usage costs.</p><a href="https://github.com/trevormw20/forgeboard-studio/blob/main/AGENT_COORDINATION.md" target="_blank" rel="noreferrer">Handoff formats and optional relay limits</a></details>
  </section>
}
