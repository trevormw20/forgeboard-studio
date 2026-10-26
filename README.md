# Forgeboard

Forgeboard is the single project manager for work across coding agents and desktop chats. Top tabs separate Today, All tasks, Project progress, From chats, and Checkpoints. Today keeps a small plan, reminders, and factual wins in focus; other work is saved in its own view. Cowork with folder access can save handoffs into a local desktop inbox; the bridge privately uploads them and Haiku summarizes them automatically. Save a standing instruction to read the inbox's shared guide. New reporting identities register automatically; **Track a chat → Copy folder setup** is optional for an already tracked identity, not a prerequisite for each new chat. [Desktop inbox setup](DESKTOP_INBOX.md) · [Coordination guide](AGENT_COORDINATION.md) · [Shared handoff protocol](FORGEBOARD_HANDOFF.md). Regular chats without file access retain manual JSON import.

Each agent can append the protocol to that project's AGENTS.md and CLAUDE.md with `node scripts/forgeboard-handoff.mjs install --project ABSOLUTE_FOLDER`; existing instructions are preserved. Agents publish one private inbox file per meaningful handoff and can read the project's current checked/blocked steps with `status --project NAME`. The app never silently reads other chats.

Claude is configured only as `ANTHROPIC_API_KEY` in the private vault's GitHub Actions secrets. The existing OpenAI configuration is a backup when Claude isn't configured or its request fails. Each configured provider gets at most one attempt per eligible refresh. A built-in plan works without either. Safe provider diagnostics appear below the brief; no raw API error bodies or credentials are copied into the workspace. Notifications are visible or best-effort while open; no email or guaranteed closed-app push.

If the Claude key is not scoped to one workspace, also add private Actions secret `ANTHROPIC_WORKSPACE_ID` with its ID from [Claude Console → Workspaces](https://platform.claude.com/settings/workspaces). The backend sends the required workspace header. A workspace-scoped key does not need this extra value. [Official authentication reference](https://platform.claude.com/docs/en/manage-claude/authentication#select-a-workspace). Run the private **Check private Claude connection** workflow to test with no planner content. The normal private studio workflow uses OpenAI backup until Claude is ready.

Forgeboard is a deadline-first, mobile-first game development planner. The public app is a static installable PWA. Planner state lives in one JSON file in a separate private GitHub repository and syncs through the GitHub Contents API.

## Personal Notes

Android users can also install the native **Forgeboard Notes** companion with real home-screen widgets. It shares this app's private GitHub vault and opens a notes-only editor. [Download and Android setup](android/README.md).

Choose **Personal notes** in the sidebar (or **Notes** on a phone). Each active Forgeboard project automatically has its own notebook, plus General notes. Switch projects inside Notes using the notebook picker or project chips. **Add project notes** creates a real project; its notebook appears automatically.

Notes are checklist-first cards with custom colors, custom colored labels, pinning, and a left-sidebar search across every project. Search matches titles, optional details, and checkbox text; results identify their notebook and reopen the original note without moving it. Start typing a list name in **Start a checklist** to create a note immediately—no New note click or Enter required to save. Enter starts the first checkbox. All new notes and sub-notes default to checklists; existing longer text remains available under optional details. Breadcrumbs show nested whole notes. Edits use the same offline queue and private GitHub workspace as tasks; connect GitHub before expecting a note on another device.

Titles, note text, and existing checklist text save after a one-second typing pause, with a five-second safety save during continuous typing. Leaving a note or backgrounding the app also flushes the latest edits. **Close** only closes the editor; it is not a save button. Checkmarks save immediately. A browser warning protects edits if you refresh or close before saving finishes; stay on the page until saved. If device storage fails, keep the tab open and use **Retry save**. GitHub syncing checks every 15 seconds while visible, on return/reconnect, or with **Sync now**; local saving and GitHub synchronization have distinct status.

Each main checklist group has its own **Add item** button immediately beneath its last descendant. Clicking creates and focuses a child of that main group, even when the preceding row is a sub-sub-item. **Add main item** starts another group. Groups can collapse and reopen; checking a main item never checks its children or prevents further edits. Slide the dotted handle to indent/outdent, Enter creates a sibling, and Tab/Shift+Tab changes level. Options also offers sub-items and reordering. Deleted groups have Undo and persistent Restore. Checklist edits merge by stable item and field, not by replacing the whole list.

Deleting a note moves its existing sub-note group into Recently deleted; Undo or Restore returns it without removing other saved work. Conflicting edits retain both snapshots in **Saved conflict copies**, where either version can be recovered as a separate note. Personal Notes and labels are not included in AI summaries or automatic task routing. They are separate from Quick capture, which creates tasks.

## Incoming updates and unread notifications

The left-side **Notifications** light and top-bar bell stay highlighted until you check the feed or the specific update. Newly synchronized reported completions, requests for review, blockers and handoffs show a small in-app popup; dismissing or letting it expire does not mark it read. Opening a linked checklist takes you directly to its original checkable review steps. Read receipts synchronize through the same private workspace across devices.

Claude's existing private Haiku summaries add **Needs you** and **Next step** to incoming handoffs. One file stays one notification card as its summary arrives; retries do not create repeated work. Startup history does not flood the screen with popups. No personal notes or notification-read receipts are sent to AI. No AI request is made per keystroke or poll. Automatic updates depend on source-file delivery, private Actions processing and the visible app's 15-second sync; they are near-live, not a direct connection to chat windows or guaranteed closed-app push.

Authenticated ETags and unchanged-file SHA caches avoid re-downloading historical inbox records. Rate-limit responses pause network requests while local autosave continues. See [GitHub's polling guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

## Automatic chat submissions

Other chats can leave separate `forgeboard-task` JSON files in `data/task-inbox/` in the private vault. Forgeboard imports them on launch, foreground return, reconnect, and periodic sync. Each file becomes one dated task with nested checkable subtasks. Stable submission IDs prevent duplicates and preserve completion. See `templates/chat-submission.example.json` and `scripts/publish-task-inbox.ps1` to publish locally saved files. The Today screen reports inbox results and invalid files.

## Security boundary

- This public repository contains app code only—never planner data, access tokens, Gmail credentials, or OpenAI keys.
- Planner records live in `data/workspace.json` in the private `forgeboard-studio-vault` repository.
- The browser GitHub token is device-specific. By default it stays only in memory for the page session; “Remember token” stores it in the browser’s IndexedDB device cache.
- OpenAI and Claude credentials belong only in the private vault repository’s GitHub Actions secrets. No email integration is used.
- The OpenAI API is billed separately from ChatGPT subscriptions.

## Connect a device

1. Open the deployed Pages app and choose **Data connection**.
2. Enter owner `trevormw20`, repository `forgeboard-studio-vault`, branch `main`, and path `data/workspace.json`.
3. Create a fine-grained GitHub personal access token. Select only the private vault repository and grant **Contents → Read and write**.
4. Enter the token directly in the app. Do not paste it into chat or commit it.
5. Choose **Save and test**. Repeat on each desktop or phone.

If the token expires, create and enter a replacement. A 30-day expiration is not permanent setup; use a longer expiration if appropriate while keeping repository access narrowly limited.

## Local checks

```bash
npm ci
npm test
npm run lint
npm run build
```

The GitHub Pages workflow runs tests and the production build before every deployment.

Forgeboard is a general project tracker, not a HIPAA-certified system. Do not store patient-identifying or regulated health data here without a separate compliance and security review.
