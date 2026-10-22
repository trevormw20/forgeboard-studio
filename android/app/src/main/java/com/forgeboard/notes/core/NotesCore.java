package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static com.forgeboard.notes.core.JsonSupport.*;

/** Notes-only mutations shared by activities and widgets. Never edits project/task data. */
public final class NotesCore {
    private static final int MAX_ITEMS = 5_000;
    private static final Comparator<JSONObject> ORDER = (left, right) -> {
        int order = Double.compare(itemOrder(left), itemOrder(right));
        if (order != 0) return order;
        order = left.optString("createdAt", "").compareTo(right.optString("createdAt", ""));
        return order != 0 ? order : left.optString("id", "").compareTo(right.optString("id", ""));
    };

    private NotesCore() { }

    public static final class Row {
        public final JSONObject item;
        public final int depth;
        public Row(JSONObject item, int depth) { this.item = item; this.depth = depth; }
    }

    /** An offline empty shell, not a substitute for an existing GitHub workspace. */
    public static JSONObject emptyWorkspace() {
        String now = Instant.now().toString();
        JSONObject workspace = new JSONObject();
        put(workspace, "schemaVersion", 1);
        put(workspace, "id", "workspace-" + UUID.randomUUID());
        put(workspace, "name", "Forgeboard Studio");
        put(workspace, "createdAt", now);
        put(workspace, "updatedAt", now);
        for (String key : new String[]{"projects", "tasks", "milestones", "deadlines", "inboxNotes", "activity", "reports", "conflicts", "personalNotes", "noteLabels"}) put(workspace, key, new JSONArray());
        put(workspace, "ai", new JSONObject());
        return workspace;
    }

    public static JSONObject findNote(JSONObject workspace, String id) {
        return find(objects(workspace, "personalNotes"), id);
    }

    public static List<JSONObject> activeNotes(JSONObject workspace, String projectId) {
        List<JSONObject> result = new ArrayList<>();
        for (JSONObject note : objects(workspace, "personalNotes")) {
            if (!deleted(note) && Objects.equals(projectId, scope(note))) result.add(note);
        }
        return result;
    }

    /** Invalid/cross-project/cyclic links are visible roots instead of hidden notes. */
    public static String noteParent(JSONObject note, List<JSONObject> notes) {
        Map<String, JSONObject> map = byId(notes);
        String parent = string(note, "parentId");
        if (parent == null) return null;
        Set<String> seen = new HashSet<>();
        seen.add(string(note, "id"));
        String cursorId = parent;
        while (cursorId != null) {
            JSONObject cursor = map.get(cursorId);
            if (cursor == null || deleted(cursor) || !Objects.equals(scope(cursor), scope(note)) || !seen.add(cursorId)) return null;
            cursorId = string(cursor, "parentId");
        }
        return parent;
    }

    public static String normalizeColor(String color) {
        if (color == null || color.trim().isEmpty()) return null;
        String clean = color.trim().toLowerCase(Locale.ROOT);
        if (clean.matches("#[0-9a-f]{6}")) return clean;
        if (clean.matches("#[0-9a-f]{3}")) {
            return "#" + clean.charAt(1) + clean.charAt(1) + clean.charAt(2) + clean.charAt(2) + clean.charAt(3) + clean.charAt(3);
        }
        throw new IllegalArgumentException("Choose a hex color such as #6d8cff.");
    }

    public static String addNote(JSONObject workspace, String projectId, String parentId, String title, String body, String color, String now) {
        checkTime(now);
        assertProject(workspace, projectId);
        String id = "note-" + UUID.randomUUID();
        JSONObject note = new JSONObject();
        put(note, "id", id);
        put(note, "projectId", projectId);
        put(note, "parentId", parentId);
        put(note, "title", text(title, 300, "Keep the note title under 300 characters."));
        put(note, "body", text(body, 100_000, "Split notes larger than 100,000 characters into sub-notes."));
        put(note, "color", normalizeColor(color));
        put(note, "labelIds", new JSONArray());
        put(note, "pinned", false);
        put(note, "createdAt", now);
        put(note, "updatedAt", now);
        validateParent(workspace, note);
        append(workspace, "personalNotes", note);
        touch(workspace, now);
        return id;
    }

