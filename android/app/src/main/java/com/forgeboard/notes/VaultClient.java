package com.forgeboard.notes;

import org.json.*;
import android.util.Base64;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class VaultClient {
    static final class Failure extends IOException { final int status; Failure(int code,String message){super(message);status=code;} }
    static final class Remote { final JSONObject workspace; final String sha; Remote(JSONObject ws,String sha){workspace=ws;this.sha=sha;} }
    private final VaultConfig config;
    VaultClient(VaultConfig config){this.config=config;config.validate();}
    private static String enc(String part){try{return URLEncoder.encode(part,"UTF-8").replace("+","%20");}catch(Exception e){throw new IllegalArgumentException();}}
    private String repo(){return "/repos/"+enc(config.owner)+"/"+enc(config.repo);}
    private String contents(){StringBuilder p=new StringBuilder(repo()+"/contents/");for(String part:config.path.split("/"))p.append(enc(part)).append('/');return p.substring(0,p.length()-1);}
    void requirePrivate() throws Exception { if(!request("GET",repo(),null).optBoolean("private",false))throw new IOException("Connect a PRIVATE data repository, not the public Pages repository."); }
    Remote read() throws Exception {
        JSONObject payload=request("GET",contents()+"?ref="+enc(config.branch),null);
        if(!payload.optString("encoding").equals("base64") || payload.optString("sha").isEmpty())throw new IOException("Workspace is too large or is not a JSON file. No data was changed.");
        JSONObject ws=new JSONObject(new String(Base64.decode(payload.getString("content"),Base64.DEFAULT),StandardCharsets.UTF_8));
        if(ws.optJSONArray("projects")==null || ws.optJSONArray("tasks")==null || ws.optString("id").isEmpty())throw new IOException("This file is not a Forgeboard workspace. No data was changed.");
        return new Remote(ws,payload.getString("sha"));
    }
    void write(JSONObject workspace,String sha) throws Exception {
        JSONObject body=new JSONObject().put("message","[skip ai] Sync Forgeboard Android notes").put("branch",config.branch).put("sha",sha).put("content",Base64.encodeToString(workspace.toString(2).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
        request("PUT",contents(),body);
    }
    private String voicePath(String folder,String id) {
        if(!id.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid voice request ID.");
        return repo()+"/contents/data/"+folder+"/"+id+".json";
    }
    private JSONObject voiceFile(String folder,String id) throws Exception {
        JSONObject file=request("GET",voicePath(folder,id)+"?ref="+enc(config.branch),null);
        if(!"base64".equals(file.optString("encoding")))throw new IOException("Invalid voice result.");
        String content=file.optString("content"); if(content.length()>200000)throw new IOException("Voice result too large.");
        return new JSONObject(new String(Base64.decode(content,Base64.DEFAULT),StandardCharsets.UTF_8));
    }
    void enqueueVoice(JSONObject job) throws Exception {
        requirePrivate(); String id=job.getString("id");
        JSONObject body=new JSONObject().put("message","Organize reviewed voice draft").put("branch",config.branch).put("content",Base64.encodeToString(job.toString(2).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
        try{request("PUT",voicePath("voice-inbox",id),body);}
        catch(Failure conflict){if(conflict.status!=409&&conflict.status!=422)throw conflict; JSONObject old=voiceFile("voice-inbox",id);if(!old.optString("transcript").equals(job.getString("transcript")))throw new IOException("Voice request identity changed. Your draft is preserved.");}
    }
    JSONObject voiceResult(String id) throws Exception {try{return voiceFile("voice-results",id);}catch(Failure e){if(e.status==404)return null;throw e;}}
    private JSONObject request(String method,String route,JSONObject body)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL("https://api.github.com"+route).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization","Bearer "+config.token);connection.setRequestProperty("Accept","application/vnd.github+json");connection.setRequestProperty("X-GitHub-Api-Version","2022-11-28");connection.setRequestProperty("User-Agent","Forgeboard-Notes-Android");
        try{
            if(body!=null){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();
            if(status<200||status>=300)throw new Failure(status,message(status));
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>8*1024*1024)throw new IOException("Workspace exceeds this app's safe download limit. No data was changed.");out.write(buffer,0,count);}return new JSONObject(out.toString("UTF-8"));
            }
        }finally{connection.disconnect();}
    }
    private static String message(int code){
        if(code==401||code==403)return "GitHub access was refused. Check token expiry, selected private repository and Contents read/write permission; GitHub rate limits can also delay syncing. Offline edits are safe.";
        if(code==404)return "Repository or workspace not found. Check owner, private repository, main branch, data/workspace.json, token repository access and Contents read/write permission. The file must already exist.";
        if(code==409||code==422)return "Workspace changed elsewhere. Retrying safely; offline edits are preserved.";
        return "GitHub could not sync (HTTP "+code+"). Offline edits are preserved. Try Sync now later.";
    }
}
