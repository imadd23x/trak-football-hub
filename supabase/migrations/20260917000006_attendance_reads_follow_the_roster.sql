-- ============================================================
-- F4 from the K1/K2 departure audit
-- (docs/reviews/k1-k2-departure.md, Imad/Codex, 18 Sept).
--
-- session_attendance has four coach policies, all originally checking one
-- thing: that the session belongs to the caller.
--
--   EXISTS (SELECT 1 FROM coach_sessions cs
--           WHERE cs.id = session_id AND cs.coach_user_id = auth.uid())
--
-- 20260917000001 rewrote INSERT and UPDATE to also prove ownership of the
-- roster row being written. It did not touch SELECT or DELETE. So after
-- removal a coach still reads attendance for the academy's children, and can
-- still delete it — the audit reproduced exactly that.
--
-- ── A correction to a deployed migration ────────────────────
--
-- 20260917000002 states, in the comment explaining why coach_sessions and
-- coach_calendar_events are NOT gated on departure:
--
--   "session_attendance — the table that joins a session to a roster row —
--    is already routed through squad_player_is_mine() by 20260917000001, so
--    the attendance rows go dark on departure while the session title does
--    not."
--
-- That is true for INSERT and UPDATE and false for SELECT and DELETE, which
-- neither migration changed. The claim was then used to justify leaving the
-- session diary ungated, so a wrong statement carried a decision. Migrations
-- are immutable once applied and that comment cannot be edited, so the
-- correction is recorded here: until this migration, attendance did not go
-- dark on departure. After it, it does — and the reasoning that comment gave
-- for leaving coach_sessions alone is sound again, but it was not sound when
-- it was written.
--
-- ── What changes ────────────────────────────────────────────
--
-- SELECT and DELETE now require the roster row as well as the session, via
-- the same squad_player_is_mine() every other coach write uses. A coach who
-- has left keeps their own session records and loses the children in them.
--
-- A player the coach released while still at the academy is unaffected:
-- squad_player_is_mine() excludes 'coach_departed' only, so 'released' and
-- 'archived' rows stay readable by the coach who still holds them. Losing
-- historical attendance for a player who simply left the squad would be a
-- regression, and this avoids it.
-- ============================================================

DROP POLICY IF EXISTS "Coaches can select attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can select attendance for own sessions"
  ON public.session_attendance FOR SELECT TO authenticated
  USING (
    public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
  );

DROP POLICY IF EXISTS "Coaches can delete attendance for own sessions" ON public.session_attendance;
CREATE POLICY "Coaches can delete attendance for own sessions"
  ON public.session_attendance FOR DELETE TO authenticated
  USING (
    public.coach_session_is_mine(session_id)
    AND public.squad_player_is_mine(squad_player_id)
  );
