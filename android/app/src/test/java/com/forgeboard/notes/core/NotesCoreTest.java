package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

import static com.forgeboard.notes.core.JsonSupport.*;
import static org.junit.Assert.*;

public class NotesCoreTest {
    private static final String T0 = "2026-10-22T12:00:00.000Z";
    private static final String T1 = "2026-10-22T12:00:01.000Z";
    private static final String T2 = "2026-10-22T12:00:02.000Z";
    private static final String T3 = "2026-10-22T12:00:03.000Z";

    static JSONObject object(String json) {
        try { return new JSONObject(json); }
        catch (Exception error) { throw new AssertionError(error); }
    }

    static JSONObject workspace() {
        JSONObject workspace = NotesCore.emptyWorkspace();
        put(workspace, "updatedAt", T0);
        put(workspace, "projects", new JSONArray().put(object("{\"id\":\"snail\",\"name\":\"Snail Mail\"}")).put(object("{\"id\":\"tactics\",\"name\":\"Tactics game\"}")));
        return workspace;
    }

    static String addNote(JSONObject workspace) { return NotesCore.addNote(workspace, "snail", null, "Review", "Plain text", null, T0); }

    static JSONObject item(JSONObject note, String id) {
        for (JSONObject item : objects(note, "checklist")) if (id.equals(item.optString("id", ""))) return item;
        throw new AssertionError("Missing item: " + id);
    }

    private static void rejects(Runnable action) {
        try { action.run(); fail("Expected validation error"); }
        catch (IllegalArgumentException expected) { assertFalse(expected.getMessage().isEmpty()); }
    }

    @Test public void emptyWorkspaceNeverSeedsFakeProjectsOrTasks() {
        JSONObject workspace = NotesCore.emptyWorkspace();
        assertEquals(0, workspace.optJSONArray("projects").length());
        assertEquals(0, workspace.optJSONArray("tasks").length());
        assertEquals(0, workspace.optJSONArray("personalNotes").length());
        assertEquals(1, workspace.optInt("schemaVersion"));
    }

    @Test public void notesUseExactExistingScopeAndPlainText() {
        JSONObject workspace = workspace();
        String id = NotesCore.addNote(workspace, "snail", null, "<b>Title</b>", "<script>not code</script>", "#aBc", T0);
        JSONObject note = NotesCore.findNote(workspace, id);
        assertEquals("snail", note.optString("projectId"));
        assertEquals("<script>not code</script>", note.optString("body"));
        assertEquals("#aabbcc", note.optString("color"));
        String general = NotesCore.addNote(workspace, null, null, "General", "", null, T0);
        assertFalse(NotesCore.findNote(workspace, general).has("projectId"));
        assertEquals(1, NotesCore.activeNotes(workspace, "snail").size());
        assertEquals(1, NotesCore.activeNotes(workspace, null).size());
    }

    @Test public void nonexistentOrDeletedProjectCannotReceiveNotes() {
        JSONObject workspace = workspace();
        String before = workspace.toString();
        rejects(() -> NotesCore.addNote(workspace, "Snail mail", null, "Wrong identity", "", null, T1));
        assertEquals(before, workspace.toString());
        put(workspace.optJSONArray("projects").optJSONObject(0), "deletedAt", T1);
        rejects(() -> NotesCore.addNote(workspace, "snail", null, "Archived", "", null, T2));
    }

    @Test public void parentMustStayInSameProjectAndRejectCyclesAtomically() {
        JSONObject workspace = workspace();
        String parent = addNote(workspace);
        rejects(() -> NotesCore.addNote(workspace, "tactics", parent, "Wrong", "", null, T1));
        String child = NotesCore.addNote(workspace, "snail", parent, "Child", "", null, T1);
        String grandchild = NotesCore.addNote(workspace, "snail", child, "Grandchild", "", null, T1);
        JSONObject changes = object("{\"title\":\"Should not save\"}");
        put(changes, "parentId", grandchild);
        rejects(() -> NotesCore.updateNote(workspace, parent, changes, T2));
        assertEquals("Review", NotesCore.findNote(workspace, parent).optString("title"));
        assertFalse(NotesCore.findNote(workspace, parent).has("parentId"));
    }

