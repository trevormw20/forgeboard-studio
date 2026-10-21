// This entry is bundled for the desktop bridge and private automation. Keep one
// importer so browser and background checklists use identical IDs and rules.
export { importSubmissions, parseSubmission } from './taskInbox'
export { parseCoordination } from '../../shared/coordination.mjs'
