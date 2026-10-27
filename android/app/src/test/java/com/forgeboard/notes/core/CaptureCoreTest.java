package com.forgeboard.notes.core;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class CaptureCoreTest {
    private static final String NOW="2026-10-27T12:00:00Z", JOB="18a358b8-19e2-4f51-9ada-46fad0e23645";
    @Test public void groupPlusesAppearOnlyAtEachParentsLastDescendant()throws Exception{
        JSONObject a=new JSONObject().put("id","a"),b=new JSONObject().put("id","b"),c=new JSONObject().put("id","c"),d=new JSONObject().put("id","d");
        Map<String,List<NotesCore.Row>> ends=CaptureCore.branchEnds(Arrays.asList(new NotesCore.Row(a,0),new NotesCore.Row(b,1),new NotesCore.Row(c,2),new NotesCore.Row(d,0)));
        assertEquals(1,ends.size());assertEquals("b",ends.get("c").get(0).item.getString("id"));assertEquals("a",ends.get("c").get(1).item.getString("id"));
    }
    @Test public void localFallbackPreservesMeaningAndDeduplicatesOnlyExplicitLines()throws Exception{
        JSONObject result=CaptureCore.localDraft("um fish and sauce; turkey; turkey");
        assertEquals(2,result.getJSONArray("items").length());assertEquals("um fish and sauce",result.getJSONArray("items").getJSONObject(0).getString("text"));
    }
    @Test public void reviewRoundTripKeepsNestedLevelsAndRejectsJumps()throws Exception{
        JSONObject proposal=CaptureCore.fromReview("Shopping","Walmart\n  Fish\n    Sauce\nCostco\n  Turkey");
        assertEquals(5,proposal.getJSONArray("items").length());assertEquals(2,proposal.getJSONArray("items").getJSONObject(2).getInt("depth"));
        assertEquals("Walmart\n  Fish\n    Sauce\nCostco\n  Turkey",CaptureCore.reviewText(proposal));
        try{CaptureCore.fromReview("","root\n    jump");fail();}catch(IllegalArgumentException expected){}
    }
    @Test public void approvalAppendsUncheckedRowsAndReplayNeverDuplicates()throws Exception{
        JSONObject workspace=NotesCore.emptyWorkspace();String note=NotesCore.addNote(workspace,null,null,"Existing","Private body",null,NOW);NotesCore.addChecklistItem(workspace,note,"Original",null,null,NOW);
        JSONObject proposal=CaptureCore.fromReview("Ignore for existing","Walmart\n  Fish\n    Sauce");
        assertEquals(note,CaptureCore.apply(workspace,note,null,JOB,proposal,NOW));CaptureCore.apply(workspace,note,null,JOB,proposal,NOW);
        List<NotesCore.Row> rows=NotesCore.orderedChecklist(NotesCore.findNote(workspace,note));assertEquals(4,rows.size());assertEquals(2,rows.get(3).depth);
        for(NotesCore.Row row:rows)assertTrue(row.item.isNull("completedAt")||!row.item.has("completedAt"));assertEquals("Private body",NotesCore.findNote(workspace,note).getString("body"));
    }
    @Test public void newNoteReplayAndDeletedDestinationAreSafe()throws Exception{
        JSONObject workspace=NotesCore.emptyWorkspace(),proposal=CaptureCore.fromReview("Groceries","Fish");String id=CaptureCore.apply(workspace,null,null,JOB,proposal,NOW);assertEquals(id,CaptureCore.apply(workspace,null,null,JOB,proposal,NOW));assertEquals(1,workspace.getJSONArray("personalNotes").length());
        NotesCore.deleteNote(workspace,id,NOW);try{CaptureCore.apply(workspace,id,null,JOB,proposal,NOW);fail();}catch(IllegalArgumentException expected){}
    }
    @Test public void selectedListSharingCopiesNoOtherPrivateDataAndIsIdempotent()throws Exception{
        JSONObject source=NotesCore.emptyWorkspace(),shared=NotesCore.emptyWorkspace();String note=NotesCore.addNote(source,null,null,"Shopping","Only selected text",null,NOW);String root=NotesCore.addChecklistItem(source,note,"Walmart",null,null,NOW);NotesCore.addChecklistItem(source,note,"Fish",root,null,NOW);NotesCore.addNote(source,null,note,"SECRET SUBNOTE","Do not share",null,NOW);String before=source.toString();
        String copied=CaptureCore.share(shared,NotesCore.findNote(source,note),"private-vault",NOW);assertEquals(copied,CaptureCore.share(shared,NotesCore.findNote(source,note),"private-vault",NOW));assertEquals(1,shared.getJSONArray("personalNotes").length());assertFalse(shared.toString().contains("SECRET"));assertEquals(before,source.toString());assertEquals(1,NotesCore.orderedChecklist(NotesCore.findNote(shared,copied)).get(1).depth);
    }
}
