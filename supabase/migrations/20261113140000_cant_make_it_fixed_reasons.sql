-- TRAK-249 (Imad, 21 Oct; list confirmed 13 Nov): Can't make it takes a fixed reason or none, never free text. The
-- 19 Oct live run showed families typing health reasons ("stomach ache", "the flu") despite the warning, and the Greek
-- legal pack v1.2 says there is no free-text reason. No health option: "ill" would still be health data.
-- Stored as a key (school, family, travel, other); the app shows its word. The table refuses anything else, whoever
-- writes, and report_cant_make_it says why in words a screen can show.

-- Before the rule: prod holds 6 free-text reasons, all on past rehearsal events (no real families yet). They go; the
-- absence itself stays.
UPDATE public.event_absences SET reason = NULL
WHERE reason IS NOT NULL AND reason NOT IN ('school', 'family', 'travel', 'other');

ALTER TABLE public.event_absences DROP CONSTRAINT event_absences_reason_check;
ALTER TABLE public.event_absences ADD CONSTRAINT event_absences_reason_check
  CHECK (reason IS NULL OR reason IN ('school', 'family', 'travel', 'other'));

CREATE OR REPLACE FUNCTION public.report_cant_make_it(p_event_id uuid, p_child uuid, p_reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_reason text := nullif(btrim(p_reason), '');
  v_squad_player uuid;
BEGIN
  IF v_reason IS NOT NULL AND v_reason NOT IN ('school', 'family', 'travel', 'other') THEN
    RAISE EXCEPTION 'Choose a reason from the list, or none' USING ERRCODE = '22023';
  END IF;
  v_squad_player := trak_private.absence_target(p_event_id, p_child);
  INSERT INTO public.event_absences (event_id, squad_player_id, reported_by, reason)
  VALUES (p_event_id, v_squad_player, auth.uid(), v_reason)
  ON CONFLICT (event_id, squad_player_id) DO UPDATE
    SET reason = EXCLUDED.reason, reported_by = EXCLUDED.reported_by, reported_at = now();
END;
$function$;
