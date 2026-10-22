package com.forgeboard.notes;

import org.json.JSONObject;

public final class VaultConfig {
    public final String owner, repo, branch, path, token;
    public VaultConfig(String owner, String repo, String branch, String path, String token) {
        this.owner=owner.trim(); this.repo=repo.trim(); this.branch=branch.trim(); this.path=path.trim(); this.token=token.trim();
    }
    public static VaultConfig defaults() { return new VaultConfig("trevormw20","forgeboard-studio-vault","main","data/workspace.json",""); }
    void validate() {
        if (!owner.matches("[A-Za-z0-9_.-]+") || !repo.matches("[A-Za-z0-9_.-]+") || branch.isEmpty() || branch.contains("\n") || branch.contains("\r") || path.startsWith("/") || path.contains("\\") || path.isEmpty()) throw new IllegalArgumentException("Check the owner, repository, branch and workspace path.");
        for(String part:path.split("/",-1)) if(part.isEmpty()||part.equals(".")||part.equals("..")) throw new IllegalArgumentException("Use a file path such as data/workspace.json.");
        if(token.isEmpty() || token.contains("\n") || token.contains("\r")) throw new IllegalArgumentException("Enter the private data repository's fine-grained access token on this device.");
    }
    String identity() { return owner.toLowerCase(java.util.Locale.ROOT)+"/"+repo.toLowerCase(java.util.Locale.ROOT)+"/"+branch+"/"+path; }
    JSONObject json() throws Exception { return new JSONObject().put("owner",owner).put("repo",repo).put("branch",branch).put("path",path).put("token",token); }
    static VaultConfig from(JSONObject j) { if(j==null)return defaults(); return new VaultConfig(j.optString("owner"),j.optString("repo"),j.optString("branch"),j.optString("path"),j.optString("token")); }
}
