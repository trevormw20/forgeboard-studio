# Project status and agent-to-agent handoffs

Forgeboard tracks each project's overall state separately from each chat's reported state. A chat finishing its part is not completion of the whole project. States: `unknown`, `in-progress`, `waiting-on-me`, `waiting-on-agent`, `paused`, `blocked`, and `done` (this chat's part).

## Current setup: Claude and ChatGPT desktop conversations

The owner uses Cowork with folder access as well as desktop conversations. No conversation URL is needed. Cowork can save directly to the dedicated [desktop inbox](DESKTOP_INBOX.md); this automates reporting INTO Forgeboard, not delivery of messages into existing chat windows. An API key does not control those windows.

1. Start the desktop inbox bridge, grant access to the dedicated inbox, and save a standing instruction to read FORGEBOARD_INSTRUCTIONS.md. That private local guide supplies verified project bindings and automatic new-chat identity rules. Copy folder setup is optional when linking an already tracked identity; new valid status reports register their own chats automatically. Do not copy one conversation's ID into shared/global instructions.
2. After meaningful work, the chat SAVES a JSON or structured Markdown file directly into that folder. Include status and, when human review is needed, one parent task with nested individually checkable steps. The bridge uploads it privately. Private Actions imports it and generates one Haiku summary per handoff; Forgeboard downloads results on sync. No repeated copy/paste is needed for file-enabled chats.
3. Chats with GitHub access may still publish individual JSON files directly to the private inbox. Regular chats without file access need a download/manual JSON import. Never pretend a local save proves remote publication. Computer and bridge must stay on to upload; uploaded files can process with the browser closed.
4. Copy an explicit peer handoff into the intended other conversation and attach the listed Markdown files if that conversation cannot read the folder. Updating a report does not prove the other conversation ran. Existing review checkmarks are never reset by re-importing a submission.

Desktop providers use `agent: "claude"` or `"chatgpt"`; coding providers use `"codex"` or `"claude-code"`. Stable chat IDs keep project histories separate. Statuses can also be updated manually. The overall project status remains independent of any one chat finishing its part.

For initial setup without inventing chat identities or tasks, a private inbox file may contain `{ "format": "forgeboard-project", "version": 1, "id": "unique-registration-id", "at": "CURRENT_ISO_TIMESTAMP", "project": "Exact project name", "color": "#a78bfa", "icon": "📁" }`. This registers a missing project as not reported yet. Re-import never overwrites an existing project's settings. These setup records belong in the private vault, not the public app repository.

The optional companion below is for actual CLI sessions only. It is not installed or enabled for the owner's desktop conversations. Fully API-driven workers would be separate sessions requiring their own context, limits, and explicit setup—not a silent link to existing chats.

## Report status

At a meaningful start, blocker, pause, or completion, save one immutable status report through the desktop inbox or publish JSON with `scripts/forgeboard-handoff.mjs publish --file FILE`. Use the SAME PROJECT ID across agents, but a SEPARATE reporting ID for EACH conversation. Use its verified native thread ID when available or generate a UUID-based reporting ID; this is not a claim about a native platform identity. First status import registers it. Do not demand a manual existing-chat mapping before saving. If chat tracking is unavailable, a task-only report needs no chat ID. Don't infer another chat's progress from idle UI. Report facts and identify the next owner. Use current timezone-aware timestamps; each event gets a new submission id.

```json
{
  "format": "forgeboard-status",
  "version": 1,
  "id": "tactics-art007-ready-20261021",
  "project": "Tactics game",
  "at": "2026-10-21T12:00:00-06:00",
  "chat": { "id": "tactics-codex-art", "name": "Art producer", "agent": "codex", "source": "Actual task title or source reference" },
  "status": "waiting-on-agent",
  "summary": "ART-007 output and report are ready for director review.",
  "nextAction": "Claude reviews the report and updates the queue.",
  "handoff": {
    "toChatId": "tactics-claude-director",
    "instruction": "Read the report, verify the delivered work, and record approval or numbered revisions in the existing project board.",
    "files": ["production/BOARD.md", "production/CODEX_QUEUE.md", "production/jobs/ART-007_tree-courtyard-01/REPORT.md"],
    "chainId": "tactics-art007",
    "hop": 0
  }
}
```

Use actual evidence, not this example as a claim of completed work. Omit `handoff` for a simple status report. A human review still uses the checklist format in [FORGEBOARD_HANDOFF.md](FORGEBOARD_HANDOFF.md); status events do not add task-list entries or check human steps off. Human approval gates in the project's own workflow remain in effect.

## Automatic delivery needs a running companion

The static Pages app and a Claude API key cannot themselves type into an existing Codex or Claude Code window. The provided local relay resumes a specifically configured **CLI session** with a bounded prompt and approved Markdown context. It requires native Codex/Claude Code CLI installation and login on that machine, exact session IDs, and access to the private vault. Do not assume a desktop task or its graphics tools are CLI-compatible. For Codex desktop-only tasks, use the app's native task-messaging tools from an authorized coordinator instead of substituting a new CLI session.

Official command behavior: [Codex non-interactive sessions](https://developers.openai.com/codex/noninteractive/), [Claude Code programmatic use](https://code.claude.com/docs/en/headless).

Store a configuration such as `pair.relay.local.json` outside public Git history. The local-only suffix is ignored in this repo. Set it up for the exact pair and scope you want; do not insert API keys. Example:

```json
{
  "enabled": false,
  "repository": "trevormw20/forgeboard-studio-vault",
  "maxHops": 4,
  "maxPerDay": 6,
  "claudeBudgetUsd": 2,
  "routes": [{
    "enabled": false,
    "project": "Tactics game",
    "fromChatId": "tactics-codex-art",
    "toChatId": "tactics-claude-director",
    "provider": "claude-code",
    "sessionId": "EXACT_EXISTING_SESSION_ID",
    "cwd": "ABSOLUTE_PROJECT_FOLDER",
    "scope": "Review the assigned art report and update the production board. Preserve existing approval gates.",
    "allowedFiles": ["production/BOARD.md", "production/CODEX_QUEUE.md", "production/jobs/ART-007_tree-courtyard-01/REPORT.md"]
  }]
}
```

Each direction has its own route and exact target session. Change both `enabled` fields only for a concrete authorized route. An optional `executable` can specify the installed native CLI path. No shell command strings or arbitrary executable templates are accepted.

```text
node scripts/forgeboard-relay.mjs --config ABSOLUTE_LOCAL_CONFIG
node scripts/forgeboard-relay.mjs --config ABSOLUTE_LOCAL_CONFIG --run
node scripts/forgeboard-relay.mjs --config ABSOLUTE_LOCAL_CONFIG --run --watch
```

The first command is a dry run. `--run` performs delivery; `--watch` checks every 30 seconds for at most one hour. No watcher is silently installed. Keep the computer and companion running. Code sessions still need their ordinary permissions and tools; the relay never uses permission-bypass flags. The Claude spend cap is a client-side limit, not a guaranteed invoice cap.

## Delivery guarantees and stops

- Only explicit matching routes can dispatch. A stale event older than 48 hours, an unfinished source, a paused/done project, a paused chat, a target reported in progress, or a human blocker stops that delivery.
- The relay reads only relative, route-approved `.md` paths, checks their resolved paths stay inside the configured project, and limits context size. File content does not authorize expanding work or messaging different destinations.
- GitHub claims each event before dispatch. A separate target-session lock prevents two relay processes from resuming the same target concurrently. Claims, results, and errors are visible in Forgeboard after sync.
- Default limits: four hops per chain, six claims per UTC day, two deliveries per pass, ten minutes per turn, and twelve Claude turns. A peer reply retains the same chain id and increments the hop. A new real job can start a new chain; the daily cap still applies.
- A successful CLI turn records **delivered**, not **project done**. The next agent must report its own outcome.
- Interrupted or uncertain delivery is never automatically retried. Its receipt becomes `needs-check`; a crash may leave `claimed`. Inspect the target before retrying. The lock is retained on uncertain results. After verifying the target is idle, a human can remove that specific lock in the private `data/relay-locks/` folder and deliberately submit a new event id. Existing receipts remain for audit.
- Pause controls affect future delivery, not a turn already running. Stop the companion to end watching. Do not run the same target manually and through the companion simultaneously.

## Initial scope

The owner requested Snail Mail and Tactics game first, with Soleivar, Hiderm, and Casedoku Manor available too. Register the real chat IDs and Markdown sources for each pair; do not guess sessions from similar names. Claude's API brief organizes progress and experiment evidence, but it cannot claim an agent run happened without a delivery receipt and status report.
