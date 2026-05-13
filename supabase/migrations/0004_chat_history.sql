-- =============================================================================
-- Chat history & conversation management
-- =============================================================================

-- -----------------------------------------------------------------------------
-- chats: pin, archive, denormalised activity, metadata, title FTS
-- -----------------------------------------------------------------------------
alter table public.chats
  add column if not exists archived         bool        not null default false,
  add column if not exists pinned           bool        not null default false,
  add column if not exists last_message_at  timestamptz,
  add column if not exists message_count    int         not null default 0,
  add column if not exists metadata         jsonb       not null default '{}'::jsonb,
  add column if not exists title_tsv        tsvector
    generated always as (to_tsvector('english', coalesce(title, ''))) stored;

-- -----------------------------------------------------------------------------
-- messages: full-text search column
-- -----------------------------------------------------------------------------
alter table public.messages
  add column if not exists tsv tsvector
    generated always as (to_tsvector('english', coalesce(content, ''))) stored;

-- -----------------------------------------------------------------------------
-- Backfill last_message_at + message_count from existing rows
-- -----------------------------------------------------------------------------
update public.chats c
   set last_message_at = m.last_at,
       message_count   = m.cnt
  from (
    select chat_id, max(created_at) as last_at, count(*) as cnt
    from public.messages
    group by chat_id
  ) m
 where c.id = m.chat_id;

update public.chats
   set last_message_at = created_at
 where last_message_at is null;

-- -----------------------------------------------------------------------------
-- Trigger: keep chats.message_count + last_message_at in sync with messages
-- -----------------------------------------------------------------------------
create or replace function public.bump_chat_on_message()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.chats
       set message_count   = message_count + 1,
           last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
     where id = new.chat_id;
  elsif (tg_op = 'DELETE') then
    update public.chats
       set message_count = greatest(message_count - 1, 0)
     where id = old.chat_id;
  end if;
  return null;
end $$;

drop trigger if exists messages_bump_chat on public.messages;
create trigger messages_bump_chat
  after insert or delete on public.messages
  for each row execute function public.bump_chat_on_message();

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
-- Drop the old plain index; replaced by composite below.
drop index if exists chats_user_id_idx;

-- Sidebar primary query: per-user, filtered by archived flag, ordered by
-- pinned-first then most recent activity.
create index if not exists chats_user_active_idx
  on public.chats (user_id, archived, pinned desc, last_message_at desc nulls last, id desc);

-- Quick lookup of all chats attached to a paper.
create index if not exists chats_user_paper_idx
  on public.chats (user_id, paper_id, last_message_at desc nulls last);

-- Title and message-content full-text indexes for sidebar search.
create index if not exists chats_title_tsv_idx
  on public.chats using gin (title_tsv);

create index if not exists messages_tsv_idx
  on public.messages using gin (tsv);

-- -----------------------------------------------------------------------------
-- search_chats RPC: rank-fused search across titles + message content
-- -----------------------------------------------------------------------------
create or replace function public.search_chats(
  q                 text,
  filter_paper_id   uuid    default null,
  include_archived  boolean default false,
  match_count       int     default 30
) returns table (
  id              uuid,
  paper_id        uuid,
  title           text,
  archived        boolean,
  pinned          boolean,
  message_count   int,
  last_message_at timestamptz,
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
    select websearch_to_tsquery('english', coalesce(q, '')) as q
  ),
  title_hits as (
    select c.id, ts_rank(c.title_tsv, t.q) * 2.0 as rank
    from public.chats c, tsq t
    where c.user_id = auth.uid()
      and (include_archived or c.archived = false)
      and (filter_paper_id is null or c.paper_id = filter_paper_id)
      and c.title_tsv @@ t.q
  ),
  message_hits as (
    select m.chat_id as id, max(ts_rank(m.tsv, t.q)) as rank
    from public.messages m
    join public.chats c on c.id = m.chat_id, tsq t
    where m.user_id = auth.uid()
      and (include_archived or c.archived = false)
      and (filter_paper_id is null or c.paper_id = filter_paper_id)
      and m.tsv @@ t.q
    group by m.chat_id
  ),
  fused as (
    select id, sum(rank) as rank
    from (select * from title_hits union all select * from message_hits) s
    group by id
  )
  select c.id,
         c.paper_id,
         c.title,
         c.archived,
         c.pinned,
         c.message_count,
         c.last_message_at,
         c.created_at,
         c.updated_at,
         f.rank
  from fused f
  join public.chats c on c.id = f.id
  order by c.pinned desc, f.rank desc, c.last_message_at desc nulls last
  limit greatest(1, least(match_count, 100));
$$;