    @Test public void updatingContentCannotChangeNoteIdentityOrProject() {
        JSONObject workspace = workspace();
        String id = addNote(workspace);
        NotesCore.updateNote(workspace, id, object("{\"id\":\"bad\",\"projectId\":\"tactics\",\"createdAt\":\"wrong\",\"title\":\"Updated\",\"pinned\":true}"), T1);
        JSONObject note = NotesCore.findNote(workspace, id);
        assertEquals(id, note.optString("id"));
        assertEquals("snail", note.optString("projectId"));
        assertEquals(T0, note.optString("createdAt"));
        assertTrue(note.optBoolean("pinned"));
    }

    @Test public void ordinaryEditRepairsBrokenOrCyclicParentWithoutLosingContent() {
        JSONObject workspace = workspace();
        String first = addNote(workspace);
        String second = NotesCore.addNote(workspace, "snail", first, "Second", "body", null, T1);
        put(NotesCore.findNote(workspace, first), "parentId", second);
        assertNull(NotesCore.noteParent(NotesCore.findNote(workspace, first), objects(workspace, "personalNotes")));
        NotesCore.updateNote(workspace, first, object("{\"body\":\"Still here\"}"), T2);
        assertFalse(NotesCore.findNote(workspace, first).has("parentId"));
        assertEquals("Still here", NotesCore.findNote(workspace, first).optString("body"));
        assertEquals(first, NotesCore.noteParent(NotesCore.findNote(workspace, second), objects(workspace, "personalNotes")));
    }