    /** Only explicit editable note fields are accepted; identity and scope cannot be changed. */
    public static void updateNote(JSONObject workspace, String id, JSONObject changes, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, id), draft = copy(note);
        for (String key : new String[]{"title", "body", "color", "labelIds", "pinned", "parentId"}) {
            if (changes.has(key)) put(draft, key, copyValue(changes.opt(key)));
        }
        put(draft, "title", text(string(draft, "title"), 300, "Keep the note title under 300 characters."));
        put(draft, "body", text(string(draft, "body"), 100_000, "Split notes larger than 100,000 characters into sub-notes."));
        put(draft, "color", normalizeColor(string(draft, "color")));
        if (changes.has("pinned") && !(changes.opt("pinned") instanceof Boolean) && changes.opt("pinned") != JSONObject.NULL) throw new IllegalArgumentException("Pinned must be true or false.");
        if (changes.has("parentId") && changes.opt("parentId") != JSONObject.NULL && !(changes.opt("parentId") instanceof String)) throw new IllegalArgumentException("Choose a valid parent note.");
        if (!changes.has("parentId") && string(note, "parentId") != null && noteParent(note, objects(workspace, "personalNotes")) == null) draft.remove("parentId");
        validateParent(workspace, draft);
        if (changes.has("labelIds")) validateLabels(workspace, draft);
        // Validation above is atomic: a rejected edit never leaves half a changed note.
        for (String key : new String[]{"title", "body", "color", "labelIds", "pinned", "parentId"}) put(note, key, copyValue(draft.opt(key)));
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    public static void deleteNote(JSONObject workspace, String id, String now) {
        checkTime(now);
        JSONObject root = findNote(workspace, id);
        if (root == null || deleted(root)) return;
        List<JSONObject> notes = objects(workspace, "personalNotes");
        Set<String> ids = descendants(notes, id, scope(root), true);
        String deletion = uniqueDeletion(notes, now);
        for (JSONObject note : notes) if (ids.contains(string(note, "id")) && !deleted(note)) {
            put(note, "deletedAt", deletion);
            put(note, "updatedAt", now);
        }
        touch(workspace, now);
    }

    public static void restoreNote(JSONObject workspace, String id, String now) {
        checkTime(now);
        JSONObject root = findNote(workspace, id);
        if (root == null || !deleted(root)) return;
        assertProject(workspace, scope(root));
        List<JSONObject> notes = objects(workspace, "personalNotes");
        Map<String, JSONObject> map = byId(notes);
        String parentId = string(root, "parentId");
        if (hasCycle(root, map, true)) root.remove("parentId");
        else if (parentId != null) {
            JSONObject parent = map.get(parentId);
            if (parent == null || !Objects.equals(scope(parent), scope(root))) root.remove("parentId");
            else if (deleted(parent)) throw new IllegalArgumentException("Restore the parent note first.");
            else if (noteParent(parent, notes) == null && string(parent, "parentId") != null) root.remove("parentId");
        }
        String deletion = string(root, "deletedAt");
        Set<String> ids = descendants(notes, id, scope(root), true);
        for (JSONObject note : notes) if (ids.contains(string(note, "id")) && Objects.equals(deletion, string(note, "deletedAt"))) {
            note.remove("deletedAt");
            put(note, "updatedAt", now);
        }
        touch(workspace, now);
    }

    public static List<JSONObject> deletedNoteRoots(JSONObject workspace) {
        return deletedRoots(objects(workspace, "personalNotes"), true);
    }

    public static String saveLabel(JSONObject workspace, String id, String projectId, String name, String color, String now) {
        checkTime(now);
        assertProject(workspace, projectId);
        String cleanName = text(name, 80, "Give the label a name of 1–80 characters.").trim();
        if (cleanName.isEmpty()) throw new IllegalArgumentException("Give the label a name of 1–80 characters.");
        String cleanColor = normalizeColor(color);
        if (cleanColor == null) throw new IllegalArgumentException("Choose a color for the label.");
        List<JSONObject> labels = objects(workspace, "noteLabels");
        JSONObject existing = id == null ? null : find(labels, id);
        if (id != null && (existing == null || deleted(existing))) throw new IllegalArgumentException("This label is unavailable.");
        for (JSONObject label : labels) if (!deleted(label) && !Objects.equals(id, string(label, "id")) && Objects.equals(projectId, scope(label)) && cleanName.equalsIgnoreCase(label.optString("name", ""))) throw new IllegalArgumentException("This section already has a label with that name.");
        if (existing != null && !Objects.equals(projectId, scope(existing))) {
            for (JSONObject note : objects(workspace, "personalNotes")) if (contains(note.optJSONArray("labelIds"), id)) throw new IllegalArgumentException("This label is in use. Create a new label in the other project instead.");
        }
        JSONObject label = existing == null ? new JSONObject() : existing;
        String finalId = existing == null ? "note-label-" + UUID.randomUUID() : id;
        put(label, "id", finalId);
        put(label, "projectId", projectId);
        put(label, "name", cleanName);
        put(label, "color", cleanColor);
        if (existing == null) put(label, "createdAt", now);
        put(label, "updatedAt", now);
        if (existing == null) append(workspace, "noteLabels", label);
        touch(workspace, now);
        return finalId;
    }

