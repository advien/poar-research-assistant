-- =============================================================================
-- POAR - reaper for stranded ingestions
--
-- Even with background ingest handed to waitUntil, a Worker can be evicted
-- mid-job. The paper then stays in a non-terminal status (parsing/embedding/
-- summarizing/retrying/pending) forever, showing a perpetual spinner with no
-- path to `failed` and no way for the user to retry.
--
-- This migration adds a reaper that flips such rows to `failed` once they have
-- made no progress for `stale_minutes`. "Progress" is tracked by papers.updated_at
-- (bumped by the papers_touch_updated_at trigger on every stage write in 0001),
-- so a paper actively moving through stages is never reaped. Complements the
-- papers_status_progress_idx partial index from 0006.
-- =============================================================================

create or replace function public.reap_stuck_ingests(stale_minutes int default 15)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  reaped int;
begin
  update public.papers
     set status = 'failed',
         error  = format('ingestion stalled (no progress for %s min; auto-reaped)', stale_minutes)
   where status in ('pending','parsing','embedding','summarizing','retrying')
     and updated_at < now() - make_interval(mins => stale_minutes);
  get diagnostics reaped = row_count;
  return reaped;
end $$;

comment on function public.reap_stuck_ingests(int) is
  'Marks papers stuck in a non-terminal ingest status (no updated_at progress for stale_minutes) as failed. Scheduled via pg_cron below; where pg_cron is unavailable, call it from an external cron instead.';

-- Least privilege: this is a maintenance mutation, not a user action. Deny the
-- client roles (anon / authenticated); the pg_cron job runs as the function
-- owner regardless. service_role keeps execute so an external cron can call it.
revoke execute on function public.reap_stuck_ingests(int) from public;
grant execute on function public.reap_stuck_ingests(int) to service_role;

-- Best-effort scheduling via pg_cron. Wrapped in a DO block with a catch-all so
-- a project without pg_cron enabled still gets the function (the migration must
-- not fail there) -- those projects can schedule the call externally.
do $$
begin
  create extension if not exists pg_cron;

  -- Idempotent re-run: drop any prior schedule of the same name first.
  if exists (select 1 from cron.job where jobname = 'reap-stuck-ingests') then
    perform cron.unschedule('reap-stuck-ingests');
  end if;

  perform cron.schedule(
    'reap-stuck-ingests',
    '*/10 * * * *',
    $cron$ select public.reap_stuck_ingests(15) $cron$
  );
  raise notice 'reap-stuck-ingests scheduled via pg_cron (every 10 min, 15 min staleness).';
exception
  when others then
    raise notice 'pg_cron unavailable (%): created reap_stuck_ingests() but did not schedule it. Schedule it from an external cron.', sqlerrm;
end $$;
