package com.forgeboard.notes.core;

/** Replaces partial hypotheses; appends each completed speech segment only once. */
public final class SpeechTranscript {
    private String finished,partial="";
    private boolean finalized;
    public SpeechTranscript(String saved){finished=saved==null?"":saved.trim();}
    public void beginSegment(){partial="";finalized=false;}
    public String partial(String text){if(!finalized)partial=clean(text);return text();}
    public String finish(String text){if(!finalized){String finalText=clean(text);if(finalText.isEmpty())finalText=partial;if(!finalText.isEmpty())finished=join(finished,finalText);partial="";finalized=true;}return text();}
    public String text(){return join(finished,partial);}
    private static String clean(String text){return text==null?"":text.trim();}
    private static String join(String a,String b){return a.isEmpty()?b:b.isEmpty()?a:a+"\n"+b;}
}
