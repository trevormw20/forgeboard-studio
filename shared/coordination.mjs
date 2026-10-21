export const progressStates = ['unknown', 'in-progress', 'waiting-on-me', 'waiting-on-agent', 'paused', 'blocked', 'done']
const idOkay = (value) => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,120}$/.test(value)
function text(value, max = 2000) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max }
function iso(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) }
export function parseCoordination(value) {
  if (!value || value.version !== 1 || !idOkay(value.id) || !iso(value.at)) throw new Error('Invalid coordination id, version, or timestamp.')
  if (value.format === 'forgeboard-project') {
    if (!text(value.project, 500) || (value.color !== undefined && !/^#[0-9a-f]{6}$/i.test(value.color)) || (value.icon !== undefined && !text(value.icon, 16))) throw new Error('Invalid project registration.')
    return value
  }
  if (value.format === 'forgeboard-relay-result') {
    if (!idOkay(value.handoffId) || !['claimed', 'delivered', 'failed', 'needs-check'].includes(value.state) || !text(value.detail)) throw new Error('Invalid relay receipt.')
    return value
  }
  if (value.format !== 'forgeboard-status' || !text(value.project, 500) || !value.chat || !idOkay(value.chat.id) || !text(value.chat.name, 500) || !['codex', 'claude-code', 'claude', 'chatgpt', 'other'].includes(value.chat.agent) || !progressStates.includes(value.status) || !text(value.summary, 4000)) throw new Error('Invalid chat status event.')
  if (value.nextAction !== undefined && !text(value.nextAction, 4000)) throw new Error('Invalid next action.')
  if (value.chat.source !== undefined && !text(value.chat.source, 4000)) throw new Error('Invalid source.')
  if (value.handoff) {
    const h = value.handoff
    if (!idOkay(h.toChatId) || !idOkay(h.chainId) || !Number.isInteger(h.hop) || h.hop < 0 || h.hop > 100 || !text(h.instruction, 4000)) throw new Error('Invalid handoff destination or chain.')
    if (!['done', 'waiting-on-agent'].includes(value.status)) throw new Error('Only completed agent work can request a peer handoff.')
    if (!Array.isArray(h.files) || h.files.length > 8 || h.files.some((file) => typeof file !== 'string' || file.length > 250 || !file.endsWith('.md') || file.startsWith('/') || file.includes('\\') || file.split('/').some((part) => !part || part === '..' || part === '.') || /^[a-z]:/i.test(file))) throw new Error('Handoff files must be relative Markdown paths inside the project.')
  }
  return value
}
