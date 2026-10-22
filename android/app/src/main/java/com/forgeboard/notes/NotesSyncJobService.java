package com.forgeboard.notes;

import android.app.job.*;
import android.content.ComponentName;
import android.content.Context;

/** Android schedules background work best-effort; explicit refresh is always available. */
public final class NotesSyncJobService extends JobService {
    private static final int PERIODIC=4101, SOON=4102;
    public static void schedulePeriodic(Context c){JobScheduler jobs=c.getSystemService(JobScheduler.class);if(jobs.getPendingJob(PERIODIC)==null)jobs.schedule(new JobInfo.Builder(PERIODIC,new ComponentName(c,NotesSyncJobService.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000).setPersisted(true).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());}
    public static void scheduleSoon(Context c){c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(SOON,new ComponentName(c,NotesSyncJobService.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1200).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());}
    @Override public boolean onStartJob(JobParameters params){NotesRepository repository=NotesRepository.get(this);if(!repository.isConnected())return false;if(repository.isSyncing()){jobFinished(params,true);return false;}repository.sync(error->jobFinished(params,error!=null||repository.hasPendingWrites()));return true;}
    @Override public boolean onStopJob(JobParameters params){return true;}
}
