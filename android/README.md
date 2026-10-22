# Forgeboard Notes for Android

A native, notes-only companion to the existing Forgeboard website. Android 8.0 or newer. It is not a WebView wrapper and does not replace the full planner.

## Install and connect

1. On your Android phone, open the [Android release downloads](https://github.com/trevormw20/forgeboard-studio/releases/tag/android-notes-v0.1.0) and download **Forgeboard-Notes.apk**. Open the download and allow installation from that source if Android asks. No Play Store account is required. Do not disable Play Protect.
2. Open **Forgeboard Notes** → **Connect GitHub**. The defaults are owner `trevormw20`, private repository `forgeboard-studio-vault`, branch `main`, file `data/workspace.json`.
3. Enter your fine-grained GitHub token **on the phone only**. It needs access to only the private vault and **Contents → Read and write**. The browser's saved token is not shared with this app. Token expiry still applies.
4. Connect, select a project notebook, and open or create a note. The project selector comes from your existing vault, not a second list you need to maintain. **General** is for notes with no project.

The public Pages repository is not the data repository. The Android app refuses public repositories and never creates or replaces a missing workspace file. If connection reports Not found, check owner/repository, branch, exact file path, token's selected repository, Contents permission and that the file exists. Replace expired tokens through the same connection screen.

## Add a real home-screen widget

Long-press an empty area of the Android home screen → **Widgets** → **Forgeboard Notes**. Drag the widget onto the home screen, then choose a **project notebook** or a **specific note/checklist**. The wording varies by Android launcher.

You can add multiple widgets, each with its own selection. Resize a widget to show more preview rows. Checkboxes are independently tappable; checking a parent never checks its children. Tap **+** for a new native note, a note to edit it, **↻** to sync, or the gear to change selection. A compact widget preview is not the whole notebook: **more/Open** opens the native editor. Text entry uses that editor, not a keyboard embedded in the widget. Widget text is visible on your home screen; choose its contents accordingly.

## Notes and offline use

Notes autosave on the phone. Write text, create nested sub-notes, use custom colors/labels, pin notes, or add checklists. Slide a checklist handle right/left to nest/outdent, or use its options menu for explicit controls. Sub-sub-checkboxes are supported. Deleted notes/items can be restored; saved conflict copies are preserved separately.

The native app and website read/write the **same JSON workspace**. Open either, use **Sync**, and allow the other to sync. The app refreshes while open about every 30 seconds; widget edits queue a background sync. Android also schedules best-effort background sync, no more frequently than its 15-minute minimum. Battery settings, network availability and Android can delay that work. There is no promise of instant closed-app refresh.

Offline edits remain in an encrypted durable outbox and merge when connected again. The latest remote planner envelope is preserved; Android edits only notes and labels, not tasks, projects, reports or AI settings. Concurrent edits merge by stable note/checklist IDs; conflicting versions are saved for recovery. **Do not uninstall, clear app data, or switch vaults with unsynced work.** Disconnect forgets the token but retains offline notes. Switching vaults is blocked while pending changes exist. Android backup/transfer is disabled to avoid copying tokens or an outbox without its encryption key.

Personal notes are not automatically sent to Claude/OpenAI. No API key is required for this companion. No analytics, advertising, email integration or account/chat control is included.

This personal planner is not a reviewed or certified health-record system. Do not add patient-identifying or sensitive health information without an appropriate compliance review. Device encryption does not make GitHub Pages or this app HIPAA-certified.

## Updates and development

Install a newer release APK **over the existing app**. Keep the same application ID and signing key; increase versionCode. Never uninstall as an update step. The signing bundle is held only in the private vault's Actions secret `ANDROID_SIGNING_BUNDLE`; it is not in source or the public app. Losing/rotating that key prevents seamless updates—retain the private repository and secret.

Build with JDK17, Gradle8.13, Android SDK36 and build tools35.0.0:

```sh
cd android
gradle testDebugUnitTest lintDebug assembleDebug
gradle connectedDebugAndroidTest
```

The private manual **Android notes build and device tests** workflow checks out only this public source, builds/tests/lints, signs the release using the private secret, verifies its signature, and uploads the APK/checksum plus test evidence. It never checks out private planner data. The release is published only after reviewing build/device results. There are no runtime third-party dependencies; AndroidX is test-only. The existing Pages build remains separate.