    @Test public void customLabelsValidateScopeAndPreserveReferencesWhenDeleted() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String labelId = NotesCore.saveLabel(workspace, null, "snail", "Next release", "#39a", T1);
        rejects(() -> NotesCore.saveLabel(workspace, null, "snail", "NEXT RELEASE", "#ffffff", T1));
        JSONObject changes = new JSONObject();
        put(changes, "labelIds", new JSONArray().put(labelId).put(labelId));
        NotesCore.updateNote(workspace, noteId, changes, T1);
        assertEquals(1, NotesCore.findNote(workspace, noteId).optJSONArray("labelIds").length());
        String otherNote = NotesCore.addNote(workspace, "tactics", null, "Other", "", null, T1);
        rejects(() -> NotesCore.updateNote(workspace, otherNote, changes, T2));
        rejects(() -> NotesCore.saveLabel(workspace, labelId, "tactics", "Moved", "#336699", T2));
        NotesCore.deleteLabel(workspace, labelId, T2);
        assertEquals(labelId, NotesCore.findNote(workspace, noteId).optJSONArray("labelIds").optString(0));
        NotesCore.updateNote(workspace, noteId, object("{\"body\":\"Still editable\"}"), T3);
    }

    @Test public void noteDeleteAndRestoreNeverRevivesEarlierTrashEvenAtSameTimestamp() {
        JSONObject workspace = workspace();
        String parent = addNote(workspace);
        String child = NotesCore.addNote(workspace, "snail", parent, "Child", "", null, T0);
        String earlier = NotesCore.addNote(workspace, "snail", child, "Earlier trash", "", null, T0);
        NotesCore.deleteNote(workspace, earlier, T1);
        NotesCore.deleteNote(workspace, parent, T1);
        assertEquals(2, NotesCore.deletedNoteRoots(workspace).size());
        NotesCore.restoreNote(workspace, parent, T2);
        assertFalse(NotesCore.findNote(workspace, parent).has("deletedAt"));
        assertFalse(NotesCore.findNote(workspace, child).has("deletedAt"));
        assertTrue(NotesCore.findNote(workspace, earlier).has("deletedAt"));
        assertEquals(1, NotesCore.deletedNoteRoots(workspace).size());
    }

    @Test public void corruptedCrossProjectParentNeverDeletesOtherProjectNotes() {
        JSONObject workspace = workspace();
        String parent = addNote(workspace);
        String unrelated = NotesCore.addNote(workspace, "tactics", null, "Other project", "", null, T0);
        put(NotesCore.findNote(workspace, unrelated), "parentId", parent);
        NotesCore.deleteNote(workspace, parent, T1);
        assertFalse(NotesCore.findNote(workspace, unrelated).has("deletedAt"));
        assertNull(NotesCore.noteParent(NotesCore.findNote(workspace, unrelated), objects(workspace, "personalNotes")));
    }

    @Test public void trashedNoteCyclesHaveARecoverableRoot() {
        JSONObject workspace = workspace();
        String first = addNote(workspace);
        String second = NotesCore.addNote(workspace, "snail", first, "Second", "", null, T0);
        put(NotesCore.findNote(workspace, first), "parentId", second);
        NotesCore.deleteNote(workspace, first, T1);
        assertEquals(1, NotesCore.deletedNoteRoots(workspace).size());
        NotesCore.restoreNote(workspace, first, T2);
        assertEquals(2, NotesCore.activeNotes(workspace, "snail").size());
        assertFalse(NotesCore.findNote(workspace, first).has("parentId"));
    }

    @Test public void checklistHasSubAndSubSubRowsWithIndependentChecks() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String first = NotesCore.addChecklistItem(workspace, noteId, "Tuesday", null, null, T0);
        String second = NotesCore.addChecklistItem(workspace, noteId, "Shopping", first, null, T0);
        String third = NotesCore.addChecklistItem(workspace, noteId, "Orange chicken", second, null, T0);
        JSONObject note = NotesCore.findNote(workspace, noteId);
        List<NotesCore.Row> rows = NotesCore.orderedChecklist(note);
        assertEquals(3, rows.size());
        assertEquals(0, rows.get(0).depth);
        assertEquals(1, rows.get(1).depth);
        assertEquals(2, rows.get(2).depth);
        NotesCore.setChecklistChecked(workspace, noteId, second, true, T1);
        assertTrue(item(note, second).has("completedAt"));
        assertFalse(item(note, first).has("completedAt"));
        assertFalse(item(note, third).has("completedAt"));
    }

    @Test public void repeatedWidgetDesiredStateDoesNotToggleOrTouchAgain() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String itemId = NotesCore.addChecklistItem(workspace, noteId, "Done", null, null, T0);
        NotesCore.setChecklistChecked(workspace, noteId, itemId, true, T1);
        String once = workspace.toString();
        NotesCore.setChecklistChecked(workspace, noteId, itemId, true, T2);
        assertEquals(once, workspace.toString());
        NotesCore.setChecklistChecked(workspace, noteId, itemId, false, T3);
        assertFalse(item(NotesCore.findNote(workspace, noteId), itemId).has("completedAt"));
    }

    @Test public void indentOutdentAndReorderKeepChildSubtreeTogether() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String a = NotesCore.addChecklistItem(workspace, noteId, "A", null, null, T0);
        String b = NotesCore.addChecklistItem(workspace, noteId, "B", null, null, T0);
        String child = NotesCore.addChecklistItem(workspace, noteId, "Child B", b, null, T0);
        JSONObject note = NotesCore.findNote(workspace, noteId);
        NotesCore.moveChecklistItem(workspace, noteId, b, "indent", T1);
        assertEquals(a, item(note, b).optString("parentId"));
        assertEquals(2, NotesCore.orderedChecklist(note).get(2).depth);
        NotesCore.moveChecklistItem(workspace, noteId, b, "outdent", T2);
        assertFalse(item(note, b).has("parentId"));
        NotesCore.moveChecklistItem(workspace, noteId, b, "up", T3);
        assertEquals(b, NotesCore.orderedChecklist(note).get(0).item.optString("id"));
        assertEquals(child, NotesCore.orderedChecklist(note).get(1).item.optString("id"));
        assertEquals(a, NotesCore.orderedChecklist(note).get(2).item.optString("id"));
    }

    @Test public void malformedOrCyclicChecklistParentsRemainVisibleAndEditable() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String a = NotesCore.addChecklistItem(workspace, noteId, "A", null, null, T0);
        String b = NotesCore.addChecklistItem(workspace, noteId, "B", a, null, T0);
        JSONObject note = NotesCore.findNote(workspace, noteId);
        put(item(note, a), "parentId", b);
        assertEquals(2, NotesCore.orderedChecklist(note).size());
        assertEquals(0, NotesCore.orderedChecklist(note).get(0).depth);
        assertEquals(0, NotesCore.orderedChecklist(note).get(1).depth);
        NotesCore.updateChecklistText(workspace, noteId, a, "Repaired", T1);
        assertFalse(item(note, a).has("parentId"));
        assertEquals(1, NotesCore.orderedChecklist(note).get(1).depth);
    }

    @Test public void checklistUndoRestoresOnlySameDeleteBatch() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String parent = NotesCore.addChecklistItem(workspace, noteId, "Parent", null, null, T0);
        String child = NotesCore.addChecklistItem(workspace, noteId, "Child", parent, null, T0);
        String earlier = NotesCore.addChecklistItem(workspace, noteId, "Earlier trash", child, null, T0);
        NotesCore.deleteChecklistItem(workspace, noteId, earlier, T1);
        NotesCore.deleteChecklistItem(workspace, noteId, parent, T1);
        JSONObject note = NotesCore.findNote(workspace, noteId);
        assertEquals(2, NotesCore.deletedChecklistRoots(note).size());
        NotesCore.restoreChecklistItem(workspace, noteId, parent, T2);
        assertEquals(2, NotesCore.orderedChecklist(note).size());
        assertTrue(item(note, earlier).has("deletedAt"));
        assertEquals(1, NotesCore.deletedChecklistRoots(note).size());
    }

    @Test public void checklistCannotReachAnItemInAnotherNote() {
        JSONObject workspace = workspace();
        String first = addNote(workspace), second = addNote(workspace);
        String itemId = NotesCore.addChecklistItem(workspace, first, "First note", null, null, T0);
        rejects(() -> NotesCore.addChecklistItem(workspace, second, "No", itemId, null, T1));
        rejects(() -> NotesCore.setChecklistChecked(workspace, second, itemId, true, T1));
        assertFalse(item(NotesCore.findNote(workspace, first), itemId).has("completedAt"));
    }

    @Test public void oversizeAndInvalidTextDoesNotDestroyExistingContent() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String before = workspace.toString();
        rejects(() -> NotesCore.updateNote(workspace, noteId, object("{\"body\":null}"), T1));
        rejects(() -> NotesCore.addChecklistItem(workspace, noteId, null, null, null, T1));
        rejects(() -> NotesCore.updateNote(workspace, noteId, object("{\"color\":\"url(javascript:bad)\"}"), T1));
        assertEquals(before, workspace.toString());
    }

    @Test public void snapshotRecoveryRemapsIdsAndRepairsCyclesWithoutChangingOriginals() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String a = NotesCore.addChecklistItem(workspace, noteId, "Parent", null, null, T0);
        String b = NotesCore.addChecklistItem(workspace, noteId, "Child", a, null, T0);
        String trash = NotesCore.addChecklistItem(workspace, noteId, "Earlier trash", b, null, T0);
        NotesCore.setChecklistChecked(workspace, noteId, b, true, T1);
        NotesCore.deleteChecklistItem(workspace, noteId, trash, T1);
        JSONObject snapshot = copy(NotesCore.findNote(workspace, noteId));
        put(item(snapshot, a), "parentId", b);
        put(snapshot, "deletedAt", T2);
        String original = snapshot.toString();
        String recoveredId = NotesCore.recoverNoteSnapshot(workspace, snapshot, T3);
        JSONObject recovered = NotesCore.findNote(workspace, recoveredId);
        assertNotEquals(noteId, recoveredId);
        assertEquals("snail", recovered.optString("projectId"));
        assertEquals("Review (saved copy)", recovered.optString("title"));
        assertEquals("Plain text", recovered.optString("body"));
        assertFalse(recovered.has("deletedAt"));
        assertEquals(2, NotesCore.orderedChecklist(recovered).size());
        assertEquals(3, recovered.optJSONArray("checklist").length());
        for (NotesCore.Row row : NotesCore.orderedChecklist(recovered)) {
            assertEquals(0, row.depth);
            assertNotEquals(a, row.item.optString("id"));
            assertNotEquals(b, row.item.optString("id"));
            if (row.item.optString("text").equals("Child")) assertEquals(T1, row.item.optString("completedAt"));
        }
        assertEquals(1, NotesCore.deletedChecklistRoots(recovered).size());
        assertEquals(original, snapshot.toString());
        assertEquals(3, NotesCore.findNote(workspace, noteId).optJSONArray("checklist").length());
    }

    @Test public void snapshotFromUnavailableProjectRecoversOnlyInGeneralWithGlobalLabels() {
        JSONObject workspace = workspace();
        String noteId = addNote(workspace);
        String projectLabel = NotesCore.saveLabel(workspace, null, "snail", "Project", "#aabbcc", T0);
        String globalLabel = NotesCore.saveLabel(workspace, null, null, "General", "#ccbbaa", T0);
        JSONObject snapshot = copy(NotesCore.findNote(workspace, noteId));
        put(snapshot, "labelIds", new JSONArray().put(projectLabel).put(globalLabel));
        put(snapshot, "projectId", "unavailable-project");
        String id = NotesCore.recoverNoteSnapshot(workspace, snapshot, T1);
        JSONObject recovered = NotesCore.findNote(workspace, id);
        assertFalse(recovered.has("projectId"));
        assertEquals(1, recovered.optJSONArray("labelIds").length());
        assertEquals(globalLabel, recovered.optJSONArray("labelIds").optString(0));
        assertEquals("snail", NotesCore.findNote(workspace, noteId).optString("projectId"));
    }
}
