-- =============================================================================
-- Persistent analyses: structured summaries, terminology, paper comparisons.
-- Each table is versioned; the latest version per scope is "current",
-- older versions are kept so users can revisit/regenerate without losing work.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- paper_summaries
-- -----------------------------------------------------------------------------
create table if not exists public.paper_summaries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  paper_id        uuid not null references public.papers (id) on delete cascade,
  version         int  not null default 1,
  payload         jsonb not null,
  citations       jsonb not null default '[]'::jsonb,
  title           text,
  pinned          bool not null default false,
  archived        bool not null default false,
  model           text,
  prompt_version  text not null default 'v1',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  title_tsv       tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(payload->>'abstract_summary', '') || ' ' ||
      coalesce(payload->>'main_findings', '')
    )
  ) stored,
  unique (user_id, paper_id, version)
);

create index if not exists summaries_user_paper_version_idx
  on public.paper_summaries (user_id, paper_id, version desc);
create index if not exists summaries_user_recent_idx
  on public.paper_summaries (user_id, archived, pinned desc, created_at desc, id desc);
create index if not exists summaries_title_tsv_idx
  on public.paper_summaries using gin (title_tsv);

-- -----------------------------------------------------------------------------
-- paper_terminology
-- -----------------------------------------------------------------------------
create table if not exists public.paper_terminology (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  paper_id        uuid not null references public.papers (id) on delete cascade,
  version         int  not null default 1,
  payload         jsonb not null,                 -- { terms: [...] }
  citations       jsonb not null default '[]'::jsonb,
  term_count      int  not null default 0,
  pinned          bool not null default false,
  archived        bool not null default false,
  model           text,
  prompt_version  text not null default 'v1',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  terms_tsv       tsvector generated always as (
    to_tsvector('english', coalesce(payload->>'__searchable', ''))
  ) stored,
  unique (user_id, paper_id, version)
);

create index if not exists terminology_user_paper_version_idx
  on public.paper_terminology (user_id, paper_id, version desc);
create index if not exists terminology_user_recent_idx
  on public.paper_terminology (user_id, archived, pinned desc, created_at desc, id desc);
create index if not exists terminology_terms_tsv_idx
  on public.paper_terminology using gin (terms_tsv);

-- -----------------------------------------------------------------------------
-- paper_comparisons
-- -----------------------------------------------------------------------------
create table if not exists public.paper_comparisons (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  paper_a_id         uuid not null references public.papers (id) on delete cascade,
  paper_b_id         uuid not null references public.papers (id) on delete cascade,
  version            int  not null default 1,
  payload            jsonb not null,
  citations          jsonb not null default '[]'::jsonb,
  similarity_score   real,
  stronger_paper     text check (stronger_paper in ('a','b','tie','undetermined')),
  contradiction_count int not null default 0,
  title              text,
  pinned             bool not null default false,
  archived           bool not null default false,
  model              text,
  prompt_version     text not null default 'v1',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  title_tsv          tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(payload->>'overall_assessment', '')
    )
  ) stored,
  -- Normalise paper ordering: paper_a_id < paper_b_id always.
  constraint paper_comparisons_ordered_pair check (paper_a_id < paper_b_id),
  unique (user_id, paper_a_id, paper_b_id, version)
);

create index if not exists comparisons_user_pair_version_idx
  on public.paper_comparisons (user_id, paper_a_id, paper_b_id, version desc);
create index if not exists comparisons_user_recent_idx
  on public.paper_comparisons (user_id, archived, pinned desc, created_at desc, id desc);
create index if not exists comparisons_title_tsv_idx
  on public.paper_comparisons using gin (title_tsv);
