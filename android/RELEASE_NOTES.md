# Forgeboard Notes for Android — 0.1.0

Native notes-only companion and real Android home-screen widgets. Android8.0+; no Play Store or AI key required.

1. Download **Forgeboard-Notes.apk** on your Android phone and open it to install.
2. Open **Forgeboard Notes**, connect to your existing private GitHub vault, and enter your fine-grained token on the phone. Never paste a token into chat.
3. Long-press an empty home-screen area → **Widgets** → **Forgeboard Notes**. Select a project notebook or a specific note/checklist. Add more widgets for other projects.

Check boxes from the widget, tap **+** to write a note in the native editor, or open a note to read/edit its full checklist. Project notebooks, colors/labels, sub-notes and nested independent checkboxes use the same private workspace as the web planner. The full Forgeboard website is unchanged.

Offline edits queue securely on the phone; Sync refreshes immediately when connected. Android can delay periodic background sync. Keep the app installed and do not clear its data while edits are pending. Install future updates over this app, without uninstalling.

No planner data, tokens or AI keys are included in this APK. Notes and credentials are encrypted with Android Keystore on the phone, backups are disabled, and concurrent changes retain recovery copies. Personal notes are not automatically sent to AI. Widget content is visible on your home screen.

Verification: 35 native unit tests and 7 Android15/API35 device tests passed. Debug/release lint and the signed production build passed. Native notebook, editor and widget screenshots were visually reviewed using demonstration notes in an isolated debug app.

Release source: `a57708143c5b098e15b0d3b11e66ddeddfd0e296`.

APK SHA256: `ccb6081782b5197e70909f06d165bb316f316fc40424ae10cef51f86f1d98ea8`.

Signing certificate SHA256: `6b2d749dc9243015e27815afed593237ec1dffa059ebef5333a878237d816120`.

The stable signing key remains in the private vault's Actions secret, not this repository. Test screenshots use demonstration data in a separate debug app, never the real vault. Physical phone installation and phone-to-website syncing still need the owner's review.

[Detailed setup, sync and recovery notes](https://github.com/trevormw20/forgeboard-studio/blob/main/android/README.md).
