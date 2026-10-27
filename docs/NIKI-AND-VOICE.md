# Notes 0.3: one-stop voice, Niki notes, and shared lists

The Pages app and private planner vault still work as before. Update the existing Android app by installing **Forgeboard-Notes.apk over it**; do not uninstall (unsynced offline notes would be lost). **Niki-Notes.apk** installs separately with its own application ID and encrypted cache.

Use the [direct installer page](https://trevormw20.github.io/forgeboard-studio/downloads/) instead of GitHub release downloads. The same signed files are available directly, with no release page or login. If a phone browser still stalls, copy the APK from your computer by USB and open it from the phone’s Files app. Keep Android security protections enabled.

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

## Voice: tap, speak, Stop

Tap **Voice note** to start listening immediately for a new checklist, or **Voice** inside an existing list to append there. Speak naturally, then tap **Stop**. The transcript goes to Claude Haiku and its organized checklist is added automatically. There are no separate Speak, Organize, or Approve steps. Android asks for microphone permission on first use; the app cannot skip that system permission.

The Stop button stays at the bottom of the screen, even for a long recording. Pauses in speech do not submit the capture. Cancel, or leaving before Stop, does not send it to Claude. Android's on-device recognizer is preferred when available; the fallback speech provider may use the network. Forgeboard never uploads audio. Only this explicitly stopped transcript goes through your personal private vault to Claude—ordinary notes and planner data are excluded. Keys stay in private Actions, never the APK/browser.

You can leave after Stop. The encrypted queue continues while the app is open and through Android's best-effort background jobs; the OS can delay background work. GitHub Actions cleanup can take minutes, not seconds. Once ready, the app adds unchecked items to the original private/shared destination without replacing existing text or checking off other work. Foreground capture opens the resulting checklist automatically. Offline requests resume when connected, with stable IDs preventing repeated additions after retries or a crash. Deleted/moved notes or changed vault connections stop the addition instead of sending it elsewhere.

The original transcript is kept encrypted under **••• → Saved voice captures**. If Claude is unavailable, not configured, or refuses the key, the capture stays saved with an error and Retry; it is not silently replaced with local cleanup. After fixing configuration, Retry requests Claude again when needed. Existing review-only drafts from version 0.2 remain available there and are not automatically submitted or applied. The old private draft screen is recovery-only, not the new Voice note flow.

The existing planner vault already has its own API secret. To enable Claude for **Niki**, add `ANTHROPIC_API_KEY` as a **repository Actions secret** in [Niki’s vault settings](https://github.com/trevormw20/forgeboard-niki-notes-vault/settings/secrets/actions) (not an environment named after the key). If that key is not workspace-scoped, also add `ANTHROPIC_WORKSPACE_ID`, as in your existing planner vault; the workflow supports it. GitHub cannot copy a stored secret value to another repository. Do not put the key in the shared vault or either app. `ANTHROPIC_VOICE_MODEL` is an optional repository variable; default `claude-haiku-4-5`. API usage is billed separately. The workflow template is `docs/voice-cleanup-workflow.yml`; it belongs only in private personal vaults as `.github/workflows/voice-cleanup.yml`.

Explicitly submitted transcripts and results are stored in the private repo's `data/voice-inbox/` and `data/voice-results/`. They remain there (and in Git history); this feature does not claim permanent erasure. Do not dictate passwords, access tokens or sensitive health information. It is not a compliance-certified system.

## Checklists

The small plus appears at the end of each parent’s existing nested group. It appends and focuses a child in that group. The main Add remains at the end of the whole list. Enter/Next saves the current text and focuses the next sibling; it **does not mark the current checkbox complete**. Actual checkmarks remain independent at every level.

## Owner checks after installation

- On your physical phone, tap Voice note, speak, then Stop. Confirm the organized new checklist appears without further buttons. Repeat from inside a current list; its existing items must remain. Try leaving after Stop and check that it finishes later. Cancel before Stop must not submit. Original transcripts should remain in Saved voice captures.
- Connect Niki's and Shared lists with the limited tokens above. A personal test note must not appear in Shared lists or your private vault.
- Create one shared test list on one phone, Sync, then Sync the other. Edit different rows on both and confirm both edits survive. Niki must not be given access to your planner repository.
- Home-screen widgets remain personal; test your existing widget after updating without uninstalling.
