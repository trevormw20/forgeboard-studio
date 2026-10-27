package com.forgeboard.notes;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Token, remote base and durable offline outbox share one encrypted atomic transaction. */
final class SecureStore {
    private final AtomicFile file;
    SecureStore(Context context) { this(context,"notes-v1"); }
    SecureStore(Context context,String name) {
        if(!name.matches("[a-z0-9-]+")) throw new IllegalArgumentException("Invalid cache name");
        file=new AtomicFile(new File(context.getNoBackupFilesDir(),name+".enc"));
    }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        String alias="forgeboard_notes_v1";
        if(!store.containsAlias(alias)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (javax.crypto.SecretKey)store.getKey(alias,null);
    }
    JSONObject read() throws Exception {
        byte[] data;
        // openRead/readFully restores AtomicFile's backup after an interrupted write.
        try { data=file.readFully(); }
        catch(FileNotFoundException missing) { if(file.getBaseFile().exists() || new File(file.getBaseFile().getPath()+".bak").exists())throw missing; return null; }
        if(data.length<30 || data[0]!=1)throw new IOException("Invalid encrypted cache");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,java.util.Arrays.copyOfRange(data,1,13)));
        return new JSONObject(new String(cipher.doFinal(data,13,data.length-13),StandardCharsets.UTF_8));
    }
    void write(JSONObject state) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=cipher.doFinal(state.toString().getBytes(StandardCharsets.UTF_8));
        FileOutputStream output=null;
        try { output=file.startWrite(); output.write(1); output.write(cipher.getIV()); output.write(encrypted); file.finishWrite(output); }
        catch(Exception e) { if(output!=null)file.failWrite(output); throw e; }
    }
}
