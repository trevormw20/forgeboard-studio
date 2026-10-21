# Forgeboard handoff protocol for Codex and Claude Code

Forgeboard is the owner's single project manager. Preserve human review and unfinished work across long conversations and across agents.

For ordinary Claude or ChatGPT desktop conversations without project-folder/GitHub access, use **Track a chat → Copy chat setup** in Forgeboard, then paste the returned JSON update into **Paste chat update** (or select its JSON file). A JSON array can include both status and review-task objects. Never claim automatic publishing or access to another desktop conversation. See [desktop coordination](AGENT_COORDINATION.md#current-setup-claude-and-chatgpt-desktop-conversations).

For chat progress and paired agent work, also read [AGENT_COORDINATION.md](AGENT_COORDINATION.md). Publish a status event when starting work, waiting on a human/peer, blocked, paused, or finishing your part. Request a peer handoff only for an explicitly configured route; retain approval gates and report what is actually finished.

## One-time instruction

When the user asks you to use this protocol, keep a short reference to it in this project's `AGENTS.md` (Codex) and/or `CLAUDE.md` (Claude Code), preserving existing instructions. Don't alter global instructions or other projects. If asked to install both, the helper supports:

```text
node "C:/Users/maker/Documents/Codex/game develop schedualer/forgeboard-studio/scripts/forgeboard-handoff.mjs" install --project "ABSOLUTE_PROJECT_FOLDER"
```

## At each meaningful handoff

1. Read this project's current Forgeboard checklist before proposing follow-up work. Use the status helper below. If access fails, say so and rely on the user's explicit report; never invent completion.
2. When you finish changes that need the owner's tests, review, decision, or later check-in, write one separate `forgeboard-task` version 1 JSON file. Include the exact project name or id shared by both agents, today's real local calendar date, a short parent summary, and individually verifiable subtasks. A review is **not** complete because the code was changed.
3. Include `handoff`: agent (`codex`, `claude-code`, or `other`), `completedWork` (what you actually finished), `review` (what the human should inspect and expected result), and `resume` (exact next action or where to find the build). `source` can identify the chat, branch, commit, or artifact. Do not embed credentials or signed links.
4. Give each file a unique stable id. Retry the same content/id after an uncertain publish. For new work, use a new id. Set `relatedSubmissionId` when continuing a prior handoff. Never replace or remove previous uncompleted steps. Do not publish another checklist just to restate the same open work.
5. Estimate the HUMAN review effort in `estimateMinutes` (1–480). Optional `reviewAt` is a real ISO date/time with timezone, only when a check-in was requested or agreed. Do not manufacture deadlines. Keep medium priority unless evidence supports another value.
6. Publish only this file to `data/task-inbox/<id>.json` in private `trevormw20/forgeboard-studio-vault`, branch `main`. Use existing authorized GitHub CLI/API or an isolated Git checkout. Never directly overwrite `data/workspace.json`. Never store planner data in the public app repository.
7. Confirm the committed file exists. In your reply, state what needs the human, the parent summary, and whether publishing succeeded. On failure, keep the local file and name the access problem. Do not claim the app was updated merely because a local file exists.

## Helper commands

Works from Codex, Claude Code, Windows, macOS, or Linux with Node and an authenticated GitHub CLI. Adjust the script location on another computer; its public source is in this repository.

```text
node "C:/Users/maker/Documents/Codex/game develop schedualer/forgeboard-studio/scripts/forgeboard-handoff.mjs" status --project "Count on Chaos"
node "C:/Users/maker/Documents/Codex/game develop schedualer/forgeboard-studio/scripts/forgeboard-handoff.mjs" publish --file "ABSOLUTE_SUBMISSION_JSON"
```

Use `--repo owner/private-vault` only if the user uses another vault. The helper never asks for a token in chat. An expired login is repaired through `gh auth login` on that machine, with access to the private vault. Use one shared project id when names are ambiguous.

## File example

```json
{
  "format": "forgeboard-task",
  "version": 1,
  "id": "count-on-chaos-2026-10-20-build-review-01",
  "project": "Count on Chaos",
  "date": "2026-10-20",
  "summary": "Review the updated demo build",
  "board": "myTodo",
  "priority": "medium",
  "estimateMinutes": 20,
  "handoff": {
    "agent": "claude-code",
    "source": "Describe the actual branch, commit, build, or chat",
    "completedWork": ["Describe only changes actually finished"],
    "review": "Test the changed flow and check the expected result in each step.",
    "resume": "Open the updated build; start with the first unchecked step."
  },
  "subtasks": [
    { "id": "start", "title": "Launch the demo and verify the menu opens without an error" },
    { "id": "play", "title": "Play one run and verify the changed flow behaves as described" },
    { "id": "feedback", "title": "Record any errors and send the results back to the working chat" }
  ]
}
```

This is an example, not a claim that a real build was changed. Use actual evidence from your task. Each file supports 1–200 steps, at most 200 KB. The old checklist-only format is still accepted.

## When the user reports a failure

Honor the user's checked steps and recorded errors. Fix the reported problem, retain the still-unchecked work, and submit only genuinely new review work as a related handoff. The app's **Copy feedback for chat** includes completed, blocked, and remaining steps. Publishing a fix never automatically checks human tests off.

## What this automates

Once published, the app imports on launch, on return, and during sync. It does not silently read chat histories. A protocol reference must be present in each project's agent instructions for future sessions to follow it. Existing chats must receive the setup prompt or be told to read the updated instructions. Shared project code does not itself share conversation context.

The owner can set reminders, park work, choose a light day, and copy review results back. No email is used. Static-app notifications are best-effort while open; closed-app push reminders are not promised.
