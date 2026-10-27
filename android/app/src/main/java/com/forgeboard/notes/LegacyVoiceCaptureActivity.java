package com.forgeboard.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.*;
import com.forgeboard.notes.core.CaptureCore;
import com.forgeboard.notes.core.NotesCore;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Android handles speech. Only an explicitly submitted transcript goes to the private AI queue. */
public final class LegacyVoiceCaptureActivity extends Activity {
    private static final int SPEECH=701;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private SecureStore store;
    private JSONObject draft;
    private EditText raw,title,review;
    private CheckBox current;
    private TextView status,destination;
    private Button organize,apply;
    private boolean loading,busy,cacheFailed,closing;
    private final Runnable saveLater=()->save();
    private final Runnable poll=()->checkJob(false);
    @Override public void onCreate(Bundle state){
        super.onCreate(state); store=new SecureStore(this,"voice-draft-v1");
        try{draft=store.read();if(draft==null || draft.optBoolean("applied"))draft=fresh();}
        catch(Exception e){Ui.message(this,"Draft could not be unlocked","Your encrypted voice draft has been preserved. Do not clear app data or uninstall.");finish();return;}
        LinearLayout root=Ui.column(this);Ui.install(this,root); LinearLayout head=Ui.row(this);Ui.pad(head,12);head.addView(Ui.button(this,"‹ Notes",this::finish));head.addView(Ui.title(this,"Voice → checklist",21));root.addView(head);
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout body=Ui.column(this);Ui.pad(body,16);scroll.addView(body);
        destination=Ui.muted(this,"");body.addView(destination);
        body.addView(Ui.muted(this,"Android’s speech service transcribes your voice (its provider may use the internet). Forgeboard sends only the transcript to Claude when you tap Organize. Nothing is added until you approve it."));
        body.addView(Ui.button(this,"🎙 Speak",this::speak));
        raw=Ui.input(this,"Speak or type your rough list",draft.optString("raw"),"voiceRaw",true);raw.setMinLines(3);raw.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(12000)});body.addView(raw);
        organize=Ui.button(this,"Organize with Claude",this::organize);organize.setTag("voiceOrganize");body.addView(organize);
        body.addView(Ui.button(this,"Review without AI (stays on this device)",()->{try{showProposal(CaptureCore.localDraft(raw.getText().toString()),"Local draft — review and edit below. Not sent to Claude.");}catch(Exception e){Ui.error(this,e);}}));
        status=Ui.muted(this,"");status.setTag("voiceStatus");body.addView(status);
        body.addView(Ui.button(this,"View returned Claude draft",()->{if(draft.optJSONObject("aiDraft")==null){Ui.message(this,"No Claude result yet","Organize a transcript first. Your current review stays unchanged.");return;}new AlertDialog.Builder(this).setTitle("Replace the review with Claude’s draft?").setMessage("Your raw transcript stays saved. This changes only the editable review, not your notes.").setNegativeButton("Keep my review",null).setPositiveButton("Show Claude draft",(d,w)->{try{showProposal(draft.getJSONObject("aiDraft"),"Claude draft — review before adding.");}catch(Exception e){Ui.error(this,e);}}).show();}));Ui.gap(body,16);
        body.addView(Ui.title(this,"Review before adding",21));body.addView(Ui.muted(this,"One checkbox per line. Two spaces indent a sub-checkbox; four spaces make a sub-sub-checkbox. Edit anything Claude misunderstood."));
        title=Ui.input(this,"Optional title for a new note",draft.optString("title"),"voiceTitle",false);title.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(300)});body.addView(title);
        review=Ui.input(this,"Your organized checklist appears here",draft.optString("review"),"voiceReview",true);review.setMinLines(4);review.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(220000)});body.addView(review);
        current=new CheckBox(this);current.setText("Add to the existing note shown above");current.setTextColor(Ui.TEXT);current.setMinHeight(Ui.dp(this,48));current.setChecked(draft.optBoolean("useCurrent",true));current.setEnabled(MainActivity.nullable(draft.optString("noteId"))!=null);if(!current.isEnabled())current.setChecked(false);body.addView(current);
        current.setOnCheckedChangeListener((b,checked)->save());
        apply=Ui.button(this,"Approve & add checkboxes",this::apply);apply.setTag("voiceApply");body.addView(apply);
        body.addView(Ui.button(this,"Start a different capture",()->new AlertDialog.Builder(this).setTitle("Start a new voice draft?").setMessage("This clears this saved draft, not any notes you already added. An AI request already sent may still finish in the private vault.").setNegativeButton("Keep draft",null).setPositiveButton("New capture",(d,w)->{try{draft=fresh();loading=true;raw.setText("");title.setText("");review.setText("");current.setEnabled(MainActivity.nullable(draft.optString("noteId"))!=null);current.setChecked(current.isEnabled());loading=false;status.setText("");save();updateDestination();}catch(Exception e){Ui.error(this,e);}}).show()));
        TextWatcher watcher=new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){if(!loading){handler.removeCallbacks(saveLater);handler.postDelayed(saveLater,500);}}public void afterTextChanged(Editable e){}};
        raw.addTextChangedListener(watcher);title.addTextChangedListener(watcher);review.addTextChangedListener(watcher);updateDestination();save();
    }
    private JSONObject fresh()throws Exception{return new JSONObject().put("raw","").put("review","").put("title","").put("vault",getIntent().getStringExtra(NotesRepository.EXTRA_VAULT)==null?"personal":getIntent().getStringExtra(NotesRepository.EXTRA_VAULT)).put("noteId",getIntent().getStringExtra("noteId")).put("projectId",getIntent().getStringExtra("projectId")).put("useCurrent",true);}
    private NotesRepository target(){return NotesRepository.get(this,"shared".equals(draft.optString("vault")));}
    private void updateDestination(){JSONObject note=NotesCore.findNote(target().snapshot(),MainActivity.nullable(draft.optString("noteId")));String name=note==null?"New note":note.optString("title").isEmpty()?"Untitled checklist":note.optString("title");destination.setText((target().isShared()?"Shared lists":"Private notes")+" · "+name+"\nA saved draft keeps its original destination; uncheck the option below to create a new note.");}
    private boolean save(){if(draft==null||raw==null||closing)return false;try{draft.put("raw",raw.getText().toString()).put("title",title.getText().toString()).put("review",review.getText().toString()).put("useCurrent",current.isChecked());store.write(draft);cacheFailed=false;return true;}catch(Exception e){cacheFailed=true;if(status!=null)status.setText("Could not save this draft. Keep this screen open and copy your text before leaving.");return false;}}
    @SuppressWarnings("deprecation") private void speak(){Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true).putExtra(RecognizerIntent.EXTRA_PROMPT,"Say your list naturally");try{startActivityForResult(intent,SPEECH);}catch(android.content.ActivityNotFoundException e){Ui.message(this,"No speech service available","Enable your phone’s speech recognition or use the microphone on your keyboard. You can also type a rough list here.");}}
    @SuppressWarnings("deprecation") @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==SPEECH&&result==RESULT_OK&&data!=null){ArrayList<String> matches=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);if(matches!=null&&!matches.isEmpty()){String previous=raw.getText().toString();raw.setText(previous+(previous.trim().isEmpty()?"":"\n")+matches.get(0));save();}}}
    private void showProposal(JSONObject proposal,String message)throws Exception{JSONObject checked=CaptureCore.validate(proposal);loading=true;title.setText(checked.getString("title"));review.setText(CaptureCore.reviewText(checked));loading=false;draft.put("proposalReady",true);status.setText(message);save();}
    private void organize(){if(busy||!save())return;String transcript=raw.getText().toString().trim();if(transcript.isEmpty()){status.setText("Speak or type a rough list first.");return;}NotesRepository personal=NotesRepository.get(this);if(!personal.isConnected()){Ui.message(this,"Connect your private notes vault","Claude requests use your personal private repository, even for a shared list. Connect My notes first. Local review works without a connection.");return;}
        try{if(draft.optBoolean("jobReady")||!transcript.equals(draft.optString("submitted"))||!personal.config().identity().equals(draft.optString("jobVault"))){draft.put("jobId",UUID.randomUUID().toString()).put("submitted",transcript).put("jobVault",personal.config().identity()).put("jobReady",false).put("submittedReview",review.getText().toString());draft.remove("aiDraft");}draft.put("queued",false);if(!save())return;checkJob(true);}catch(Exception e){Ui.error(this,e);}}
    private void checkJob(boolean upload){if(busy||draft==null||draft.optString("jobId").isEmpty()||draft.optBoolean("jobReady"))return;NotesRepository personal=NotesRepository.get(this);if(!personal.isConnected()||!personal.config().identity().equals(draft.optString("jobVault")))return;
        String id=draft.optString("jobId"),submitted=draft.optString("submitted");VaultConfig config=personal.config();busy=true;organize.setEnabled(false);status.setText("Waiting for private Claude cleanup. GitHub Actions can take a minute or two. You can leave this screen; your draft is saved.");
        io.execute(()->{JSONObject result=null;String error=null;try{VaultClient client=new VaultClient(config);if(upload||!draft.optBoolean("queued"))client.enqueueVoice(new JSONObject().put("version",1).put("id",id).put("createdAt",NotesRepository.now()).put("transcript",submitted));result=client.voiceResult(id);}catch(Exception e){error=e instanceof VaultClient.Failure?e.getMessage():"Could not reach voice cleanup. Your draft is saved. Retry Organize when online, or use local review.";}final JSONObject response=result;final String issue=error;handler.post(()->{busy=false;if(isFinishing()||isDestroyed()||closing)return;organize.setEnabled(true);try{if(!id.equals(draft.optString("jobId")))return;if(issue!=null){status.setText(issue);return;}draft.put("queued",true);save();if(response==null){handler.removeCallbacks(poll);handler.postDelayed(poll,12000);return;}if(!id.equals(response.optString("id")))throw new IllegalArgumentException("Mismatched cleanup result.");draft.put("jobReady",true);if(!submitted.equals(raw.getText().toString().trim())){status.setText("Your transcript changed while Claude worked. It was not replaced. Tap Organize for the updated text.");save();return;}if("ready".equals(response.optString("status"))){draft.put("aiDraft",CaptureCore.validate(response.getJSONObject("draft")));if(review.getText().toString().equals(draft.optString("submittedReview")))showProposal(draft.getJSONObject("aiDraft"),"Claude draft ready. Review every item; nothing has been added yet.");else{status.setText("Your review changed while Claude worked, so it was kept. Tap View returned Claude draft to compare or replace it.");save();}}else{status.setText("Claude cleanup is unavailable or not configured in this private vault. Your original text is safe. Use local review, or retry with a new capture after setup.");save();}}catch(Exception e){status.setText("The cleanup result was invalid. Your original draft is safe; use local review.");}});});}
    private void apply(){if(cacheFailed||!save())return;try{JSONObject proposal=CaptureCore.fromReview(title.getText().toString(),review.getText().toString());String id=draft.optString("applyId");if(id.isEmpty()){id=UUID.randomUUID().toString();draft.put("applyId",id);if(!save())return;}String batch=id;String[] note={null};String original=current.isChecked()?MainActivity.nullable(draft.optString("noteId")):null;NotesRepository repository=target();repository.edit(ws->note[0]=CaptureCore.apply(ws,original,MainActivity.nullable(draft.optString("projectId")),batch,proposal,Ui.now()));draft.put("applied",true);store.write(draft);closing=true;repository.sync(error->{});startActivity(repository.target(new Intent(this,NoteEditorActivity.class).putExtra("noteId",note[0])));finish();}catch(Exception e){Ui.error(this,e);}}
    @Override protected void onResume(){super.onResume();if(draft!=null&&raw!=null){handler.removeCallbacks(poll);handler.postDelayed(poll,1500);}}
    @Override protected void onPause(){save();handler.removeCallbacks(saveLater);handler.removeCallbacks(poll);super.onPause();}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);io.shutdown();super.onDestroy();}
}
