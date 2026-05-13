-- Broadcast papers table changes so the /library client can update status
-- badges live (pending -> parsing -> embedding -> ready) without polling.

alter publication supabase_realtime add table public.papers;
