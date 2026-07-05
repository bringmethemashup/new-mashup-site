-- ============================================================
-- Migration: let mashup artists edit their OWN tracks after approval
-- Run ONCE in Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run.
--
-- What it does:
--  * Widens the tracks UPDATE policy so an owner can edit their own track at
--    ANY status (not just while pending) — so an artist can add a YouTube
--    video / fix source songs on an already-approved track later, and it
--    stays live with no re-review.
--  * Adds a guard trigger so a non-admin owner can change their track's DATA
--    but never its STATUS (they can't self-approve a pending/rejected track).
-- ============================================================

drop policy if exists "admin or pending-owner updates tracks" on public.tracks;
drop policy if exists "admin or owner updates tracks" on public.tracks;

create policy "admin or owner updates tracks"
  on public.tracks for update to authenticated
  using (public.is_admin() or owner = auth.uid())
  with check (public.is_admin() or owner = auth.uid());

create or replace function public.protect_track_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and not public.is_admin() then
    new.status := old.status;
  end if;
  return new;
end $$;

drop trigger if exists tracks_protect_status on public.tracks;
create trigger tracks_protect_status
  before update on public.tracks
  for each row execute function public.protect_track_status();
