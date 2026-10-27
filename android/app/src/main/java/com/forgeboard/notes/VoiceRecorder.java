package com.forgeboard.notes;

interface VoiceRecorder {
    interface Listener { void text(String text); void stopped(String text); void failed(String message,String savedText); }
    interface Factory { VoiceRecorder create(android.content.Context context,String saved,Listener listener); }
    void start();
    void stop();
    void cancel();
    default boolean needsPermission(){return true;}
}
