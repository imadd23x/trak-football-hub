-- TRAK-364 (Season plan 16/18, spec TRAK-348): the evaluation. Where the season_plan switch is on, a squad's coach
-- evaluates every consented player on the plan's rhythm instead of being reminded one player at a time (TRAK-197). The
-- rhythm is the plan's: every 2 weeks, every month or every 6 weeks, on a day of the week (the last one of the month for
-- "every month"); the app works out the dates from the season's dates, in the academy's time zone
-- (src/lib/evaluation.ts). The session assessment (J5, TRAK-100) stays as it is: an academy without the switch, and a
-- coach who still assesses one player after a session, write exactly what they wrote before.
--
-- Publish writes the assessment records J6 already shows (coach_assessments, the message in coach_shared_feedback),
-- one per player, with no session and published at once, through publish_evaluation() only: the coach, the squad,
-- consent, the switch and the date, all or nothing, so a failed publish writes nothing and the coach keeps what was
-- entered. One evaluation per scheduled date: season_evaluations groups its assessments and says which date it closed.
-- The note to a player is the message (coach_shared_feedback): the player reads it once published, and no family role
-- has ever had a policy on that table, so a guardian never does. Families see the bands as they do now.
--
-- Changing the rhythm after the plan is shared waits under "Not shared yet" as 'evaluation' (evaluation dates), as
-- the season's dates do.

-- ── The rhythm ─────────────────────────────────────────────────────────────
-- eval_day is a day of the week, 0 Sunday to 6 Saturday (JavaScript's getDay()). The mockup's default: every month, on
-- the last Sunday.
ALTER TABLE public.season_plans
  ADD COLUMN eval_every text NOT NULL DEFAULT 'month' CHECK (eval_every IN ('2w', 'month', '6w')),
  ADD COLUMN eval_day smallint NOT NULL DEFAULT 0 CHECK (eval_day BETWEEN 0 AND 6),
  DROP CONSTRAINT season_plans_unshared_parts_check,
  ADD CONSTRAINT season_plans_unshared_parts_check CHECK (unshared_parts <@ ARRAY['dates', 'season_objectives', 'evaluation']::text[]);

-- TRAK-356's rule, as it was, and a new rhythm on a shared plan waits to be shared too.
CREATE OR REPLACE FUNCTION trak_private.season_plan_fixed_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon') THEN
  IF TG_OP = 'INSERT' THEN
   IF NEW.shared_at IS NOT NULL OR NEW.last_shared_at IS NOT NULL OR NEW.unshared_parts <> '{}' OR NEW.unshared_players <> '{}' THEN
    RAISE EXCEPTION 'A season plan starts as a draft' USING ERRCODE = '42501';
   END IF;
  ELSIF NEW.coach_user_id IS DISTINCT FROM OLD.coach_user_id OR NEW.squad IS DISTINCT FROM OLD.squad
    OR NEW.shared_at IS DISTINCT FROM OLD.shared_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.last_shared_at IS DISTINCT FROM OLD.last_shared_at OR NEW.unshared_parts IS DISTINCT FROM OLD.unshared_parts
    OR NEW.unshared_players IS DISTINCT FROM OLD.unshared_players THEN
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

-- ── One evaluation per scheduled date ──────────────────────────────────────
-- due_on is the scheduled date it closes: a missed date stays due, and when several have passed one evaluation closes
-- them all, so the next is due after it. Only the plan's coach reads them; nobody writes one but publish_evaluation().
CREATE TABLE public.season_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.season_plans(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_evaluations_one_per_date UNIQUE (plan_id, due_on)
);
ALTER TABLE public.season_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_evaluations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.season_evaluations TO authenticated;
CREATE POLICY "Coaches read their own evaluations" ON public.season_evaluations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.season_plans p WHERE p.id = season_evaluations.plan_id AND p.coach_user_id = (SELECT auth.uid())));

-- An evaluation's assessments name it. Only publish_evaluation() does: a coach's own write never sets or moves it.
ALTER TABLE public.coach_assessments
  ADD COLUMN evaluation_id uuid REFERENCES public.season_evaluations(id) ON DELETE SET NULL;
