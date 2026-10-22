package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.forgeboard.notes.core.JsonSupport.*;

/**
 * A deliberately narrow three-way merger. The newest GitHub workspace is the
 * envelope; Android only owns notes and labels, never tasks/projects/AI fields.
 * Stable IDs and tombstones let a stale-SHA retry keep both devices' work.
 */
public final class StaticWorkspaceMerger {
    private static final Set<String> NOTE_KEYS = new LinkedHashSet<>(Arrays.asList("projectId", "parentId", "title", "body", "color", "labelIds", "pinned", "checklist", "createdAt", "updatedAt", "deletedAt"));
    private static final Set<String> LABEL_KEYS = new LinkedHashSet<>(Arrays.asList("projectId", "name", "color", "createdAt", "updatedAt", "deletedAt"));
    private static final Set<String> ITEM_KEYS = new LinkedHashSet<>(Arrays.asList("text", "parentId", "order", "createdAt", "updatedAt", "completedAt", "deletedAt"));

    private StaticWorkspaceMerger() { }

    public static JSONObject merge(JSONObject base, JSONObject local, JSONObject remote, String now) {
        if (local == null || remote == null) throw new IllegalArgumentException("Both local and GitHub workspaces are required.");
        try { Instant.parse(now); }
        catch (Exception error) { throw new IllegalArgumentException("Use a valid ISO timestamp.", error); }
        JSONObject merged = copy(remote);
        List<JSONObject> conflicts = unionConflicts(local.optJSONArray("conflicts"), remote.optJSONArray("conflicts"));
        if (hasCollection(base, local, remote, "personalNotes")) {
            put(merged, "personalNotes", mergeCollection("personal-note", arrayAt(base, "personalNotes"), local.optJSONArray("personalNotes"), remote.optJSONArray("personalNotes"), conflicts, now));
        }
        if (hasCollection(base, local, remote, "noteLabels")) {
            put(merged, "noteLabels", mergeCollection("note-label", arrayAt(base, "noteLabels"), local.optJSONArray("noteLabels"), remote.optJSONArray("noteLabels"), conflicts, now));
        }
        put(merged, "conflicts", array(unionConflicts(array(conflicts), new JSONArray())));
        put(merged, "updatedAt", now);
        return merged;
    }

    private static boolean hasCollection(JSONObject base, JSONObject local, JSONObject remote, String key) {
        return (base != null && base.has(key)) || local.has(key) || remote.has(key);
    }

    private static JSONArray arrayAt(JSONObject object, String key) { return object == null ? null : object.optJSONArray(key); }

    private static JSONArray mergeCollection(String type, JSONArray baseItems, JSONArray localItems, JSONArray remoteItems, List<JSONObject> conflicts, String now) {
        Map<String, JSONObject> base = byId(objects(baseItems));
        Map<String, JSONObject> local = byId(objects(localItems));
        Map<String, JSONObject> remote = byId(objects(remoteItems));
        // Preserve current server ordering, then append offline additions.
        Set<String> ids = new LinkedHashSet<>(remote.keySet());
        ids.addAll(local.keySet());
        ids.addAll(base.keySet());
        JSONArray result = new JSONArray();
        for (String id : ids) {
            JSONObject b = base.get(id), l = local.get(id), r = remote.get(id);
            if (l != null && r != null) result.put(mergeEntity(type, b, l, r, conflicts, now));
            else if (r != null) result.put(copy(r));
            else if (l != null) result.put(copy(l));
            // Deletion is explicit via deletedAt. Missing data is never taken as
            // permission to erase a base record (including older-client arrays).
            else if (b != null) result.put(copy(b));
        }
        // Malformed/unknown entries are never discarded from the GitHub copy.
        if (remoteItems != null) for (int i = 0; i < remoteItems.length(); i++) {
            Object item = remoteItems.opt(i);
            if (!(item instanceof JSONObject) || string((JSONObject) item, "id") == null || string((JSONObject) item, "id").isEmpty()) result.put(copyValue(item));
        }
        return result;
    }

    private static JSONObject mergeEntity(String type, JSONObject base, JSONObject local, JSONObject remote, List<JSONObject> conflicts, String now) {
        JSONObject merged = copy(remote);
        boolean localNewer = compareTime(string(local, "updatedAt"), string(remote, "updatedAt")) >= 0;
        Set<String> known = "personal-note".equals(type) ? NOTE_KEYS : "note-label".equals(type) ? LABEL_KEYS : ITEM_KEYS;
        Set<String> keys = keys(remote);
        keys.addAll(keys(local));
        keys.addAll(keys(base));
        boolean conflicting = deletionAgainstEdit(base, local, remote);
        for (String key : keys) {
            if ("id".equals(key)) continue;
            Object b = base == null ? null : base.opt(key), l = local.opt(key), r = remote.opt(key);
            if (!known.contains(key)) {
                // Native code does not understand or edit future web-only fields.
                // Prefer the live server value, retaining the local/base copy if
                // an older web client omitted the unknown field entirely.
                if (!remote.has(key)) put(merged, key, copyValue(local.has(key) ? l : b));
                continue;
            }
            if ("updatedAt".equals(key)) {
                put(merged, key, copyValue(localNewer ? l : r));
            } else if ("personal-note".equals(type) && "checklist".equals(key)) {
                List<JSONObject> itemConflicts = new ArrayList<>();
                put(merged, key, mergeCollection("note-checklist-item", b instanceof JSONArray ? (JSONArray) b : null, l instanceof JSONArray ? (JSONArray) l : null, r instanceof JSONArray ? (JSONArray) r : null, itemConflicts, now));
                // The web recovery screen restores entire note snapshots, not
                // orphaned item snapshots that cannot stand alone as a note.
                if (!itemConflicts.isEmpty()) conflicting = true;
            } else if ("personal-note".equals(type) && "labelIds".equals(key) && l instanceof JSONArray && r instanceof JSONArray) {
                put(merged, key, mergeLabelIds(b instanceof JSONArray ? (JSONArray) b : null, (JSONArray) l, (JSONArray) r));
            } else if (equal(l, r)) {
                put(merged, key, copyValue(l));
            } else if (equal(l, b)) {
                put(merged, key, copyValue(r));
            } else if (equal(r, b)) {
                put(merged, key, copyValue(l));
            } else {
                put(merged, key, copyValue(localNewer ? l : r));
                if (!"createdAt".equals(key)) conflicting = true;
            }
        }
        if (conflicting) addConflict(type, local, remote, localNewer, conflicts, now);
        return merged;
    }

