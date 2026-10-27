package com.forgeboard.notes.core;

import org.json.*;
import java.util.Objects;
import java.util.UUID;

/** Consent is the user's Stop, bound permanently to the recording's original destination. */
public final class AutoVoiceCore {
    private AutoVoiceCore(){}
    private static String value(JSONObject object,String key){Object value=object.opt(key);return value instanceof String?(String)value:null;}
    public static JSONObject create(boolean shared,String note,String project,String personalVault,String targetVault,String now)throws Exception{
        return new JSONObject().put("id",UUID.randomUUID().toString()).put("status","recording").put("raw","").put("shared",shared).put("noteId",note).put("projectId",project).put("personalVault",personalVault).put("targetVault",targetVault).put("createdAt",now).put("updatedAt",now);
    }
    public static boolean canRecord(JSONObject job){return "recording".equals(job.optString("status"))||"paused".equals(job.optString("status"));}
    public static boolean pending(JSONObject job){return java.util.Arrays.asList("queued","waiting","applying","waiting-connection").contains(job.optString("status"));}
    public static void stop(JSONObject job,String transcript,String now)throws Exception{
        if(!canRecord(job))return;
        if(transcript==null||transcript.trim().isEmpty()||transcript.length()>12000)throw new IllegalArgumentException("No words captured, or the recording exceeds 12,000 characters. Your saved recording has not been sent.");
        job.put("raw",transcript.trim()).put("status","queued").put("stoppedAt",now).put("updatedAt",now).put("requestId",UUID.randomUUID().toString()).put("uploaded",false);job.remove("error");
    }
    public static void retry(JSONObject job,String now)throws Exception{
        if(!job.has("stoppedAt"))throw new IllegalArgumentException("Press Stop before sending this recording.");
        if("applied".equals(job.optString("status"))||"cancelled".equals(job.optString("status")))return;
        if(job.optBoolean("remoteFinished")){job.put("requestId",UUID.randomUUID().toString()).put("uploaded",false).put("remoteFinished",false);job.remove("proposal");}
        job.put("status","queued").put("updatedAt",now);job.remove("error");job.remove("nextAttemptAt");
    }
    public static String apply(JSONObject workspace,JSONObject job,JSONObject proposal,String now)throws Exception{
        if(!job.has("stoppedAt")||!pending(job))throw new IllegalArgumentException("This recording was not submitted or was cancelled.");
        String noteId=value(job,"noteId");JSONObject note=noteId==null?null:NotesCore.findNote(workspace,noteId);
        if(note!=null&&!Objects.equals(value(note,"projectId"),value(job,"projectId")))throw new IllegalArgumentException("The original note moved to another project. Your transcript is saved; no other project was changed.");
        if(job.optBoolean("noteAware"))return NoteVoiceCore.apply(workspace,job,proposal,now);
        return CaptureCore.apply(workspace,noteId,value(job,"projectId"),job.getString("id"),proposal,now);
    }
    public static String failure(JSONObject response){
        switch(response.optString("reason")){
            case "not-configured":return "Claude isn’t configured in your personal vault yet. Your recording is saved. Add its private API secret, then Retry.";
            case "authentication_error":return "Claude refused the API key. Your recording is saved. Update the private secret, then Retry.";
            case "billing-unavailable":return "Claude API billing needs attention. Your recording is saved. Fix billing, then Retry.";
            case "workspace-required":return "Claude needs ANTHROPIC_WORKSPACE_ID in your personal vault’s Actions secrets. Your recording is saved; add it, then Retry.";
            default:return "Claude couldn’t organize this recording. The original is saved; Retry when the service is ready.";
        }
    }
}
