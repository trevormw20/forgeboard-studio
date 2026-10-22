package com.forgeboard.notes;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/** Small native view system shared by the companion screens; no WebView or embedded credentials. */
public final class Ui {
    public static final int BG = Color.rgb(15, 20, 31);
    public static final int SURFACE = Color.rgb(25, 33, 48);
    public static final int TEXT = Color.rgb(239, 243, 250);
    public static final int MUTED = Color.rgb(167, 180, 200);
    public static final int ACCENT = Color.rgb(183, 174, 255);
    public static final String[] COLORS = {"#273247", "#263D46", "#34334F", "#453449", "#423B2D", "#254039", "#443034", "#293A58"};
    private Ui() {}
    public static int dp(Context c, float n) { return Math.round(n * c.getResources().getDisplayMetrics().density); }
    public static LinearLayout column(Context c) { LinearLayout l = new LinearLayout(c); l.setOrientation(LinearLayout.VERTICAL); return l; }
    public static LinearLayout row(Context c) { LinearLayout l = new LinearLayout(c); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(android.view.Gravity.CENTER_VERTICAL); return l; }
    public static void pad(View v, int n) { int p = dp(v.getContext(), n); v.setPadding(p, p, p, p); }
    public static GradientDrawable shape(int color, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(radius); return d; }
    public static int color(String hex, int fallback) { try { return Color.parseColor(hex); } catch (Exception ignored) { return fallback; } }
    public static int readable(int background) {
        int dark=Color.rgb(20,25,35); double light=luminance(background);
        return (luminance(TEXT)+.05)/(light+.05) >= (light+.05)/(luminance(dark)+.05) ? TEXT : dark;
    }
    private static double luminance(int color) { double[] channels={Color.red(color)/255.0,Color.green(color)/255.0,Color.blue(color)/255.0}; for(int i=0;i<channels.length;i++) channels[i]=channels[i]<=.04045?channels[i]/12.92:Math.pow((channels[i]+.055)/1.055,2.4); return .2126*channels[0]+.7152*channels[1]+.0722*channels[2]; }
    public static LinearLayout card(Context c, String color) {
        LinearLayout l = column(c); pad(l, 16); l.setBackground(shape(Ui.color(color, SURFACE), dp(c, 18)));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.bottomMargin = dp(c, 12); l.setLayoutParams(p); return l;
    }
    public static TextView text(Context c, String text, int size, int color) {
        TextView t = new TextView(c); t.setText(text); t.setTextSize(size); t.setTextColor(color); t.setLineSpacing(dp(c, 2), 1.05f); return t;
    }
    public static TextView title(Context c, String text, int size) { TextView t = text(c,text,size,TEXT); t.setTypeface(null, Typeface.BOLD); return t; }
    public static TextView muted(Context c, String text) { return text(c,text,14,MUTED); }
    public static Button button(Context c, String text, Runnable action) {
        Button b = new Button(c); b.setText(text); b.setTextSize(14); b.setAllCaps(false); b.setTextColor(TEXT);
        b.setMinHeight(dp(c,48)); b.setMinimumHeight(dp(c,48)); b.setPadding(dp(c,14),dp(c,6),dp(c,14),dp(c,6));
        b.setBackground(shape(Color.rgb(44,56,77),dp(c,12))); b.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2,-2); p.setMargins(0,dp(c,4),dp(c,8),dp(c,4)); b.setLayoutParams(p); return b;
    }
    public static EditText input(Context c, String hint, String value, String tag, boolean multiline) {
        EditText e = new EditText(c); e.setHint(hint); e.setText(value); e.setTag(tag); e.setContentDescription(hint); e.setTextColor(TEXT); e.setHintTextColor(MUTED); e.setTextSize(16);
        e.setSingleLine(!multiline); e.setGravity(android.view.Gravity.TOP | android.view.Gravity.START); e.setMinHeight(dp(c,52));
        e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | (multiline ? android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES : android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES));
        pad(e,12); e.setBackground(shape(Color.rgb(20,28,42),dp(c,10)));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1,-2); p.setMargins(0,dp(c,6),0,dp(c,10)); e.setLayoutParams(p); return e;
    }
    public static void gap(LinearLayout l, int height) { View v = new View(l.getContext()); l.addView(v,new LinearLayout.LayoutParams(1,dp(l.getContext(),height))); }
    public static void field(LinearLayout l, String label, View view) { l.addView(muted(l.getContext(),label)); l.addView(view); }
    public static void message(Activity a, String title, String body) { new AlertDialog.Builder(a).setTitle(title).setMessage(body).setPositiveButton("OK",null).show(); }
    public static void error(Activity a, Exception e) { message(a,"Couldn’t save",e.getMessage() == null ? "Your last saved content is still available. Try again." : e.getMessage()); }
    public static String now() { return Instant.now().toString(); }
    public static String date(String value) { try { return DateTimeFormatter.ofPattern("MMM d · h:mm a").withZone(ZoneId.systemDefault()).format(Instant.parse(value)); } catch (Exception ignored) { return value == null ? "" : value; } }
    /** target 36 is edge-to-edge. Include IME so editors stay above the keyboard. */
    public static void install(Activity a, LinearLayout root) {
        root.setBackgroundColor(BG); a.getWindow().setStatusBarColor(BG); a.getWindow().setNavigationBarColor(BG);
        a.getWindow().getDecorView().setSystemUiVisibility(0); a.setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            a.getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> { android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()); v.setPadding(i.left,i.top,i.right,i.bottom); return insets; });
            root.requestApplyInsets();
        } else { root.setFitsSystemWindows(true); }
    }
}