    private static boolean deletionAgainstEdit(JSONObject base, JSONObject local, JSONObject remote) {
        if (base == null) return false;
        boolean localDeletionChanged = !equal(local.opt("deletedAt"), base.opt("deletedAt"));
        boolean remoteDeletionChanged = !equal(remote.opt("deletedAt"), base.opt("deletedAt"));
        return (localDeletionChanged && contentChanged(base, remote)) || (remoteDeletionChanged && contentChanged(base, local));
    }

    private static boolean contentChanged(JSONObject base, JSONObject item) {
        Set<String> keys = keys(base);
        keys.addAll(keys(item));
        for (String key : keys) {
            if (!"updatedAt".equals(key) && !"deletedAt".equals(key) && !equal(base.opt(key), item.opt(key))) return true;
        }
        return false;
    }

    private static JSONArray mergeLabelIds(JSONArray base, JSONArray local, JSONArray remote) {
        Set<String> b = stringSet(base), l = stringSet(local), r = stringSet(remote);
        Set<String> all = new LinkedHashSet<>(r);
        all.addAll(l);
        all.addAll(b);
        JSONArray merged = new JSONArray();
        for (String id : all) {
            boolean bv = b.contains(id), lv = l.contains(id), rv = r.contains(id);
            if (lv == rv ? lv : lv == bv ? rv : lv) merged.put(id);
        }
        return merged;
    }

    private static Set<String> stringSet(JSONArray array) {
        Set<String> result = new LinkedHashSet<>();
        if (array != null) for (int i = 0; i < array.length(); i++) if (array.opt(i) instanceof String) result.add((String) array.opt(i));
        return result;
    }

    private static int compareTime(String left, String right) {
        if (left == null) return right == null ? 0 : -1;
        if (right == null) return 1;
        try { return Instant.parse(left).compareTo(Instant.parse(right)); }
        catch (Exception ignored) { return left.compareTo(right); }
    }

    private static List<JSONObject> unionConflicts(JSONArray local, JSONArray remote) {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (JSONArray array : new JSONArray[]{local, remote}) {
            for (JSONObject conflict : objects(array)) {
                String id = string(conflict, "id");
                if (id == null) id = "legacy-" + fingerprint(canonical(conflict));
                if (!result.containsKey(id)) result.put(id, copy(conflict));
            }
        }
        return new ArrayList<>(result.values());
    }

    private static void addConflict(String type, JSONObject local, JSONObject remote, boolean localNewer, List<JSONObject> conflicts, String now) {
        String id = "conflict-native-" + fingerprint(type + "\n" + local.optString("id", "") + "\n" + canonical(local) + "\n" + canonical(remote));
        for (JSONObject conflict : conflicts) if (id.equals(string(conflict, "id"))) return;
        JSONObject conflict = new JSONObject();
        put(conflict, "id", id);
        put(conflict, "entityType", type);
        put(conflict, "entityId", local.optString("id", ""));
        put(conflict, "detectedAt", now);
        put(conflict, "local", copy(local));
        put(conflict, "remote", copy(remote));
        put(conflict, "resolution", "Combined independent changes, kept the " + (localNewer ? "local" : "remote") + " value where edits conflicted, and preserved both full snapshots here.");
        conflicts.add(conflict);
    }

    private static String canonical(Object value) {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            List<String> keys = new ArrayList<>(keys(object));
            Collections.sort(keys);
            StringBuilder result = new StringBuilder("{");
            for (String key : keys) result.append(JSONObject.quote(key)).append(':').append(canonical(object.opt(key))).append(',');
            return result.append('}').toString();
        }
        if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            StringBuilder result = new StringBuilder("[");
            for (int i = 0; i < array.length(); i++) result.append(canonical(array.opt(i))).append(',');
            return result.append(']').toString();
        }
        if (value == null || value == JSONObject.NULL) return "null";
        return value instanceof String ? JSONObject.quote((String) value) : String.valueOf(value);
    }

    private static String fingerprint(String input) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : hash) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (Exception error) { throw new IllegalStateException("SHA-256 is unavailable.", error); }
    }
}
