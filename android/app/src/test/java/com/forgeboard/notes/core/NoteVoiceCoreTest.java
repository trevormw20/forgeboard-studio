package com.forgeboard.notes.core;

import org.json.*;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class NoteVoiceCoreTest {
    private static final String NOW="2026-10-27T20:00:00Z",LATER="2026-10-27T21:00:00Z";
    private JSONObject workspace,job;private String note,walmart,fish,sauce,other;
    private void setup()throws Exception{
        workspace=NotesCore.emptyWorkspace();note=NotesCore.addNote(workspace,null,null,"Shopping","Keep all this text",null,NOW);
        walmart=NotesCore.addChecklistItem(workspace,note,"Walmart",null,null,NOW);fish=NotesCore.addChecklistItem(workspace,note,"Fish",walmart,null,NOW);sauce=NotesCore.addChecklistItem(workspace,note,"Sauce",fish,null,NOW);
        other=NotesCore.addNote(workspace,null,null,"Other note","Do not send",null,NOW);NotesCore.setChecklistChecked(workspace,note,sauce,true,NOW);
        job=AutoVoiceCore.create(false,note,null,"personal","personal",NOW).put("noteAware",true).put("noteContext",NoteVoiceCore.context(NotesCore.findNote(workspace,note)));AutoVoiceCore.stop(job,"Add milk under Walmart and tartar sauce under Fish",NOW);
    }
    private JSONObject plan(String...pairs)throws Exception{JSONArray rows=new JSONArray();for(int i=0;i<pairs.length;i+=2)rows.put(new JSONObject().put("text",pairs[i]).put("parent",pairs[i+1]));return new JSONObject().put("additions",rows);}
    private void unchangedReject(JSONObject plan)throws Exception{String before=workspace.toString();try{AutoVoiceCore.apply(workspace,job,plan,LATER);fail("Must reject");}catch(IllegalArgumentException expected){}assertEquals(before,workspace.toString());}
    @Test public void addsInsideExistingHierarchyAndPreservesEveryOriginalRecord()throws Exception{
        setup();JSONObject before=new JSONObject(NotesCore.findNote(workspace,note).toString());String unrelated=NotesCore.findNote(workspace,other).toString();
        AutoVoiceCore.apply(workspace,job,plan("Milk","existing:"+walmart,"Tartar sauce","existing:"+fish,"Brand","new:1","A separate reminder",""),LATER);
        JSONObject actual=NotesCore.findNote(workspace,note);JSONArray original=before.getJSONArray("checklist"),rows=actual.getJSONArray("checklist");
        for(int i=0;i<original.length();i++)assertEquals(original.getJSONObject(i).toString(),rows.getJSONObject(i).toString());
        for(Iterator<String> keys=before.keys();keys.hasNext();){String key=keys.next();if(!Arrays.asList("checklist","updatedAt").contains(key))assertEquals(before.get(key).toString(),actual.get(key).toString());}
        assertEquals(walmart,rows.getJSONObject(3).getString("parentId"));assertEquals(fish,rows.getJSONObject(4).getString("parentId"));assertEquals(rows.getJSONObject(4).getString("id"),rows.getJSONObject(5).getString("parentId"));assertFalse(rows.getJSONObject(6).has("parentId"));
        for(int i=3;i<rows.length();i++)assertTrue(rows.getJSONObject(i).isNull("completedAt"));assertEquals(unrelated,NotesCore.findNote(workspace,other).toString());
        assertFalse(job.getJSONObject("noteContext").toString().contains("Do not send"));
    }
    @Test public void rejectsCommandsUnknownCrossNoteAndForwardParentsAtomically()throws Exception{
        setup();String foreign=NotesCore.addChecklistItem(workspace,other,"Foreign",null,null,NOW);
        for(String parent:new String[]{"existing:","existing:missing","existing:"+foreign,"new:0","new:999","new:-1","new:00","delete:"+walmart})unchangedReject(plan("Keep valid first","","Bad",parent.equals("new:0")?"new:1":parent));
        unchangedReject(plan("Bad","existing:"+walmart).put("delete",walmart));JSONObject bad=plan("Bad","");bad.getJSONArray("additions").getJSONObject(0).put("completed",true);unchangedReject(bad);
    }
    @Test public void staleParentOrAncestorNeverGetsWrongAdditions()throws Exception{
        for(String change:new String[]{"rename","move","delete","ancestor"}){
            setup();JSONObject target=NotesCore.findNote(workspace,note).getJSONArray("checklist").getJSONObject(change.equals("ancestor")?0:1);
            if(change.equals("move"))target.remove("parentId");else if(change.equals("delete"))target.put("deletedAt",LATER);else target.put("text","Changed");
            unchangedReject(plan("New root must not partially apply","","New sauce","existing:"+fish));
        }
    }
    @Test public void concurrentAdditionsReordersAndChecksArePreservedAndReplayIsNoOp()throws Exception{
        setup();NotesCore.addChecklistItem(workspace,note,"Added elsewhere",walmart,null,LATER);NotesCore.setChecklistChecked(workspace,note,walmart,true,LATER);
        JSONObject original=new JSONObject(NotesCore.findNote(workspace,note).toString());JSONObject proposal=plan("Milk","existing:"+walmart);AutoVoiceCore.apply(workspace,job,proposal,LATER);
        JSONArray rows=NotesCore.findNote(workspace,note).getJSONArray("checklist");for(int i=0;i<original.getJSONArray("checklist").length();i++)assertEquals(original.getJSONArray("checklist").get(i).toString(),rows.get(i).toString());
        NotesCore.deleteChecklistItem(workspace,note,walmart,LATER);String before=workspace.toString();AutoVoiceCore.apply(workspace,job,proposal,LATER);assertEquals(before,workspace.toString());
    }
    @Test public void malformedLegacyRowsAreNotRepairedAndNewRootsDoNotAlterThem()throws Exception{
        setup();NotesCore.findNote(workspace,note).getJSONArray("checklist").getJSONObject(2).put("parentId","missing");String old=NotesCore.findNote(workspace,note).getJSONArray("checklist").getJSONObject(2).toString();AutoVoiceCore.apply(workspace,job,plan("New root",""),LATER);assertEquals(old,NotesCore.findNote(workspace,note).getJSONArray("checklist").getJSONObject(2).toString());
    }
    @Test public void contextLimitsAndExtremeOrderingFailWithoutChangingNote()throws Exception{
        setup();JSONObject n=NotesCore.findNote(workspace,note);n.put("body",String.join("",Collections.nCopies(64001,"x")));try{NoteVoiceCore.context(n);fail();}catch(IllegalArgumentException expected){}
        n.getJSONArray("checklist").getJSONObject(1).put("order",Double.MAX_VALUE);unchangedReject(plan("Milk","existing:"+walmart));
    }
}
