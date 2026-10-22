package com.forgeboard.notes;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import com.forgeboard.notes.core.NotesCore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small native preview. Long notebooks/checklists open in the notes-only app. */
public final class NotesWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.forgeboard.notes.WIDGET_REFRESH";
    public static final String ACTION_CHECK = "com.forgeboard.notes.WIDGET_CHECK";
    private static final String PREFS = "widget_config";
    private static final ExecutorService ACTIONS = Executors.newSingleThreadExecutor();
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    public static void saveConfig(Context context, int id, String projectId, String noteId) {
        config(context).edit().putString("project_" + id, safe(projectId))
                .putString("note_" + id, safe(noteId)).apply();
    }

    public static String projectFor(Context context, int id) {
        return config(context).getString("project_" + id, "");
    }

    public static String noteFor(Context context, int id) {
        return config(context).getString("note_" + id, "");
    }

    private static SharedPreferences config(Context context) {
        // IDs and per-widget choices only. All actual content remains in the encrypted repository cache.
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
        NotesRepository.get(context).requestSync();
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, manager, id);
    }

    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = config(context).edit();
        for (int id : ids) editor.remove("project_" + id).remove("note_" + id);
        editor.apply();
    }

    @Override public void onRestored(Context context, int[] oldIds, int[] newIds) {
        // Android backup is disabled for private content, but keep host restore behavior deterministic.
        for (int i = 0; i < Math.min(oldIds.length, newIds.length); i++) {
            saveConfig(context, newIds[i], projectFor(context, oldIds[i]), noteFor(context, oldIds[i]));
        }
        onDeleted(context, oldIds);
        onUpdate(context, AppWidgetManager.getInstance(context), newIds);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (!ACTION_REFRESH.equals(intent.getAction()) && !ACTION_CHECK.equals(intent.getAction())) {
            super.onReceive(context, intent);
            return;
        }
        final int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (!isOwnWidget(context, id)) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        ACTIONS.execute(() -> {
            try {
                NotesRepository repository = NotesRepository.get(app);
                if (ACTION_CHECK.equals(intent.getAction())) {
                    final String noteId = safe(intent.getStringExtra("noteId"));
                    final String itemId = safe(intent.getStringExtra("itemId"));
                    final boolean desired = intent.getBooleanExtra("checked", false);
                    if (!intent.hasExtra("checked") || noteId.isEmpty() || itemId.isEmpty()) return;
                    // A stale tap may not change a moved/deleted note, another widget, or another project.
                    if (!noteId.equals(noteFor(app, id))) return;
                    final String project = projectFor(app, id);
                    repository.edit(workspace -> {
                        JSONObject note = NotesCore.findNote(workspace, noteId);
                        if (note == null || deleted(note) || !project.equals(note.optString("projectId", ""))) return;
                        NotesCore.setChecklistChecked(workspace, noteId, itemId, desired, Instant.now().toString());
                    });
                }
                updateAll(app);
                // Never hold a BroadcastReceiver waiting for the network. JobScheduler owns that work.
                repository.requestSync();
            } catch (Exception ignored) {
                // The repository retains the previous cache and pending edits; nothing is erased on failure.
                updateAll(app);
            } finally {
                pending.finish();
            }
        });
    }

    private static boolean isOwnWidget(Context context, int id) {
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return false;
        android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        return info != null && new ComponentName(context, NotesWidgetProvider.class).equals(info.provider);
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, NotesWidgetProvider.class))) {
            update(context, manager, id);
        }
    }

    public static void update(Context context, AppWidgetManager manager, int id) {
        try {
            manager.updateAppWidget(id, buildViews(context, id, manager.getAppWidgetOptions(id)));
        } catch (RuntimeException ignored) {
            // A launcher can remove or resize a widget between enumeration and update.
        }
    }

    /** Exposed for native rendering tests; no credential or note content is in PendingIntent extras. */
    public static RemoteViews buildViews(Context context, int id, Bundle options) {
        NotesRepository repository = NotesRepository.get(context);
        JSONObject workspace = repository.snapshot();
        String project = projectFor(context, id), noteId = noteFor(context, id);
        JSONObject note = noteId.isEmpty() ? null : NotesCore.findNote(workspace, noteId);
        if (note != null && (deleted(note) || !project.equals(note.optString("projectId", "")))) note = null;

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_notes);
        String projectName = projectName(workspace, project);
        String title = noteId.isEmpty() ? projectName : note == null ? "Note unavailable" : title(note);
        views.setTextViewText(R.id.widget_title, clipped(title, 120));
        views.setTextViewText(R.id.widget_scope, noteId.isEmpty() ? "Forgeboard · Project notebook" : projectName + " · Pinned note");
        views.setContentDescription(R.id.widget_title, "Open " + clipped(title, 120));
        int accent = Color.rgb(125, 211, 252);
        if (note != null && note.optString("color").matches("#[0-9a-fA-F]{6}")) accent = Color.parseColor(note.optString("color"));
        views.setInt(R.id.widget_accent, "setBackgroundColor", accent);
        views.removeAllViews(R.id.widget_rows);

        Intent notebook = new Intent(context, MainActivity.class).putExtra("projectId", project);
        Intent editor = new Intent(context, NoteEditorActivity.class).putExtra("projectId", project);
        if (note != null) editor.putExtra("noteId", noteId);
        views.setOnClickPendingIntent(R.id.widget_title, activity(context, id, "open", noteId.isEmpty() ? notebook : editor));
        views.setOnClickPendingIntent(R.id.widget_more, activity(context, id, "more", noteId.isEmpty() ? notebook : editor));
        views.setOnClickPendingIntent(R.id.widget_add, activity(context, id, "new", new Intent(context, NoteEditorActivity.class).putExtra("projectId", project)));
        views.setOnClickPendingIntent(R.id.widget_settings, activity(context, id, "config", new Intent(context, WidgetConfigActivity.class)
                .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)));
        views.setOnClickPendingIntent(R.id.widget_refresh, broadcast(context, id, "refresh", new Intent(context, NotesWidgetProvider.class)
                .setAction(ACTION_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)));
        views.setTextViewText(R.id.widget_status, status(repository));

        int height = options == null ? 250 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250);
        int rowLimit = Math.max(1, Math.min(8, (height - 153) / 48));
        int shown = 0, total = 0;
        if (!noteId.isEmpty() && note != null) {
            String body = note.optString("body", "").trim();
            List<NotesCore.Row> checklist = NotesCore.orderedChecklist(note);
            total = checklist.size() + (body.isEmpty() ? 0 : 1);
            if (!body.isEmpty()) {
                RemoteViews row = textRow(context, clipped(body, 220));
                row.setOnClickPendingIntent(R.id.widget_row, activity(context, id, "body-" + noteId, editor));
                views.addView(R.id.widget_rows, row);
                shown++;
            }
            for (NotesCore.Row item : checklist) {
                if (shown >= rowLimit) break;
                JSONObject value = item.item;
                boolean checked = value.has("completedAt") && !value.optString("completedAt").isEmpty();
                RemoteViews row = textRow(context, clipped(value.optString("text", ""), 180));
                row.setViewVisibility(R.id.widget_checkbox, View.VISIBLE);
                row.setTextViewText(R.id.widget_checkbox, checked ? "☑" : "☐");
                row.setContentDescription(R.id.widget_checkbox, (checked ? "Uncheck " : "Check ") + clipped(value.optString("text"), 120));
                row.setTextColor(R.id.widget_row_text, Color.parseColor(checked ? "#94A3B8" : "#E2E8F0"));
                row.setInt(R.id.widget_row_text, "setPaintFlags", Paint.ANTI_ALIAS_FLAG | (checked ? Paint.STRIKE_THRU_TEXT_FLAG : 0));
                int indentation = dp(context, Math.min(item.depth, 3) * 10);
                boolean rtl = context.getResources().getConfiguration().getLayoutDirection() == View.LAYOUT_DIRECTION_RTL;
                row.setViewPadding(R.id.widget_row, rtl ? 0 : indentation, 0, rtl ? indentation : 0, 0);
                Intent check = new Intent(context, NotesWidgetProvider.class).setAction(ACTION_CHECK)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("noteId", noteId)
                        .putExtra("itemId", value.optString("id")).putExtra("checked", !checked);
                String checkKey = "check/" + Uri.encode(noteId) + "/" + Uri.encode(value.optString("id")) + "/" + !checked;
                row.setOnClickPendingIntent(R.id.widget_checkbox, broadcast(context, id, checkKey, check));
                row.setOnClickPendingIntent(R.id.widget_row_text, activity(context, id, "item-" + noteId + "-" + value.optString("id"), editor));
                views.addView(R.id.widget_rows, row);
                shown++;
            }
        } else if (noteId.isEmpty()) {
            List<JSONObject> notes = notesFor(workspace, project);
            total = notes.size();
            for (JSONObject entry : notes) {
                if (shown >= rowLimit) break;
                String body = entry.optString("body", "").replace('\n', ' ').trim();
                int items = NotesCore.orderedChecklist(entry).size();
                String preview = (entry.optBoolean("pinned") ? "★ " : "") + title(entry);
                if (!body.isEmpty()) preview += "\n" + body;
                else if (items > 0) preview += "\n" + items + (items == 1 ? " checklist item" : " checklist items");
                RemoteViews row = textRow(context, clipped(preview, 220));
                row.setOnClickPendingIntent(R.id.widget_row, activity(context, id, "note-" + entry.optString("id"),
                        new Intent(context, NoteEditorActivity.class).putExtra("projectId", project).putExtra("noteId", entry.optString("id"))));
                views.addView(R.id.widget_rows, row);
                shown++;
            }
        }

        boolean empty = shown == 0;
        views.setViewVisibility(R.id.widget_rows, empty ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.widget_empty, empty ? View.VISIBLE : View.GONE);
        String emptyText = !repository.isConnected() ? "Connect your private GitHub vault in the app. Your existing web notes will appear after sync."
                : !noteId.isEmpty() && note == null ? "This note was moved or deleted. Tap ⚙ to choose another note. No notes have been removed from your vault."
                : "Nothing here yet. Tap + to write a note.";
        views.setTextViewText(R.id.widget_empty, emptyText);
        views.setOnClickPendingIntent(R.id.widget_empty, activity(context, id, "empty", notebook));
        views.setTextViewText(R.id.widget_more, total > shown ? "+" + (total - shown) + " more" : "Open");
        views.setContentDescription(R.id.widget_more, "Open app to see all notes and checklist items");
        return views;
    }

    private static RemoteViews textRow(Context context, String text) {
        RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_note_row);
        row.setTextViewText(R.id.widget_row_text, text);
        return row;
    }

    static List<JSONObject> notesFor(JSONObject workspace, String project) {
        List<JSONObject> notes = new ArrayList<>();
        JSONArray source = workspace.optJSONArray("personalNotes");
        if (source != null) for (int i = 0; i < source.length(); i++) {
            JSONObject note = source.optJSONObject(i);
            if (note != null && !deleted(note) && project.equals(note.optString("projectId", ""))) notes.add(note);
        }
        notes.sort(Comparator.<JSONObject, Boolean>comparing(note -> !note.optBoolean("pinned"))
                .thenComparing(note -> note.optString("updatedAt", ""), Comparator.reverseOrder())
                .thenComparing(note -> note.optString("id", "")));
        return notes;
    }

    static String projectName(JSONObject workspace, String project) {
        if (project.isEmpty()) return "General notes";
        JSONArray projects = workspace.optJSONArray("projects");
        if (projects != null) for (int i = 0; i < projects.length(); i++) {
            JSONObject candidate = projects.optJSONObject(i);
            if (candidate != null && project.equals(candidate.optString("id"))) return candidate.optString("name", "Project notes");
        }
        return "Project unavailable";
    }

    static String title(JSONObject note) {
        String title = note.optString("title", "").trim();
        return title.isEmpty() ? "Untitled note" : title;
    }

    private static String status(NotesRepository repository) {
        String message = safe(repository.statusMessage()).replace('\n', ' ');
        if (!repository.lastError().isEmpty()) return clipped(repository.lastError(), 105);
        if (!repository.isConnected()) return "Not connected · Tap Open to connect";
        if (repository.isSyncing()) return "Syncing with GitHub…";
        if (repository.hasPendingWrites()) return "Edits queued · " + (message.isEmpty() ? "Will sync when connected" : clipped(message, 65));
        String last = safe(repository.lastSyncAt());
        if (last.isEmpty()) return message.isEmpty() ? "Waiting for first sync · Tap ↻" : clipped(message, 90);
        try {
            long age = System.currentTimeMillis() - Instant.parse(last).toEpochMilli();
            String relative = DateUtils.getRelativeTimeSpanString(Instant.parse(last).toEpochMilli(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString();
            String prefix = age > 60 * 60 * 1000 ? "Cached · " : "Synced · ";
            String normalizedMessage = message.toLowerCase(Locale.ROOT);
            if (!message.isEmpty() && (normalizedMessage.contains("fail") || normalizedMessage.contains("error") || normalizedMessage.contains("offline"))) return clipped(message, 60) + " · " + relative;
            return prefix + relative;
        } catch (RuntimeException ignored) {
            return "Cached notes · Tap ↻ to sync";
        }
    }

    private static PendingIntent activity(Context context, int id, String key, Intent intent) {
        intent.setData(uri(id, key)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, intent, PI_FLAGS);
    }

    private static PendingIntent broadcast(Context context, int id, String key, Intent intent) {
        intent.setData(uri(id, key));
        return PendingIntent.getBroadcast(context, 0, intent, PI_FLAGS);
    }

    private static Uri uri(int id, String key) {
        return new Uri.Builder().scheme("forgeboard-notes").authority("widget").appendPath(Integer.toString(id)).appendPath(key).build();
    }

    private static int dp(Context context, int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
    private static boolean deleted(JSONObject note) { return !note.optString("deletedAt", "").isEmpty(); }
    private static String safe(String value) { return value == null ? "" : value; }
    private static String clipped(String value, int limit) {
        return value.length() <= limit ? value : value.substring(0, limit - 1) + "…";
    }
}
