package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import static com.forgeboard.notes.core.JsonSupport.*;
import static com.forgeboard.notes.core.NotesCoreTest.*;
import static org.junit.Assert.*;

public class StaticWorkspaceMergerTest {
    private static final String T0 = "2026-10-22T12:00:00.000Z";
    private static final String T1 = "2026-10-22T12:00:01.000Z";
    private static final String T2 = "2026-10-22T12:00:02.000Z";
    private static final String T3 = "2026-10-22T12:00:03.000Z";

    @Test public void onlyNotesAndLabelsAreMergedIntoNewestGitHubEnvelope() {
        JSONObject base = workspace();
        String id = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateNote(local, id, object("{\"body\":\"Phone offline edit\"}"), T1);
        put(local, "tasks", new JSONArray().put(object("{\"id\":\"stale-task\"}")));
        put(local, "ai", object("{\"notice\":\"stale\"}"));
        put(remote, "tasks", new JSONArray().put(object("{\"id\":\"new-live-task\",\"title\":\"Keep me\",\"futureTaskField\":42}")));
        put(remote, "futureWorkspaceField", object("{\"private\":true}"));
        put(remote, "ai", object("{\"notice\":\"Current\"}"));
        put(remote, "handoffSummaries", new JSONArray().put(object("{\"id\":\"new-handoff\"}")));
        String localBefore = local.toString(), remoteBefore = remote.toString();
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T2);
        assertTrue(equal(remote.opt("tasks"), merged.opt("tasks")));
        assertTrue(equal(remote.opt("projects"), merged.opt("projects")));
        assertTrue(equal(remote.opt("ai"), merged.opt("ai")));
        assertTrue(equal(remote.opt("handoffSummaries"), merged.opt("handoffSummaries")));
        assertTrue(equal(remote.opt("futureWorkspaceField"), merged.opt("futureWorkspaceField")));
        assertEquals("Phone offline edit", NotesCore.findNote(merged, id).optString("body"));
        assertEquals(localBefore, local.toString());
        assertEquals(remoteBefore, remote.toString());
    }

    @Test public void independentTitleAndBodyEditsBothSurvive() {
        JSONObject base = workspace();
        String id = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateNote(local, id, object("{\"title\":\"Phone title\"}"), T1);
        NotesCore.updateNote(remote, id, object("{\"body\":\"Desktop body\"}"), T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertEquals("Phone title", NotesCore.findNote(merged, id).optString("title"));
        assertEquals("Desktop body", NotesCore.findNote(merged, id).optString("body"));
        assertEquals(0, merged.optJSONArray("conflicts").length());
    }

    @Test public void sameChecklistItemTextAndCheckboxAreIndependentFields() {
        JSONObject base = workspace();
        String note = addNote(base);
        String row = NotesCore.addChecklistItem(base, note, "Test", null, null, T0);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateChecklistText(local, note, row, "Test on Android", T1);
        NotesCore.setChecklistChecked(remote, note, row, true, T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        JSONObject mergedRow = item(NotesCore.findNote(merged, note), row);
        assertEquals("Test on Android", mergedRow.optString("text"));
        assertEquals(T2, mergedRow.optString("completedAt"));
        assertEquals(0, merged.optJSONArray("conflicts").length());
    }

    @Test public void checkmarksOnDifferentItemsAndNoteBodyAllSurvive() {
        JSONObject base = workspace();
        String note = addNote(base);
        String a = NotesCore.addChecklistItem(base, note, "One", null, null, T0);
        String b = NotesCore.addChecklistItem(base, note, "Two", a, null, T0);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.setChecklistChecked(local, note, a, true, T1);
        NotesCore.setChecklistChecked(remote, note, b, true, T2);
        NotesCore.updateNote(remote, note, object("{\"body\":\"Website edited\"}"), T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        JSONObject result = NotesCore.findNote(merged, note);
        assertTrue(item(result, a).has("completedAt"));
        assertTrue(item(result, b).has("completedAt"));
        assertEquals("Website edited", result.optString("body"));
        assertEquals(0, merged.optJSONArray("conflicts").length());
    }

    @Test public void conflictingTextPreservesBothWholeNotesIncludingNestedChecksAndTrash() {
        JSONObject base = workspace();
        String note = addNote(base);
        String parent = NotesCore.addChecklistItem(base, note, "Parent", null, null, T0);
        String child = NotesCore.addChecklistItem(base, note, "Child", parent, null, T0);
        NotesCore.deleteChecklistItem(base, note, child, T0);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateChecklistText(local, note, parent, "Phone version", T1);
        NotesCore.updateChecklistText(remote, note, parent, "Desktop version", T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertEquals("Desktop version", item(NotesCore.findNote(merged, note), parent).optString("text"));
        assertEquals(1, merged.optJSONArray("conflicts").length());
        JSONObject conflict = merged.optJSONArray("conflicts").optJSONObject(0);
        assertEquals("personal-note", conflict.optString("entityType"));
        assertEquals(note, conflict.optString("entityId"));
        assertTrue(equal(NotesCore.findNote(local, note), conflict.optJSONObject("local")));
        assertTrue(equal(NotesCore.findNote(remote, note), conflict.optJSONObject("remote")));
        assertTrue(item(conflict.optJSONObject("local"), child).has("deletedAt"));
    }

    @Test public void noteBodyConflictUsesChronologicalTimeNotLexicalFractionFormatting() {
        JSONObject base = workspace();
        String note = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateNote(local, note, object("{\"body\":\"Earlier\"}"), "2026-10-22T12:00:01Z");
        NotesCore.updateNote(remote, note, object("{\"body\":\"Later\"}"), "2026-10-22T12:00:01.001Z");
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T2);
        assertEquals("Later", NotesCore.findNote(merged, note).optString("body"));
        assertEquals(1, merged.optJSONArray("conflicts").length());
    }

    @Test public void deleteAgainstNewEditRetainsTombstoneContentAndSnapshots() {
        JSONObject base = workspace();
        String note = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.deleteNote(local, note, T1);
        NotesCore.updateNote(remote, note, object("{\"body\":\"Important new content\"}"), T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertTrue(NotesCore.findNote(merged, note).has("deletedAt"));
        assertEquals("Important new content", NotesCore.findNote(merged, note).optString("body"));
        assertEquals(1, merged.optJSONArray("conflicts").length());
        NotesCore.restoreNote(merged, note, T3);
        assertEquals("Important new content", NotesCore.findNote(merged, note).optString("body"));
    }

    @Test public void concurrentAdditionsAndNewChildUnderDeletedParentRemainAccessible() {
        JSONObject base = workspace();
        String note = addNote(base);
        String parent = NotesCore.addChecklistItem(base, note, "Parent", null, null, T0);
        JSONObject local = copy(base), remote = copy(base);
        String localNote = NotesCore.addNote(local, "snail", null, "Offline note", "", null, T1);
        String newChild = NotesCore.addChecklistItem(local, note, "New offline child", parent, null, T1);
        NotesCore.deleteChecklistItem(remote, note, parent, T2);
        String remoteNote = NotesCore.addNote(remote, "tactics", null, "Web note", "", null, T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertNotNull(NotesCore.findNote(merged, localNote));
        assertNotNull(NotesCore.findNote(merged, remoteNote));
        assertEquals(newChild, NotesCore.orderedChecklist(NotesCore.findNote(merged, note)).get(0).item.optString("id"));
        assertEquals(0, NotesCore.orderedChecklist(NotesCore.findNote(merged, note)).get(0).depth);
    }

    @Test public void optionalCollectionsAndUnknownNoteFieldsSurviveOlderClients() {
        JSONObject base = workspace();
        String note = addNote(base);
        String row = NotesCore.addChecklistItem(base, note, "Keep item", null, null, T0);
        put(NotesCore.findNote(base, note), "futureContent", object("{\"keep\":true}"));
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.findNote(remote, note).remove("futureContent");
        NotesCore.findNote(remote, note).remove("checklist");
        NotesCore.updateNote(remote, note, object("{\"body\":\"Older website body\"}"), T1);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T2);
        assertTrue(NotesCore.findNote(merged, note).has("futureContent"));
        assertEquals(row, NotesCore.orderedChecklist(NotesCore.findNote(merged, note)).get(0).item.optString("id"));
        JSONObject olderLocal = copy(base);
        olderLocal.remove("personalNotes");
        put(NotesCore.findNote(remote, note), "futureContent", object("{\"keep\":\"new remote\"}"));
        JSONObject second = StaticWorkspaceMerger.merge(base, olderLocal, remote, T2);
        assertEquals("new remote", NotesCore.findNote(second, note).optJSONObject("futureContent").optString("keep"));
    }

    @Test public void omittedArraysAreNotAnInstructionToDeleteBaseRecords() {
        JSONObject base = workspace();
        String note = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        local.remove("personalNotes");
        remote.remove("personalNotes");
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T1);
        assertNotNull(NotesCore.findNote(merged, note));
    }

    @Test public void labelsMergeIndependentAssignmentsAndKeepTombstones() {
        JSONObject base = workspace();
        String note = addNote(base);
        String firstLabel = NotesCore.saveLabel(base, null, "snail", "First", "#aabbcc", T0);
        JSONObject local = copy(base), remote = copy(base);
        String secondLabel = NotesCore.saveLabel(local, null, "snail", "Second", "#336699", T1);
        String thirdLabel = NotesCore.saveLabel(remote, null, null, "General", "#998877", T2);
        JSONObject a = new JSONObject(), b = new JSONObject();
        put(a, "labelIds", new JSONArray().put(secondLabel));
        put(b, "labelIds", new JSONArray().put(thirdLabel));
        NotesCore.updateNote(local, note, a, T1);
        NotesCore.updateNote(remote, note, b, T2);
        NotesCore.deleteLabel(remote, firstLabel, T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertEquals(2, NotesCore.findNote(merged, note).optJSONArray("labelIds").length());
        assertEquals(3, merged.optJSONArray("noteLabels").length());
        assertTrue(merged.optJSONArray("noteLabels").optJSONObject(0).has("deletedAt"));
    }

    @Test public void staleShaRetryKeepsSecondServerEditsAndEarlierMergedChecks() {
        JSONObject base = workspace();
        String note = addNote(base);
        String row = NotesCore.addChecklistItem(base, note, "Test", null, null, T0);
        JSONObject local = copy(base), server = copy(base);
        NotesCore.updateChecklistText(local, note, row, "Phone text", T1);
        NotesCore.setChecklistChecked(server, note, row, true, T2);
        JSONObject firstAttempt = StaticWorkspaceMerger.merge(base, local, server, T3);
        JSONObject secondServer = copy(server);
        NotesCore.updateNote(secondServer, note, object("{\"title\":\"Server advanced\"}"), T3);
        put(secondServer, "tasks", new JSONArray().put(object("{\"id\":\"new-task-after-sha\"}")));
        JSONObject retried = StaticWorkspaceMerger.merge(base, firstAttempt, secondServer, "2026-10-22T12:00:04Z");
        JSONObject mergedNote = NotesCore.findNote(retried, note);
        assertEquals("Phone text", item(mergedNote, row).optString("text"));
        assertTrue(item(mergedNote, row).has("completedAt"));
        assertEquals("Server advanced", mergedNote.optString("title"));
        assertEquals("new-task-after-sha", retried.optJSONArray("tasks").optJSONObject(0).optString("id"));
    }

    @Test public void sameConflictRetryDoesNotCreateDuplicateSnapshots() {
        JSONObject base = workspace();
        String note = addNote(base);
        JSONObject local = copy(base), remote = copy(base);
        NotesCore.updateNote(local, note, object("{\"body\":\"Phone\"}"), T2);
        NotesCore.updateNote(remote, note, object("{\"body\":\"Website\"}"), T1);
        JSONObject first = StaticWorkspaceMerger.merge(base, local, remote, T3);
        JSONObject second = StaticWorkspaceMerger.merge(base, first, remote, "2026-10-22T12:00:04Z");
        assertEquals(1, first.optJSONArray("conflicts").length());
        assertEquals(1, second.optJSONArray("conflicts").length());
        assertTrue(equal(first.optJSONArray("conflicts").optJSONObject(0).optJSONObject("local"), second.optJSONArray("conflicts").optJSONObject(0).optJSONObject("local")));
    }

    @Test public void conflictingNestingCanNeverHideChecklistRows() {
        JSONObject base = workspace();
        String note = addNote(base);
        String a = NotesCore.addChecklistItem(base, note, "A", null, null, T0);
        String b = NotesCore.addChecklistItem(base, note, "B", null, null, T0);
        JSONObject local = copy(base), remote = copy(base);
        put(item(NotesCore.findNote(local, note), a), "parentId", b);
        put(item(NotesCore.findNote(remote, note), b), "parentId", a);
        put(NotesCore.findNote(local, note), "updatedAt", T1);
        put(NotesCore.findNote(remote, note), "updatedAt", T2);
        JSONObject merged = StaticWorkspaceMerger.merge(base, local, remote, T3);
        assertEquals(2, NotesCore.orderedChecklist(NotesCore.findNote(merged, note)).size());
        for (NotesCore.Row row : NotesCore.orderedChecklist(NotesCore.findNote(merged, note))) assertEquals(0, row.depth);
    }
}
