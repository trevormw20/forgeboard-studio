package com.forgeboard.notes.core;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class AutoVoiceCoreTest {
    private static final String NOW="2026-10-27T19:00:00Z";
    private JSONObject capture()throws Exception{return AutoVoiceCore.create(false,null,null,"personal","personal",NOW);}
    private JSONObject proposal()throws Exception{return CaptureCore.fromReview("Shopping","Walmart\n  Milk\n  Eggs");}
    @Test public void noTransmissionOrApplyBeforeStopAndStopIsIdempotent()throws Exception{
        JSONObject job=capture(),workspace=NotesCore.emptyWorkspace();assertFalse(AutoVoiceCore.pending(job));assertTrue(AutoVoiceCore.canRecord(job));
        try{AutoVoiceCore.apply(workspace,job,proposal(),NOW);fail();}catch(IllegalArgumentException expected){}
        AutoVoiceCore.stop(job,"Walmart with milk and eggs",NOW);String request=job.getString("requestId");assertTrue(AutoVoiceCore.pending(job));assertFalse(AutoVoiceCore.canRecord(job));AutoVoiceCore.stop(job,"do not replace submitted text",NOW);
        assertEquals(request,job.getString("requestId"));assertEquals("Walmart with milk and eggs",job.getString("raw"));
    }
    @Test public void automaticResultAddsOnceAndNeverChecksOffOtherItems()throws Exception{
        JSONObject job=capture(),workspace=NotesCore.emptyWorkspace();AutoVoiceCore.stop(job,"Shopping",NOW);
        String first=AutoVoiceCore.apply(workspace,job,proposal(),NOW),second=AutoVoiceCore.apply(workspace,job,proposal(),NOW);
        assertEquals(first,second);assertEquals(1,workspace.getJSONArray("personalNotes").length());assertEquals(3,NotesCore.orderedChecklist(NotesCore.findNote(workspace,first)).size());
        for(NotesCore.Row row:NotesCore.orderedChecklist(NotesCore.findNote(workspace,first)))assertTrue(row.item.isNull("completedAt"));
    }
    @Test public void retriesPreserveCaptureIdentityAndOnlyNewProviderAttemptGetsNewRequest()throws Exception{
        JSONObject job=capture();AutoVoiceCore.stop(job,"Milk",NOW);String id=job.getString("id"),request=job.getString("requestId");job.put("status","failed");AutoVoiceCore.retry(job,NOW);assertEquals(request,job.getString("requestId"));
        job.put("status","failed").put("remoteFinished",true);AutoVoiceCore.retry(job,NOW);assertEquals(id,job.getString("id"));assertNotEquals(request,job.getString("requestId"));assertEquals("Milk",job.getString("raw"));
    }
    @Test public void movedOrDeletedCurrentNoteIsNotReplacedOrRerouted()throws Exception{
        JSONObject workspace=NotesCore.emptyWorkspace();String note=NotesCore.addNote(workspace,null,null,"Original","Keep this",null,NOW);JSONObject job=AutoVoiceCore.create(false,note,null,"personal","personal",NOW);AutoVoiceCore.stop(job,"Milk",NOW);
        NotesCore.findNote(workspace,note).put("projectId","other-project");String before=workspace.toString();try{AutoVoiceCore.apply(workspace,job,proposal(),NOW);fail();}catch(IllegalArgumentException expected){}assertEquals(before,workspace.toString());
        NotesCore.findNote(workspace,note).remove("projectId");NotesCore.deleteNote(workspace,note,NOW);before=workspace.toString();try{AutoVoiceCore.apply(workspace,job,proposal(),NOW);fail();}catch(IllegalArgumentException expected){}assertEquals(before,workspace.toString());
    }
    @Test public void emptyStopAndCancelledCaptureNeverCreateAHallucinatedNote()throws Exception{
        JSONObject job=capture();try{AutoVoiceCore.stop(job,"  ",NOW);fail();}catch(IllegalArgumentException expected){}assertFalse(job.has("stoppedAt"));
        job.put("status","cancelled");AutoVoiceCore.stop(job,"Do not send",NOW);assertFalse(AutoVoiceCore.pending(job));assertFalse(job.has("requestId"));
    }
    @Test public void partialHypothesesReplaceRatherThanDuplicateAndSegmentsAppendOnce(){
        SpeechTranscript speech=new SpeechTranscript("");speech.beginSegment();assertEquals("milk",speech.partial("milk"));assertEquals("milk and eggs",speech.partial("milk and eggs"));assertEquals("Milk and eggs.",speech.finish("Milk and eggs."));assertEquals("Milk and eggs.",speech.finish("duplicate callback"));
        speech.beginSegment();speech.partial("Chicken");assertEquals("Milk and eggs.\nChicken",speech.finish(""));speech.beginSegment();assertEquals("Milk and eggs.\nChicken",speech.finish(""));
    }
    @Test public void resumeKeepsSavedWordsAndProviderFailureIsHonest()throws Exception{
        SpeechTranscript speech=new SpeechTranscript("Walmart");speech.beginSegment();speech.partial("Milk");assertEquals("Walmart\nMilk",speech.text());assertEquals("Walmart\nMilk",speech.finish("Milk"));
        assertTrue(AutoVoiceCore.failure(new JSONObject().put("reason","not-configured")).contains("isn’t configured"));
    }
}
