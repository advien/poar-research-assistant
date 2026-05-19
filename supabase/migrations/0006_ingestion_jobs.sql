-- =============================================================================
-- POAR - background-style ingestion: extended status enum + retry / progress
--
-- The MVP shipped with statuses: pending | parsing | embedding | ready | failed.
-- Production ingestion needs two more terminal-ish states for retries and the
-- distinct summary stage:
--   - summarizing  : chunks are persisted, summary is being written
--   - retrying     : last attempt failed transiently; another attempt is
--                    scheduled or in progress
--
-- We also add lightweight bookkeeping columns so the UI can show the live
-- progress of a long ingestion without polling the worker:
--   - ingest_attempts        : monotonically increasing per-paper retry counter
--   - ingest_started_at      : when the most recent attempt started
--   - ingest_finished_at     : when the paper reached a terminal state (ready
--                              or failed). null while in progress.
--   - ingest_progress_pct    : 0..100, advisory only (set per-stage)
--
-- This migration is idempotent: dropping the old CHECK and re-adding the
-- broader one is safe; the column adds use IF NOT EXISTS.
-- =============================================================================

-- 1. Extend the status enum (constraint, not a real enum type).
alter table public.papers
  drop constraint if exists papers_status_check;

alter table public.papers
  add constraint papers_status_check
  check (status in (
    'pending',
    'parsing',
    'embedding',
    'summarizing',
    'ready',
    'failed',
    'retrying'
  ));

-- 2. Bookkeeping columns.
alter table public.papers
  add column if not exists ingest_attempts     int         not null default 0,
  add column if not exists ingest_started_at   timestamptz,
  add column if not exists ingest_finished_at  timestamptz,
  add column if not exists ingest_progress_pct int         not null default 0
    check (ingest_progress_pct between 0 and 100);

-- 3. Index to find papers stuck in non-terminal states (a future worker would
--    poll this view to reap orphans / time out long-running attempts).
create index if not exists papers_status_progress_idx
  on public.papers (status, updated_at)
  where status in ('pending','parsing','embedding','summarizing','retrying');

-- 4. Trigger: stamp ingest_started_at when status transitions OUT OF
--    pending|ready|failed (i.e. a new attempt begins) and ingest_finished_at
--    when the row reaches ready|failed.
create or replace function public.touch_ingest_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('parsing','retrying') and (old.status in ('pending','ready','failed') or old.status is null) then
      new.ingest_started_at := now();
      new.ingest_attempts := coalesce(old.ingest_attempts, 0) + 1;
    end if;
    if new.status in ('ready','failed') then
      new.ingest_finished_at := now();
      if new.status = 'ready' then
        new.ingest_progress_pct := 100;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists papers_touch_ingest_timestamps on public.papers;
create trigger papers_touch_ingest_timestamps
  before update on public.papers
  for each row execute function public.touch_ingest_timestamps();

comment on column public.papers.ingest_attempts is
  'monotonic per-paper attempt counter, incremented by trigger on status->parsing|retrying transitions';
comment on column public.papers.ingest_progress_pct is
  'advisory progress in [0..100]; set per-stage by ingestPaper(); 100 implies status=ready';
