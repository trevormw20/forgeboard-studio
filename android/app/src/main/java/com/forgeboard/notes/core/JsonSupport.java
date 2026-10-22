package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Small Android/JVM-compatible helpers. JSON objects always remain plain data. */
final class JsonSupport {
    private JsonSupport() { }

    static JSONObject copy(JSONObject object) {
        try { return new JSONObject(object.toString()); }
        catch (JSONException error) { throw new IllegalArgumentException("Invalid workspace JSON.", error); }
    }

    static Object copyValue(Object value) {
        if (value instanceof JSONObject) return copy((JSONObject) value);
        if (value instanceof JSONArray) {
            try { return new JSONArray(value.toString()); }
            catch (JSONException error) { throw new IllegalArgumentException("Invalid array JSON.", error); }
        }
        return value;
    }

    static JSONObject put(JSONObject object, String key, Object value) {
        try {
            if (value == null || value == JSONObject.NULL) object.remove(key);
            else object.put(key, value);
            return object;
        } catch (JSONException error) { throw new IllegalArgumentException("Invalid " + key + ".", error); }
    }

    static String string(JSONObject object, String key) {
        Object value = object == null ? null : object.opt(key);
        return value instanceof String ? (String) value : null;
    }

    static String scope(JSONObject object) { return string(object, "projectId"); }
    static boolean deleted(JSONObject object) { return string(object, "deletedAt") != null; }

    static List<JSONObject> objects(JSONArray array) {
        List<JSONObject> result = new ArrayList<>();
        if (array != null) for (int i = 0; i < array.length(); i++) {
            JSONObject object = array.optJSONObject(i);
            if (object != null) result.add(object);
        }
        return result;
    }

    static List<JSONObject> objects(JSONObject object, String key) { return objects(object.optJSONArray(key)); }

    static JSONArray array(List<JSONObject> objects) {
        JSONArray array = new JSONArray();
        for (JSONObject object : objects) array.put(object);
        return array;
    }

    static Map<String, JSONObject> byId(List<JSONObject> objects) {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (JSONObject object : objects) {
            String id = string(object, "id");
            if (id != null && !id.isEmpty()) result.put(id, object);
        }
        return result;
    }

    static Set<String> keys(JSONObject object) {
        Set<String> result = new LinkedHashSet<>();
        if (object != null) {
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) result.add(keys.next());
        }
        return result;
    }

    static boolean equal(Object left, Object right) {
        if (left == JSONObject.NULL) left = null;
        if (right == JSONObject.NULL) right = null;
        if (left == right) return true;
        if (left == null || right == null) return false;
        if (left instanceof JSONObject && right instanceof JSONObject) {
            JSONObject l = (JSONObject) left, r = (JSONObject) right;
            Set<String> keys = keys(l);
            keys.addAll(keys(r));
            for (String key : keys) if (!equal(l.opt(key), r.opt(key))) return false;
            return true;
        }
        if (left instanceof JSONArray && right instanceof JSONArray) {
            JSONArray l = (JSONArray) left, r = (JSONArray) right;
            if (l.length() != r.length()) return false;
            for (int i = 0; i < l.length(); i++) if (!equal(l.opt(i), r.opt(i))) return false;
            return true;
        }
        if (left instanceof Number && right instanceof Number) {
            return Double.compare(((Number) left).doubleValue(), ((Number) right).doubleValue()) == 0;
        }
        return left.equals(right);
    }
}
