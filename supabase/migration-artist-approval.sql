-- ============================================================
-- Migration: mashup-artist accounts now require admin approval
-- Run ONCE in Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run.
--
-- What it does:
--  * Adds profiles.artist_status ('none' | 'pending' | 'approved'). Users can
--    request access (none -> pending) but can never self-approve — only the
--    admin can move a row to 'approved' (mirrors protect_admin_flag).
--  * Grandfathers in anyone already marked role = 'artist'.
--  * Re-points the track-submission and storage-upload policies at
--    artist_status = 'approved' instead of the (now purely cosmetic,
--    self-settable) role = 'artist' label — that's the actual security fix,
--    since role alone was never admin-gated.
-- ============================================================

alter table public.profiles
  add column if not exists artist_status text not null default 'none'
    check (artist_status in ('none', 'pending', 'approved'));

update public.profiles set artist_status = 'approved' where role = 'artist' and artist_status <> 'approved';

create or replace function public.protect_artist_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.artist_status is distinct from old.artist_status
     and auth.uid() is not null
     and not public.is_admin() then
    if new.artist_status = 'pending' and old.artist_status = 'none' then
      -- allowed: requesting artist access
    else
      new.artist_status := old.artist_status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_artist_status on public.profiles;
create trigger profiles_protect_artist_status
  before update on public.profiles
  for each row execute function public.protect_artist_status();

drop policy if exists "artists insert own pending tracks" on public.tracks;
drop policy if exists "approved artists insert own pending tracks" on public.tracks;
create policy "approved artists insert own pending tracks"
  on public.tracks for insert to authenticated
  with check (
    owner = auth.uid()
    and (
      public.is_admin()
      or (
        status = 'pending'
        and (select artist_status from public.profiles where id = auth.uid()) = 'approved'
      )
    )
  );

drop policy if exists "artists upload own files" on storage.objects;
drop policy if exists "approved artists upload own files" on storage.objects;
create policy "approved artists upload own files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mashups'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (select artist_status from public.profiles where id = auth.uid()) = 'approved'
  );
