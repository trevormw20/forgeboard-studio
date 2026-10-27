package com.forgeboard.notes.core;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Bounded, review-first capture operations. No network and no model instructions executed. */
public final class CaptureCore {
    private CaptureCore() { }
    public static Map<String,List<NotesCore.Row>> branchEnds(List<NotesCore.Row> rows) {
        Map<String,List<NotesCore.Row>> ends=new LinkedHashMap<>();
        Deque<NotesCore.Row> parents=new ArrayDeque<>();
        for(int i=0;i<rows.size();i++) {
            NotesCore.Row row=rows.get(i); int next=i+1<rows.size()?rows.get(i+1).depth:-1;
            if(next>row.depth) parents.push(row);
            while(!parents.isEmpty() && next<=parents.peek().depth) {
                ends.computeIfAbsent(row.item.optString("id"),key->new ArrayList<>()).add(parents.pop());
            }
        }
        return ends;
    }
    public static JSONObject localDraft(String raw) throws Exception {
        if(raw==null || raw.trim().isEmpty() || raw.length()>12000) throw new IllegalArgumentException("Dictate or type 1–12,000 characters first.");
        JSONArray items=new JSONArray(); Set<String> seen=new LinkedHashSet<>();
        // Conservative fallback: split only explicit line breaks/list punctuation, not every 'and'.
        for(String line:raw.split("[\\r\\n;]+")) {
            String text=line.trim().replaceFirst("(?i)^(?:[-*•]|\\d+[.)])\\s+","");
            if(!text.isEmpty() && seen.add(text.toLowerCase(Locale.ROOT))) items.put(new JSONObject().put("text",text).put("depth",0));
        }
        return validate(new JSONObject().put("title","").put("items",items));
    }
    public static JSONObject validate(JSONObject draft) throws Exception {
        if(draft==null || !(draft.opt("title") instanceof String) || draft.optString("title").length()>300) throw new IllegalArgumentException("Invalid checklist title.");
        JSONArray input=draft.optJSONArray("items");
        if(input==null || input.length()<1 || input.length()>100) throw new IllegalArgumentException("Use 1–100 checklist items per capture.");
        JSONArray items=new JSONArray(); int previous=-1;
        for(int i=0;i<input.length();i++) {
            JSONObject row=input.optJSONObject(i);
            if(row==null || !(row.opt("text") instanceof String) || !(row.opt("depth") instanceof Number)) throw new IllegalArgumentException("Invalid checklist item.");
            String text=row.getString("text").trim(); double level=row.getDouble("depth"); int depth=(int)level;
            if(text.isEmpty() || text.length()>2000 || text.contains("\n") || depth!=level || depth<0 || depth>8 || depth>previous+1) throw new IllegalArgumentException("Use nonempty items with consecutive nesting levels (up to 8).");
            items.put(new JSONObject().put("text",text).put("depth",depth)); previous=depth;
        }
        return new JSONObject().put("title",draft.getString("title").trim()).put("items",items);
    }
    public static String reviewText(JSONObject draft) throws Exception {
        JSONArray items=validate(draft).getJSONArray("items"); StringBuilder text=new StringBuilder();
        for(int i=0;i<items.length();i++) { JSONObject row=items.getJSONObject(i); if(i>0)text.append('\n'); for(int d=0;d<row.getInt("depth");d++)text.append("  "); text.append(row.getString("text")); }
        return text.toString();
    }
    public static JSONObject fromReview(String title,String lines) throws Exception {
        JSONArray items=new JSONArray();
        for(String line:lines.split("\\r?\\n")) { if(line.trim().isEmpty())continue; int spaces=0; while(spaces<line.length() && line.charAt(spaces)==' ')spaces++; items.put(new JSONObject().put("text",line.trim()).put("depth",spaces/2)); }
        return validate(new JSONObject().put("title",title).put("items",items));
    }
    /** Stable IDs make replay after a crash safe, even if the added rows were later deleted. */
    public static String apply(JSONObject workspace,String noteId,String projectId,String jobId,JSONObject proposed,String now) throws Exception {
        if(!jobId.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid capture ID.");
        JSONObject draft=validate(proposed); JSONObject note=noteId==null?NotesCore.findNote(workspace,"note-voice-"+jobId):NotesCore.findNote(workspace,noteId);
        if(note==null && noteId!=null) throw new IllegalArgumentException("The destination note is missing. Choose a new note instead.");
        if(note==null) { String id=NotesCore.addNote(workspace,projectId,null,draft.getString("title"),"",null,now); note=NotesCore.findNote(workspace,id); note.put("id","note-voice-"+jobId); }
        if(note.optString("deletedAt").length()>0 && !note.optString("deletedAt").equals("null")) throw new IllegalArgumentException("The destination was deleted. Choose a new note instead.");
        String destination=note.getString("id"); JSONArray existing=note.optJSONArray("checklist");
        // Never partially replay an already applied batch after editing the review.
        if(existing!=null) for(int j=0;j<existing.length();j++) if(existing.optJSONObject(j)!=null && existing.getJSONObject(j).optString("id").startsWith("voice-"+jobId+"-"))return destination;
        JSONArray items=draft.getJSONArray("items"); String[] parents=new String[9];
        for(int i=0;i<items.length();i++) { JSONObject row=items.getJSONObject(i); int depth=row.getInt("depth"); String generated=NotesCore.addChecklistItem(workspace,destination,row.getString("text"),depth==0?null:parents[depth-1],null,now); JSONObject target=NotesCore.findNote(workspace,destination); JSONArray list=target.getJSONArray("checklist"); for(int j=0;j<list.length();j++) if(generated.equals(list.getJSONObject(j).optString("id")))list.getJSONObject(j).put("id","voice-"+jobId+"-"+i); parents[depth]="voice-"+jobId+"-"+i; }
        return destination;
    }
    public static String sharedId(String sourceVault,String noteId) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest((sourceVault+"\n"+noteId).getBytes(StandardCharsets.UTF_8)); StringBuilder hex=new StringBuilder("note-shared-"); for(byte b:digest)hex.append(String.format(Locale.ROOT,"%02x",b)); return hex.toString();
    }
    /** Copies only this selected note; no other projects, labels, sub-notes or conflict copies. */
    public static String share(JSONObject destination,JSONObject source,String sourceVault,String now) throws Exception {
        String id=sharedId(sourceVault,source.getString("id"));
        if(NotesCore.findNote(destination,id)!=null)return id;
        String added=NotesCore.addNote(destination,null,null,source.optString("title"),source.optString("body"),source.optString("color"),now);
        JSONObject note=NotesCore.findNote(destination,added); note.put("id",id);
        Map<String,String> copied=new HashMap<>();
        for(NotesCore.Row row:NotesCore.orderedChecklist(source)) {
            String parent=row.item.optString("parentId"); String item=NotesCore.addChecklistItem(destination,id,row.item.optString("text"),copied.get(parent),null,now); copied.put(row.item.optString("id"),item);
            if(row.item.optString("completedAt").length()>0 && !row.item.optString("completedAt").equals("null"))NotesCore.setChecklistChecked(destination,id,item,true,now);
        }
        return id;
    }
}
