package com.forgeboard.notes;

import static org.junit.Assert.*;

import android.Manifest;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.forgeboard.notes.core.NotesCore;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Device tests use a debug-app sandbox and fake notes only; they never call GitHub. */
@RunWith(AndroidJUnit4.class)
public final class NativeNotesInstrumentedTest {
    private static final String NOTE = "test-note-release";
    private static final String PROJECT = "test-project-demo";
    private static final String OTHER_PROJECT = "test-project-other";
    private static final String ROOT = "test-check-root";
    private static final String CHILD = "test-check-child";
    private static final String GRANDCHILD = "test-check-grandchild";
    private static final String NOW = "2026-10-22T12:00:00.000Z";
    private Context context;
    private NotesRepository repository;

    @Before public void prepareFakeOfflineWorkspace() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue("These tests must run only in the dedicated debug app", context.getPackageName().endsWith(".debug"));
        // AOSP Quickstep can ANR under emulator/Gradle CPU contention. Stop only that test launcher;
        // do not dismiss or conceal any Forgeboard errors.
        stopContendedEmulatorLauncher(InstrumentationRegistry.getInstrumentation().getUiAutomation());
        idle();
        repository = NotesRepository.get(context);
        assertFalse("Never run fixture tests against a connected vault", repository.isConnected());
        JSONObject fixture = fixture();
        repository.edit(workspace -> {
            List<String> oldKeys = new ArrayList<>();
            Iterator<String> keys = workspace.keys();
            while (keys.hasNext()) oldKeys.add(keys.next());
            for (String key : oldKeys) workspace.remove(key);
            keys = fixture.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                workspace.put(key, fixture.get(key));
            }
        });
        idle();
    }

    @Test public void editorPersistsTextNestedCheckboxesAndIndependentCompletion() throws Exception {
        String untouchedTasks = repository.snapshot().getJSONArray("tasks").toString();
        Intent intent = new Intent(context, NoteEditorActivity.class).putExtra("noteId", NOTE).putExtra("projectId", PROJECT);
        try (ActivityScenario<NoteEditorActivity> scenario = ActivityScenario.launch(intent)) {
            scenario.onActivity(activity -> {
                EditText title = tagged(activity.getWindow().getDecorView(), "noteTitle", EditText.class);
                EditText body = tagged(activity.getWindow().getDecorView(), "noteBody", EditText.class);
                title.setText("Demo release checklist");
                body.setText("A small, focused plan. Fake demonstration notes only.");
                // First indent the last sibling under the middle one; moving its parent then carries it.
                pressTab(activity.getWindow().getDecorView(), GRANDCHILD);
                pressTab(activity.getWindow().getDecorView(), CHILD);
                CheckBox parent = tagged(activity.getWindow().getDecorView(), "checklistCheck:" + ROOT, CheckBox.class);
                parent.performClick();
                assertTrue(parent.isChecked());
                CheckBox grandchild = tagged(activity.getWindow().getDecorView(), "checklistCheck:" + GRANDCHILD, CheckBox.class);
                grandchild.performClick();
                assertTrue(grandchild.isChecked());
                parent.performClick();
                assertFalse(parent.isChecked());
                assertFalse(tagged(activity.getWindow().getDecorView(), "checklistCheck:" + CHILD, CheckBox.class).isChecked());
                assertTrue(grandchild.isChecked());
                EditText nested = tagged(activity.getWindow().getDecorView(), "checklistText:" + GRANDCHILD, EditText.class);
                View nestedWrap = (View) nested.getParent().getParent();
                assertEquals(Ui.dp(activity, 32), nestedWrap.getPaddingLeft());
                body.clearFocus(); nested.clearFocus();
                ((InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE))
                        .hideSoftInputFromWindow(body.getWindowToken(), 0);
                nested.requestRectangleOnScreen(new Rect(0, 0, nested.getWidth(), nested.getHeight()), true);
            });
            idle();
            screenshot("native-notes-editor.png");
            scenario.moveToState(Lifecycle.State.CREATED); // onPause flushes dirty fields immediately.
        }
        JSONObject saved = NotesCore.findNote(repository.snapshot(), NOTE);
        assertEquals("Demo release checklist", saved.getString("title"));
        assertEquals("A small, focused plan. Fake demonstration notes only.", saved.getString("body"));
        assertEquals(ROOT, item(saved, CHILD).getString("parentId"));
        assertEquals(CHILD, item(saved, GRANDCHILD).getString("parentId"));
        assertFalse(item(saved, ROOT).has("completedAt"));
        assertFalse(item(saved, CHILD).has("completedAt"));
        assertTrue(item(saved, GRANDCHILD).has("completedAt"));
        assertEquals(untouchedTasks, repository.snapshot().getJSONArray("tasks").toString());
        assertTrue(repository.hasPendingWrites());
        JSONObject durable = new SecureStore(context).read();
        assertNotNull(durable);
        assertTrue(durable.getBoolean("dirty"));
        assertEquals("Demo release checklist", NotesCore.findNote(durable.getJSONObject("workspace"), NOTE).getString("title"));
    }

    @Test public void notebookSwitchKeepsProjectsSeparateAndNewNotesAppear() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(new Intent(context, MainActivity.class).putExtra("projectId", PROJECT))) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                assertNotNull(decor.findViewWithTag("noteCard:" + NOTE));
                assertNull(decor.findViewWithTag("noteCard:test-note-other"));
                Spinner projects = tagged(decor, "projectSelector", Spinner.class);
                projects.setSelection(2); // General, Demo game, Another project.
            });
            idle();
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                assertNull(decor.findViewWithTag("noteCard:" + NOTE));
                assertNotNull(decor.findViewWithTag("noteCard:test-note-other"));
                tagged(decor, "projectSelector", Spinner.class).setSelection(1);
            });
            idle();
            screenshot("native-notes-notebook.png");
        }
    }

    @Test public void nativeEditorAddsAnIndividuallyCheckableItem() throws Exception {
        try (ActivityScenario<NoteEditorActivity> scenario = ActivityScenario.launch(new Intent(context, NoteEditorActivity.class).putExtra("noteId", NOTE))) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                assertTrue(decor.findViewWithTag("checklistAdd").performClick());
                List<NotesCore.Row> rows = NotesCore.orderedChecklist(NotesCore.findNote(repository.snapshot(), NOTE));
                assertEquals(4, rows.size());
                String id = rows.get(3).item.optString("id");
                tagged(decor, "checklistText:" + id, EditText.class).setText("Test the Android notes widget");
                tagged(decor, "checklistCheck:" + id, CheckBox.class).performClick();
            });
            scenario.moveToState(Lifecycle.State.CREATED);
        }
        List<NotesCore.Row> saved = NotesCore.orderedChecklist(NotesCore.findNote(repository.snapshot(), NOTE));
        assertEquals(4, saved.size());
        assertEquals("Test the Android notes widget", saved.get(3).item.getString("text"));
        assertTrue(saved.get(3).item.has("completedAt"));
        assertFalse(saved.get(0).item.has("completedAt"));
    }

    @Test public void focusedEditorRetainsCompleteLocalAndConcurrentCloudBodySnapshots() throws Exception {
        String cloudBody = "Cloud revision: ship the verified demo first.\nKeep the original build available until the new one passes smoke tests.";
        String localBody = "My focused editor draft: test the first five minutes and the ending.\nDo not lose this second paragraph while another device synchronizes.";
        try (ActivityScenario<NoteEditorActivity> scenario = ActivityScenario.launch(new Intent(context, NoteEditorActivity.class).putExtra("noteId", NOTE))) {
            scenario.onActivity(activity -> {
                EditText body = tagged(activity.getWindow().getDecorView(), "noteBody", EditText.class);
                assertTrue(body.requestFocus());
                try {
                    // Simulate the repository changing while the current editor still holds its loaded version.
                    repository.edit(ws -> {
                        NotesCore.updateNote(ws, NOTE, new JSONObject().put("body", cloudBody), NOW);
                        NotesCore.setChecklistChecked(ws, NOTE, ROOT, true, NOW);
                        NotesCore.findNote(ws, NOTE).put("remoteOnlyMetadata", "full cloud snapshot sentinel");
                    });
                } catch (Exception error) { throw new AssertionError(error); }
                body.setText(localBody);
                assertTrue(body.hasFocus());
            });
            JSONObject conflict = waitForConflict(localBody);
            JSONObject local = conflict.getJSONObject("local"), remote = conflict.getJSONObject("remote");
            assertEquals("personal-note", conflict.getString("entityType"));
            assertEquals(NOTE, conflict.getString("entityId"));
            assertEquals(localBody, local.getString("body"));
            assertEquals(cloudBody, remote.getString("body"));
            for (JSONObject snapshot : new JSONObject[]{local, remote}) {
                assertEquals(NOTE, snapshot.getString("id"));
                assertEquals(PROJECT, snapshot.getString("projectId"));
                assertEquals("Demo release plan", snapshot.getString("title"));
                assertEquals(Color.parseColor("#7A82CC"), Color.parseColor(snapshot.getString("color")));
                assertEquals("full cloud snapshot sentinel", snapshot.getString("remoteOnlyMetadata"));
                assertEquals(3, snapshot.getJSONArray("checklist").length());
                assertTrue(item(snapshot, ROOT).has("completedAt"));
                assertEquals("Test the first five minutes", item(snapshot, GRANDCHILD).getString("text"));
            }
            assertEquals(localBody, NotesCore.findNote(repository.snapshot(), NOTE).getString("body"));
            assertTrue(repository.hasPendingWrites());
            JSONObject durable = new SecureStore(context).read().getJSONObject("workspace");
            assertEquals(cloudBody, durable.getJSONArray("conflicts").getJSONObject(0).getJSONObject("remote").getString("body"));
        }
    }

    @Test public void focusedTypingSurvivesConcurrentNoteAndChecklistDeletionWithoutRestoringOriginal() throws Exception {
        String originalBody = NotesCore.findNote(repository.snapshot(), NOTE).getString("body");
        String localBody = "Unfinished body draft that must survive deletion elsewhere.\nThis complete second line also needs to remain recoverable.";
        String localChecklistText = "My unfinished checklist edit — keep every word, including this final recovery sentinel.";
        try (ActivityScenario<NoteEditorActivity> scenario = ActivityScenario.launch(new Intent(context, NoteEditorActivity.class).putExtra("noteId", NOTE))) {
            scenario.onActivity(activity -> {
                View decor = activity.getWindow().getDecorView();
                EditText body = tagged(decor, "noteBody", EditText.class);
                body.requestFocus();
                body.setText(localBody);
                EditText checklistText = tagged(decor, "checklistText:" + CHILD, EditText.class);
                assertTrue(checklistText.requestFocus());
                checklistText.setText(localChecklistText);
                try {
                    // Run in the same UI callback before the draft debounce can execute.
                    repository.edit(ws -> {
                        NotesCore.deleteChecklistItem(ws, NOTE, CHILD, NOW);
                        NotesCore.deleteNote(ws, NOTE, NOW);
                    });
                } catch (Exception error) { throw new AssertionError(error); }
                assertTrue(checklistText.hasFocus());
            });
            JSONObject conflict = waitForConflict(localBody);
            JSONObject latest = NotesCore.findNote(repository.snapshot(), NOTE);
            assertTrue("The original note must stay in Deleted notes", latest.has("deletedAt"));
            assertTrue("The original checklist item must stay deleted", item(latest, CHILD).has("deletedAt"));
            assertEquals(originalBody, latest.getString("body"));
            assertEquals("Upload the build", item(latest, CHILD).getString("text"));
            assertTrue(NotesCore.activeNotes(repository.snapshot(), PROJECT).isEmpty());
            JSONObject local = conflict.getJSONObject("local"), remote = conflict.getJSONObject("remote");
            assertEquals(localBody, local.getString("body"));
            assertEquals(localChecklistText, item(local, CHILD).getString("text"));
            assertEquals(3, local.getJSONArray("checklist").length());
            assertEquals(NOTE, local.getString("id"));
            assertEquals(PROJECT, local.getString("projectId"));
            assertEquals("Demo release plan", local.getString("title"));
            assertEquals(originalBody, remote.getString("body"));
            assertTrue(remote.has("deletedAt"));
            assertTrue(item(remote, CHILD).has("deletedAt"));
            assertEquals("Upload the build", item(remote, CHILD).getString("text"));
            JSONObject durable = new SecureStore(context).read().getJSONObject("workspace");
            JSONObject durableDraft = durable.getJSONArray("conflicts").getJSONObject(0).getJSONObject("local");
            assertEquals(localBody, durableDraft.getString("body"));
            assertEquals(localChecklistText, item(durableDraft, CHILD).getString("text"));
        }
    }

    @Test public void remoteViewsRenderAndRepeatedWidgetClickKeepsDesiredCheckedState() throws Exception {
        // Bind a genuine test host ID so the receiver's widget/project security checks stay enabled.
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AppWidgetHost host = new AppWidgetHost(context, 7041);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int id = host.allocateAppWidgetId();
        try {
            instrumentation.getUiAutomation().adoptShellPermissionIdentity(Manifest.permission.BIND_APPWIDGET);
            try {
                assertTrue("Could not bind the emulator's test widget host", manager.bindAppWidgetIdIfAllowed(id,
                        new ComponentName(context, NotesWidgetProvider.class), largeWidget()));
            } finally { instrumentation.getUiAutomation().dropShellPermissionIdentity(); }
            repository.edit(ws -> {
                NotesCore.moveChecklistItem(ws, NOTE, GRANDCHILD, "indent", NOW);
                NotesCore.moveChecklistItem(ws, NOTE, CHILD, "indent", NOW);
            });
            NotesWidgetProvider.saveConfig(context, id, PROJECT, NOTE);
            final TextView[] checkbox = new TextView[1];
            try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(new Intent(context, MainActivity.class))) {
                idle();
                CountDownLatch actionChanges = new CountDownLatch(2);
                BroadcastReceiver changes = new BroadcastReceiver() {
                    @Override public void onReceive(Context c, Intent intent) { actionChanges.countDown(); }
                };
                if (android.os.Build.VERSION.SDK_INT >= 33) context.registerReceiver(changes, new IntentFilter(NotesRepository.ACTION_CHANGED), Context.RECEIVER_NOT_EXPORTED);
                else context.registerReceiver(changes, new IntentFilter(NotesRepository.ACTION_CHANGED));
                try {
                scenario.onActivity(activity -> {
                    RemoteViews remoteViews = NotesWidgetProvider.buildViews(context, id, largeWidget());
                    FrameLayout screen = new FrameLayout(activity);
                    screen.setBackgroundColor(Ui.BG);
                    screen.setPadding(Ui.dp(activity, 18), Ui.dp(activity, 48), Ui.dp(activity, 18), Ui.dp(activity, 32));
                    View widget = remoteViews.apply(activity, screen);
                    screen.addView(widget, new FrameLayout.LayoutParams(-1, Ui.dp(activity, 500)));
                    activity.setContentView(screen);
                    assertEquals("Demo release plan", ((TextView) widget.findViewById(R.id.widget_title)).getText().toString());
                    LinearLayout rows = widget.findViewById(R.id.widget_rows);
                    assertEquals(4, rows.getChildCount()); // body plus three checkbox levels.
                    assertEquals(Ui.dp(activity, 20), rows.getChildAt(3).getPaddingLeft());
                    checkbox[0] = rows.getChildAt(1).findViewById(R.id.widget_checkbox);
                    assertEquals("☐", checkbox[0].getText().toString());
                    assertTrue(checkbox[0].hasOnClickListeners());
                    assertTrue(checkbox[0].performClick());
                });
                waitForChecked(ROOT, true);
                // Replay the exact older click, without re-rendering. It must not toggle the item off.
                scenario.onActivity(activity -> checkbox[0].performClick());
                assertTrue("Both explicit widget actions should complete", actionChanges.await(5, TimeUnit.SECONDS));
                idle();
                assertTrue(item(NotesCore.findNote(repository.snapshot(), NOTE), ROOT).has("completedAt"));
                assertFalse(item(NotesCore.findNote(repository.snapshot(), NOTE), CHILD).has("completedAt"));
                scenario.onActivity(activity -> {
                    FrameLayout screen = (FrameLayout) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0);
                    NotesWidgetProvider.buildViews(context, id, largeWidget()).reapply(activity, screen.getChildAt(0));
                });
                idle();
                screenshot("native-notes-widget.png");
                } finally { context.unregisterReceiver(changes); }
            }
        } finally {
            host.deleteAppWidgetId(id);
            NotesWidgetProvider.saveConfig(context, id, "", "");
        }
    }

    @Test public void keystoreCacheRoundTripNeverWritesTokenOrNoteAsPlaintext() throws Exception {
        SecureStore store = new SecureStore(context);
        JSONObject original = store.read();
        assertNotNull(original);
        String fakeToken = "FORGEBOARD_TEST_ONLY_FAKE_TOKEN_8e578c";
        String fakeNote = "PRIVATE_TEST_NOTE_SENTINEL_cfeea9";
        try {
            JSONObject probe = new JSONObject(original.toString());
            probe.put("connection", new VaultConfig("test-only", "fake-vault", "main", "data/workspace.json", fakeToken).json());
            probe.put("testPrivateNote", fakeNote);
            store.write(probe);
            JSONObject restored = new SecureStore(context).read();
            assertEquals(fakeToken, restored.getJSONObject("connection").getString("token"));
            assertEquals(fakeNote, restored.getString("testPrivateNote"));
            byte[] ciphertext = Files.readAllBytes(new File(context.getNoBackupFilesDir(), "notes-v1.enc").toPath());
            assertTrue(ciphertext.length > 30);
            String raw = new String(ciphertext, StandardCharsets.ISO_8859_1);
            assertFalse(raw.contains(fakeToken));
            assertFalse(raw.contains(fakeNote));
            assertNotEquals('{', ciphertext[0]);
        } finally { store.write(original); }
        assertFalse(repository.isConnected()); // Fake key never enters the active repository or network client.
    }

    private void waitForChecked(String itemId, boolean checked) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) {
            idle();
            boolean actual = item(NotesCore.findNote(repository.snapshot(), NOTE), itemId).has("completedAt");
            if (actual == checked) return;
            SystemClock.sleep(40);
        }
        fail("Widget checkbox update did not become durable");
    }

    private JSONObject waitForConflict(String expectedLocalBody) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 5000;
        while (SystemClock.uptimeMillis() < deadline) {
            idle();
            JSONArray conflicts = repository.snapshot().optJSONArray("conflicts");
            if (conflicts != null) for (int i = 0; i < conflicts.length(); i++) {
                JSONObject conflict = conflicts.getJSONObject(i), local = conflict.optJSONObject("local");
                if (NOTE.equals(conflict.optString("entityId")) && local != null && expectedLocalBody.equals(local.optString("body"))) return conflict;
            }
            SystemClock.sleep(40);
        }
        throw new AssertionError("The editor did not preserve its complete draft conflict snapshot");
    }

    private static void pressTab(View decor, String itemId) {
        EditText input = tagged(decor, "checklistText:" + itemId, EditText.class);
        input.requestFocus();
        assertTrue("Tab should indent a checklist item", input.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_TAB)));
    }

    private static <T extends View> T tagged(View parent, String tag, Class<T> type) {
        View view = parent.findViewWithTag(tag);
        assertNotNull("Missing native view: " + tag, view);
        return type.cast(view);
    }

    private static void idle() { InstrumentationRegistry.getInstrumentation().waitForIdleSync(); }

    private void screenshot(String name) throws Exception {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        stopContendedEmulatorLauncher(automation);
        idle();
        SystemClock.sleep(350); // Let the rendered frame, not just the main message queue, settle.
        assertFalse("An unexpected Android ANR/crash dialog is covering the app", hasAndroidErrorDialog(automation.getRootInActiveWindow()));
        Bitmap bitmap = automation.takeScreenshot();
        assertNotNull("The emulator did not return a screenshot", bitmap);
        File directory = new File(context.getExternalFilesDir(null), "qa");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File screenshot = new File(directory, name);
        try (FileOutputStream output = new FileOutputStream(screenshot)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        } finally { bitmap.recycle(); }
        // Gradle/UTP removes the debug app after the suite, including externalFilesDir.
        // Export only these known fake-data images to the emulator shell's QA directory first.
        assertTrue(name.matches("native-notes-(editor|notebook|widget)\\.png"));
        assertTrue(screenshot.getAbsolutePath().matches("[A-Za-z0-9_./-]+"));
        String destination = "/data/local/tmp/forgeboard-qa/" + name;
        shellOutput(automation, "mkdir -p /data/local/tmp/forgeboard-qa");
        shellOutput(automation, "cp " + screenshot.getAbsolutePath() + " " + destination);
        assertEquals(destination, shellOutput(automation, "ls " + destination).trim());
    }

    private static String shellOutput(UiAutomation automation, String command) throws Exception {
        // executeShellCommand does not interpret shell operators or quotes. Each invocation is one executable.
        try (InputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command));
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int count;
            while ((count = stream.read(buffer)) != -1) output.write(buffer, 0, count); // EOF waits for this executable to finish.
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void stopContendedEmulatorLauncher(UiAutomation automation) throws Exception {
        String hardware = android.os.Build.HARDWARE.toLowerCase(Locale.ROOT);
        boolean emulator = hardware.contains("ranchu") || hardware.contains("goldfish") || android.os.Build.FINGERPRINT.startsWith("generic");
        if (context.getPackageName().endsWith(".debug") && emulator) shellOutput(automation, "am force-stop com.android.launcher3");
    }

    private static boolean hasAndroidErrorDialog(AccessibilityNodeInfo node) {
        if (node == null) return false;
        String text = String.valueOf(node.getText()).toLowerCase(Locale.ROOT);
        if (text.contains("isn't responding") || text.contains("isn’t responding") || text.contains("is not responding")
                || text.contains("keeps stopping") || text.contains("has stopped")) return true;
        for (int i = 0; i < node.getChildCount(); i++) if (hasAndroidErrorDialog(node.getChild(i))) return true;
        return false;
    }

    private static JSONObject item(JSONObject note, String id) throws Exception {
        JSONArray items = note.getJSONArray("checklist");
        for (int i = 0; i < items.length(); i++) if (id.equals(items.getJSONObject(i).optString("id"))) return items.getJSONObject(i);
        throw new AssertionError("Missing test checklist item " + id);
    }

    private static Bundle largeWidget() {
        Bundle options = new Bundle();
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 500);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 500);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 400);
        return options;
    }

    private static JSONObject fixture() throws Exception {
        JSONObject ws = NotesCore.emptyWorkspace();
        ws.put("projects", new JSONArray().put(new JSONObject().put("id", PROJECT).put("name", "Demo game").put("color", "#34334F").put("createdAt", NOW).put("updatedAt", NOW))
                .put(new JSONObject().put("id", OTHER_PROJECT).put("name", "Another project").put("createdAt", NOW).put("updatedAt", NOW)));
        ws.put("tasks", new JSONArray().put(new JSONObject().put("id", "test-existing-task").put("title", "Existing tasks stay untouched")));
        JSONObject note = new JSONObject().put("id", NOTE).put("projectId", PROJECT).put("title", "Demo release plan")
                .put("body", "One small step at a time. Demonstration data only.").put("color", "#7A82CC").put("pinned", true)
                .put("createdAt", NOW).put("updatedAt", NOW).put("checklist", new JSONArray()
                        .put(check(ROOT, "Prepare the demo", 0)).put(check(CHILD, "Upload the build", 1)).put(check(GRANDCHILD, "Test the first five minutes", 2)));
        ws.put("personalNotes", new JSONArray().put(note)
                .put(new JSONObject().put("id", "test-note-other").put("projectId", OTHER_PROJECT).put("title", "Another project’s idea")
                        .put("body", "This must stay in its own notebook.").put("createdAt", NOW).put("updatedAt", NOW)));
        return ws;
    }

    private static JSONObject check(String id, String text, int order) throws Exception {
        return new JSONObject().put("id", id).put("text", text).put("order", order).put("createdAt", NOW).put("updatedAt", NOW);
    }
}
