-- =============================================================================
-- POAR Research Assistant - storage bucket + policies
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'papers',
  'papers',
  false,
  104857600,                                  -- 100 MB
  array['application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {user_id}/{paper_id}.pdf
-- All four operations restricted to the owning user via the leading folder.

create policy "papers storage: read own"
  on storage.objects for select
  using (
    bucket_id = 'papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "papers storage: insert own"
  on storage.objects for insert
  with check (
    bucket_id = 'papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "papers storage: update own"
  on storage.objects for update
  using (
    bucket_id = 'papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "papers storage: delete own"
  on storage.objects for delete
  using (
    bucket_id = 'papers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
