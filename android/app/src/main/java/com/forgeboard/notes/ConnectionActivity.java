package com.forgeboard.notes;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Credentials are entered here only; the repository encrypts them with Android Keystore. */
public final class ConnectionActivity extends Activity {
    private EditText owner, repoName, branch, path, token;
    private Button save;
    private TextView status;
    private NotesRepository repository;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE); repository = NotesRepository.forIntent(this,getIntent()); VaultConfig c = repository.config();
        LinearLayout root = Ui.column(this); Ui.install(this,root);
        LinearLayout header = Ui.row(this); Ui.pad(header,16); header.addView(Ui.button(this,"‹ Notes",this::finish)); header.addView(Ui.title(this,"Private GitHub vault",20)); root.addView(header);
        ScrollView sc = new ScrollView(this); sc.setFillViewport(true); root.addView(sc,new LinearLayout.LayoutParams(-1,0,1)); LinearLayout body = Ui.column(this); Ui.pad(body,20); sc.addView(body);
        body.addView(Ui.title(this,repository.isShared()?"Shared lists only":BuildConfig.NIKI_PROFILE?"Niki’s private notes":"Your notes. Same vault.",25)); Ui.gap(body,8);
        body.addView(Ui.muted(this,repository.isShared()?"Connect the household shared repository. It must contain only lists you are happy for both of you to read. Your private notes remain in a separate vault.":BuildConfig.NIKI_PROFILE?"Use a token for Niki’s notes vault and the shared-lists vault only. Do not give this app access to the full planner vault. Your GitHub account owns these repositories; this is a separate notes profile, not a separate GitHub login.":"Connect to the same private repository as Forgeboard. This app never creates or replaces a missing workspace. Your browser connection is separate.")); Ui.gap(body,20);
        owner = Ui.input(this,"GitHub owner",c == null ? "trevormw20" : c.owner,"connectionOwner",false);
        repoName = Ui.input(this,"Private repository",c == null ? "forgeboard-studio-vault" : c.repo,"connectionRepo",false);
        branch = Ui.input(this,"Branch",c == null ? "main" : c.branch,"connectionBranch",false);
        path = Ui.input(this,"Workspace path",c == null ? "data/workspace.json" : c.path,"connectionPath",false);
        token = Ui.input(this,"Fine-grained personal access token","","connectionToken",false);
        for (EditText e : new EditText[]{owner,repoName,branch,path}) { e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD); e.setAutofillHints((String[]) null); }
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD); token.setSaveEnabled(false); token.setAutofillHints((String[]) null); token.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        Ui.field(body,"Account / owner",owner); Ui.field(body,"Private data repository — not the public app",repoName); Ui.field(body,"Branch",branch); Ui.field(body,"Workspace file",path); Ui.field(body,"Token" + (repository.isConnected() ? " — leave blank to keep the saved token" : ""),token);
        body.addView(Ui.muted(this,"Create a fine-grained token limited to this private repository only, with Contents → Read and write. The token is encrypted with this device’s Android Keystore. Never paste it into chat. Expiring tokens need replacement.")); Ui.gap(body,12);
        status = Ui.muted(this,""); status.setTag("connectionStatus"); body.addView(status);
        save = Ui.button(this,"Connect & load existing notes",this::connect); save.setTag("connectionSave"); body.addView(save,new LinearLayout.LayoutParams(-1,-2));
        if (repository.isConnected()) body.addView(Ui.button(this,"Disconnect this device",() -> new android.app.AlertDialog.Builder(this).setTitle("Disconnect this device?").setMessage("This removes the saved connection. Offline notes stay on this device. Nothing is deleted from GitHub.").setNegativeButton("Cancel",null).setPositiveButton("Disconnect",(d,w) -> { try { repository.disconnect(); finish(); } catch(Exception e) { Ui.error(this,e); } }).show()));
    }
    private void connect() {
        String existing = repository.config() == null ? "" : repository.config().token;
        String value = token.getText().toString().trim(); if (value.isEmpty()) value = existing;
        if (owner.getText().toString().trim().isEmpty() || repoName.getText().toString().trim().isEmpty() || value.isEmpty()) { status.setText("Enter the owner, private repository, and a token."); return; }
        VaultConfig config = new VaultConfig(owner.getText().toString().trim(),repoName.getText().toString().trim(),branch.getText().toString().trim(),path.getText().toString().trim(),value);
        save.setEnabled(false); status.setText("Checking private repository and workspace…");
        repository.connect(config,error -> { if(isFinishing() || isDestroyed()) return; save.setEnabled(true); token.getText().clear(); if(error == null) { finish(); } else { status.setText(error); } });
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        // Do not put token text in the OS view-state bundle.
        token.setSaveEnabled(false); super.onSaveInstanceState(out);
    }
}