CREATE INDEX coach_assessments_evaluation_idx ON public.coach_assessments(evaluation_id) WHERE evaluation_id IS NOT NULL;
COMMENT ON COLUMN public.coach_assessments.evaluation_id IS
  'TRAK-364: the season evaluation this assessment was published in (no session). Set only by publish_evaluation().';

CREATE FUNCTION trak_private.assessment_evaluation_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('authenticated', 'anon')
   AND ((TG_OP = 'INSERT' AND NEW.evaluation_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.evaluation_id IS DISTINCT FROM OLD.evaluation_id)) THEN
  RAISE EXCEPTION 'Only publishing an evaluation puts an assessment in it' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trak_private.assessment_evaluation_fixed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER coach_assessments_evaluation_fixed BEFORE INSERT OR UPDATE ON public.coach_assessments
  FOR EACH ROW EXECUTE FUNCTION trak_private.assessment_evaluation_fixed();

-- ── Publish ────────────────────────────────────────────────────────────────
-- p_players: one object per player, {squad_player_id, work_rate, tactical, attitude, technical, physical, coachability,
-- note}. Six whole ratings from 0 to 10, as the assessment's sliders; the card stats follow them as deriveCardStats()
-- (src/lib/cardStats.ts) works them out. The note is optional, up to 300 characters, as the assessment's message.
-- p_due_on is the scheduled date the app shows as due: not in the future (the academy's day), inside the season, and
-- after the plan's last evaluation. Returns the evaluation and each player's assessment, for J7's count.
CREATE FUNCTION public.publish_evaluation(p_plan_id uuid, p_due_on date, p_players jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_plan public.season_plans%ROWTYPE;
 v_list jsonb := coalesce(p_players, '[]'::jsonb);
 v_today date;
 v_last date;
 v_evaluation uuid;
 v_coach_name text;
 v_item jsonb;
 v_id uuid;
 v_age_group text;
 v_assessment uuid;
 v_note text;
 v_out jsonb := '[]'::jsonb;
BEGIN
 -- Locks the plan, so two publishes run one after the other.
 SELECT * INTO v_plan FROM public.season_plans p WHERE p.id = p_plan_id AND p.coach_user_id = (SELECT auth.uid()) FOR UPDATE;
 IF NOT FOUND OR NOT public.is_coach() OR NOT trak_private.coaches_squad(v_plan.squad) THEN
  RAISE EXCEPTION 'This season plan isn''t one of yours' USING ERRCODE = '42501';
 END IF;
 IF NOT public.feature_on('season_plan') THEN
  RAISE EXCEPTION 'The season plan is switched off for your academy' USING ERRCODE = '42501';
 END IF;
 IF v_plan.shared_at IS NULL OR v_plan.starts_on IS NULL OR v_plan.ends_on IS NULL THEN
  RAISE EXCEPTION 'Share the season plan first: the evaluation follows it' USING ERRCODE = 'P0001';
 END IF;
 v_today := (now() AT TIME ZONE trak_private.academy_time_zone(public.my_coach_organization_id()))::date;
 IF p_due_on IS NULL OR p_due_on > v_today THEN
  RAISE EXCEPTION 'This evaluation isn''t due yet' USING ERRCODE = 'P0001';
 END IF;
 IF p_due_on < v_plan.starts_on OR p_due_on > v_plan.ends_on THEN
  RAISE EXCEPTION 'That evaluation date isn''t in this season' USING ERRCODE = 'P0001';
 END IF;
 SELECT max(e.due_on) INTO v_last FROM public.season_evaluations e WHERE e.plan_id = v_plan.id;
 IF v_last IS NOT NULL AND p_due_on <= v_last THEN
  RAISE EXCEPTION 'This evaluation is already published' USING ERRCODE = 'P0001';
 END IF;

 -- Two checks, not one OR: jsonb_array_length() refuses what isn't an array, and SQL picks its own order.
 IF jsonb_typeof(v_list) <> 'array' THEN
  RAISE EXCEPTION 'An evaluation rates at least one player' USING ERRCODE = '22023';
 END IF;
 IF jsonb_array_length(v_list) = 0 THEN
  RAISE EXCEPTION 'An evaluation rates at least one player' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) e
     WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'squad_player_id') IS DISTINCT FROM 'string'
       OR (e ? 'note' AND jsonb_typeof(e -> 'note') NOT IN ('string', 'null'))
       OR char_length(coalesce(e ->> 'note', '')) > 300
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['work_rate', 'tactical', 'attitude', 'technical', 'physical', 'coachability']) k
         WHERE CASE WHEN jsonb_typeof(e -> k) = 'number'
           THEN NOT ((e ->> k)::numeric BETWEEN 0 AND 10 AND (e ->> k)::numeric % 1 = 0) ELSE true END))
   OR (SELECT count(DISTINCT e ->> 'squad_player_id') FROM jsonb_array_elements(v_list) e) <> jsonb_array_length(v_list) THEN
  RAISE EXCEPTION 'Each player comes once, with six whole ratings from 0 to 10 and a note of up to 300 characters' USING ERRCODE = '22023';
 END IF;

 SELECT nullif(btrim(p.full_name), '') INTO v_coach_name FROM public.profiles p WHERE p.user_id = auth.uid();
 INSERT INTO public.season_evaluations (plan_id, due_on, published_by) VALUES (v_plan.id, p_due_on, auth.uid())
  RETURNING id INTO v_evaluation;
 FOR v_item IN SELECT e FROM jsonb_array_elements(v_list) e LOOP
  v_id := (v_item ->> 'squad_player_id')::uuid;
  IF NOT public.squad_player_is_mine(v_id) THEN
   RAISE EXCEPTION 'Not authorized for this squad player' USING ERRCODE = '42501';
  END IF;
  SELECT btrim(coalesce(sp.age_group, '')) INTO v_age_group FROM public.squad_players sp WHERE sp.id = v_id;
  IF v_age_group IS DISTINCT FROM v_plan.squad THEN
   RAISE EXCEPTION 'A player in this evaluation is in another squad' USING ERRCODE = '22023';
  END IF;
  -- As the assessment's own rules: nothing is recorded about a child waiting for a parent.
  IF trak_private.squad_player_consent_required(v_id) THEN
   RAISE EXCEPTION 'Waiting for consent: nothing is recorded about this player yet' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.coach_assessments (coach_user_id, coach_name_snapshot, squad_player_id, session_id, appearance,
    work_rate, tactical, attitude, technical, physical, coachability,
    consistency, impact, workrate, technique, spirit, published_at, evaluation_id)
  SELECT auth.uid(), v_coach_name, v_id, NULL, NULL,
    r.work_rate, r.tactical, r.attitude, r.technical, r.physical, r.coachability,
    r.attitude, r.technical, r.work_rate, round((r.technical + r.tactical) / 2.0)::integer, round((r.attitude + r.coachability) / 2.0)::integer,
    now(), v_evaluation
  FROM (SELECT (v_item ->> 'work_rate')::integer AS work_rate, (v_item ->> 'tactical')::integer AS tactical,
      (v_item ->> 'attitude')::integer AS attitude, (v_item ->> 'technical')::integer AS technical,
      (v_item ->> 'physical')::integer AS physical, (v_item ->> 'coachability')::integer AS coachability) r
  RETURNING id INTO v_assessment;
  v_note := btrim(coalesce(v_item ->> 'note', ''));
  IF v_note <> '' THEN
   INSERT INTO public.coach_shared_feedback (assessment_id, coach_user_id, body, published_at)
    VALUES (v_assessment, auth.uid(), v_note, now());
  END IF;
  v_out := v_out || jsonb_build_array(jsonb_build_object('squad_player_id', v_id, 'assessment_id', v_assessment));
 END LOOP;
 RETURN jsonb_build_object('evaluation_id', v_evaluation, 'due_on', p_due_on, 'assessments', v_out);
END $$;
REVOKE ALL ON FUNCTION public.publish_evaluation(uuid, date, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_evaluation(uuid, date, jsonb) TO authenticated;
COMMENT ON FUNCTION public.publish_evaluation(uuid, date, jsonb) IS
  'TRAK-364: publishes a season evaluation: one assessment (no session) and its optional message per consented player. Checks the coach, the squad, the season_plan switch, consent and the date; all or nothing.';
