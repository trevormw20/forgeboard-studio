package com.forgeboard.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Paint;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.forgeboard.notes.core.NotesCore;
import com.forgeboard.notes.core.CaptureCore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A small native editor shared by app and widget. Checkbox completion is always independent. */
public final class NoteEditorActivity extends Activity {
    public static final String EXTRA_NOTE_ID = "noteId";
    public static final String EXTRA_PROJECT_ID = "projectId";
    private NotesRepository repository;
    private String noteId, projectId;
    private EditText title, body;
    private TextView status, location;
    private LinearLayout checklist, labels, children;
    private Button pin;
    private boolean titleDirty, bodyDirty, loading;
    private boolean receiverRegistered;
    private boolean draftBlocked;
    private String knownTitle="",knownBody="";
    private final Map<String,JSONObject> knownItems=new LinkedHashMap<>();
    private android.window.OnBackInvokedCallback backCallback;
    private final Map<String,String> pendingText = new LinkedHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable saveDraft = this::flush;
    private final Runnable upload = () -> repository.sync(error -> { if(!isFinishing() && !isDestroyed()) updateStatus(error); });
    private final Runnable poll = new Runnable() { @Override public void run() { VoiceCaptureManager.get(NoteEditorActivity.this).process(null); repository.sync(error -> { if(!isFinishing() && !isDestroyed()) { refreshFromRepository(); updateStatus(error); } }); handler.postDelayed(this,30000); } };
    private final BroadcastReceiver changes=new BroadcastReceiver() { @Override public void onReceive(Context c,Intent intent) { refreshFromRepository(); } };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); repository = NotesRepository.forIntent(this,getIntent());
        noteId = state == null ? MainActivity.nullable(getIntent().getStringExtra(EXTRA_NOTE_ID)) : state.getString(EXTRA_NOTE_ID);
        projectId = MainActivity.nullable(getIntent().getStringExtra(EXTRA_PROJECT_ID));
        if(noteId == null) { String[] created = new String[1]; try { repository.edit(ws -> created[0] = NotesCore.addNote(ws,projectId,MainActivity.nullable(getIntent().getStringExtra("parentId")),"","",null,Ui.now())); noteId = created[0]; } catch(Exception e) { unavailable("Couldn’t open a note",e.getMessage()); return; } }
        JSONObject note = note(); if(note == null) { unavailable("Note unavailable","This note is not in the local workspace. Open Forgeboard Notes and sync, then try again."); return; } projectId = MainActivity.nullable(note.optString("projectId"));
        LinearLayout root = Ui.column(this); Ui.install(this,root);
        if(android.os.Build.VERSION.SDK_INT>=33) { backCallback=this::leave; getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,backCallback); }
        LinearLayout header=Ui.row(this); Ui.pad(header,12); Button back=Ui.button(this,"‹ Notes",this::leave); header.addView(back); header.addView(Ui.title(this,"Your note",20),new LinearLayout.LayoutParams(0,-2,1)); header.addView(Ui.button(this,"↻",this::sync)); root.addView(header);
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1)); LinearLayout content=Ui.column(this); content.setPadding(Ui.dp(this,18),Ui.dp(this,4),Ui.dp(this,18),Ui.dp(this,32)); scroll.addView(content);
        location=Ui.muted(this,""); content.addView(location); Ui.gap(content,8);
        title=Ui.input(this,"Note title",note.optString("title"),"noteTitle",true); title.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(300)}); title.setTextSize(24); title.setTypeface(null,android.graphics.Typeface.BOLD); content.addView(title);
        body=Ui.input(this,"Write a note…",note.optString("body"),"noteBody",true); body.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(100000)}); body.setMinLines(3); body.setVisibility(note.optString("body").isEmpty()?android.view.View.GONE:android.view.View.VISIBLE); content.addView(body);
        knownTitle=note.optString("title"); knownBody=note.optString("body"); title.addTextChangedListener(watcher(() -> titleDirty=true)); body.addTextChangedListener(watcher(() -> bodyDirty=true));
        LinearLayout tools=Ui.row(this); pin=Ui.button(this,"Pin",this::togglePin); tools.addView(pin); tools.addView(Ui.button(this,"Color",this::noteColor)); tools.addView(Ui.button(this,"Labels",this::labelPicker)); content.addView(tools);
        Button talk=Ui.button(this,"🎙 Talk to Claude · add to this note",()->{ if(flush())startActivity(repository.target(new Intent(this,VoiceCaptureActivity.class).putExtra(EXTRA_NOTE_ID,noteId).putExtra(EXTRA_PROJECT_ID,projectId).putExtra(VoiceCaptureActivity.EXTRA_NOTE_AWARE,true))); });talk.setTag("noteTalkClaude");content.addView(talk,new LinearLayout.LayoutParams(-1,-2));
        labels=Ui.column(this); content.addView(labels); status=Ui.muted(this,""); status.setTag("editorStatus"); status.setPadding(0,Ui.dp(this,8),0,Ui.dp(this,16)); content.addView(status);
        content.addView(Ui.title(this,"Checklist",20)); content.addView(Ui.muted(this,"Slide the handle right to indent or left to outdent. Use ••• for more options. Each box is independent.")); Ui.gap(content,8);
        checklist=Ui.column(this); content.addView(checklist); Button add=Ui.button(this,"＋ Add checklist item",() -> addItem(null,null)); add.setTag("checklistAdd"); content.addView(add,new LinearLayout.LayoutParams(-1,-2)); content.addView(Ui.button(this,"Restore deleted checklist items",this::checklistTrash));
        Ui.gap(content,24); content.addView(Ui.title(this,"Sub-notes",20)); children=Ui.column(this); content.addView(children); content.addView(Ui.button(this,"＋ Add sub-note",() -> { if(!flush()) return; Intent intent=repository.target(new Intent(this,NoteEditorActivity.class)); intent.putExtra(EXTRA_PROJECT_ID,projectId); intent.putExtra("parentId",noteId); startActivity(intent); }));
        if(!repository.isShared())content.addView(Ui.button(this,"Share this list with Niki / household",this::shareNote));
        Ui.gap(content,20); content.addView(Ui.button(this,"Move note to Deleted notes",this::deleteNote));
        renderMetadata(); renderChecklist(); renderChildren(); updateStatus(null);
        if(MainActivity.deleted(note)) new AlertDialog.Builder(this).setTitle("This note is deleted").setMessage("Restore this note and its sub-notes to edit them.").setCancelable(false).setNegativeButton("Back",(d,w)->finish()).setPositiveButton("Restore",(d,w)->mutate(ws->NotesCore.restoreNote(ws,noteId,Ui.now()),true)).show();
    }
    private TextWatcher watcher(Runnable changed) { return new TextWatcher() { public void beforeTextChanged(CharSequence s,int start,int count,int after) {} public void onTextChanged(CharSequence s,int start,int before,int count) { if(!loading) { changed.run(); handler.removeCallbacks(saveDraft); handler.postDelayed(saveDraft,350); if(status!=null) status.setText("Saving…"); } } public void afterTextChanged(Editable e) {} }; }
    private JSONObject note() { return NotesCore.findNote(repository.snapshot(),noteId); }
    /** Flush only dirty fields into the latest repository snapshot, never a stale full note. */
    private boolean flush() {
        handler.removeCallbacks(saveDraft); if(title==null || (!titleDirty && !bodyDirty && pendingText.isEmpty())) return true;
        boolean saveTitle=titleDirty, saveBody=bodyDirty; String titleText=title.getText().toString(), bodyText=body.getText().toString(); Map<String,String> edits=new LinkedHashMap<>(pendingText);
        final JSONObject[] retained={null};
        try { repository.edit(ws -> {
            JSONObject latest=NotesCore.findNote(ws,noteId); if(latest==null) throw new IllegalArgumentException("The note is unavailable. Keep the editor open and copy your draft.");
            JSONObject draft=new JSONObject(latest.toString()); if(saveTitle) draft.put("title",titleText); if(saveBody) draft.put("body",bodyText);
            boolean stale=saveTitle&&!latest.optString("title").equals(knownTitle)&&!latest.optString("title").equals(titleText) || saveBody&&!latest.optString("body").equals(knownBody)&&!latest.optString("body").equals(bodyText);
            boolean blocked=MainActivity.deleted(latest); JSONArray items=draft.optJSONArray("checklist"); if(items==null) { items=new JSONArray(); draft.put("checklist",items); }
            for(Map.Entry<String,String> entry:edits.entrySet()) { JSONObject item=null; for(int i=0;i<items.length();i++) { JSONObject candidate=items.optJSONObject(i); if(candidate!=null && MainActivity.same(candidate.optString("id"),entry.getKey())) item=candidate; } JSONObject expected=knownItems.get(entry.getKey());
                if(item==null || MainActivity.deleted(item)) { blocked=true; if(expected!=null) { JSONObject copy=new JSONObject(expected.toString()); copy.put("text",entry.getValue()); copy.remove("deletedAt"); boolean replaced=false; for(int i=0;i<items.length();i++) if(items.optJSONObject(i)!=null && MainActivity.same(items.optJSONObject(i).optString("id"),entry.getKey())) { items.put(i,copy); replaced=true; break; } if(!replaced) items.put(copy); } }
                else { if(expected!=null && !item.optString("text").equals(expected.optString("text")) && !item.optString("text").equals(entry.getValue())) stale=true; item.put("text",entry.getValue()); }
            }
            if(stale || blocked) { draft.put("updatedAt",Ui.now()); JSONArray conflicts=ws.optJSONArray("conflicts"); if(conflicts==null) { conflicts=new JSONArray(); ws.put("conflicts",conflicts); } conflicts.put(new JSONObject().put("id","conflict-editor-"+java.util.UUID.randomUUID()).put("entityType","personal-note").put("entityId",noteId).put("detectedAt",Ui.now()).put("local",draft).put("remote",new JSONObject(latest.toString())).put("resolution","Preserved the editor draft and the latest synced version as separate full snapshots.")); }
            if(blocked) { retained[0]=draft; return; }
            JSONObject changes=new JSONObject(); if(saveTitle) changes.put("title",titleText); if(saveBody) changes.put("body",bodyText); if(changes.length()>0) NotesCore.updateNote(ws,noteId,changes,Ui.now()); for(Map.Entry<String,String> entry:edits.entrySet()) NotesCore.updateChecklistText(ws,noteId,entry.getKey(),entry.getValue(),Ui.now());
        }); titleDirty=false; bodyDirty=false; if(saveTitle) knownTitle=titleText; if(saveBody) knownBody=bodyText; for(String id:edits.keySet()) { pendingText.remove(id); JSONObject item=knownItems.get(id); if(item!=null) item.put("text",edits.get(id)); } updateStatus(null); scheduleUpload(); if(retained[0]!=null) { draftBlocked=true; offerRetainedDraft(retained[0]); return false; } return true; }
        catch(Exception e) { if(status!=null) status.setText("Not saved: "+e.getMessage()+". Keep this editor open and try again."); return false; }
    }
    private void scheduleUpload() { handler.removeCallbacks(upload); handler.postDelayed(upload,1400); }
    private void updateStatus(String error) { if(status==null) return; String last=repository.lastSyncAt(); status.setText(error!=null ? error : repository.statusMessage()+(last==null || last.isEmpty()?"":"\nLast synced "+Ui.date(last))); }
    private boolean mutate(NotesRepository.Edit action,boolean redraw) { if(!flush()) return false; try { repository.edit(action); if(redraw) { renderMetadata(); renderChecklist(); renderChildren(); } updateStatus(null); scheduleUpload(); return true; } catch(Exception e) { Ui.error(this,e); return false; } }
    private void renderMetadata() {
        JSONObject note=note(); if(note==null) return; String project="General notes"; JSONArray projects=repository.snapshot().optJSONArray("projects"); if(projects!=null) for(int i=0;i<projects.length();i++) { JSONObject p=projects.optJSONObject(i); if(p!=null && MainActivity.same(p.optString("id"),projectId)) project=p.optString("name"); }
        String parent=MainActivity.nullable(note.optString("parentId")); JSONObject parentNote=NotesCore.findNote(repository.snapshot(),parent); location.setText(project+(parentNote==null?"":" / "+(parentNote.optString("title").isEmpty()?"Untitled parent":parentNote.optString("title"))));
        pin.setText(note.optBoolean("pinned")?"● Pinned":"Pin"); labels.removeAllViews(); JSONArray selected=note.optJSONArray("labelIds"), all=repository.snapshot().optJSONArray("noteLabels"); if(selected!=null && all!=null) for(int i=0;i<all.length();i++) { JSONObject label=all.optJSONObject(i); if(label==null || MainActivity.deleted(label) || !allowedLabel(label)) continue; boolean included=false; for(int j=0;j<selected.length();j++) if(MainActivity.same(selected.optString(j),label.optString("id"))) included=true; if(included) { TextView chip=Ui.text(this,label.optString("name"),14,Ui.readable(Ui.color(label.optString("color"),Ui.SURFACE))); Ui.pad(chip,8); chip.setBackground(Ui.shape(Ui.color(label.optString("color"),Ui.SURFACE),Ui.dp(this,10))); LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-2,-2); lp.setMargins(0,Ui.dp(this,4),0,Ui.dp(this,4)); labels.addView(chip,lp); } }
    }
    private void togglePin() { JSONObject n=note(); if(n!=null) mutate(ws->NotesCore.updateNote(ws,noteId,new JSONObject().put("pinned",!n.optBoolean("pinned")),Ui.now()),true); }
    private void renderChecklist() {
        checklist.removeAllViews(); JSONObject n=note(); if(n==null) return; knownItems.clear();
        List<NotesCore.Row> ordered=NotesCore.orderedChecklist(n); Map<String,List<NotesCore.Row>> additions=CaptureCore.branchEnds(ordered);
        for(NotesCore.Row item:ordered) {
            try { knownItems.put(item.item.optString("id"),new JSONObject(item.item.toString())); } catch(Exception ignored) { }
            String id=item.item.optString("id"); LinearLayout wrap=Ui.column(this); wrap.setPadding(Ui.dp(this,Math.min(item.depth,3)*16),0,0,0); LinearLayout row=Ui.row(this); row.setGravity(Gravity.TOP); row.setBackground(Ui.shape(Ui.SURFACE,Ui.dp(this,12))); LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(-1,-2); rp.bottomMargin=Ui.dp(this,7); wrap.addView(row,rp);
            Button grip=Ui.button(this,"⠿",() -> itemMenu(id)); grip.setContentDescription("Drag to indent checklist item, or tap for options"); grip.setMinWidth(Ui.dp(this,48)); grip.setMinimumWidth(Ui.dp(this,48)); grip.setPadding(0,0,0,0); row.addView(grip,new LinearLayout.LayoutParams(Ui.dp(this,48),Ui.dp(this,52))); final float[] down={0}; final boolean[] moved={false};
            grip.setOnTouchListener((v,event) -> { if(event.getAction()==MotionEvent.ACTION_DOWN) { down[0]=event.getRawX(); moved[0]=false; return true; } if(event.getAction()==MotionEvent.ACTION_MOVE && Math.abs(event.getRawX()-down[0])>Ui.dp(this,18)) { moved[0]=true; v.getParent().requestDisallowInterceptTouchEvent(true); return true; } if(event.getAction()==MotionEvent.ACTION_UP) { float dx=event.getRawX()-down[0]; if(Math.abs(dx)>Ui.dp(this,42)) move(id,dx>0?"indent":"outdent"); else if(!moved[0]) v.performClick(); return true; } return event.getAction()==MotionEvent.ACTION_CANCEL; });
            CheckBox check=new CheckBox(this); check.setContentDescription("Complete "+item.item.optString("text")); check.setTag("checklistCheck:"+id); check.setChecked(MainActivity.nullable(item.item.optString("completedAt"))!=null); check.setButtonTintList(android.content.res.ColorStateList.valueOf(Ui.ACCENT)); check.setMinHeight(Ui.dp(this,52)); check.setMinWidth(Ui.dp(this,48)); row.addView(check,new LinearLayout.LayoutParams(Ui.dp(this,48),Ui.dp(this,52)));
            EditText text=Ui.input(this,"Checklist item",pendingText.containsKey(id)?pendingText.get(id):item.item.optString("text"),"checklistText:"+id,true); text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(10000)}); text.setPadding(Ui.dp(this,2),Ui.dp(this,12),Ui.dp(this,2),Ui.dp(this,12)); text.setBackgroundColor(android.graphics.Color.TRANSPARENT); text.setTextSize(16); if(check.isChecked()) { text.setPaintFlags(text.getPaintFlags()|Paint.STRIKE_THRU_TEXT_FLAG); text.setTextColor(Ui.MUTED); } row.addView(text,new LinearLayout.LayoutParams(0,-2,1)); text.addTextChangedListener(watcher(() -> pendingText.put(id,text.getText().toString())));
            check.setOnCheckedChangeListener((b,value) -> { if(loading) return; if(mutate(ws->NotesCore.setChecklistChecked(ws,noteId,id,value,Ui.now()),false)) { text.setPaintFlags(value?text.getPaintFlags()|Paint.STRIKE_THRU_TEXT_FLAG:text.getPaintFlags()&~Paint.STRIKE_THRU_TEXT_FLAG); text.setTextColor(value?Ui.MUTED:Ui.TEXT); } else { loading=true; check.setChecked(!value); loading=false; } });
            text.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
            text.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_NEXT|android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
            text.setOnEditorActionListener((v,action,event)->{ if(action==android.view.inputmethod.EditorInfo.IME_ACTION_NEXT || action==android.view.inputmethod.EditorInfo.IME_ACTION_DONE || (event!=null && event.getKeyCode()==android.view.KeyEvent.KEYCODE_ENTER)) { if(event==null || event.getAction()==android.view.KeyEvent.ACTION_DOWN && event.getRepeatCount()==0) addItem(MainActivity.nullable(item.item.optString("parentId")),id); return true; } return false; });
            text.setOnKeyListener((v,key,event)->{ if(key==android.view.KeyEvent.KEYCODE_ENTER && !event.isShiftPressed()) { if(event.getAction()==android.view.KeyEvent.ACTION_DOWN && event.getRepeatCount()==0)addItem(MainActivity.nullable(item.item.optString("parentId")),id); return true; } if(event.getAction()!=android.view.KeyEvent.ACTION_DOWN)return false; if(key==android.view.KeyEvent.KEYCODE_TAB) { move(id,event.isShiftPressed()?"outdent":"indent"); return true; } return false; });
            Button options=Ui.button(this,"•••",()->itemMenu(id)); options.setContentDescription("Options for "+item.item.optString("text")); options.setPadding(0,0,0,0); row.addView(options,new LinearLayout.LayoutParams(Ui.dp(this,48),Ui.dp(this,52))); checklist.addView(wrap);
            if(item.depth>3) { TextView depth=Ui.muted(this,"Nested level "+(item.depth+1)); wrap.addView(depth); }
            if(additions.containsKey(id)) for(NotesCore.Row parent:additions.get(id)) {
                Button add=Ui.button(this,"＋",()->addItem(parent.item.optString("id"),null)); add.setContentDescription("Add checkbox to "+parent.item.optString("text")); add.setTag("checklistGroupAdd:"+parent.item.optString("id"));
                LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(Ui.dp(this,48),Ui.dp(this,48)); lp.leftMargin=Ui.dp(this,Math.max(0,Math.min(parent.depth+1,3)-Math.min(item.depth,3))*16); wrap.addView(add,lp);
            }
        }
    }
    private void shareNote() {
        if(!flush())return; JSONObject selected=note(); if(selected==null)return; NotesRepository shared=NotesRepository.get(this,true);
        if(!shared.isConnected()) { new AlertDialog.Builder(this).setTitle("Connect Shared lists first").setMessage("A separate private repository holds only lists you choose to share. Your planner and other notes stay private.").setNegativeButton("Cancel",null).setPositiveButton("Connect",(d,w)->startActivity(shared.target(new Intent(this,ConnectionActivity.class)))).show(); return; }
        new AlertDialog.Builder(this).setTitle("Share this selected list?").setMessage("Its title, text and active checkboxes will be copied into Shared lists, where both of you can edit them. Other notes and sub-notes are not shared. Your original stays private and is not a two-way mirror; use Shared lists for ongoing changes.").setNegativeButton("Cancel",null).setPositiveButton("Share selected list",(d,w)->{ try { String[] id={null}; shared.edit(ws->id[0]=CaptureCore.share(ws,selected,repository.config().identity(),Ui.now())); shared.sync(error->{}); startActivity(shared.target(new Intent(this,NoteEditorActivity.class).putExtra(EXTRA_NOTE_ID,id[0]))); } catch(Exception e){Ui.error(this,e);} }).show();
    }
    private void itemMenu(String id) { new AlertDialog.Builder(this).setTitle("Checklist item").setItems(new String[]{"Add sub-checkbox","Add item below","Indent →","← Outdent","Move up","Move down","Delete item and sub-items"},(d,i)->{ if(i==0) addItem(id,null); else if(i==1) { JSONObject item=findItem(id); addItem(item==null?null:MainActivity.nullable(item.optString("parentId")),id); } else if(i==6) mutate(ws->NotesCore.deleteChecklistItem(ws,noteId,id,Ui.now()),true); else move(id,new String[]{"indent","outdent","up","down"}[i-2]); }).show(); }
    private JSONObject findItem(String id) { JSONObject n=note(); if(n==null) return null; JSONArray a=n.optJSONArray("checklist"); if(a!=null) for(int i=0;i<a.length();i++) { JSONObject item=a.optJSONObject(i); if(item!=null && MainActivity.same(id,item.optString("id"))) return item; } return null; }
    private void move(String id,String direction) { mutate(ws->NotesCore.moveChecklistItem(ws,noteId,id,direction,Ui.now()),true); }
    private void addItem(String parent,String after) { final String[] id={null}; if(mutate(ws->id[0]=NotesCore.addChecklistItem(ws,noteId,"",parent,after,Ui.now()),true)) { EditText target=checklist.findViewWithTag("checklistText:"+id[0]); if(target!=null) { target.requestFocus(); target.post(()->((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(target,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)); } } }
    private void checklistTrash() { JSONObject n=note(); List<JSONObject> items=n==null?new ArrayList<>():NotesCore.deletedChecklistRoots(n); List<String> names=new ArrayList<>(); for(JSONObject item:items) names.add(item.optString("text").isEmpty()?"Untitled item":item.optString("text")); if(items.isEmpty()) { Ui.message(this,"Deleted checklist items","No deleted checklist items. Deleting a parent keeps its sub-items together for recovery."); return; } new AlertDialog.Builder(this).setTitle("Tap an item to restore its group").setItems(names.toArray(new String[0]),(d,i)->mutate(ws->NotesCore.restoreChecklistItem(ws,noteId,items.get(i).optString("id"),Ui.now()),true)).setNegativeButton("Close",null).show(); }
    private void renderChildren() { if(children==null) return; children.removeAllViews(); JSONArray notes=repository.snapshot().optJSONArray("personalNotes"); if(notes==null) return; for(int i=0;i<notes.length();i++) { JSONObject n=notes.optJSONObject(i); if(n==null || MainActivity.deleted(n) || !MainActivity.same(n.optString("parentId"),noteId) || !MainActivity.same(MainActivity.nullable(n.optString("projectId")),projectId)) continue; children.addView(Ui.button(this,(n.optString("title").isEmpty()?"Untitled note":n.optString("title"))+" →",()->{ if(flush()) startActivity(repository.target(new Intent(this,NoteEditorActivity.class).putExtra(EXTRA_NOTE_ID,n.optString("id")))); })); } }
    private void noteColor() { chooseColor(note()==null?null:note().optString("color"),value->mutate(ws->NotesCore.updateNote(ws,noteId,new JSONObject().put("color",value==null?JSONObject.NULL:value),Ui.now()),true)); }
    private interface ColorResult { void picked(String color); }
    private void chooseColor(String current,ColorResult result) { String[] names={"Default slate","Ocean · "+Ui.COLORS[1],"Lavender · "+Ui.COLORS[2],"Plum · "+Ui.COLORS[3],"Sand · "+Ui.COLORS[4],"Forest · "+Ui.COLORS[5],"Rose · "+Ui.COLORS[6],"Blue · "+Ui.COLORS[7],"Custom hex color…"}; new AlertDialog.Builder(this).setTitle("Choose a color").setItems(names,(d,i)->{ if(i<8) result.picked(i==0?null:Ui.COLORS[i]); else { EditText input=Ui.input(this,"Hex color, for example #785bc7",current==null?"#34334f":current,"customColor",false); new AlertDialog.Builder(this).setTitle("Custom color").setView(input).setNegativeButton("Cancel",null).setPositiveButton("Apply",(a,b)->{ try { String value=input.getText().toString().trim(); if(!value.matches("#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}")) throw new IllegalArgumentException("Use a hex color such as #785bc7."); result.picked(value); } catch(Exception e) { Ui.error(this,e); } }).show(); } }).show(); }
    private boolean allowedLabel(JSONObject label) { String scope=MainActivity.nullable(label.optString("projectId")); return scope==null || MainActivity.same(scope,projectId); }
    private List<JSONObject> availableLabels() { List<JSONObject> result=new ArrayList<>(); JSONArray all=repository.snapshot().optJSONArray("noteLabels"); if(all!=null) for(int i=0;i<all.length();i++) { JSONObject label=all.optJSONObject(i); if(label!=null && !MainActivity.deleted(label) && allowedLabel(label)) result.add(label); } return result; }
    private void labelPicker() { if(!flush()) return; List<JSONObject> all=availableLabels(); String[] names=new String[all.size()]; boolean[] checked=new boolean[all.size()]; JSONArray selected=note().optJSONArray("labelIds"); for(int i=0;i<all.size();i++) { names[i]=all.get(i).optString("name"); if(selected!=null) for(int j=0;j<selected.length();j++) if(MainActivity.same(all.get(i).optString("id"),selected.optString(j))) checked[i]=true; } new AlertDialog.Builder(this).setTitle(all.isEmpty()?"Create your first label":"Labels for this note").setMultiChoiceItems(names,checked,(d,i,value)->checked[i]=value).setNegativeButton("Cancel",null).setNeutralButton("Manage labels",(d,w)->manageLabels()).setPositiveButton("Apply",(d,w)->{ JSONArray ids=new JSONArray(); for(int i=0;i<all.size();i++) if(checked[i]) ids.put(all.get(i).optString("id")); mutate(ws->NotesCore.updateNote(ws,noteId,new JSONObject().put("labelIds",ids),Ui.now()),true); }).show(); }
    private void manageLabels() { List<JSONObject> all=availableLabels(); String[] names=new String[all.size()+1]; names[0]="＋ New label in this notebook"; for(int i=0;i<all.size();i++) names[i+1]=all.get(i).optString("name"); new AlertDialog.Builder(this).setTitle("Manage labels").setItems(names,(d,i)->editLabel(i==0?null:all.get(i-1))).setNegativeButton("Close",null).show(); }
    private void editLabel(JSONObject label) { LinearLayout layout=Ui.column(this); Ui.pad(layout,16); EditText name=Ui.input(this,"Label name",label==null?"":label.optString("name"),"labelName",false); layout.addView(name); EditText color=Ui.input(this,"Label color (#785bc7)",label==null?"#34334f":label.optString("color"),"labelColor",false); layout.addView(color); AlertDialog.Builder dialog=new AlertDialog.Builder(this).setTitle(label==null?"New label":"Edit label").setView(layout).setNegativeButton("Cancel",null).setPositiveButton("Save",(d,w)->{ String[] id={null}; if(mutate(ws->{ id[0]=NotesCore.saveLabel(ws,label==null?null:label.optString("id"),label==null?projectId:MainActivity.nullable(label.optString("projectId")),name.getText().toString(),color.getText().toString(),Ui.now()); JSONObject n=NotesCore.findNote(ws,noteId); JSONArray ids=n.optJSONArray("labelIds"); if(ids==null) ids=new JSONArray(); boolean found=false; for(int i=0;i<ids.length();i++) if(MainActivity.same(ids.optString(i),id[0])) found=true; if(!found) ids.put(id[0]); NotesCore.updateNote(ws,noteId,new JSONObject().put("labelIds",ids),Ui.now()); },true)) labelPicker(); }); if(label!=null) dialog.setNeutralButton("Delete label",(d,w)->mutate(ws->NotesCore.deleteLabel(ws,label.optString("id"),Ui.now()),true)); dialog.show(); }
    private void deleteNote() { new AlertDialog.Builder(this).setTitle("Move note to Deleted notes?").setMessage("Its sub-notes move with it. You can restore the group from the notebook menu.").setNegativeButton("Cancel",null).setPositiveButton("Move",(d,w)->{ if(mutate(ws->NotesCore.deleteNote(ws,noteId,Ui.now()),false)) finish(); }).show(); }
    private void sync() { if(!flush()) return; VoiceCaptureManager.get(this).process(null); updateStatus(null); repository.sync(error->{ if(isFinishing() || isDestroyed()) return; refreshFromRepository(); updateStatus(error); }); }
    private void refreshFromRepository() {
        if(title==null || isFinishing() || isDestroyed()) return; JSONObject n=note(); if(n==null) return; boolean remoteFocusChange=false; loading=true;
        if(!titleDirty && !title.hasFocus()) { if(!title.getText().toString().equals(n.optString("title"))) title.setText(n.optString("title")); knownTitle=n.optString("title"); } else if(!n.optString("title").equals(knownTitle)) remoteFocusChange=true;
        if(!bodyDirty && !body.hasFocus()) { if(!body.getText().toString().equals(n.optString("body"))) body.setText(n.optString("body")); knownBody=n.optString("body"); } else if(!n.optString("body").equals(knownBody)) remoteFocusChange=true;
        android.view.View focus=getCurrentFocus(); boolean editingChecklist=focus instanceof EditText && focus!=title && focus!=body;
        if(!editingChecklist && pendingText.isEmpty()) renderChecklist(); else for(NotesCore.Row item:NotesCore.orderedChecklist(n)) { String id=item.item.optString("id"); EditText text=checklist.findViewWithTag("checklistText:"+id); CheckBox check=checklist.findViewWithTag("checklistCheck:"+id); boolean checked=MainActivity.nullable(item.item.optString("completedAt"))!=null; if(check!=null) check.setChecked(checked); if(text!=null) { text.setPaintFlags(checked?text.getPaintFlags()|Paint.STRIKE_THRU_TEXT_FLAG:text.getPaintFlags()&~Paint.STRIKE_THRU_TEXT_FLAG); text.setTextColor(checked?Ui.MUTED:Ui.TEXT); } if(text!=null && !text.hasFocus() && !pendingText.containsKey(id)) { if(!text.getText().toString().equals(item.item.optString("text"))) text.setText(item.item.optString("text")); try { knownItems.put(id,new JSONObject(item.item.toString())); } catch(Exception ignored) {} } }
        loading=false; renderMetadata(); renderChildren(); updateStatus(null); if(remoteFocusChange) status.setText("This note also changed on another device. Your current typing is safe; both versions will be kept if they differ."); if(MainActivity.deleted(n)) status.setText("Deleted on another device. Any unfinished typing will be preserved in Saved conflict copies, not discarded.");
    }
    private void offerRetainedDraft(JSONObject draft) { title.setEnabled(false); body.setEnabled(false); checklist.removeAllViews(); if(isFinishing() || isDestroyed()) return; new AlertDialog.Builder(this).setTitle("Your draft is safely preserved").setMessage("This note or checklist item was deleted elsewhere while you were editing. Your text is saved in conflict copies. Recover a separate new note, or leave the original deleted.").setCancelable(false).setNegativeButton("Back to notes",(d,w)->finish()).setPositiveButton("Recover as new note",(d,w)->{ try { String[] id={null}; repository.edit(ws->id[0]=NotesCore.recoverNoteSnapshot(ws,draft,Ui.now())); noteId=id[0]; draftBlocked=false; JSONObject n=note(); projectId=MainActivity.nullable(n.optString("projectId")); loading=true; title.setText(n.optString("title")); body.setText(n.optString("body")); knownTitle=n.optString("title"); knownBody=n.optString("body"); title.setEnabled(true); body.setEnabled(true); loading=false; renderMetadata(); renderChecklist(); renderChildren(); } catch(Exception e) { Ui.error(this,e); } }).show(); }
    private void leave() { if(draftBlocked || flush()) finish(); else if(!draftBlocked) Ui.message(this,"Keep your unsaved text","This note has not been saved. Leave the editor open and try again, or copy your text before leaving."); }
    private void unavailable(String heading,String message) { new AlertDialog.Builder(this).setTitle(heading).setMessage(message).setCancelable(false).setPositiveButton("Back to notes",(d,w)->finish()).show(); }
    // Legacy API26–32 back handling; API33+ registers OnBackInvokedCallback in onCreate.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { leave(); }
    // The guarded legacy overload is necessary below API33; modern registrations are NOT_EXPORTED.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onResume() { super.onResume(); if(!receiverRegistered) { IntentFilter filter=new IntentFilter(NotesRepository.ACTION_CHANGED); if(android.os.Build.VERSION.SDK_INT>=33) registerReceiver(changes,filter,Context.RECEIVER_NOT_EXPORTED); else registerReceiver(changes,filter); receiverRegistered=true; } if(children!=null) { refreshFromRepository(); repository.sync(error->{ if(!isFinishing() && !isDestroyed()) { refreshFromRepository(); updateStatus(error); } }); handler.removeCallbacks(poll); handler.postDelayed(poll,30000); } }
    @Override protected void onPause() { flush(); handler.removeCallbacks(saveDraft); handler.removeCallbacks(upload); handler.removeCallbacks(poll); if(receiverRegistered) { unregisterReceiver(changes); receiverRegistered=false; } if(repository!=null) repository.sync(error->{}); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { flush(); out.putString(EXTRA_NOTE_ID,noteId); super.onSaveInstanceState(out); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); if(android.os.Build.VERSION.SDK_INT>=33 && backCallback!=null) getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback); super.onDestroy(); }
}