    public static void deleteLabel(JSONObject workspace, String id, String now) {
        checkTime(now);
        JSONObject label = find(objects(workspace, "noteLabels"), id);
        if (label == null || deleted(label)) return;
        put(label, "deletedAt", now);
        put(label, "updatedAt", now);
        // Keep note references: deleting a label never destroys note content.
        touch(workspace, now);
    }

    public static String addChecklistItem(JSONObject workspace, String noteId, String text, String parentId, String afterId, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, noteId);
        String clean = text(text, 10_000, "Keep each checklist item under 10,000 characters.");
        List<JSONObject> items = objects(note, "checklist");
        if (items.size() >= MAX_ITEMS) throw new IllegalArgumentException("This note already has 5,000 checklist items. Start another note.");
        Tree tree = new Tree(items);
        if (parentId != null) activeItem(note, parentId);
        JSONObject after = afterId == null ? null : activeItem(note, afterId);
        String parent = parentId != null ? parentId : after == null ? null : tree.parents.get(afterId);
        if (after != null && !Objects.equals(parent, tree.parents.get(afterId))) throw new IllegalArgumentException("Place the new checklist item beside an item in the same group.");
        List<JSONObject> siblings = tree.children(parent);
        int index = after == null ? siblings.size() : indexOf(siblings, afterId) + 1;
        repairParents(items, tree, now);
        String id = "check-" + UUID.randomUUID();
        JSONObject item = new JSONObject();
        put(item, "id", id);
        put(item, "text", clean);
        put(item, "parentId", parent);
        put(item, "createdAt", now);
        place(item, siblings, index, now);
        append(note, "checklist", item);
        put(note, "updatedAt", now);
        touch(workspace, now);
        return id;
    }

    public static void updateChecklistText(JSONObject workspace, String noteId, String itemId, String text, String now) {
        checkTime(now);
        String clean = text(text, 10_000, "Keep each checklist item under 10,000 characters.");
        JSONObject note = activeNote(workspace, noteId), item = activeItem(note, itemId);
        put(item, "text", clean);
        put(item, "parentId", new Tree(objects(note, "checklist")).parents.get(itemId));
        put(item, "updatedAt", now);
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    /** Explicit desired state is safe when Android redelivers a widget action. */
    public static void setChecklistChecked(JSONObject workspace, String noteId, String itemId, boolean checked, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, noteId), item = activeItem(note, itemId);
        if ((string(item, "completedAt") != null) == checked) return;
        put(item, "completedAt", checked ? now : null);
        put(item, "updatedAt", now);
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    public static List<Row> orderedChecklist(JSONObject note) {
        Tree tree = new Tree(objects(note, "checklist"));
        List<Row> output = new ArrayList<>();
        Deque<Row> stack = new ArrayDeque<>();
        List<JSONObject> roots = tree.children(null);
        for (int i = roots.size() - 1; i >= 0; i--) stack.push(new Row(roots.get(i), 0));
        Set<String> seen = new HashSet<>();
        while (!stack.isEmpty()) {
            Row row = stack.pop();
            String id = string(row.item, "id");
            if (!seen.add(id)) continue;
            output.add(row);
            List<JSONObject> children = tree.children(id);
            for (int i = children.size() - 1; i >= 0; i--) stack.push(new Row(children.get(i), row.depth + 1));
        }
        return output;
    }

    public static boolean canMoveChecklistItem(JSONObject note, String itemId, String direction) {
        Tree tree = new Tree(objects(note, "checklist"));
        if (!tree.map.containsKey(itemId)) return false;
        List<JSONObject> siblings = tree.children(tree.parents.get(itemId));
        int index = indexOf(siblings, itemId);
        if ("outdent".equals(direction)) return tree.parents.get(itemId) != null;
        if ("down".equals(direction)) return index >= 0 && index < siblings.size() - 1;
        if ("up".equals(direction) || "indent".equals(direction)) return index > 0;
        throw new IllegalArgumentException("Choose indent, outdent, up, or down.");
    }

    public static void moveChecklistItem(JSONObject workspace, String noteId, String itemId, String direction, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, noteId), item = activeItem(note, itemId);
        if (!canMoveChecklistItem(note, itemId, direction)) return;
        List<JSONObject> items = objects(note, "checklist");
        Tree tree = new Tree(items);
        repairParents(items, tree, now);
        String parent = tree.parents.get(itemId);
        List<JSONObject> siblings = tree.children(parent);
        int index = indexOf(siblings, itemId);
        if ("indent".equals(direction)) {
            String nextParent = string(siblings.get(index - 1), "id");
            List<JSONObject> target = tree.children(nextParent);
            put(item, "parentId", nextParent);
            place(item, target, target.size(), now);
        } else if ("outdent".equals(direction)) {
            String nextParent = tree.parents.get(parent);
            List<JSONObject> target = tree.children(nextParent);
            put(item, "parentId", nextParent);
            place(item, target, indexOf(target, parent) + 1, now);
        } else {
            List<JSONObject> target = new ArrayList<>(siblings);
            target.remove(item);
            put(item, "parentId", parent);
            place(item, target, "up".equals(direction) ? index - 1 : index + 1, now);
        }
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    public static void deleteChecklistItem(JSONObject workspace, String noteId, String itemId, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, noteId);
        activeItem(note, itemId);
        List<JSONObject> items = objects(note, "checklist");
        Set<String> ids = descendants(items, itemId, null, false);
        String deletion = uniqueDeletion(items, now);
        for (JSONObject item : items) if (ids.contains(string(item, "id")) && !deleted(item)) {
            put(item, "deletedAt", deletion);
            put(item, "updatedAt", now);
        }
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    public static void restoreChecklistItem(JSONObject workspace, String noteId, String itemId, String now) {
        checkTime(now);
        JSONObject note = activeNote(workspace, noteId);
        List<JSONObject> items = objects(note, "checklist");
        JSONObject root = find(items, itemId);
        if (root == null || !deleted(root)) return;
        Map<String, JSONObject> map = byId(items);
        boolean cycle = hasCycle(root, map, false);
        String parentId = string(root, "parentId");
        JSONObject parent = parentId == null ? null : map.get(parentId);
        if (!cycle && parent != null && deleted(parent)) throw new IllegalArgumentException("Restore the parent checklist item first.");
        if (cycle || (parentId != null && parent == null)) root.remove("parentId");
        String deletion = string(root, "deletedAt");
        Set<String> ids = descendants(items, itemId, null, false);
        for (JSONObject item : items) if (ids.contains(string(item, "id")) && Objects.equals(deletion, string(item, "deletedAt"))) {
            item.remove("deletedAt");
            put(item, "updatedAt", now);
        }
        put(note, "updatedAt", now);
        touch(workspace, now);
    }

    public static List<JSONObject> deletedChecklistRoots(JSONObject note) {
        List<JSONObject> result = deletedRoots(objects(note, "checklist"), false);
        result.sort(ORDER);
        return result;
    }

    private static void assertProject(JSONObject workspace, String projectId) {
        if (projectId == null) return;
        JSONObject project = find(objects(workspace, "projects"), projectId);
        if (project == null || deleted(project)) throw new IllegalArgumentException("Choose an existing active project for this note.");
    }

    private static JSONObject activeNote(JSONObject workspace, String id) {
        JSONObject note = findNote(workspace, id);
        if (note == null || deleted(note)) throw new IllegalArgumentException("This note is unavailable. Restore it before editing.");
        assertProject(workspace, scope(note));
        return note;
    }

    private static JSONObject activeItem(JSONObject note, String id) {
        JSONObject item = find(objects(note, "checklist"), id);
        if (item == null || deleted(item)) throw new IllegalArgumentException("This checklist item is unavailable in this note.");
        return item;
    }

    private static JSONObject find(List<JSONObject> items, String id) {
        if (id == null) return null;
        for (JSONObject item : items) if (id.equals(string(item, "id"))) return item;
        return null;
    }

    private static void validateParent(JSONObject workspace, JSONObject note) {
        String parentId = string(note, "parentId");
        if (parentId == null) return;
        if (parentId.isEmpty()) throw new IllegalArgumentException("Choose a valid parent note.");
        Map<String, JSONObject> map = byId(objects(workspace, "personalNotes"));
        Set<String> seen = new HashSet<>();
        seen.add(string(note, "id"));
        String cursorId = parentId;
        while (cursorId != null) {
            JSONObject parent = map.get(cursorId);
            if (parent == null || deleted(parent)) throw new IllegalArgumentException("Restore the parent note first, or choose a top-level note.");
            if (!Objects.equals(scope(note), scope(parent))) throw new IllegalArgumentException("A sub-note must stay in the same project as its parent.");
            if (!seen.add(cursorId)) throw new IllegalArgumentException("A note cannot be nested inside itself or its descendants.");
            cursorId = string(parent, "parentId");
        }
    }

    private static void validateLabels(JSONObject workspace, JSONObject note) {
        JSONArray labels = note.optJSONArray("labelIds");
        if (labels == null) throw new IllegalArgumentException("Choose valid note labels.");
        Map<String, JSONObject> available = byId(objects(workspace, "noteLabels"));
        JSONArray unique = new JSONArray();
        Set<String> seen = new LinkedHashSet<>();
        for (int i = 0; i < labels.length(); i++) {
            Object value = labels.opt(i);
            if (!(value instanceof String)) throw new IllegalArgumentException("Choose valid note labels.");
            String id = (String) value;
            JSONObject label = available.get(id);
            if (label == null) throw new IllegalArgumentException("One of these labels is unavailable.");
            if (!deleted(label) && scope(label) != null && !Objects.equals(scope(label), scope(note))) throw new IllegalArgumentException("A project label can only be used on that project's notes.");
            if (seen.add(id)) unique.put(id);
        }
        put(note, "labelIds", unique);
    }

    private static void append(JSONObject object, String key, JSONObject value) {
        JSONArray array = object.optJSONArray(key);
        if (array == null) { array = new JSONArray(); put(object, key, array); }
        array.put(value);
    }

    private static boolean contains(JSONArray array, String id) {
        if (array != null) for (int i = 0; i < array.length(); i++) if (id.equals(array.opt(i))) return true;
        return false;
    }

    private static void touch(JSONObject workspace, String now) { put(workspace, "updatedAt", now); }
    private static void checkTime(String now) {
        try { Instant.parse(now); }
        catch (Exception error) { throw new IllegalArgumentException("Use a valid ISO timestamp.", error); }
    }
    private static String text(String value, int limit, String error) {
        if (value == null || value.length() > limit) throw new IllegalArgumentException(error);
        return value;
    }

    private static Set<String> descendants(List<JSONObject> items, String id, String projectId, boolean scoped) {
        Set<String> result = new LinkedHashSet<>();
        result.add(id);
        boolean changed = true;
        while (changed) {
            changed = false;
            for (JSONObject item : items) {
                String itemId = string(item, "id"), parent = string(item, "parentId");
                if ((!scoped || Objects.equals(projectId, scope(item))) && itemId != null && parent != null && result.contains(parent) && result.add(itemId)) changed = true;
            }
        }
        return result;
    }

    private static String uniqueDeletion(List<JSONObject> items, String now) {
        Set<String> used = new HashSet<>();
        for (JSONObject item : items) if (deleted(item)) used.add(string(item, "deletedAt"));
        String deletion = now;
        while (used.contains(deletion)) deletion = Instant.parse(deletion).plusMillis(1).toString();
        return deletion;
    }

    private static boolean hasCycle(JSONObject root, Map<String, JSONObject> map, boolean scoped) {
        Set<String> seen = new HashSet<>();
        seen.add(string(root, "id"));
        String cursorId = string(root, "parentId");
        while (cursorId != null) {
            JSONObject cursor = map.get(cursorId);
            if (cursor == null || (scoped && !Objects.equals(scope(root), scope(cursor)))) return false;
            if (!seen.add(cursorId)) return true;
            cursorId = string(cursor, "parentId");
        }
        return false;
    }

    private static List<JSONObject> deletedRoots(List<JSONObject> items, boolean scoped) {
        List<JSONObject> deleted = new ArrayList<>();
        for (JSONObject item : items) if (deleted(item)) deleted.add(item);
        Map<String, JSONObject> map = byId(deleted), roots = new LinkedHashMap<>();
        Set<String> visited = new HashSet<>();
        for (JSONObject item : deleted) {
            if (visited.contains(string(item, "id"))) continue;
            List<JSONObject> path = new ArrayList<>();
            Map<String, Integer> positions = new HashMap<>();
            JSONObject cursor = item;
            while (cursor != null && !visited.contains(string(cursor, "id"))) {
                String id = string(cursor, "id");
                Integer cycleStart = positions.get(id);
                if (cycleStart != null) {
                    JSONObject root = path.get(cycleStart);
                    for (int i = cycleStart; i < path.size(); i++) if (path.get(i).optString("id", "").compareTo(root.optString("id", "")) < 0) root = path.get(i);
                    roots.put(string(root, "id"), root);
                    break;
                }
                positions.put(id, path.size());
                path.add(cursor);
                JSONObject parent = map.get(string(cursor, "parentId"));
                if (parent == null || !Objects.equals(string(parent, "deletedAt"), string(cursor, "deletedAt")) || (scoped && !Objects.equals(scope(parent), scope(cursor)))) {
                    roots.put(id, cursor);
                    break;
                }
                cursor = parent;
            }
            for (JSONObject member : path) visited.add(string(member, "id"));
        }
        return new ArrayList<>(roots.values());
    }

    private static double itemOrder(JSONObject item) {
        double order = item.optDouble("order", 0);
        return Double.isNaN(order) || Double.isInfinite(order) ? 0 : order;
    }

    private static int indexOf(List<JSONObject> items, String id) {
        for (int i = 0; i < items.size(); i++) if (Objects.equals(id, string(items.get(i), "id"))) return i;
        return -1;
    }

    private static void place(JSONObject item, List<JSONObject> siblings, int index, String now) {
        Double before = index > 0 ? itemOrder(siblings.get(index - 1)) : null;
        Double after = index < siblings.size() ? itemOrder(siblings.get(index)) : null;
        double order = before == null ? (after == null ? 0 : after - 1) : after == null ? before + 1 : (before + after) / 2;
        if (!Double.isFinite(order) || Math.abs(order) > 999_999_999 || (before != null && after != null && (order <= before || order >= after))) {
            for (int i = 0; i < siblings.size(); i++) {
                put(siblings.get(i), "order", i * 2);
                put(siblings.get(i), "updatedAt", now);
            }
            order = index == 0 ? -1 : index == siblings.size() ? siblings.size() * 2 : index * 2 - 1;
        }
        put(item, "order", order);
        put(item, "updatedAt", now);
    }

    private static void repairParents(List<JSONObject> items, Tree tree, String now) {
        for (JSONObject item : items) if (!deleted(item) && !Objects.equals(string(item, "parentId"), tree.parents.get(string(item, "id")))) {
            put(item, "parentId", tree.parents.get(string(item, "id")));
            put(item, "updatedAt", now);
        }
    }

    private static final class Tree {
        final Map<String, JSONObject> map;
        final Map<String, String> parents = new HashMap<>();
        final Map<String, List<JSONObject>> groups = new HashMap<>();
        Tree(List<JSONObject> items) {
            List<JSONObject> active = new ArrayList<>();
            for (JSONObject item : items) if (!deleted(item)) active.add(item);
            map = byId(active);
            for (JSONObject item : active) {
                String parent = safeParent(item);
                parents.put(string(item, "id"), parent);
                List<JSONObject> children = groups.get(parent);
                if (children == null) { children = new ArrayList<>(); groups.put(parent, children); }
                children.add(item);
            }
            for (List<JSONObject> siblings : groups.values()) siblings.sort(ORDER);
        }
        List<JSONObject> children(String parent) { return groups.containsKey(parent) ? groups.get(parent) : Collections.emptyList(); }
        String safeParent(JSONObject item) {
            String parent = string(item, "parentId"), cursor = parent;
            Set<String> seen = new HashSet<>();
            seen.add(string(item, "id"));
            while (cursor != null) {
                JSONObject ancestor = map.get(cursor);
                if (ancestor == null || !seen.add(cursor)) return null;
                cursor = string(ancestor, "parentId");
            }
            return parent;
        }
    }
}
