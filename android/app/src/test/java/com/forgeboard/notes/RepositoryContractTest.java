package com.forgeboard.notes;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class RepositoryContractTest {
    @Test public void canonicalComparisonIgnoresOnlyEnvelopeTimestamp() throws Exception {
        JSONObject a=new JSONObject("{\"updatedAt\":\"old\",\"note\":{\"text\":\"true\",\"pinned\":true}}");
        JSONObject b=new JSONObject("{\"note\":{\"pinned\":true,\"text\":\"true\"},\"updatedAt\":\"new\"}");
        assertTrue(NotesRepository.equivalent(a,b));
        b.getJSONObject("note").put("text",true);
        assertFalse(NotesRepository.equivalent(a,b));
        b.getJSONObject("note").put("text","true").put("updatedAt","changed-note");
        assertFalse(NotesRepository.equivalent(a,b));
    }
    @Test public void configRefusesPathsOutsideWorkspaceFile() {
        for(String path:new String[]{"../secrets.json","/data/workspace.json","data//workspace.json","data/./workspace.json","data\\workspace.json"}) {
            try { new VaultConfig("owner","private","main",path,"fake-token").validate(); fail(path); }
            catch(IllegalArgumentException expected) { }
        }
        new VaultConfig("owner","private","main","data/workspace.json","fake-token").validate();
    }
}
