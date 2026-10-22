package com.forgeboard.notes;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import com.forgeboard.notes.core.NotesCore;
import com.forgeboard.notes.core.StaticWorkspaceMerger;

/** The encrypted workspace + base are a durable offline outbox. No planner data is stored in preferences. */
public final class NotesRepository {
    public static final String ACTION_CHANGED="com.forgeboard.notes.CHANGED";
    private static NotesRepository instance;
    public interface Callback { void onComplete(String error); }
    public interface Edit { void apply(JSONObject workspace) throws Exception; }
    private final Context context;
    private final SecureStore store;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private JSONObject state;
    private String loadError;
    private boolean syncing;
    private long revision;
    private NotesRepository(Context context){
        this.context=context.getApplicationContext();store=new SecureStore(this.context);
        try{state=store.read();if(state==null)state=new JSONObject().put("workspace",NotesCore.emptyWorkspace()).put("dirty",false);}
        catch(Exception e){loadError="The encrypted offline cache could not be unlocked. It has been preserved; do not uninstall or clear app data. Contact support before reconnecting.";state=new JSONObject();}
        NotesSyncJobService.schedulePeriodic(this.context);
    }
    public static synchronized NotesRepository get(Context context){if(instance==null)instance=new NotesRepository(context);return instance;}
    private static JSONObject copy(JSONObject value){try{return new JSONObject(value.toString());}catch(Exception e){throw new IllegalStateException("Could not read saved data.");}}
    public synchronized JSONObject snapshot(){JSONObject ws=state.optJSONObject("workspace");return ws==null?NotesCore.emptyWorkspace():copy(ws);}
    public synchronized VaultConfig config(){return VaultConfig.from(state.optJSONObject("connection"));}
    public synchronized boolean isConnected(){return loadError==null&&!config().token.isEmpty();}
    public synchronized boolean hasPendingWrites(){return state.optBoolean("dirty");}
    public synchronized boolean isSyncing(){return syncing;}
    public synchronized String lastSyncAt(){return state.optString("lastSyncAt","");}
    public synchronized String statusMessage(){
        if(loadError!=null)return loadError;
        if(syncing)return "Syncing with your private GitHub vault…";
        if(!state.optString("lastError").isEmpty())return state.optString("lastError");
        if(hasPendingWrites())return isConnected()?"Saved on this device · waiting to sync":"Saved on this device · connect GitHub to sync";
        return isConnected()?"Synced with GitHub":"Connect your private GitHub vault to load your notebooks";
    }
    public static String now(){return Instant.now().toString();}
    public void edit(Edit edit)throws Exception{
        synchronized(this){checkCache();JSONObject next=copy(state),ws=snapshot();edit.apply(ws);next.put("workspace",ws).put("dirty",true).remove("lastError");store.write(next);state=next;revision++;}
        changed();requestSync();
    }
    public void disconnect()throws Exception{
        synchronized(this){checkCache();if(syncing)throw new IOException("Wait for the current sync to finish before disconnecting.");JSONObject next=copy(state);VaultConfig c=config();next.put("connection",new VaultConfig(c.owner,c.repo,c.branch,c.path,"").json());next.remove("lastError");store.write(next);state=next;revision++;}changed();
    }
    private void checkCache()throws IOException{if(loadError!=null)throw new IOException(loadError);}
    public void connect(VaultConfig candidate,Callback callback){
        synchronized(this){if(syncing){complete(callback,"A sync is already running. Please try again in a moment.");return;}syncing=true;}changed();
        io.execute(()->{String error=null;try{
            candidate.validate();VaultClient client=new VaultClient(candidate);client.requirePrivate();VaultClient.Remote remote=client.read();
            synchronized(this){checkCache();String identity=state.optString("vaultIdentity",config().token.isEmpty()?"":config().identity());
                if(!identity.isEmpty()&&!identity.equals(candidate.identity())&&hasPendingWrites())throw new IOException("Sync pending edits to the previous vault before switching repositories. Your notes have been preserved.");
                boolean same=identity.equals(candidate.identity()) || identity.isEmpty();
                JSONObject ws=same&&hasPendingWrites()?StaticWorkspaceMerger.merge(state.optJSONObject("base"),snapshot(),remote.workspace,now()):remote.workspace;
                JSONObject next=copy(state);next.put("connection",candidate.json()).put("vaultIdentity",candidate.identity()).put("workspace",ws).put("base",remote.workspace).put("dirty",!equivalent(ws,remote.workspace)).put("lastSyncAt",now());next.remove("lastError");store.write(next);state=next;revision++;
            }
            doSync();
        }catch(Exception e){error=safe(e);saveError(error);}finally{finishSync(callback,error);}});
    }
    public void sync(Callback callback){
        synchronized(this){if(syncing){complete(callback,null);return;}if(!isConnected()){complete(callback,loadError==null?"Connect your private GitHub vault first. Offline notes remain saved.":loadError);return;}syncing=true;}changed();
        io.execute(()->{String error=null;try{doSync();}catch(Exception e){error=safe(e);saveError(error);}finally{finishSync(callback,error);}});
    }
    private void doSync()throws Exception{
        VaultConfig c;JSONObject local,base;long startRevision;
        synchronized(this){checkCache();c=config();local=snapshot();base=state.optJSONObject("base");if(base!=null)base=copy(base);startRevision=revision;}
        VaultClient client=new VaultClient(c);client.requirePrivate();JSONObject uploaded=null;
        for(int attempt=0;attempt<4;attempt++){
            VaultClient.Remote remote=client.read();
            JSONObject merged=StaticWorkspaceMerger.merge(base,local,remote.workspace,now());
            if(!equivalent(merged,remote.workspace)){
                try{client.write(merged,remote.sha);}catch(VaultClient.Failure e){if((e.status==409||e.status==422)&&attempt<3)continue;throw e;}
                uploaded=merged;
            }else uploaded=remote.workspace;
            break;
        }
        if(uploaded==null)throw new IOException("The vault is busy on another device. Try Sync now again; all offline edits are safe.");
        synchronized(this){
            JSONObject display=revision==startRevision?uploaded:StaticWorkspaceMerger.merge(local,snapshot(),uploaded,now());
            JSONObject next=copy(state);next.put("workspace",display).put("base",uploaded).put("dirty",!equivalent(display,uploaded)).put("lastSyncAt",now());next.remove("lastError");store.write(next);state=next;
        }
    }
    private void finishSync(Callback callback,String error){synchronized(this){syncing=false;}changed();complete(callback,error);if(error==null&&hasPendingWrites())requestSync();}
    private void complete(Callback callback,String error){if(callback!=null)main.post(()->callback.onComplete(error));}
    private void saveError(String error){synchronized(this){try{if(loadError!=null)return;JSONObject next=copy(state);next.put("lastError",error);store.write(next);state=next;}catch(Exception ignored){/* Previous durable outbox is not replaced. */}}}
    private static String safe(Exception error){if(error instanceof VaultClient.Failure||error instanceof IllegalArgumentException)return error.getMessage();if(error instanceof IOException&&error.getMessage()!=null&&(error.getMessage().startsWith("The ")||error.getMessage().startsWith("Sync pending")||error.getMessage().startsWith("Connect a PRIVATE")||error.getMessage().startsWith("Workspace")||error.getMessage().startsWith("This file")))return error.getMessage();return "Could not sync. Check your connection and try Sync now. Your saved offline edits have been preserved.";}
    public void requestSync(){if(isConnected())NotesSyncJobService.scheduleSoon(context);}
    private void changed(){main.post(()->{context.sendBroadcast(new Intent(ACTION_CHANGED).setPackage(context.getPackageName()));NotesWidgetProvider.updateAll(context);});}
    static boolean equivalent(JSONObject a,JSONObject b){try{JSONObject x=copy(a),y=copy(b);x.remove("updatedAt");y.remove("updatedAt");return canonical(x).equals(canonical(y));}catch(Exception e){return false;}}
    private static String canonical(Object object)throws Exception{
        if(object instanceof JSONObject){JSONObject j=(JSONObject)object;List<String>keys=new ArrayList<>();Iterator<String>it=j.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);StringBuilder s=new StringBuilder("{");for(String key:keys)s.append(JSONObject.quote(key)).append(':').append(canonical(j.get(key))).append(',');return s.append('}').toString();}
        if(object instanceof JSONArray){JSONArray a=(JSONArray)object;StringBuilder s=new StringBuilder("[");for(int i=0;i<a.length();i++)s.append(canonical(a.get(i))).append(',');return s.append(']').toString();}if(object instanceof String)return JSONObject.quote((String)object);return String.valueOf(object);
    }
}
