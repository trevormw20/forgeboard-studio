# Notes 0.2: quick entry, voice, and shared lists

The Pages app and private planner vault still work as before. Update the existing Android app by installing **Forgeboard-Notes.apk over it**; do not uninstall (unsynced offline notes would be lost). **Niki-Notes.apk** installs separately with its own application ID and encrypted cache.

## Three spaces under the same GitHub account

| Space | Private repository | Who should have its token |
| --- | --- | --- |
| Your private planner/notes | `trevormw20/forgeboard-studio-vault` | You only |
| Niki's private notes | `trevormw20/forgeboard-niki-notes-vault` | Niki's app |
| Shared lists | `trevormw20/forgeboard-family-notes-vault` | Both apps |

Each uses `main` and `data/workspace.json`. These are distinct repositories, not hidden filters inside your planner. The account owner can read all three. Niki is a separate app profile, **not an independent GitHub sign-in**. Never give Niki a token that can access your full planner vault. GitHub tokens grant repository access, not just a visible list.

1. For Niki, create a fine-grained token owned by `trevormw20`, selecting **only** `forgeboard-niki-notes-vault` and `forgeboard-family-notes-vault`; set Contents → Read and write. Enter it on her phone in **••• → Private vault connection**, using the prefilled personal vault. Do not send it in chat or add it to source code.
2. Tap **Shared lists →**, then connect its prefilled shared vault. The same limited token can be entered there too. Connections and offline outboxes are separately encrypted; switching spaces never copies private notes.
3. In your Forgeboard Notes app, connect Shared lists with a token scoped to the shared repository (or your own token selecting your private and shared repositories). Keep your existing private connection.
4. Open a private note and tap **Share this list**. Confirm which content will be copied. Only that note's title, text and active checklist are shared—not sub-notes, other projects, labels, deleted rows or conflict copies. Re-sharing that same source opens its existing shared copy rather than overwriting it.
5. Make future shared edits in **Shared lists**. The old private original remains private and is **not** a live mirrored copy. Both apps read/write the same shared workspace and preserve conflicting edits as recoverable versions.

Token expiry still applies. Replace an expired token on each phone. Default home-screen widgets currently display **personal** notes only; open Shared lists in the app for household lists. Your browser planner does not automatically load this separate shared vault.

## Voice, with review

Tap **Voice note** for a new note, or **Voice** inside a current list. Android's selected speech service transcribes your speech; offline recognition is requested, but the provider may use its network. Forgeboard does not upload audio. You can instead type or use your keyboard microphone.

**Organize with Claude** sends only this transcript through your personal private vault to Claude Haiku. Ordinary notes and planner data are not sent. The API key stays in GitHub Actions; it is never in the APK or browser. Your original transcript and editable review are encrypted on the device. A pending request can be retried after reconnecting without adding duplicate checkboxes. GitHub Actions is a queue, not instant processing; results may take minutes. The app checks while this screen is open and resumes checking when you return.

Edit the returned review, then tap **Approve & add checkboxes**. One line is one item; two leading spaces make a sub-checkbox, four make a sub-sub-checkbox. The destination label identifies the original note and space of a resumed draft; uncheck the current-note option to create a new one instead. Nothing is checked off automatically. Changes you make to the review while Claude works are not overwritten. If AI is unavailable, **Review without AI** conservatively splits explicit lines/semicolons and keeps meaning; it is not presented as Claude cleanup.

The existing planner vault already has its own API secret. To enable Claude for **Niki**, add `ANTHROPIC_API_KEY` as a **repository Actions secret** in [Niki’s vault settings](https://github.com/trevormw20/forgeboard-niki-notes-vault/settings/secrets/actions) (not an environment named after the key). If that key is not workspace-scoped, also add `ANTHROPIC_WORKSPACE_ID`, as in your existing planner vault; the workflow supports it. GitHub cannot copy a stored secret value to another repository. Do not put the key in the shared vault or either app. `ANTHROPIC_VOICE_MODEL` is an optional repository variable; default `claude-haiku-4-5`. API usage is billed separately. The workflow template is `docs/voice-cleanup-workflow.yml`; it belongs only in private personal vaults as `.github/workflows/voice-cleanup.yml`.

Explicitly submitted transcripts and results are stored in the private repo's `data/voice-inbox/` and `data/voice-results/`. They remain there (and in Git history); this feature does not claim permanent erasure. Do not dictate passwords, access tokens or sensitive health information. It is not a compliance-certified system.

## Checklists

The small plus appears at the end of each parent’s existing nested group. It appends and focuses a child in that group. The main Add remains at the end of the whole list. Enter/Next saves the current text and focuses the next sibling; it **does not mark the current checkbox complete**. Actual checkmarks remain independent at every level.

## Owner checks after installation

- On your physical phone, speak a rough list, request Claude cleanup, review the result, append to a current note, then try a new note. Confirm the original transcript survives closing/reopening before approval.
- Connect Niki's and Shared lists with the limited tokens above. A personal test note must not appear in Shared lists or your private vault.
- Create one shared test list on one phone, Sync, then Sync the other. Edit different rows on both and confirm both edits survive. Niki must not be given access to your planner repository.
- Home-screen widgets remain personal; test your existing widget after updating without uninstalling.
