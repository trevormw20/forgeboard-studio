package com.forgeboard.notes;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.forgeboard.notes.core.AutoVoiceCore;
import com.forgeboard.notes.core.CaptureCore;
import org.json.*;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

/** Durable encrypted jobs continue after the recording screen closes. Never stores API keys. */
final class VoiceCaptureManager {
    interface Remote {
        VaultConfig config(boolean shared);
        boolean connected(boolean shared);
        void enqueue(VaultConfig config,JSONObject request)throws Exception;
        JSONObject result(VaultConfig config,String id)throws Exception;
    }
    interface Change {void apply(JSONObject job)throws Exception;}
    private static VoiceCaptureManager instance;
    static VoiceCaptureManager testInstance; // Only honored in the separate debug APK; no intent-controlled bypass.
    private final Context context;
    private final SecureStore store;
    private final Remote remote;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final List<Runnable> callbacks=new ArrayList<>();
    private JSONObject state;
    private String cacheError;
    private boolean busy,rerun;
    static synchronized VoiceCaptureManager get(Context context){
        if(BuildConfig.DEBUG&&testInstance!=null)return testInstance;
        Context app=context.getApplicationContext();
        if(instance==null)instance=new VoiceCaptureManager(app,new SecureStore(app,"voice-auto-v1"),new Remote(){
            public VaultConfig config(boolean shared){return NotesRepository.get(app,shared).config();}
            public boolean connected(boolean shared){return NotesRepository.get(app,shared).isConnected();}
            public void enqueue(VaultConfig config,JSONObject request)throws Exception{new VaultClient(config).enqueueVoice(request);}
            public JSONObject result(VaultConfig config,String id)throws Exception{return new VaultClient(config).voiceResult(id);}
        });
        return instance;
    }
    VoiceCaptureManager(Context context,SecureStore store,Remote remote){
        this.context=context.getApplicationContext();this.store=store;this.remote=remote;
        try{state=store.read();if(state==null)state=new JSONObject().put("jobs",new JSONArray());if(state.optJSONArray("jobs")==null)throw new IllegalArgumentException();}
        catch(Exception e){state=new JSONObject();cacheError="The encrypted voice queue could not be unlocked. It has been preserved; do not uninstall or clear data.";}
    }
    private static JSONObject copy(JSONObject value){try{return new JSONObject(value.toString());}catch(Exception e){throw new IllegalArgumentException("Could not read the voice draft.");}}
    private void writable(){if(cacheError!=null)throw new IllegalStateException(cacheError);}
    private static JSONObject find(JSONObject state,String id){JSONArray jobs=state.optJSONArray("jobs");if(jobs!=null)for(int i=0;i<jobs.length();i++){JSONObject job=jobs.optJSONObject(i);if(job!=null&&id.equals(job.optString("id")))return job;}return null;}
    synchronized JSONObject snapshot(String id){JSONObject job=find(state,id);return job==null?null:copy(job);}
    synchronized List<JSONObject> jobs(){List<JSONObject> jobs=new ArrayList<>();JSONArray all=state.optJSONArray("jobs");if(all!=null)for(int i=all.length()-1;i>=0;i--){JSONObject job=all.optJSONObject(i);if(job!=null)jobs.add(copy(job));}return jobs;}
    synchronized String create(boolean shared,String note,String project)throws Exception{
        writable();JSONObject next=copy(state),job=AutoVoiceCore.create(shared,note,project,remote.config(false).identity(),remote.config(shared).identity(),Ui.now());next.getJSONArray("jobs").put(job);store.write(next);state=next;changed();return job.getString("id");
    }
    private synchronized void change(String id,Change action)throws Exception{
        writable();JSONObject next=copy(state),job=find(next,id);if(job==null)throw new IllegalArgumentException("Recording not found.");action.apply(job);
        if(next.toString().equals(state.toString()))return;job.put("updatedAt",Ui.now());store.write(next);state=next;changed();
    }
    void transcript(String id,String raw,boolean paused)throws Exception{change(id,job->{if(AutoVoiceCore.canRecord(job))job.put("raw",raw).put("status",paused?"paused":"recording");});}
    void stop(String id,String raw)throws Exception{change(id,job->AutoVoiceCore.stop(job,raw,Ui.now()));process(null);NotesSyncJobService.scheduleSoon(context);}
    void cancel(String id)throws Exception{change(id,job->{if(AutoVoiceCore.canRecord(job))job.put("status","cancelled");});}
    void retry(String id)throws Exception{change(id,job->AutoVoiceCore.retry(job,Ui.now()));process(null);NotesSyncJobService.scheduleSoon(context);}
    synchronized boolean needsRetry(){for(JSONObject job:jobs())if(AutoVoiceCore.pending(job)&&remote.connected(false)&&remote.connected(job.optBoolean("shared")))return true;return false;}
    synchronized String statusLine(){
        if(cacheError!=null)return cacheError;int waiting=0,failed=0;
        for(JSONObject job:jobs()){if(AutoVoiceCore.pending(job))waiting++;else if("failed".equals(job.optString("status")))failed++;}
        return waiting==0&&failed==0?"":"Voice: "+waiting+" waiting for Claude"+(failed>0?" · "+failed+" need attention (Saved voice captures)":"");
    }
    void process(Runnable callback){
        synchronized(this){if(callback!=null)callbacks.add(callback);if(busy){rerun=true;return;}busy=true;rerun=false;}
        io.execute(()->{
            while(true){
                try{int processed=0;List<JSONObject> candidates=jobs();candidates.sort(Comparator.comparingLong(job->job.optLong("lastAttemptAt")));for(JSONObject job:candidates){if(!AutoVoiceCore.pending(job)||job.optLong("nextAttemptAt")>System.currentTimeMillis())continue;if(processed++>=4)break;try{change(job.optString("id"),item->item.put("lastAttemptAt",System.currentTimeMillis()));}catch(Exception ignored){continue;}processOne(job);}}
                catch(Exception ignored){/* Keep the durable queue; a later scheduled pass can retry. */}
                List<Runnable> done;synchronized(this){if(rerun){rerun=false;continue;}busy=false;done=new ArrayList<>(callbacks);callbacks.clear();}
                main.post(()->{for(Runnable callbackItem:done)callbackItem.run();});break;
            }
        });
    }
    private void processOne(JSONObject initial){
        String id=initial.optString("id");
        try{
            JSONObject job=snapshot(id);if(job==null||!AutoVoiceCore.pending(job))return;
            boolean shared=job.optBoolean("shared");VaultConfig personal=remote.config(false),destination=remote.config(shared);
            if(!personal.identity().equals(job.optString("personalVault"))||!destination.identity().equals(job.optString("targetVault"))){fail(id,"The connected vault changed. Your recording remains in its original space; reconnect that vault before retrying.",false);return;}
            if(!remote.connected(false)||!remote.connected(shared)){change(id,item->item.put("status","waiting-connection").put("error",shared?"Connect both My notes and Shared lists. Your recording is saved and will continue automatically.":"Connect your private notes vault. Your recording is saved and will continue automatically."));return;}
            JSONObject proposal=job.optJSONObject("proposal");
            if(proposal==null){
                if(!job.optBoolean("uploaded")){
                    remote.enqueue(personal,new JSONObject().put("version",1).put("id",job.getString("requestId")).put("createdAt",job.getString("stoppedAt")).put("transcript",job.getString("raw")));
                    change(id,item->item.put("uploaded",true).put("status","waiting"));
                }
                JSONObject response=remote.result(personal,job.getString("requestId"));
                if(response==null){change(id,item->{item.put("status","waiting");item.remove("error");});return;}
                if(!job.getString("requestId").equals(response.optString("id")))throw new IllegalArgumentException("The Claude result did not match this recording. Your transcript is preserved.");
                if(!"ready".equals(response.optString("status"))){fail(id,AutoVoiceCore.failure(response),true);return;}
                proposal=CaptureCore.validate(response.getJSONObject("draft"));JSONObject validated=proposal;
                change(id,item->item.put("proposal",validated).put("status","applying").put("remoteFinished",true));
            }
            // Notes commit and queue completion are separate stores. Stable IDs make crash replay safe.
            JSONObject current=snapshot(id);if(current==null||!AutoVoiceCore.pending(current))return;
            JSONObject toApply=proposal;String[] note={null};NotesRepository repository=NotesRepository.get(context,shared);
            repository.edit(workspace->{if(!remote.config(shared).identity().equals(current.optString("targetVault")))throw new IllegalArgumentException("The destination vault changed; your recording was preserved.");note[0]=AutoVoiceCore.apply(workspace,current,toApply,Ui.now());});
            change(id,item->{item.put("status","applied").put("resultNoteId",note[0]).put("appliedAt",Ui.now());item.remove("error");});repository.requestSync();
        }catch(IllegalArgumentException e){failQuietly(id,e.getMessage());}
        catch(JSONException e){failQuietly(id,"The Claude result was invalid. Your original recording is saved; no checklist was changed.");}
        catch(Exception e){
            if(e instanceof VaultClient.Failure&&(((VaultClient.Failure)e).status==401||((VaultClient.Failure)e).status==403||((VaultClient.Failure)e).status==404)){failQuietly(id,"GitHub refused this voice request. Your recording is saved. Check the personal vault token, then Retry.");return;}
            try{change(id,item->item.put("error","Waiting for a connection. Your recording is saved; it will retry automatically.").put("nextAttemptAt",System.currentTimeMillis()+30000));}catch(Exception ignored){/* Never replace an unreadable encrypted queue. */}
        }
    }
    private void fail(String id,String message,boolean finished)throws Exception{change(id,job->job.put("status","failed").put("error",message).put("remoteFinished",finished));}
    private void failQuietly(String id,String message){try{fail(id,message,false);}catch(Exception ignored){}}
    private void changed(){main.post(()->context.sendBroadcast(new Intent(NotesRepository.ACTION_CHANGED).setPackage(context.getPackageName())));}
}