-- Reverse-direction lookup index for "all comparisons that involve this paper".
create index if not exists comparisons_user_paper_b_idx
  on public.paper_comparisons (user_id, paper_b_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers (re-uses public.touch_updated_at from 0001)
-- -----------------------------------------------------------------------------
create trigger paper_summaries_touch_updated_at
  before update on public.paper_summaries
  for each row execute function public.touch_updated_at();

create trigger paper_terminology_touch_updated_at
  before update on public.paper_terminology
  for each row execute function public.touch_updated_at();

create trigger paper_comparisons_touch_updated_at
  before update on public.paper_comparisons
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.paper_summaries   enable row level security;
alter table public.paper_terminology enable row level security;
alter table public.paper_comparisons enable row level security;

create policy "summaries: owner all"   on public.paper_summaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "terminology: owner all" on public.paper_terminology
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comparisons: owner all" on public.paper_comparisons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Unified history search: union over the three tables, ranked by FTS hit + recency.
-- Returns a row per artifact with kind discriminator. UI fetches details lazily.
-- -----------------------------------------------------------------------------
create or replace function public.search_analyses(
  q                 text,
  filter_kind       text default null,             -- 'summary' | 'terminology' | 'comparison' | null
  filter_paper_id   uuid default null,             -- show only items touching this paper
  include_archived  boolean default false,
  match_count       int default 30
) returns table (
  kind            text,
  id              uuid,
  paper_id        uuid,                            -- summaries/terminology
  paper_a_id      uuid,                            -- comparisons
  paper_b_id      uuid,                            -- comparisons
  title           text,
  version         int,
  pinned          boolean,
  archived        boolean,
  created_at      timestamptz,
  updated_at      timestamptz,
  rank            real
)
language sql
stable
security invoker
set search_path = public
as $$
  with tsq as (
    select case
      when q is null or length(trim(q)) = 0 then null
      else websearch_to_tsquery('english', q)
    end as q
  ),
  s as (
    select 'summary'::text as kind,
           ps.id, ps.paper_id, null::uuid as paper_a_id, null::uuid as paper_b_id,
           ps.title, ps.version, ps.pinned, ps.archived, ps.created_at, ps.updated_at,
           case when (select q from tsq) is null then 0::real
                else ts_rank(ps.title_tsv, (select q from tsq))
           end as rank
    from public.paper_summaries ps, tsq
    where ps.user_id = auth.uid()
      and (include_archived or ps.archived = false)
      and (filter_paper_id is null or ps.paper_id = filter_paper_id)
      and (filter_kind is null or filter_kind = 'summary')
      and (tsq.q is null or ps.title_tsv @@ tsq.q)
  ),
  t as (
    select 'terminology'::text,
           pt.id, pt.paper_id, null::uuid, null::uuid,
           coalesce('Terminology v' || pt.version, 'Terminology'),
           pt.version, pt.pinned, pt.archived, pt.created_at, pt.updated_at,
           case when (select q from tsq) is null then 0::real
                else ts_rank(pt.terms_tsv, (select q from tsq))
           end
    from public.paper_terminology pt, tsq
    where pt.user_id = auth.uid()
      and (include_archived or pt.archived = false)
      and (filter_paper_id is null or pt.paper_id = filter_paper_id)
      and (filter_kind is null or filter_kind = 'terminology')
      and (tsq.q is null or pt.terms_tsv @@ tsq.q)
  ),
  c as (
    select 'comparison'::text,
           pc.id, null::uuid, pc.paper_a_id, pc.paper_b_id,
           pc.title, pc.version, pc.pinned, pc.archived, pc.created_at, pc.updated_at,
           case when (select q from tsq) is null then 0::real
                else ts_rank(pc.title_tsv, (select q from tsq))
           end
    from public.paper_comparisons pc, tsq
    where pc.user_id = auth.uid()
      and (include_archived or pc.archived = false)
      and (filter_paper_id is null
           or pc.paper_a_id = filter_paper_id
           or pc.paper_b_id = filter_paper_id)
      and (filter_kind is null or filter_kind = 'comparison')
      and (tsq.q is null or pc.title_tsv @@ tsq.q)
  )
  select * from (
    select * from s union all
    select * from t union all
    select * from c
  ) all_hits
  order by pinned desc, rank desc, created_at desc
  limit greatest(1, least(match_count, 100));
$$;
