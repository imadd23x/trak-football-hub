-- TRAK-390 (Drill Library 5/11, parent TRAK-384): bookmarks. My drills is the Library drills a coach bookmarked
-- (Kostas, 8 Nov); a coach can't change a Trak drill, only keep it. One row per coach and drill. The drill is the
-- Library's id (`lib-…`, in the app, src/lib/training/library/drills.ts), so a drill renamed later keeps its bookmark.
--
-- Only the coach reads or writes their own bookmarks; no player, guardian, other coach or academy admin. Writes also
-- need the academy's training switch on, as restrictive rules, as My drills' were. Reads don't need the switch, so
-- switching Training off keeps them. There's nothing to change in a bookmark: it's added or taken out.

CREATE TABLE public.coach_drill_bookmarks (
  coach_user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  drill text NOT NULL CHECK (char_length(drill) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coach_user_id, drill)
);

ALTER TABLE public.coach_drill_bookmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.coach_drill_bookmarks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.coach_drill_bookmarks TO authenticated;

CREATE POLICY "Coaches read their own bookmarks" ON public.coach_drill_bookmarks
  FOR SELECT TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));
CREATE POLICY "Coaches add their own bookmarks" ON public.coach_drill_bookmarks
  FOR INSERT TO authenticated
  WITH CHECK (coach_user_id = (SELECT auth.uid()) AND public.is_coach());
CREATE POLICY "Coaches take out their own bookmarks" ON public.coach_drill_bookmarks
  FOR DELETE TO authenticated
  USING (coach_user_id = (SELECT auth.uid()));

-- Restrictive: no stray grant or permissive rule can open writes for an academy that is off.
CREATE POLICY "Training switch gates bookmark inserts" ON public.coach_drill_bookmarks
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_coach() AND (SELECT public.feature_on('training')));
CREATE POLICY "Training switch gates bookmark deletes" ON public.coach_drill_bookmarks
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.is_coach() AND (SELECT public.feature_on('training')));
