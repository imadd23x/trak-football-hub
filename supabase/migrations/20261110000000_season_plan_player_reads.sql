-- TRAK-396 (Season plan 18/18 build 1/8, spec TRAK-366): what players and guardians read of the season plan. Read-only;
-- no screen uses it yet (builds 2 to 7 do). This is the privacy line for all of them.
--
-- Share is a promise (Tarek, 9 Nov): a player and their family read what the coach last SHARED, never the working
-- copy. The coach's edits save straight into season_plans, season_objectives and player_objectives, and the evaluation
-- also changes player_objectives (Met), so reading those rows would leak every unshared edit and drop a player's plan
-- whenever one is waiting. Share therefore stamps what it shared, as TRAK-356 foresaw ("a copy per share"):
--   season_plans.shared_*           the season's dates and the evaluation rhythm as last shared;
--   season_objectives.shared_*      a season objective's words as last shared (null: not shared yet);
--   player_objectives.shared_at     when an objective was first shared (null: not shared yet).
-- A player's position, Can also play and roles are not on Share's list (TRAK-356), so they are read as they are.
-- Published evaluations are read as published: progress needs no Share.
--
-- Nothing here is a table policy. Players and guardians read through two functions that return only these words:
-- season_plan_for_player() and, to clear "New", mark_season_plan_seen(). The function checks who the caller is (the
-- child, or a guardian linked to the child), that consent is in place, that the academy's season_plan switch is on, that
-- the plan is shared and that the player has a shared objective still standing. Anyone else gets no rows, and no error
-- that says why. The evaluation note (coach_shared_feedback) is not read here and stays the player's alone.
--
-- "New": season_plan_player_shares says when a Share last changed something for a player (everything at the first
-- share or when a squad-wide part changed, otherwise the players whose objectives changed); season_plan_seen says when
-- a player or guardian last opened it. Neither is a sign-off. No role has a grant on either: the coach never reads who
-- opened it, and nothing in Trak shows who tapped Got it.

-- ── What Share shared ──────────────────────────────────────────────────────
ALTER TABLE public.season_plans
  ADD COLUMN shared_starts_on date,
  ADD COLUMN shared_ends_on date,
  ADD COLUMN shared_eval_every text CHECK (shared_eval_every IN ('2w', 'month', '6w')),
  ADD COLUMN shared_eval_day smallint CHECK (shared_eval_day BETWEEN 0 AND 6);
ALTER TABLE public.season_objectives
  ADD COLUMN shared_title text,
  ADD COLUMN shared_looks_like text,
  ADD CONSTRAINT season_objectives_shared_together CHECK ((shared_title IS NULL) = (shared_looks_like IS NULL));
ALTER TABLE public.player_objectives
  ADD COLUMN shared_at timestamptz;

