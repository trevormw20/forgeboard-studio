package com.forgeboard.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Paint;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import com.forgeboard.notes.core.NotesCore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Native, notes-only front door. Project notebooks are derived from the shared workspace. */
public final class MainActivity extends Activity {
    private NotesRepository repository;
    private LinearLayout list;
    private TextView status, breadcrumb;
    private Spinner notebooks;
    private EditText search;
    private String projectId, parentId;
    private final List<String> projectIds = new ArrayList<>();
    private boolean rebuilding;
    private boolean receiverRegistered;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() { @Override public void run() { sync(); handler.postDelayed(this,30000); } };
    private final BroadcastReceiver changes = new BroadcastReceiver() { @Override public void onReceive(Context c,Intent i) { refreshProjects(); renderList(); updateStatus(); } };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); repository = NotesRepository.forIntent(this,getIntent());
        projectId = state == null ? nullable(getIntent().getStringExtra("projectId")) : nullable(state.getString("projectId"));
        parentId = state == null ? null : nullable(state.getString("parentId"));
        LinearLayout root = Ui.column(this); Ui.install(this,root);
        LinearLayout header = Ui.row(this); Ui.pad(header,16); LinearLayout brand = Ui.column(this); brand.addView(Ui.title(this,repository.isShared()?"Shared lists":BuildConfig.NIKI_PROFILE?"Niki Notes":"Forgeboard Notes",24)); brand.addView(Ui.muted(this,repository.isShared()?"Only lists you choose to share":"Your private notes")); header.addView(brand,new LinearLayout.LayoutParams(0,-2,1)); header.addView(Ui.button(this,"•••",this::menu)); root.addView(header);
        LinearLayout tools = Ui.column(this); tools.setPadding(Ui.dp(this,16),0,Ui.dp(this,16),Ui.dp(this,8)); root.addView(tools);
        LinearLayout spaces=Ui.row(this); spaces.addView(Ui.button(this,repository.isShared()?"‹ My notes":"Shared lists →",()->startActivity(NotesRepository.get(this,!repository.isShared()).target(new Intent(this,MainActivity.class))))); Button voice=Ui.button(this,"Voice note",()->startActivity(repository.target(new Intent(this,VoiceCaptureActivity.class).putExtra("projectId",projectId)))); voice.setTag("mainVoice"); spaces.addView(voice); tools.addView(spaces);
        notebooks = new Spinner(this); notebooks.setTag("projectSelector"); notebooks.setContentDescription("Project notebook"); notebooks.setMinimumHeight(Ui.dp(this,52)); tools.addView(notebooks,new LinearLayout.LayoutParams(-1,-2));
        notebooks.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onNothingSelected(android.widget.AdapterView<?> p) {}
            @Override public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int position,long id) { if(rebuilding || position >= projectIds.size()) return; String next = projectIds.get(position); if(!same(next,projectId)) { projectId = next; parentId = null; renderList(); } }
        });
        search = Ui.input(this,"Search this project’s notes","","notesSearch",false); tools.addView(search); search.addTextChangedListener(new android.text.TextWatcher() { public void beforeTextChanged(CharSequence s,int start,int count,int after) {} public void onTextChanged(CharSequence s,int start,int before,int count) { renderList(); } public void afterTextChanged(android.text.Editable e) {} });
        LinearLayout actions = Ui.row(this); Button add = Ui.button(this,"＋ New note",() -> openEditor(null,parentId)); add.setTag("mainAddNote"); actions.addView(add,new LinearLayout.LayoutParams(0,-2,1)); Button sync = Ui.button(this,"↻ Sync",this::sync); sync.setTag("mainSync"); actions.addView(sync); tools.addView(actions);
        status = Ui.muted(this,""); status.setTag("syncStatus"); status.setPadding(0,Ui.dp(this,6),0,Ui.dp(this,6)); tools.addView(status);
        breadcrumb = Ui.muted(this,""); breadcrumb.setMinHeight(Ui.dp(this,48)); breadcrumb.setGravity(android.view.Gravity.CENTER_VERTICAL); breadcrumb.setContentDescription("Back to parent notes"); breadcrumb.setOnClickListener(v -> { JSONObject note = NotesCore.findNote(repository.snapshot(),parentId); parentId = note == null ? null : nullable(note.optString("parentId")); renderList(); }); tools.addView(breadcrumb);
        ScrollView scroll = new ScrollView(this); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1)); list = Ui.column(this); list.setPadding(Ui.dp(this,16),Ui.dp(this,4),Ui.dp(this,16),Ui.dp(this,24)); scroll.addView(list);
        refreshProjects(); renderList(); updateStatus();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if(intent.hasExtra("projectId")) { projectId = nullable(intent.getStringExtra("projectId")); parentId = null; refreshProjects(); renderList(); } }
    // Runtime receiver flags do not exist on API26–32; API33+ uses NOT_EXPORTED explicitly.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onResume() { super.onResume(); if(!receiverRegistered) { IntentFilter filter = new IntentFilter(NotesRepository.ACTION_CHANGED); if(Build.VERSION.SDK_INT >= 33) registerReceiver(changes,filter,Context.RECEIVER_NOT_EXPORTED); else registerReceiver(changes,filter); receiverRegistered = true; } refreshProjects(); renderList(); updateStatus(); handler.removeCallbacks(poll); handler.post(poll); }
    @Override protected void onPause() { handler.removeCallbacks(poll); if(receiverRegistered) { unregisterReceiver(changes); receiverRegistered = false; } super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("projectId",projectId); out.putString("parentId",parentId); super.onSaveInstanceState(out); }
    private void refreshProjects() {
        if(notebooks == null) return; rebuilding = true; projectIds.clear(); projectIds.add(null); List<String> names = new ArrayList<>(); names.add("General notes"); JSONArray projects = repository.snapshot().optJSONArray("projects");
        if(projects != null) for(int i=0;i<projects.length();i++) { JSONObject p = projects.optJSONObject(i); if(p == null || deleted(p)) continue; projectIds.add(p.optString("id")); names.add(p.optString("name","Untitled project")); }
        JSONArray storedNotes=repository.snapshot().optJSONArray("personalNotes");
        if(storedNotes!=null) for(int i=0;i<storedNotes.length();i++) { JSONObject n=storedNotes.optJSONObject(i); if(n==null || deleted(n)) continue; String scope=nullable(n.optString("projectId")); if(scope!=null && !projectIds.contains(scope)) { projectIds.add(scope); names.add("Archived project notes"); } }
        if(!projectIds.contains(projectId)) { // Keep orphaned project notes reachable rather than hide them.
            if(projectId != null) { projectIds.add(projectId); names.add("Archived project notes"); } else projectId = null;
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,names); adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); notebooks.setAdapter(adapter); notebooks.setSelection(Math.max(0,projectIds.indexOf(projectId)),false); rebuilding = false;
    }
    private void renderList() {
        if(list == null) return; list.removeAllViews(); JSONObject ws = repository.snapshot(); JSONArray all = ws.optJSONArray("personalNotes"); List<JSONObject> notes = new ArrayList<>(); String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        if(parentId != null) { JSONObject p = NotesCore.findNote(ws,parentId); if(p == null || deleted(p) || !same(nullable(p.optString("projectId")),projectId)) parentId = null; }
        breadcrumb.setText(parentId == null ? "" : "‹ All notes / " + path(ws,parentId)); breadcrumb.setVisibility(parentId == null ? android.view.View.GONE : android.view.View.VISIBLE);
        List<JSONObject> active=NotesCore.activeNotes(ws,projectId);
        if(all != null) for(int i=0;i<all.length();i++) {
            JSONObject note = all.optJSONObject(i); if(note == null || deleted(note) || !same(nullable(note.optString("projectId")),projectId)) continue;
            String parent = NotesCore.noteParent(note,active);
            if(query.isEmpty() ? !same(parent,parentId) : !matches(note,query)) continue;
            notes.add(note);
        }
        notes.sort(Comparator.<JSONObject,Boolean>comparing(n -> !n.optBoolean("pinned")).thenComparing(n -> n.optString("updatedAt"),Comparator.reverseOrder()));
        List<JSONObject> conflicts=noteConflicts(); if(!conflicts.isEmpty()) { LinearLayout saved=Ui.card(this,"#34334f"); saved.addView(Ui.title(this,"Both versions are safe",18)); saved.addView(Ui.muted(this,"Some notes changed on more than one device. Compare and recover a separate copy; your original stays untouched.")); Button copies=Ui.button(this,"Saved conflict copies ("+conflicts.size()+")",this::conflictCopies); copies.setTag("savedConflictCopies"); saved.addView(copies); list.addView(saved); }
        if(notes.isEmpty()) { LinearLayout empty = Ui.card(this,null); empty.addView(Ui.title(this,query.isEmpty() ? "Room for your next thought" : "No matching notes",22)); Ui.gap(empty,10); empty.addView(Ui.muted(this,query.isEmpty() ? "Create a note, collect ideas, or make a checklist with as many levels as you need. Project sections stay in sync with Forgeboard." : "Try a word from the title, note, or checklist. Search stays inside this notebook.")); if(!repository.isConnected()) empty.addView(Ui.button(this,"Connect your private vault",() -> startActivity(repository.target(new Intent(this,ConnectionActivity.class))))); list.addView(empty); }
        for(JSONObject note : notes) addCard(ws,note,!query.isEmpty());
    }
    private void addCard(JSONObject ws,JSONObject note,boolean searching) {
        String id = note.optString("id"); int bg = Ui.color(note.optString("color"),Ui.SURFACE), ink = Ui.readable(bg); LinearLayout card = Ui.card(this,note.optString("color")); card.setTag("noteCard:"+id); card.setOnClickListener(v -> openEditor(id,null)); card.setContentDescription("Open note "+note.optString("title","Untitled note"));
        LinearLayout top = Ui.row(this); TextView title = Ui.text(this,(note.optBoolean("pinned") ? "● " : "") + (note.optString("title").isEmpty() ? "Untitled note" : note.optString("title")),19,ink); title.setTypeface(null,android.graphics.Typeface.BOLD); top.addView(title,new LinearLayout.LayoutParams(0,-2,1)); top.addView(Ui.button(this,"•••",() -> noteMenu(note))); card.addView(top);
        if(searching && nullable(note.optString("parentId")) != null) card.addView(Ui.text(this,path(ws,note.optString("parentId")),14,ink));
        if(!note.optString("body").isEmpty()) { TextView body = Ui.text(this,note.optString("body"),16,ink); body.setMaxLines(5); body.setEllipsize(android.text.TextUtils.TruncateAt.END); card.addView(body); Ui.gap(card,8); }
        List<NotesCore.Row> rows = NotesCore.orderedChecklist(note); int visible = Math.min(6,rows.size());
        for(int i=0;i<visible;i++) { NotesCore.Row row = rows.get(i); CheckBox check = new CheckBox(this); check.setText(row.item.optString("text")); check.setTextSize(15); check.setTextColor(ink); check.setMinHeight(Ui.dp(this,48)); check.setPadding(Ui.dp(this,Math.min(4,row.depth)*16),0,0,0); check.setChecked(MainActivity.nullable(row.item.optString("completedAt"))!=null); check.setButtonTintList(android.content.res.ColorStateList.valueOf(ink)); if(check.isChecked()) check.setPaintFlags(check.getPaintFlags()|Paint.STRIKE_THRU_TEXT_FLAG); check.setOnCheckedChangeListener((b,value) -> { try { repository.edit(w -> NotesCore.setChecklistChecked(w,id,row.item.optString("id"),value,Ui.now())); handler.postDelayed(this::sync,900); } catch(Exception e) { Ui.error(this,e); renderList(); } }); card.addView(check); }
        if(rows.size()>visible) card.addView(Ui.text(this,"+"+(rows.size()-visible)+" more checklist items",14,ink));
        JSONArray labels = note.optJSONArray("labelIds"), allLabels = ws.optJSONArray("noteLabels"); List<String> names = new ArrayList<>(); if(labels!=null && allLabels!=null) for(int i=0;i<allLabels.length();i++) { JSONObject label = allLabels.optJSONObject(i); if(label == null || deleted(label) || (nullable(label.optString("projectId"))!=null && !same(nullable(label.optString("projectId")),projectId))) continue; for(int j=0;j<labels.length();j++) if(same(label.optString("id"),labels.optString(j))) names.add(label.optString("name")); } if(!names.isEmpty()) { Ui.gap(card,8); card.addView(Ui.text(this,String.join("  ·  ",names),14,ink)); }
        int children = 0; List<JSONObject> active=NotesCore.activeNotes(ws,projectId); for(JSONObject n:active) if(same(NotesCore.noteParent(n,active),id)) children++;
        if(children>0) { Button open=Ui.button(this,"Open sub-notes ("+children+") →",() -> { parentId=id; search.setText(""); renderList(); }); card.addView(open); }
        Ui.gap(card,6); card.addView(Ui.text(this,"Edited "+Ui.date(note.optString("updatedAt")),14,ink)); list.addView(card);
    }
    private boolean matches(JSONObject note,String query) { if((note.optString("title")+" "+note.optString("body")).toLowerCase(Locale.ROOT).contains(query)) return true; for(NotesCore.Row row:NotesCore.orderedChecklist(note)) if(row.item.optString("text").toLowerCase(Locale.ROOT).contains(query)) return true; return false; }
    private String path(JSONObject ws,String id) { List<String> bits=new ArrayList<>(); java.util.HashSet<String> seen=new java.util.HashSet<>(); while(id!=null && seen.add(id) && bits.size()<8) { JSONObject n=NotesCore.findNote(ws,id); if(n==null || deleted(n) || !same(nullable(n.optString("projectId")),projectId)) break; bits.add(0,n.optString("title").isEmpty()?"Untitled":n.optString("title")); id=nullable(n.optString("parentId")); } return String.join(" / ",bits); }
    private void noteMenu(JSONObject note) { String id=note.optString("id"); new AlertDialog.Builder(this).setTitle(note.optString("title","Note")).setItems(new String[]{note.optBoolean("pinned")?"Unpin note":"Pin note","Open sub-notes","Add sub-note","Move to deleted notes"},(d,index) -> { if(index==1) { parentId=id; search.setText(""); renderList(); return; } if(index==2) { openEditor(null,id); return; } try { if(index==0) repository.edit(w -> NotesCore.updateNote(w,id,new JSONObject().put("pinned",!note.optBoolean("pinned")),Ui.now())); else repository.edit(w -> NotesCore.deleteNote(w,id,Ui.now())); renderList(); updateStatus(); if(index==3) new AlertDialog.Builder(this).setMessage("Note and its sub-notes moved to Deleted notes.").setNegativeButton("Done",null).setPositiveButton("Undo",(x,y)->{ try { repository.edit(w->NotesCore.restoreNote(w,id,Ui.now())); renderList(); } catch(Exception e) { Ui.error(this,e); } }).show(); sync(); } catch(Exception e) { Ui.error(this,e); } }).show(); }
    private void openEditor(String id,String parent) { Intent intent=repository.target(new Intent(this,NoteEditorActivity.class)); if(id!=null) intent.putExtra(NoteEditorActivity.EXTRA_NOTE_ID,id); if(projectId!=null) intent.putExtra(NoteEditorActivity.EXTRA_PROJECT_ID,projectId); if(parent!=null) intent.putExtra("parentId",parent); startActivity(intent); }
    private void menu() { new AlertDialog.Builder(this).setTitle("Forgeboard Notes").setItems(new String[]{"Add home-screen widget","Deleted notes in this project","Private vault connection","About syncing"},(d,index) -> { if(index==0) pinWidget(); else if(index==1) trash(); else if(index==2) startActivity(repository.target(new Intent(this,ConnectionActivity.class))); else Ui.message(this,"Your notes, on every device","Notes use the same private GitHub workspace as Forgeboard. Offline edits are saved on this phone and queued for syncing. Sync runs while this app is open and periodically for widgets; Android may delay background updates. Tap Sync to refresh now. Widget + opens a small notes editor, not the full planner."); }).show(); }
    private void pinWidget() { AppWidgetManager manager=AppWidgetManager.getInstance(this); if(manager.isRequestPinAppWidgetSupported()) manager.requestPinAppWidget(new ComponentName(this,NotesWidgetProvider.class),null,null); else Ui.message(this,"Add a widget","Touch and hold an empty spot on your home screen, choose Widgets, then Forgeboard Notes. Select a project or a pinned note."); }
    private boolean snapshotInNotebook(JSONObject note) { if(note==null || !(note.opt("body") instanceof String)) return false; String scope=nullable(note.optString("projectId")); if(same(scope,projectId)) return true; if(projectId!=null) return false; JSONArray projects=repository.snapshot().optJSONArray("projects"); if(projects!=null) for(int i=0;i<projects.length();i++) { JSONObject p=projects.optJSONObject(i); if(p!=null && !deleted(p) && same(p.optString("id"),scope)) return false; } return true; }
    private List<JSONObject> noteConflicts() { List<JSONObject> result=new ArrayList<>(); JSONArray all=repository.snapshot().optJSONArray("conflicts"); if(all!=null) for(int i=0;i<all.length();i++) { JSONObject c=all.optJSONObject(i); if(c!=null && "personal-note".equals(c.optString("entityType")) && (snapshotInNotebook(c.optJSONObject("local")) || snapshotInNotebook(c.optJSONObject("remote")))) result.add(c); } return result; }
    private void conflictCopies() { List<JSONObject> copies=noteConflicts(); List<String> names=new ArrayList<>(); for(JSONObject c:copies) { JSONObject n=c.optJSONObject("local"); if(!snapshotInNotebook(n)) n=c.optJSONObject("remote"); names.add((n==null || n.optString("title").isEmpty()?"Untitled note":n.optString("title"))+"\n"+Ui.date(c.optString("detectedAt"))); } new AlertDialog.Builder(this).setTitle("Saved conflict copies").setItems(names.toArray(new String[0]),(d,i)->chooseConflictVersion(copies.get(i))).setNegativeButton("Close",null).show(); }
    private void chooseConflictVersion(JSONObject conflict) { List<JSONObject> versions=new ArrayList<>(); List<String> names=new ArrayList<>(); if(snapshotInNotebook(conflict.optJSONObject("local"))) { versions.add(conflict.optJSONObject("local")); names.add("Saved version A"); } if(snapshotInNotebook(conflict.optJSONObject("remote"))) { versions.add(conflict.optJSONObject("remote")); names.add("Saved version B"); } new AlertDialog.Builder(this).setTitle("Compare a saved version").setItems(names.toArray(new String[0]),(d,i)->previewConflict(versions.get(i),names.get(i))).setNegativeButton("Back",(d,w)->conflictCopies()).show(); }
    private void previewConflict(JSONObject snapshot,String label) { StringBuilder preview=new StringBuilder(snapshot.optString("title")).append("\n\n"); String text=snapshot.optString("body"); preview.append(text.length()>6000?text.substring(0,6000)+"\n[Preview shortened — recovery keeps the full note]":text); int shown=0; for(NotesCore.Row row:NotesCore.orderedChecklist(snapshot)) { if(shown++>=50) { preview.append("\n[More checklist items — all are preserved]"); break; } preview.append('\n'); for(int depth=0;depth<Math.min(row.depth,6);depth++) preview.append("  "); preview.append(nullable(row.item.optString("completedAt"))==null?"☐ ":"☑ ").append(row.item.optString("text")); } preview.append("\n\nRecovering makes a separate top-level note. The original and both saved versions remain unchanged. If its original project is unavailable, the copy goes into General."); new AlertDialog.Builder(this).setTitle(label).setMessage(preview.toString()).setNegativeButton("Close",null).setPositiveButton("Recover as new note",(d,w)->{ String[] id={null}; try { repository.edit(ws->id[0]=NotesCore.recoverNoteSnapshot(ws,snapshot,Ui.now())); renderList(); sync(); startActivity(repository.target(new Intent(this,NoteEditorActivity.class).putExtra(NoteEditorActivity.EXTRA_NOTE_ID,id[0]))); } catch(Exception e) { Ui.error(this,e); } }).show(); }
    private void trash() { List<JSONObject> deleted=new ArrayList<>(); List<String> names=new ArrayList<>(); for(JSONObject n:NotesCore.deletedNoteRoots(repository.snapshot())) if(same(nullable(n.optString("projectId")),projectId)) { deleted.add(n); names.add(n.optString("title").isEmpty()?"Untitled note":n.optString("title")); } if(deleted.isEmpty()) { Ui.message(this,"Deleted notes","No deleted notes in this notebook. Deleted notes remain recoverable; nothing is permanently erased here."); return; } new AlertDialog.Builder(this).setTitle("Tap a note to restore").setItems(names.toArray(new String[0]),(d,i)->{ try { repository.edit(w->NotesCore.restoreNote(w,deleted.get(i).optString("id"),Ui.now())); renderList(); sync(); } catch(Exception e) { Ui.error(this,e); } }).setNegativeButton("Close",null).show(); }
    private void sync() { if(repository==null) return; repository.sync(error->{ if(isFinishing() || isDestroyed()) return; updateStatus(); renderList(); }); updateStatus(); }
    private void updateStatus() { if(status==null) return; String message=repository.statusMessage(); String last=repository.lastSyncAt(); status.setText((message==null?"":message)+(last==null || last.isEmpty()?"":"\nLast synced "+Ui.date(last))); }
    static String nullable(String s) { return s==null || s.isEmpty() || s.equals("null") ? null : s; }
    static boolean same(String a,String b) { return java.util.Objects.equals(a,b); }
    static boolean deleted(JSONObject o) { return o!=null && nullable(o.optString("deletedAt"))!=null; }
}
