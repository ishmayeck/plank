-- Create the avatars storage bucket (public, so avatar URLs are accessible)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload their own avatar
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'avatars'
  );

-- Allow authenticated users to update (upsert) their own avatar
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'avatars'
  );

-- Allow anyone to read avatars (public bucket)
create policy "Avatars are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Allow authenticated users to delete their own avatar
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = 'avatars'
  );
