package com.forgeboard.notes;

import android.content.Context;
import android.content.Intent;
import android.widget.TextView;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.forgeboard.notes.core.NotesCore;
import com.forgeboard.notes.core.CaptureCore;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Synthetic microphone/Claude transport only, in an unconnected debug sandbox. */
@RunWith(AndroidJUnit4.class)
public class OneStopVoiceInstrumentedTest {
    private Context context;
    private NotesRepository personal,shared;
    private VoiceCaptureManager manager;
    private FakeRemote remote;
    private final AtomicBoolean started=new AtomicBoolean();
    private static final String NOW="2026-10-27T19:00:00Z";
    @Before public void setup()throws Exception{
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue(context.getPackageName().endsWith(".debug"));personal=NotesRepository.get(context);shared=NotesRepository.get(context,true);assertFalse(personal.isConnected());assertFalse(shared.isConnected());
        personal.edit(ws->{JSONObject empty=NotesCore.emptyWorkspace();List<String> keys=new ArrayList<>();ws.keys().forEachRemaining(keys::add);for(String key:keys)ws.remove(key);empty.keys().forEachRemaining(key->{try{ws.put(key,empty.get(key));}catch(Exception e){throw new IllegalArgumentException(e);}});});
        SecureStore store=new SecureStore(context,"voice-auto-test-v1");store.write(new JSONObject().put("jobs",new JSONArray()));remote=new FakeRemote();manager=new VoiceCaptureManager(context,store,remote);VoiceCaptureManager.testInstance=manager;
        VoiceCaptureActivity.testRecorderFactory=(c,saved,listener)->new VoiceRecorder(){
            public boolean needsPermission(){return false;}
            public void start(){started.set(true);listener.text("Walmart with milk and eggs");}
            public void stop(){listener.stopped("Walmart with milk and eggs");}
            public void cancel(){}
        };
    }
    @After public void cleanup()throws Exception{waitProcess();VoiceCaptureActivity.testRecorderFactory=null;VoiceCaptureManager.testInstance=null;}
    static final class FakeRemote implements VoiceCaptureManager.Remote{
        final Map<String,String> requests=new ConcurrentHashMap<>();boolean connected=true,ready=true,unavailable=false;int uploads;
        public VaultConfig config(boolean shared){VaultConfig c=VaultConfig.defaults(shared);return new VaultConfig(c.owner,c.repo,c.branch,c.path,"fake-instrumentation-only");}
        public boolean connected(boolean shared){return connected;}
        public void enqueue(VaultConfig config,JSONObject request)throws Exception{uploads++;requests.put(request.getString("id"),request.getString("transcript"));}
        public JSONObject result(VaultConfig config,String id)throws Exception{if(!ready)return null;if(unavailable)return new JSONObject().put("id",id).put("status","unavailable").put("reason","not-configured");return new JSONObject().put("id",id).put("status","ready").put("draft",CaptureCore.fromReview("Shopping","Walmart\n  Milk\n  Eggs"));}
    }
    private void waitProcess()throws Exception{CountDownLatch done=new CountDownLatch(1);manager.process(done::countDown);assertTrue(done.await(15,TimeUnit.SECONDS));InstrumentationRegistry.getInstrumentation().waitForIdleSync();}
    private static View tagged(View root,String tag){if(tag.equals(root.getTag()))return root;if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){View result=tagged(((ViewGroup)root).getChildAt(i),tag);if(result!=null)return result;}return null;}
    @Test public void launchStartsRecordingAndStopAutomaticallyAppendsWithoutApproval()throws Exception{
        String[] note={null};personal.edit(ws->note[0]=NotesCore.addNote(ws,null,null,"Existing","Untouched body",null,NOW));String sharedBefore=shared.snapshot().toString();
        try(ActivityScenario<VoiceCaptureActivity> scenario=ActivityScenario.launch(new Intent(context,VoiceCaptureActivity.class).putExtra("noteId",note[0]))){
            scenario.onActivity(activity->{assertTrue(started.get());assertEquals(0,remote.uploads);View root=activity.getWindow().getDecorView();assertNull(tagged(root,"voiceOrganize"));assertNull(tagged(root,"voiceApply"));assertEquals("Listening…",((TextView)tagged(root,"voiceHeading")).getText().toString());tagged(root,"voiceStop").performClick();});
            waitProcess();
        }
        JSONObject actual=NotesCore.findNote(personal.snapshot(),note[0]);assertEquals("Untouched body",actual.getString("body"));assertEquals(3,NotesCore.orderedChecklist(actual).size());for(NotesCore.Row row:NotesCore.orderedChecklist(actual))assertTrue(row.item.isNull("completedAt"));assertEquals(sharedBefore,shared.snapshot().toString());assertEquals(1,remote.uploads);
        waitProcess();assertEquals(1,remote.uploads);assertEquals(3,NotesCore.orderedChecklist(NotesCore.findNote(personal.snapshot(),note[0])).size());
    }
    @Test public void closingPendingScreenStillAppliesLaterToSharedDestinationOnly()throws Exception{
        remote.ready=false;String before=personal.snapshot().toString();String capture=manager.create(true,null,null);manager.stop(capture,"Walmart with milk and eggs");waitProcess();assertEquals("waiting",manager.snapshot(capture).getString("status"));assertEquals(before,personal.snapshot().toString());
        remote.ready=true;waitProcess();JSONObject finished=manager.snapshot(capture);assertEquals("applied",finished.getString("status"));JSONObject note=NotesCore.findNote(shared.snapshot(),finished.getString("resultNoteId"));assertNotNull(note);assertEquals(3,NotesCore.orderedChecklist(note).size());assertEquals(before,personal.snapshot().toString());assertEquals(1,remote.uploads);
    }
    @Test public void cancelBeforeStopNeverUploadsAndMissingClaudePreservesTranscript()throws Exception{
        try(ActivityScenario<VoiceCaptureActivity> scenario=ActivityScenario.launch(new Intent(context,VoiceCaptureActivity.class))){scenario.onActivity(activity->tagged(activity.getWindow().getDecorView(),"voiceCancel").performClick());}
        waitProcess();assertEquals(0,remote.uploads);assertTrue(manager.jobs().stream().anyMatch(job->"cancelled".equals(job.optString("status"))&&job.optString("raw").contains("milk")));
        remote.unavailable=true;String id=manager.create(false,null,null);manager.stop(id,"Keep my original words");waitProcess();JSONObject failed=manager.snapshot(id);assertEquals("failed",failed.getString("status"));assertEquals("Keep my original words",failed.getString("raw"));assertEquals(0,personal.snapshot().getJSONArray("personalNotes").length());
        String oldRequest=failed.getString("requestId");remote.unavailable=false;manager.retry(id);waitProcess();assertNotEquals(oldRequest,manager.snapshot(id).getString("requestId"));assertEquals("applied",manager.snapshot(id).getString("status"));
    }
    @Test public void offlineStopSurvivesManagerReloadAndResumesWithoutAnotherButton()throws Exception{
        remote.connected=false;String id=manager.create(false,null,null);manager.stop(id,"Saved offline");waitProcess();assertEquals(0,remote.uploads);assertEquals("waiting-connection",manager.snapshot(id).getString("status"));
        manager=new VoiceCaptureManager(context,new SecureStore(context,"voice-auto-test-v1"),remote);VoiceCaptureManager.testInstance=manager;remote.connected=true;waitProcess();assertEquals("applied",manager.snapshot(id).getString("status"));assertEquals(1,remote.uploads);
    }
}
