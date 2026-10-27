package com.forgeboard.notes;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.forgeboard.notes.core.SpeechTranscript;
import java.util.ArrayList;

/** Foreground speech segments continue across pauses until the user's Stop, never on silence. */
final class AndroidVoiceRecorder implements VoiceRecorder,RecognitionListener {
    private final Context context;
    private final Listener listener;
    private final SpeechTranscript transcript;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean closed,stopping,active,onDevice;
    private int errors;
    AndroidVoiceRecorder(Context context,String saved,Listener listener){this.context=context;this.listener=listener;transcript=new SpeechTranscript(saved);}
    @Override public void start(){
        try{
            if(android.os.Build.VERSION.SDK_INT>=31&&SpeechRecognizer.isOnDeviceRecognitionAvailable(context)){recognizer=SpeechRecognizer.createOnDeviceSpeechRecognizer(context);onDevice=true;}
            else if(SpeechRecognizer.isRecognitionAvailable(context))recognizer=SpeechRecognizer.createSpeechRecognizer(context);
            else{fail("No Android speech service is available. Enable a speech recognition service on this phone, then try again.");return;}
            recognizer.setRecognitionListener(this);startSegment();
        }catch(Exception e){fail("Couldn’t start the microphone. Check microphone access and your Android speech service.");}
    }
    private void startSegment(){if(closed||stopping)return;if(context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED){fail("Microphone permission is needed. Your captured words are saved.");return;}try{transcript.beginSegment();active=true;recognizer.startListening(new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1));}catch(Exception e){fail("Speech recognition couldn’t continue. Your captured words are saved.");}}
    @Override public void stop(){if(closed||stopping)return;stopping=true;handler.removeCallbacksAndMessages(null);if(!active){finishStop();return;}try{recognizer.stopListening();handler.postDelayed(this::finishStop,4000);}catch(Exception e){finishStop();}}
    private void finishStop(){if(closed)return;String text=transcript.finish("");release();listener.stopped(text);}
    @Override public void cancel(){release();}
    private void release(){if(closed)return;closed=true;active=false;handler.removeCallbacksAndMessages(null);if(recognizer!=null){recognizer.cancel();recognizer.destroy();recognizer=null;}}
    private void fail(String message){String saved=transcript.finish("");release();listener.failed(message,saved);}
    private String best(Bundle data){ArrayList<String> values=data==null?null:data.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);return values==null||values.isEmpty()?"":values.get(0);}
    @Override public void onPartialResults(Bundle data){if(closed)return;String text=transcript.partial(best(data));listener.text(text);if(text.length()>12000)fail("This recording reached the transcript limit. Your words are saved; shorten or split it before sending.");}
    @Override public void onResults(Bundle data){if(closed)return;active=false;String text=transcript.finish(best(data));listener.text(text);errors=0;if(stopping)finishStop();else handler.postDelayed(this::startSegment,250);}
    @Override public void onError(int error){if(closed)return;active=false;listener.text(transcript.finish(""));if(stopping){finishStop();return;}if(error==SpeechRecognizer.ERROR_NO_MATCH||error==SpeechRecognizer.ERROR_SPEECH_TIMEOUT){handler.postDelayed(this::startSegment,350);return;}if(error==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS){fail("Microphone permission is needed. Allow microphone access for this app, then try again.");return;}if(++errors<=2){handler.postDelayed(this::startSegment,1000);return;}fail("The speech service stopped responding. Your captured words are saved. Try again, or Stop to send what was captured.");}
    @Override public void onReadyForSpeech(Bundle params){}
    @Override public void onBeginningOfSpeech(){}
    @Override public void onRmsChanged(float rmsdB){}
    @Override public void onBufferReceived(byte[] buffer){}
    @Override public void onEndOfSpeech(){}
    @Override public void onEvent(int type,Bundle params){}
}
