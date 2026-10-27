package com.forgeboard.notes;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.view.View;
import android.widget.*;
import com.forgeboard.notes.core.AutoVoiceCore;
import com.forgeboard.notes.core.NotesCore;
import org.json.JSONObject;
import java.util.List;

/** One normal action after launch: Stop submits to Claude and adds the result automatically. */
public final class VoiceCaptureActivity extends Activity {
    static VoiceRecorder.Factory testRecorderFactory; // Debug-only, never selected by external intent extras.
    static final String EXTRA_CAPTURE="voiceCaptureId",EXTRA_HISTORY="voiceHistory";
    private static final int MICROPHONE=702;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private VoiceCaptureManager manager;
    private VoiceRecorder recorder;
    private String captureId,latest="",message;
    private TextView heading,destination,transcript,status;
    private Button stop,retry,cancel;
    private LinearLayout history;
    private boolean historyMode,resumed,recording,stopping,permissionRequested,permissionDenied,leaving,saveScheduled;
    private final Runnable savePartial=()->{saveScheduled=false;saveTranscript(false);};
    private final Runnable poll=new Runnable(){@Override public void run(){if(!resumed)return;manager.process(()->{if(resumed)refresh();});handler.postDelayed(this,12000);}};
    private final BroadcastReceiver changes=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent intent){refresh();}};
    private boolean registered;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);manager=VoiceCaptureManager.get(this);historyMode=getIntent().getBooleanExtra(EXTRA_HISTORY,false);
        LinearLayout root=Ui.column(this);Ui.install(this,root);LinearLayout header=Ui.row(this);Ui.pad(header,12);header.addView(Ui.button(this,"‹ Notes",this::finish));header.addView(Ui.title(this,historyMode?"Saved voice captures":"Voice note",22));root.addView(header);
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout body=Ui.column(this);Ui.pad(body,20);scroll.addView(body);
        if(historyMode){history=Ui.column(this);body.addView(history);renderHistory();return;}
        try{
            captureId=state==null?MainActivity.nullable(getIntent().getStringExtra(EXTRA_CAPTURE)):state.getString(EXTRA_CAPTURE);
            if(captureId==null)captureId=manager.create("shared".equals(getIntent().getStringExtra(NotesRepository.EXTRA_VAULT)),MainActivity.nullable(getIntent().getStringExtra("noteId")),MainActivity.nullable(getIntent().getStringExtra("projectId")));
            JSONObject job=manager.snapshot(captureId);if(job==null)throw new IllegalArgumentException("Recording not found.");latest=job.optString("raw");permissionDenied=state!=null&&state.getBoolean("permissionDenied");
        }catch(Exception e){Ui.error(this,e);finish();return;}
        destination=Ui.muted(this,"");body.addView(destination);Ui.gap(body,24);
        heading=Ui.title(this,"Starting microphone…",28);heading.setTag("voiceHeading");body.addView(heading);Ui.gap(body,12);
        transcript=Ui.text(this,latest.isEmpty()?"Say your list naturally.":latest,18,Ui.TEXT);transcript.setTag("voiceTranscript");transcript.setTextIsSelectable(true);transcript.setMinHeight(Ui.dp(this,100));body.addView(transcript);
        status=Ui.muted(this,"");status.setTag("voiceStatus");body.addView(status);Ui.gap(body,24);
        stop=Ui.button(this,"Stop",this::stopRecording);stop.setTag("voiceStop");stop.setMinHeight(Ui.dp(this,64));body.addView(stop,new LinearLayout.LayoutParams(-1,-2));
        retry=Ui.button(this,"Try again",this::retry);retry.setTag("voiceRetry");body.addView(retry,new LinearLayout.LayoutParams(-1,-2));
        cancel=Ui.button(this,"Cancel",()->{cancelRecorder();saveTranscript(true);try{manager.cancel(captureId);finish();}catch(Exception e){Ui.error(this,e);}});cancel.setTag("voiceCancel");body.addView(cancel);
        Ui.gap(body,16);body.addView(Ui.muted(this,"Stop sends this transcript to Claude and adds its checklist here automatically. Android’s speech provider may use the internet. Your original words stay saved."));refresh();
    }
    private void startRecording(){
        JSONObject job=manager.snapshot(captureId);if(job==null||!AutoVoiceCore.canRecord(job)||!resumed||recording||stopping||leaving)return;
        cancelRecorder();message=null;latest=job.optString("raw");
        VoiceRecorder.Listener listener=new VoiceRecorder.Listener(){
            public void text(String text){latest=text;if(transcript!=null)transcript.setText(text.isEmpty()?"Say your list naturally.":text);if(!saveScheduled){saveScheduled=true;handler.postDelayed(savePartial,500);}}
            public void stopped(String text){latest=text;recording=false;recorder=null;submit();}
            public void failed(String error,String text){latest=text;recording=false;recorder=null;message=error;saveTranscript(true);refresh();}
        };
        recorder=BuildConfig.DEBUG&&testRecorderFactory!=null?testRecorderFactory.create(this,latest,listener):new AndroidVoiceRecorder(this,latest,listener);
        if(recorder.needsPermission()&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){recorder.cancel();recorder=null;if(!permissionRequested){permissionRequested=true;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MICROPHONE);}return;}
        recording=true;saveTranscript(false);refresh();recorder.start();
    }
    private void stopRecording(){if(stopping||leaving)return;JSONObject job=manager.snapshot(captureId);if(job==null||!AutoVoiceCore.canRecord(job))return;stopping=true;message=null;refresh();if(recorder!=null)recorder.stop();else submit();}
    private void submit(){
        handler.removeCallbacks(savePartial);saveScheduled=false;cancelRecorder();stopping=false;recording=false;
        if(!saveTranscript(true))return;
        try{manager.stop(captureId,latest);message=null;refresh();}catch(Exception e){message=e.getMessage();refresh();}
    }
    private boolean saveTranscript(boolean paused){
        if(manager==null||captureId==null)return false;
        try{manager.transcript(captureId,latest,paused);return true;}catch(Exception e){message="Couldn’t save this recording. Keep this screen open and copy your words before leaving.";if(status!=null)status.setText(message);return false;}
    }
    private void cancelRecorder(){if(recorder!=null){VoiceRecorder previous=recorder;recorder=null;previous.cancel();}recording=false;}
    private void retry(){JSONObject job=manager.snapshot(captureId);if(job==null)return;if(AutoVoiceCore.canRecord(job)){permissionDenied=false;startRecording();return;}try{manager.retry(captureId);message=null;refresh();}catch(Exception e){Ui.error(this,e);}}
    private void refresh(){
        if(isFinishing()||isDestroyed()||leaving)return;if(historyMode){renderHistory();return;}if(heading==null)return;
        JSONObject job=manager.snapshot(captureId);if(job==null)return;String phase=job.optString("status");boolean pending=AutoVoiceCore.pending(job);
        NotesRepository repository=NotesRepository.get(this,job.optBoolean("shared"));JSONObject note=NotesCore.findNote(repository.snapshot(),MainActivity.nullable(job.optString("noteId")));
        String name=note==null?"New checklist":note.optString("title").isEmpty()?"Current checklist":note.optString("title");destination.setText((job.optBoolean("shared")?"Shared lists":"Private notes")+" · "+name);
        if(!recording&&!stopping){latest=job.optString("raw");transcript.setText(latest.isEmpty()?"Say your list naturally.":latest);}
        heading.setText(recording&&!stopping?"Listening…":stopping?"Finishing your words…":pending?"Organizing with Claude…":"failed".equals(phase)?"Recording saved":"applied".equals(phase)?"Added to your checklist":"Microphone paused");
        status.setText(message!=null?message:!job.optString("error").isEmpty()?job.optString("error"):pending?"I’ll add the checklist automatically. You can leave this screen; processing continues when connected.":recording?"Keep speaking. Tap Stop when you’re done.":"Your words are saved on this phone.");
        stop.setVisibility(AutoVoiceCore.canRecord(job)?View.VISIBLE:View.GONE);stop.setEnabled(!stopping);
        retry.setVisibility(!recording&&!stopping&&!pending&&!"applied".equals(phase)&&!"cancelled".equals(phase)?View.VISIBLE:View.GONE);retry.setText(AutoVoiceCore.canRecord(job)?"Resume microphone":"Retry Claude");
        cancel.setText(pending||"failed".equals(phase)?"Close":"Cancel");cancel.setOnClickListener(v->{if(pending||"failed".equals(phase)){finish();return;}cancelRecorder();saveTranscript(true);try{manager.cancel(captureId);finish();}catch(Exception e){Ui.error(this,e);}});
        if("applied".equals(phase)&&resumed){leaving=true;startActivity(repository.target(new Intent(this,NoteEditorActivity.class).putExtra("noteId",job.optString("resultNoteId"))));finish();}
    }
    private void renderHistory(){
        if(history==null)return;history.removeAllViews();List<JSONObject> jobs=manager.jobs();int shown=0;
        for(JSONObject job:jobs){if(job.optString("raw").trim().isEmpty())continue;if(shown++>=30)break;
            String raw=job.optString("raw"),label=job.optString("status")+" · "+(raw.length()>70?raw.substring(0,70)+"…":raw);
            history.addView(Ui.button(this,label,()->{if("cancelled".equals(job.optString("status"))){new AlertDialog.Builder(this).setTitle("Cancelled recording — not sent").setMessage(raw).setPositiveButton("Close",null).show();return;}startActivity(new Intent(this,VoiceCaptureActivity.class).putExtra(EXTRA_CAPTURE,job.optString("id")));}));
        }
        if(shown==0)history.addView(Ui.muted(this,"No saved recordings yet."));
        history.addView(Ui.button(this,"Earlier review-only draft (version 0.2)",()->startActivity(new Intent(this,LegacyVoiceCaptureActivity.class))));
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==MICROPHONE){permissionRequested=false;if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED){permissionDenied=false;startRecording();}else{permissionDenied=true;message="Allow microphone access to record. Nothing has been sent.";refresh();}}}
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onResume(){super.onResume();resumed=true;if(!registered){IntentFilter filter=new IntentFilter(NotesRepository.ACTION_CHANGED);if(Build.VERSION.SDK_INT>=33)registerReceiver(changes,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(changes,filter);registered=true;}refresh();if(!historyMode&&!permissionDenied&&!permissionRequested)startRecording();handler.removeCallbacks(poll);handler.post(poll);}
    @Override protected void onPause(){resumed=false;if(stopping)submit();else if(recording){cancelRecorder();saveTranscript(true);}handler.removeCallbacks(savePartial);saveScheduled=false;handler.removeCallbacks(poll);if(registered){unregisterReceiver(changes);registered=false;}super.onPause();}
    @Override protected void onSaveInstanceState(Bundle out){if(!historyMode)saveTranscript(true);out.putString(EXTRA_CAPTURE,captureId);out.putBoolean("permissionDenied",permissionDenied);super.onSaveInstanceState(out);}
    @Override protected void onDestroy(){cancelRecorder();handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
