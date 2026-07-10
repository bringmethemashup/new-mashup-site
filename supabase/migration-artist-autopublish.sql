-- ============================================================
-- Migration: approve the artist, not each track
-- Run ONCE in Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.
--
-- What changes:
--  * An APPROVED mashup artist's own submissions now publish immediately
--    (status = 'approved') instead of landing in a pending review queue.
--    You approve the *person* once (admin.html -> Artist requests); after
--    that everything they add goes live with no per-track click from you.
--  * Your own admin submissions still auto-publish.
--  * Nothing else can self-approve: a non-approved user still can't insert an
--    approved (or pending) row, and the update-time status guard
--    (protect_track_status) is unchanged, so a non-admin owner still can't
--    flip an existing track's status.
--  * The safety valve is removal: admin can delete or unpublish any track
--    (existing "admin or pending-owner deletes tracks" policy + admin.html).
--
-- This only touches the INSERT policy. protect_track_status is an UPDATE-time
-- trigger and does not affect inserts, so it needs no change.
-- ============================================================

drop policy if exists "artists insert own pending tracks" on public.tracks;
drop policy if exists "approved artists insert own pending tracks" on public.tracks;
drop policy if exists "approved artists insert own tracks" on public.tracks;

create policy "approved artists insert own tracks"
  on public.tracks for insert to authenticated
  with check (
    owner = auth.uid()
    and (
      public.is_admin()
      or (
        -- approved artists may publish straight to 'approved' (or 'pending');
        -- gate is artist_status = 'approved', never the cosmetic role label
        status in ('pending', 'approved')
        and (select artist_status from public.profiles where id = auth.uid()) = 'approved'
      )
    )
  );
