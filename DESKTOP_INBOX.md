# Desktop folder → private vault → Haiku → Forgeboard

The Pages app and cross-device vault remain unchanged. The local companion adds automatic handoffs from Cowork or other chats that can save files. A static site cannot silently read arbitrary Windows folders by itself.

## Owner setup

Run `node scripts/forgeboard-desktop.mjs start`. The default inbox is **Forgeboard Inbox** next to the public app checkout, never inside it. On this machine, the parent folder also has Start Forgeboard, Stop Forgeboard Inbox, and Forgeboard Inbox Status `.cmd` launchers. Start opens the existing Pages app; `--no-open` starts only the bridge. Restart after reboot; no automatic login startup is installed.

Grant Cowork only that dedicated inbox folder and save a standing instruction to read FORGEBOARD_INSTRUCTIONS.md. The private local guide contains verified project mappings. Each new conversation can use its own verified native thread ID or generate a UUID reporting ID; its first valid status report registers it automatically. Reuse an existing supplied ID only for that same conversation. **Track a chat → Copy folder setup** is optional, not required for every new chat. Task-only reports need no chat ID. Existing project access is independent of inbox access. Regular chats without file access still need a file download/manual import. Changing a local CLAUDE.md does not edit account-level Claude UI instructions; save the short launcher there once if that is the desired scope.

```text
node scripts/forgeboard-desktop.mjs start
node scripts/forgeboard-desktop.mjs status
node scripts/forgeboard-desktop.mjs stop
```

Optional `--folder ABSOLUTE_FOLDER --repo OWNER/PRIVATE_VAULT` must refer to a dedicated inbox and PRIVATE vault. Do not reuse one inbox for different repositories. GitHub CLI must be installed and authenticated with access to the vault; no token or AI key is placed in arguments or files. The existing browser uses its own fine-grained data-vault token as before.

## File contract and safety

Top-level `.json` and structured `.md` files under 200 KB, one project per file. JSON accepts original `forgeboard-task`, `forgeboard-status`, and `forgeboard-project` objects, or 1–25 objects in an array. Markdown frontmatter needs `forgeboard: 1`, `id`, `project`, `date`; heading is summary; unchecked boxes become nested review checks. Include `chat_id`, `chat_name`, `agent`, `status`, and `next_action` for chat progress. The inbox guide has a full example. README.md and FORGEBOARD_INSTRUCTIONS.md are ignored. Subfolders, symlinks and relay receipts are not imported by the desktop watcher.

Files must settle before sending. Writes are one non-forced fast-forward commit per file; stale heads are retried against the latest tree without replacing workspace.json or unrelated files. Submission IDs are immutable. Re-saved identical files are deduplicated by semantic content. Different content under an existing ID is rejected. Original files remain even after success. Offline work retries with bounded backoff. `_bridge/receipts.json`, `status.json`, and `bridge.log` expose local delivery/errors. No other folders are watched. Possible credential patterns are rejected as a best-effort guard, not a guarantee; never submit secrets.

Private Actions imports files while the browser is closed and requests one Haiku summary per grouped handoff. The UI shows pending/fallback states honestly; only successful Anthropic calls say Haiku summary. Original checks remain independent. Polling every 30 seconds while visible downloads remote state without writing no-op commits.

## Private automation and costs

Deploy private `studio-automation.yml`, `automation/inbox-core.mjs`, and `handoff-summaries.mjs`. Set `ANTHROPIC_API_KEY` and, when required, `ANTHROPIC_WORKSPACE_ID` in PRIVATE Actions secrets. No additional key is needed on the desktop. Optional repository variable `ANTHROPIC_SUMMARY_MODEL` must identify a Haiku model; default is pinned `claude-haiku-4-5-20251001`. `FORGEBOARD_SUMMARY_BATCH_LIMIT` defaults 5 (max10), `FORGEBOARD_SUMMARY_DAILY_LIMIT` defaults40 (max100). These cap incoming-summary requests, not the separate manager brief or provider billing.

Max900 output tokens per summary, bounded report context and45-second timeout. Up to3 attempts per handoff; eligible failures retry on later inbox/morning/manual runs, not a costly constant polling workflow. Fresh backlog can self-dispatch bounded summary-only batches. Quota-exhausted items wait for a later run. Missing credentials/API failures never block original task import. Set provider spending limits separately; API usage is billed independently of chat subscriptions.

This does not control existing Claude/ChatGPT windows, message peers, grant folder permissions, or replace human approval. The optional CLI relay remains separate and disabled by this setup.

## Maintaining the shared importer

`npm run build:inbox` bundles the exact browser validators/importer to `runtime/inbox-core.mjs` with Vite. Copy that generated file to private `automation/inbox-core.mjs` whenever importer/coordination logic changes. Compare hashes and run both test suites before release. The runtime contains public code only, never planner data or credentials. Private saving replays the exact validated inbox snapshot onto the latest remote workspace before applying AI-owned fields; it never replaces the task collection with a stale generated snapshot.
