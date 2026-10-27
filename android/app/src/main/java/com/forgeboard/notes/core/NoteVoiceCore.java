package com.forgeboard.notes.core;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import static com.forgeboard.notes.core.JsonSupport.*;

/** Capability-limited Claude plans: append rows only; never repair or rewrite existing rows. */
public final class NoteVoiceCore {
    private NoteVoiceCore(){}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Claude’s additions could not be safely placed. Your words are saved; the existing checklist was not changed.");}
    public static JSONObject context(JSONObject note)throws Exception{
        if(note==null||deleted(note))throw new IllegalArgumentException("Open an existing, active note to talk to Claude.");
        JSONArray items=new JSONArray();String[] parents=new String[33];
        for(NotesCore.Row row:NotesCore.orderedChecklist(note)){
            if(row.depth>32||items.length()>=500)throw new IllegalArgumentException("This note is too large for Claude context. Use a smaller note; nothing was sent.");
            String id=string(row.item,"id");
            items.put(new JSONObject().put("id",id).put("text",row.item.optString("text")).put("parentId",row.depth==0?"":parents[row.depth-1]).put("completed",string(row.item,"completedAt")!=null));parents[row.depth]=id;
        }
        JSONObject result=new JSONObject().put("id",note.getString("id")).put("title",note.optString("title")).put("body",note.optString("body")).put("items",items);
        if(result.toString().getBytes(StandardCharsets.UTF_8).length>64000)throw new IllegalArgumentException("This note is too large for Claude context. Use a smaller note; nothing was sent.");
        return result;
    }
    private static void keys(JSONObject object,String...allowed){Set<String> valid=new HashSet<>(Arrays.asList(allowed));Iterator<String> keys=object.keys();while(keys.hasNext())if(!valid.contains(keys.next()))throw invalid();}
    private static Map<String,JSONObject> rows(JSONObject context){Map<String,JSONObject> rows=new HashMap<>();for(JSONObject item:objects(context,"items"))rows.put(string(item,"id"),item);return rows;}
    private static int existingDepth(Map<String,JSONObject> rows,String id){Set<String> seen=new HashSet<>();int depth=-1;while(id!=null&&!id.isEmpty()){JSONObject row=rows.get(id);if(row==null||!seen.add(id)||++depth>32)throw invalid();id=string(row,"parentId");}return depth;}
    public static JSONObject validate(JSONObject plan,JSONObject context)throws Exception{
        if(plan==null||context==null)throw invalid();keys(plan,"additions");JSONArray input=plan.optJSONArray("additions");if(input==null||input.length()<1||input.length()>100)throw invalid();
        Map<String,JSONObject> existing=rows(context);JSONArray output=new JSONArray();int[] depths=new int[input.length()];
        for(int i=0;i<input.length();i++){
            JSONObject row=input.optJSONObject(i);if(row==null)throw invalid();keys(row,"text","parent");String text=string(row,"text"),parent=string(row,"parent");if(text==null||text.trim().isEmpty()||text.length()>2000||text.contains("\n")||text.contains("\r")||parent==null)throw invalid();
            int depth=0;
            if(parent.startsWith("existing:")){if(!existing.containsKey(parent.substring(9)))throw invalid();depth=existingDepth(existing,parent.substring(9))+1;}
            else if(parent.matches("new:(0|[1-9][0-9]{0,2})")){int index=Integer.parseInt(parent.substring(4));if(index>=i)throw invalid();depth=depths[index]+1;}
            else if(!parent.isEmpty())throw invalid();
            if(depth>32)throw invalid();depths[i]=depth;output.put(new JSONObject().put("text",text.trim()).put("parent",parent));
        }
        return new JSONObject().put("additions",output);
    }
    private static void checkParent(String id,Map<String,JSONObject> captured,Map<String,JSONObject> current){
        Set<String> seen=new HashSet<>();while(id!=null&&!id.isEmpty()){
            JSONObject old=captured.get(id),now=current.get(id);
            if(old==null||now==null||!seen.add(id)||deleted(now)||!Objects.equals(string(old,"text"),string(now,"text"))||!Objects.equals(emptyNull(string(old,"parentId")),emptyNull(string(now,"parentId"))))throw new IllegalArgumentException("A destination group was renamed, moved or deleted while Claude worked. Your words are saved; nothing was added. Start a new recording with the updated note.");
            id=string(old,"parentId");
        }
    }
    private static String emptyNull(String value){return value==null||value.isEmpty()?null:value;}
    public static String apply(JSONObject workspace,JSONObject job,JSONObject proposal,String now)throws Exception{
        Instant.parse(now);String noteId=job.getString("noteId"),captureId=job.getString("id");if(!captureId.matches("[a-f0-9-]{36}"))throw invalid();
        JSONObject note=NotesCore.findNote(workspace,noteId),context=job.getJSONObject("noteContext");if(note==null||deleted(note)||!noteId.equals(context.optString("id")))throw invalid();
        JSONArray original=note.optJSONArray("checklist");if(original==null)original=new JSONArray();String prefix="voice-"+captureId+"-";
        // Replay must stay a no-op, even if a person subsequently edited/deleted the original group.
        for(JSONObject row:objects(original))if(row.optString("id").startsWith(prefix))return noteId;
        JSONArray additions=validate(proposal,context).getJSONArray("additions");if(original.length()+additions.length()>5000)throw invalid();
        Map<String,JSONObject> captured=rows(context),current=byId(objects(original));
        JSONArray appended=new JSONArray(original.toString());Map<String,Double> last=new HashMap<>();
        for(JSONObject row:objects(original))if(!deleted(row)){String parent=emptyNull(string(row,"parentId"));double order=row.optDouble("order",0);if(!Double.isFinite(order))order=0;last.put(parent,Math.max(last.getOrDefault(parent,Double.NEGATIVE_INFINITY),order));}
        for(int i=0;i<additions.length();i++){
            JSONObject add=additions.getJSONObject(i);String ref=add.getString("parent"),parent=null;
            if(ref.startsWith("existing:")){parent=ref.substring(9);checkParent(parent,captured,current);}
            else if(ref.startsWith("new:"))parent=prefix+Integer.parseInt(ref.substring(4));
            double before=last.getOrDefault(parent,-1.0),order=before+1;if(!Double.isFinite(order)||order<=before)throw invalid();last.put(parent,order);
            JSONObject row=new JSONObject().put("id",prefix+i).put("text",add.getString("text")).put("order",order).put("createdAt",now).put("updatedAt",now);if(parent!=null)row.put("parentId",parent);appended.put(row);
        }
        // Commit only after every row/target validates; all original records remain byte-for-byte equivalent.
        note.put("checklist",appended).put("updatedAt",now);workspace.put("updatedAt",now);return noteId;
    }
}
