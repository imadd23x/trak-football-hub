-- TRAK-387 (Drill Library 3/11, parent TRAK-384): a clean start for the new Library (Kostas, 8 Nov). No coach-made
-- drills for the pilot: the Drills tab now shows Trak's Library, and the hand-written drills and the plans that used
-- them go. Checked on production 8 Nov: the training switch is on for Rehearsal FC only; 3 hand-written drills (one
-- coach); 5 saved plans used one (23 practices, 6 of them hand-written), which is every saved plan there; no drafts.
--
-- A plan that used a hand-written drill goes whole, so its training is "Not planned" again; its register and its
-- after-training notes are other tables and stay. A practice written straight into a plan ('own') counts as
-- hand-written, as one from My drills ('drill') does. A draft holding either goes too.
--
-- The coach_drills table stays, empty, for coach-made drills later (a founders' decision). Nothing here is reversible;
-- the rows were synthetic rehearsal data.

DELETE FROM public.training_plans p
WHERE EXISTS (
  SELECT 1 FROM public.training_plan_practices x
  WHERE x.event_id = p.event_id AND x.source IN ('own', 'drill')
);

DELETE FROM public.training_plan_drafts d
WHERE jsonb_path_exists(d.body, '$.parts[*].drill.source ? (@ == "own" || @ == "drill")');

DELETE FROM public.coach_drills;
