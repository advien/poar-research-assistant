-- =============================================================================
-- POAR Research Assistant - initial schema
-- (prosthetics, orthotics, and assistive / rehabilitation robotics)
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- papers
-- -----------------------------------------------------------------------------
create table public.papers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text,
  authors       text[] default '{}',
  journal       text,
  year          int,
  doi           text,
  abstract      text,
  tags          text[] default '{}',
  storage_path  text not null,
  page_count    int,
  status        text not null default 'pending'
                check (status in ('pending','parsing','embedding','ready','failed')),
  error         text,
  summary       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index papers_user_id_idx on public.papers (user_id);
create index papers_status_idx on public.papers (user_id, status);
create index papers_tags_idx on public.papers using gin (tags);

-- -----------------------------------------------------------------------------
-- chunks
-- -----------------------------------------------------------------------------
create table public.chunks (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid not null references public.papers (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  chunk_index   int  not null,
  page_start    int,
  page_end      int,
  section       text,
  content       text not null,
  tokens        int,
  embedding     extensions.vector(1536),
  tsv           tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  created_at    timestamptz not null default now()
);

create unique index chunks_paper_idx on public.chunks (paper_id, chunk_index);
create index chunks_user_id_idx on public.chunks (user_id);
create index chunks_tsv_idx on public.chunks using gin (tsv);
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- chats
-- -----------------------------------------------------------------------------
create table public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  paper_id    uuid references public.papers (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index chats_user_id_idx on public.chats (user_id, created_at desc);
create index chats_paper_id_idx on public.chats (paper_id);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  citations   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index messages_chat_idx on public.messages (chat_id, created_at);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger papers_touch_updated_at
  before update on public.papers
  for each row execute function public.touch_updated_at();

create trigger chats_touch_updated_at
  before update on public.chats
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.papers   enable row level security;
alter table public.chunks   enable row level security;
alter table public.chats    enable row level security;
alter table public.messages enable row level security;

create policy "papers: owner all" on public.papers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chunks: owner all" on public.chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chats: owner all" on public.chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "messages: owner all" on public.messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- match_chunks RPC (vector retrieval, RLS-aware)
-- -----------------------------------------------------------------------------
create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  match_count     int  default 8,
  filter_paper_id uuid default null
) returns table (
  id          uuid,
  paper_id    uuid,
  chunk_index int,
  page_start  int,
  page_end    int,
  section     text,
  content     text,
  similarity  float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id,
    c.paper_id,
    c.chunk_index,
    c.page_start,
    c.page_end,
    c.section,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.user_id = auth.uid()
    and (filter_paper_id is null or c.paper_id = filter_paper_id)
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

-- -----------------------------------------------------------------------------
-- hybrid_search RPC (vector + full-text rank fusion)
-- -----------------------------------------------------------------------------
create or replace function public.hybrid_search(
  query_text       text,
  query_embedding  extensions.vector(1536),
  match_count      int  default 12,
  filter_paper_id  uuid default null,
  rrf_k            int  default 60
) returns table (
  id          uuid,
  paper_id    uuid,
  chunk_index int,
  page_start  int,
  page_end    int,
  section     text,
  content     text,
  score       float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with vector_hits as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rnk
    from public.chunks c
    where c.user_id = auth.uid()
      and (filter_paper_id is null or c.paper_id = filter_paper_id)
    order by c.embedding <=> query_embedding
    limit match_count * 4
  ),
  fts_hits as (
    select c.id,
           row_number() over (order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc) as rnk
    from public.chunks c
    where c.user_id = auth.uid()
      and (filter_paper_id is null or c.paper_id = filter_paper_id)
      and c.tsv @@ websearch_to_tsquery('english', query_text)
    order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
    limit match_count * 4
  ),
  fused as (
    select id, sum(weight) as score
    from (
      select id, 1.0 / (rrf_k + rnk) as weight from vector_hits
      union all
      select id, 1.0 / (rrf_k + rnk) as weight from fts_hits
    ) s
    group by id
  )
  select c.id,
         c.paper_id,
         c.chunk_index,
         c.page_start,
         c.page_end,
         c.section,
         c.content,
         f.score
  from fused f
  join public.chunks c on c.id = f.id
  order by f.score desc
  limit match_count;
$$;