-- TRAK-356's and TRAK-364's rule, plus the new columns: only Share writes what was shared. (Triggers don't hold back
-- Trak's own functions, which run as the table owner.)
CREATE OR REPLACE FUNCTION trak_private.season_plan_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon') THEN
  IF TG_OP = 'INSERT' THEN
   IF NEW.shared_at IS NOT NULL OR NEW.last_shared_at IS NOT NULL OR NEW.unshared_parts <> '{}' OR NEW.unshared_players <> '{}'
     OR NEW.shared_starts_on IS NOT NULL OR NEW.shared_ends_on IS NOT NULL
     OR NEW.shared_eval_every IS NOT NULL OR NEW.shared_eval_day IS NOT NULL THEN
    RAISE EXCEPTION 'A season plan starts as a draft' USING ERRCODE = '42501';
   END IF;
  ELSIF NEW.coach_user_id IS DISTINCT FROM OLD.coach_user_id OR NEW.squad IS DISTINCT FROM OLD.squad
    OR NEW.shared_at IS DISTINCT FROM OLD.shared_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.last_shared_at IS DISTINCT FROM OLD.last_shared_at OR NEW.unshared_parts IS DISTINCT FROM OLD.unshared_parts
    OR NEW.unshared_players IS DISTINCT FROM OLD.unshared_players
    OR NEW.shared_starts_on IS DISTINCT FROM OLD.shared_starts_on OR NEW.shared_ends_on IS DISTINCT FROM OLD.shared_ends_on
    OR NEW.shared_eval_every IS DISTINCT FROM OLD.shared_eval_every OR NEW.shared_eval_day IS DISTINCT FROM OLD.shared_eval_day THEN
   RAISE EXCEPTION 'Only a season plan''s dates change' USING ERRCODE = '42501';
  END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.shared_at IS NOT NULL
   AND (NEW.starts_on IS DISTINCT FROM OLD.starts_on OR NEW.ends_on IS DISTINCT FROM OLD.ends_on)
   AND NOT 'dates' = ANY (NEW.unshared_parts) THEN
  NEW.unshared_parts := array_append(NEW.unshared_parts, 'dates');
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.shared_at IS NOT NULL
   AND (NEW.eval_every IS DISTINCT FROM OLD.eval_every OR NEW.eval_day IS DISTINCT FROM OLD.eval_day)
   AND NOT 'evaluation' = ANY (NEW.unshared_parts) THEN
  NEW.unshared_parts := array_append(NEW.unshared_parts, 'evaluation');
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trak_private.season_objective_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.status <> 'open' OR NEW.retired_at IS NOT NULL OR NEW.shared_title IS NOT NULL OR NEW.shared_looks_like IS NOT NULL THEN
   RAISE EXCEPTION 'A season objective starts open and unshared' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.place IS DISTINCT FROM OLD.place THEN
  RAISE EXCEPTION 'A season objective keeps its plan and its place' USING ERRCODE = '42501';
 END IF;
 IF NEW.shared_title IS DISTINCT FROM OLD.shared_title OR NEW.shared_looks_like IS DISTINCT FROM OLD.shared_looks_like THEN
  RAISE EXCEPTION 'Only sharing the plan shares an objective' USING ERRCODE = '42501';
 END IF;
 IF OLD.status = 'retired' THEN
  RAISE EXCEPTION 'A removed season objective is kept as it was' USING ERRCODE = '42501';
 END IF;
 IF NEW.status = 'retired' THEN
  IF NOT EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = NEW.plan_id AND p.shared_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Until the plan is shared, delete the objective instead' USING ERRCODE = '22023';
  END IF;
  NEW.retired_at := now();
 ELSIF NEW.retired_at IS NOT NULL THEN
  RAISE EXCEPTION 'Only a removed season objective has a removal date' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;

-- ── "New" ──────────────────────────────────────────────────────────────────
-- Both stamps use clock_timestamp(), so "changed after seen" is strictly ordered even inside one transaction.
-- No policy and no grant: only the functions below, which run as Trak, read or write these.
CREATE TABLE public.season_plan_player_shares (
  squad_player_id uuid PRIMARY KEY REFERENCES public.squad_players(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL
);
CREATE TABLE public.season_plan_seen (
  viewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL REFERENCES public.squad_players(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_user_id, squad_player_id)
);
CREATE INDEX season_plan_seen_squad_player_idx ON public.season_plan_seen (squad_player_id);
ALTER TABLE public.season_plan_player_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_plan_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_plan_player_shares, public.season_plan_seen FROM PUBLIC, anon, authenticated;

-- ── Share, with the copy ───────────────────────────────────────────────────
-- As 20261106100000_season_plan_share.sql wrote it, plus: it stamps the words it shared, and the players it changed
-- something for, before it clears what was waiting. Order matters: stamping a player's objective is itself a change
-- that note_player_objective_change() would list as waiting, so the lists are cleared last.
CREATE OR REPLACE FUNCTION public.share_season_plan(p_plan_id uuid, p_talked boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_plan public.season_plans%ROWTYPE;
BEGIN
 -- Locks the plan, so two shares run one after the other.
 SELECT * INTO v_plan FROM public.season_plans p WHERE p.id = p_plan_id AND p.coach_user_id = (SELECT auth.uid()) FOR UPDATE;
 IF NOT FOUND OR NOT public.is_coach() OR NOT trak_private.coaches_squad(v_plan.squad) THEN
  RAISE EXCEPTION 'This season plan isn''t one of yours' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF v_plan.starts_on IS NULL OR v_plan.ends_on IS NULL THEN
  RAISE EXCEPTION 'Add the season''s dates first' USING ERRCODE = 'P0001';
 END IF;
 IF v_plan.shared_at IS NULL AND p_talked IS NOT TRUE AND (
     EXISTS (SELECT 1 FROM public.season_objectives so WHERE so.plan_id = v_plan.id AND so.status = 'open')
     OR EXISTS (SELECT 1 FROM public.player_objectives po JOIN public.squad_players sp ON sp.id = po.squad_player_id
       WHERE po.status = 'open' AND sp.coach_user_id = v_plan.coach_user_id AND btrim(sp.age_group) = v_plan.squad
         AND sp.status IS DISTINCT FROM 'coach_departed')) THEN
  RAISE EXCEPTION 'Talk the objectives through with the players, face to face, before you share them' USING ERRCODE = 'P0001';
 END IF;

 -- Who this share changes something for: everyone with objectives at the first share or when a squad-wide part
 -- (dates, season objectives, evaluation) changed, otherwise the players whose objectives changed.
 INSERT INTO public.season_plan_player_shares (squad_player_id, changed_at)
  SELECT sp.id, clock_timestamp() FROM public.squad_players sp
  WHERE sp.coach_user_id = v_plan.coach_user_id AND btrim(sp.age_group) = v_plan.squad
    AND sp.status IS DISTINCT FROM 'coach_departed'
    AND EXISTS (SELECT 1 FROM public.player_objectives po WHERE po.squad_player_id = sp.id AND po.status = 'open')
    AND (v_plan.shared_at IS NULL OR v_plan.unshared_parts <> '{}' OR sp.id = ANY (v_plan.unshared_players))
 ON CONFLICT (squad_player_id) DO UPDATE SET changed_at = EXCLUDED.changed_at;
 -- The words as they are now. A season objective's own update is not a change to list (the trigger returns early).
 UPDATE public.season_objectives so SET shared_title = so.title, shared_looks_like = so.looks_like
  WHERE so.plan_id = v_plan.id AND so.status = 'open'
    AND (so.shared_title IS DISTINCT FROM so.title OR so.shared_looks_like IS DISTINCT FROM so.looks_like);
 UPDATE public.player_objectives po SET shared_at = now()
  FROM public.squad_players sp
  WHERE po.squad_player_id = sp.id AND sp.coach_user_id = v_plan.coach_user_id AND btrim(sp.age_group) = v_plan.squad
    AND po.status = 'open' AND po.shared_at IS NULL;

 UPDATE public.season_plans p SET shared_at = coalesce(p.shared_at, now()), last_shared_at = now(),
   unshared_parts = '{}', unshared_players = '{}',
   shared_starts_on = p.starts_on, shared_ends_on = p.ends_on, shared_eval_every = p.eval_every, shared_eval_day = p.eval_day
  WHERE p.id = v_plan.id;
 RETURN now();
END $$;
REVOKE ALL ON FUNCTION public.share_season_plan(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.share_season_plan(uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.share_season_plan(uuid, boolean) IS
  'TRAK-356, TRAK-396: shares a season plan (the first time, or its changes) and stamps what players and families read. Checks the coach, the squad, the season_plan switch, the dates and, at the first share, the face-to-face talk.';

-- Plans already shared (Rehearsal FC's, the only academy with the switch on) read what they hold now, except what
-- the plan lists as waiting: those stay hidden until the coach shares them. The trigger that lists a player's changes
-- would list every player here, so it sits out this one statement.
ALTER TABLE public.player_objectives DISABLE TRIGGER player_objectives_note_change;
UPDATE public.season_plans SET shared_starts_on = starts_on, shared_ends_on = ends_on,
  shared_eval_every = eval_every, shared_eval_day = eval_day
 WHERE shared_at IS NOT NULL;
UPDATE public.season_objectives so SET shared_title = so.title, shared_looks_like = so.looks_like
 FROM public.season_plans pl
 WHERE pl.id = so.plan_id AND pl.shared_at IS NOT NULL AND so.status = 'open' AND NOT 'season_objectives' = ANY (pl.unshared_parts);
UPDATE public.player_objectives po SET shared_at = coalesce(pl.last_shared_at, pl.shared_at)
 FROM public.squad_players sp
 JOIN public.season_plans pl ON pl.coach_user_id = sp.coach_user_id AND pl.squad = btrim(sp.age_group)
 WHERE po.squad_player_id = sp.id AND pl.shared_at IS NOT NULL AND po.status = 'open' AND NOT sp.id = ANY (pl.unshared_players);
ALTER TABLE public.player_objectives ENABLE TRIGGER player_objectives_note_change;
INSERT INTO public.season_plan_player_shares (squad_player_id, changed_at)
 SELECT po.squad_player_id, max(po.shared_at) FROM public.player_objectives po WHERE po.shared_at IS NOT NULL GROUP BY po.squad_player_id;

-- ── Who may read which plan ────────────────────────────────────────────────
-- The squad rows (and their shared plan) the caller reads: their own, or a child's they are a linked guardian of.
-- Consent in place (the rule family reads follow), the academy's season_plan switch on, the player still on the coach's
-- roster, the plan shared, and at least one shared objective still standing: a player the coach hasn't shared, or whose
-- shared objectives were all removed, has no plan to read. p_child narrows it to one child.
CREATE FUNCTION trak_private.readable_season_plans(p_child uuid)
RETURNS TABLE (squad_player_id uuid, plan_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT sp.id, pl.id
  FROM public.squad_players sp
  JOIN public.season_plans pl ON pl.coach_user_id = sp.coach_user_id AND pl.squad = btrim(sp.age_group)
  WHERE sp.linked_player_id IS NOT NULL
    AND (p_child IS NULL OR sp.linked_player_id = p_child)
    AND (sp.linked_player_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.player_parent_links l
              WHERE l.player_user_id = sp.linked_player_id AND l.parent_user_id = (SELECT auth.uid())))
    AND sp.status IS DISTINCT FROM 'coach_departed'
    AND pl.shared_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.academy_features f WHERE f.organization_id = sp.organization_id AND f.feature = 'season_plan')
    AND NOT public.player_consent_required(sp.linked_player_id)
    AND EXISTS (SELECT 1 FROM public.player_objectives po
         WHERE po.squad_player_id = sp.id AND po.shared_at IS NOT NULL AND po.status <> 'retired');
$$;
-- Called only by the two functions below, which run as Trak: no caller needs to execute it.
REVOKE ALL ON FUNCTION trak_private.readable_season_plans(uuid) FROM PUBLIC, anon, authenticated;

-- What a player and their guardians read of the season plan, one row per squad the child is in with a shared plan.
--   squad objectives   [{id, place, title, looks_like}], the words as last shared; no counts, no Good/Watch/At risk.
--   objectives         [{id, slot, title, status open|met, current, supports, history}] for the shared objectives not
--                      removed. current is the latest published evaluation's word (not_yet, some_progress, on_track,
--                      met), null before the first; history is [{due_on, status}] for each published evaluation.
--                      supports is a shared season objective's id, or null.
--   dates and rhythm   as last shared, with the academy's time zone and the last evaluation's date, from which the app
--                      works out the next one (src/lib/evaluation.ts).
--   position, also_plays, roles   as the coach has them now (not on Share's list).
--   is_new             something changed for this child at a Share since the caller last opened it.
CREATE FUNCTION public.season_plan_for_player(p_child uuid DEFAULT NULL)
RETURNS TABLE (
  squad_player_id uuid, squad text, coach_name text, time_zone text,
  starts_on date, ends_on date, eval_every text, eval_day smallint, last_evaluation_on date,
  "position" text, also_plays text[], roles text[],
  season_objectives jsonb, objectives jsonb,
  is_new boolean, shared_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT sp.id, btrim(sp.age_group), coalesce(btrim(pr.full_name), ''), trak_private.academy_time_zone(sp.organization_id),
    pl.shared_starts_on, pl.shared_ends_on, pl.shared_eval_every, pl.shared_eval_day,
    (SELECT max(ev.due_on) FROM public.season_evaluations ev WHERE ev.plan_id = pl.id),
    sp.position,
    coalesce((SELECT array_agg(a.position ORDER BY a.added_at, a.position) FROM public.squad_player_also_plays a
      WHERE a.squad_player_id = sp.id), '{}'),
    coalesce((SELECT array_agg(r.role ORDER BY r.added_at, r.role) FROM public.squad_player_roles r
      WHERE r.squad_player_id = sp.id), '{}'),
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', so.id, 'place', so.place, 'title', so.shared_title,
        'looks_like', so.shared_looks_like) ORDER BY so.place)
      FROM public.season_objectives so
      WHERE so.plan_id = pl.id AND so.status = 'open' AND so.shared_title IS NOT NULL), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', po.id, 'slot', po.slot, 'title', po.title, 'status', po.status,
        'current', (SELECT p1.status FROM public.objective_progress p1 JOIN public.season_evaluations e1 ON e1.id = p1.evaluation_id
          WHERE p1.player_objective_id = po.id ORDER BY e1.due_on DESC LIMIT 1),
        'supports', (SELECT s1.id FROM public.season_objectives s1
          WHERE s1.id = po.season_objective_id AND s1.status = 'open' AND s1.shared_title IS NOT NULL),
        'history', coalesce((SELECT jsonb_agg(jsonb_build_object('due_on', e2.due_on, 'status', p2.status) ORDER BY e2.due_on)
          FROM public.objective_progress p2 JOIN public.season_evaluations e2 ON e2.id = p2.evaluation_id
          WHERE p2.player_objective_id = po.id), '[]'::jsonb))
      ORDER BY (po.status = 'met'), po.slot, po.created_at)
      FROM public.player_objectives po
      WHERE po.squad_player_id = sp.id AND po.shared_at IS NOT NULL AND po.status <> 'retired'), '[]'::jsonb),
    coalesce(stamp.changed_at > seen.seen_at, stamp.changed_at IS NOT NULL AND seen.seen_at IS NULL, false),
    pl.last_shared_at
  FROM trak_private.readable_season_plans(p_child) r
  JOIN public.squad_players sp ON sp.id = r.squad_player_id
  JOIN public.season_plans pl ON pl.id = r.plan_id
  LEFT JOIN public.profiles pr ON pr.user_id = pl.coach_user_id
  LEFT JOIN public.season_plan_player_shares stamp ON stamp.squad_player_id = sp.id
  LEFT JOIN public.season_plan_seen seen ON seen.squad_player_id = sp.id AND seen.viewer_user_id = (SELECT auth.uid())
  ORDER BY sp.created_at, sp.id;
$$;
REVOKE ALL ON FUNCTION public.season_plan_for_player(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.season_plan_for_player(uuid) TO authenticated;
COMMENT ON FUNCTION public.season_plan_for_player(uuid) IS
  'TRAK-396: the season plan as last shared, for the caller (a child) or a child they are a linked guardian of. No rows for anyone else, an unshared player, a child without consent or an academy with the switch off. Never the evaluation note.';

-- Opening the page, or the player's Got it: the caller has seen what they can read. Not a sign-off, and nobody reads it.
CREATE FUNCTION public.mark_season_plan_seen(p_child uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.season_plan_seen (viewer_user_id, squad_player_id, seen_at)
  SELECT (SELECT auth.uid()), r.squad_player_id, clock_timestamp() FROM trak_private.readable_season_plans(p_child) r
  ON CONFLICT (viewer_user_id, squad_player_id) DO UPDATE SET seen_at = EXCLUDED.seen_at;
$$;
REVOKE ALL ON FUNCTION public.mark_season_plan_seen(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_season_plan_seen(uuid) TO authenticated;
COMMENT ON FUNCTION public.mark_season_plan_seen(uuid) IS
  'TRAK-396: the caller has opened the season plan they can read, so it is no longer New for them. Private to the caller.';
