package com.forgeboard.notes;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Launcher-owned configuration; each widget has independent project and note choices. */
public final class WidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private LinearLayout form;
    private Spinner projectPicker, modePicker, notePicker;
    private TextView status, noteLabel;
    private final List<String> projectIds = new ArrayList<>();
    private final List<String> noteIds = new ArrayList<>();
    private JSONObject workspace = new JSONObject();
    private String desiredProject = "", desiredNote = "";
    private boolean initial = true;

    @Override public void onCreate(Bundle savedInstanceState) {
        setTheme(android.R.style.Theme_Material_NoActionBar);
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || info == null
                || !new ComponentName(this, NotesWidgetProvider.class).equals(info.provider)) {
            finish();
            return;
        }
        desiredProject = NotesWidgetProvider.projectFor(this, widgetId);
        desiredNote = NotesWidgetProvider.noteFor(this, widgetId);
        if (savedInstanceState != null) {
            desiredProject = savedInstanceState.getString("project", desiredProject);
            desiredNote = savedInstanceState.getString("note", desiredNote);
        }
        buildForm();
    }

    @Override protected void onResume() {
        super.onResume();
        if (form == null) return;
        if (!initial) rememberSelections();
        refreshProjects();
        NotesRepository.get(this).requestSync();
        initial = false;
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        rememberSelections();
        state.putString("project", desiredProject);
        state.putString("note", desiredNote);
        super.onSaveInstanceState(state);
    }

    private void buildForm() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.parseColor("#101924"));
        form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(24), dp(22), dp(24));
        scroll.addView(form, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(scroll);
        TextView heading = text("Your notes, right here", 27, "#F1F5F9");
        heading.setTypeface(null, android.graphics.Typeface.BOLD);
        form.addView(heading);
        form.addView(text("Choose a project notebook or one note. Add several widgets if you want different projects side by side.", 15, "#CBD5E1"));
        status = text("", 13, "#93C5FD");
        form.addView(status);
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button connect = button("Connect vault");
        connect.setOnClickListener(view -> startActivity(new Intent(this, ConnectionActivity.class)));
        actions.addView(connect, new LinearLayout.LayoutParams(0, dp(54), 1));
        Button refresh = button("Reload choices");
        refresh.setOnClickListener(view -> {
            rememberSelections();
            refreshProjects();
            NotesRepository.get(this).requestSync();
        });
        actions.addView(refresh, new LinearLayout.LayoutParams(0, dp(54), 1));
        form.addView(actions);

        form.addView(text("Project", 14, "#F1F5F9"));
        projectPicker = picker();
        form.addView(projectPicker);
        form.addView(text("Show on home screen", 14, "#F1F5F9"));
        modePicker = picker();
        modePicker.setAdapter(adapter(Arrays.asList("Project notebook", "One note + its checklist")));
        modePicker.setSelection(desiredNote.isEmpty() ? 0 : 1);
        form.addView(modePicker);
        noteLabel = text("Note", 14, "#F1F5F9");
        form.addView(noteLabel);
        notePicker = picker();
        form.addView(notePicker);

        projectPicker.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { refreshNotes(); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        modePicker.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { showMode(); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        form.addView(text("Resize the widget to see more. Tap + to type in the quick editor; tap a checkbox to check it here. Full notebooks and longer checklists open in the app.", 13, "#94A3B8"));
        form.addView(text("Android controls background refresh, so it is not instant. Tap ↻ on the widget to request a sync. Offline edits are kept safely until your phone reconnects.", 13, "#94A3B8"));
        Button save = button("Save widget");
        save.setTextColor(Color.parseColor("#BAE6FD"));
        save.setTag("widgetSave");
        save.setOnClickListener(view -> save());
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        saveParams.topMargin = dp(18);
        form.addView(save, saveParams);
        Button cancel = button("Cancel");
        cancel.setOnClickListener(view -> finish());
        form.addView(cancel);
    }

    private void refreshProjects() {
        workspace = NotesRepository.get(this).snapshot();
        projectIds.clear();
        List<String> names = new ArrayList<>();
        projectIds.add(""); names.add("General notes");
        JSONArray projects = workspace.optJSONArray("projects");
        if (projects != null) for (int i = 0; i < projects.length(); i++) {
            JSONObject project = projects.optJSONObject(i);
            if (project == null || !project.optString("deletedAt", "").isEmpty() || project.optString("id").isEmpty()) continue;
            projectIds.add(project.optString("id"));
            names.add(project.optString("name", "Unnamed project"));
        }
        projectPicker.setAdapter(adapter(names));
        int selected = projectIds.indexOf(desiredProject);
        projectPicker.setSelection(selected < 0 ? 0 : selected);
        refreshNotes();
        NotesRepository repository = NotesRepository.get(this);
        status.setText(repository.isConnected()
                ? "Your private GitHub vault is connected. Newly added projects appear here after syncing."
                : "Connect your vault first, then reload choices after the first sync. A blank widget will not delete any notes.");
    }

    private void refreshNotes() {
        if (notePicker == null) return;
        String project = selectedProject();
        noteIds.clear();
        List<String> names = new ArrayList<>();
        for (JSONObject note : NotesWidgetProvider.notesFor(workspace, project)) {
            noteIds.add(note.optString("id"));
            names.add(NotesWidgetProvider.title(note));
        }
        if (names.isEmpty()) names.add("No notes in this project yet");
        notePicker.setAdapter(adapter(names));
        int selected = noteIds.indexOf(desiredNote);
        notePicker.setSelection(selected < 0 ? 0 : selected);
        showMode();
    }

    private void showMode() {
        if (notePicker == null || noteLabel == null) return;
        int visibility = modePicker.getSelectedItemPosition() == 1 ? View.VISIBLE : View.GONE;
        noteLabel.setVisibility(visibility);
        notePicker.setVisibility(visibility);
        notePicker.setEnabled(!noteIds.isEmpty());
    }

    private void save() {
        if (modePicker.getSelectedItemPosition() == 1 && noteIds.isEmpty()) {
            status.setText("This project has no notes yet. Choose Project notebook, then tap + on the widget to write one.");
            return;
        }
        rememberSelections();
        NotesWidgetProvider.saveConfig(this, widgetId, desiredProject, desiredNote);
        NotesWidgetProvider.update(this, AppWidgetManager.getInstance(this), widgetId);
        NotesRepository.get(this).requestSync();
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private void rememberSelections() {
        if (projectPicker == null || modePicker == null) return;
        desiredProject = selectedProject();
        int noteIndex = notePicker.getSelectedItemPosition();
        desiredNote = modePicker.getSelectedItemPosition() == 1 && noteIndex >= 0 && noteIndex < noteIds.size() ? noteIds.get(noteIndex) : "";
    }

    private String selectedProject() {
        int index = projectPicker.getSelectedItemPosition();
        return index >= 0 && index < projectIds.size() ? projectIds.get(index) : "";
    }

    private Spinner picker() {
        Spinner picker = new Spinner(this);
        picker.setMinimumHeight(dp(56));
        picker.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        return picker;
    }

    private ArrayAdapter<String> adapter(List<String> names) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, names);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.parseColor("#E2E8F0"));
        button.setMinHeight(dp(48));
        return button;
    }

    private TextView text(String value, int size, String color) {
        TextView label = new TextView(this);
        label.setText(value);
        label.setTextSize(size);
        label.setTextColor(Color.parseColor(color));
        label.setPadding(0, dp(10), 0, dp(10));
        return label;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
