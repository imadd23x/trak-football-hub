-- TRAK-125 (J8.2): events belong to the coach's squad and academy; families
-- read them only with active consent (G1, G3, G6).
--
-- Before this, players and parents read a coach's published events with no
-- consent check (a withdrawn child's family still read them), no academy
-- check, and through squad rows the coach had already left. Now a family
-- reads a published event only through a squad row of that coach that is
-- still theirs (not coach_departed, the coach's own squad rule), in the
-- event's academy, while that child's consent is active. Drafts stay
-- coach-only (Imad, 9 Oct publish step). Writes keep the J8.1 switch.

ALTER TABLE public.coach_calendar_events
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  ADD COLUMN cancel_reason text,
  ADD COLUMN meet_time time,
  ADD COLUMN kit text,
  ADD COLUMN home_away text CHECK (home_away IN ('home', 'away')),
  ADD COLUMN series_id uuid,
  ADD COLUMN sequence integer NOT NULL DEFAULT 0;

-- Existing rows take their coach's academy (12 Rehearsal FC rows on 9 Oct).
-- Runs before the trigger below, which pins the academy on update.
UPDATE public.coach_calendar_events e
SET organization_id = cd.organization_id
FROM public.coach_details cd
WHERE cd.user_id = e.coach_user_id;

-- The database owns the academy and the change counter; whatever the app
-- sends is overwritten. The academy is the coach's at creation and never
-- moves (the squad_players rule). The counter starts at 0 and goes up on
-- every change, so calendar apps update an entry instead of duplicating it
-- (J8.9). A published event never goes back to draft: families and their
-- calendars already have it, so it is cancelled instead.
CREATE FUNCTION public.stamp_calendar_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.organization_id := (SELECT cd.organization_id FROM public.coach_details cd
                            WHERE cd.user_id = NEW.coach_user_id);
    NEW.sequence := 0;
  ELSE
    IF OLD.published AND NOT NEW.published THEN
      RAISE EXCEPTION 'published_event_cannot_return_to_draft' USING ERRCODE = '42501';
    END IF;
    -- The one way out of the pin is the FK's own ON DELETE SET NULL, once the
    -- academy is gone (20260918224500's carve-out 2). Pinning that too would
    -- block deleting the academy and its admin's account.
    IF NEW.organization_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
      NEW.organization_id := OLD.organization_id;
    END IF;
    NEW.sequence := OLD.sequence + 1;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.stamp_calendar_event() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_stamp_calendar_event
  BEFORE INSERT OR UPDATE ON public.coach_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.stamp_calendar_event();

-- True when the caller is a child on this coach's squad, or a parent linked
-- to one, in this academy, and that child's consent is active.
CREATE FUNCTION trak_private.family_reads_event(p_coach_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.squad_players sp
    WHERE sp.coach_user_id = p_coach_user_id
      AND sp.organization_id = p_organization_id
      AND sp.status <> 'coach_departed'
      AND (sp.linked_player_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.player_parent_links ppl
                      WHERE ppl.player_user_id = sp.linked_player_id
                        AND ppl.parent_user_id = auth.uid()))
      AND NOT public.player_consent_required(sp.linked_player_id)
  );
$fn$;
REVOKE ALL ON FUNCTION trak_private.family_reads_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.family_reads_event(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION trak_private.family_reads_event(uuid, uuid) IS
  'RLS-only: the caller is a consented child on this coach''s squad in this academy, or their linked parent (J8.2).';

DROP POLICY IF EXISTS "Players read published events from their coach" ON public.coach_calendar_events;
DROP POLICY IF EXISTS "Parents read published events for child coach" ON public.coach_calendar_events;
CREATE POLICY "Family reads published squad events with consent" ON public.coach_calendar_events
  FOR SELECT TO authenticated
  USING (published AND trak_private.family_reads_event(coach_user_id, organization_id));

-- Only a draft can be deleted. A published event is cancelled instead, so
-- families and calendar apps see the cancellation rather than a silent gap.
CREATE POLICY "Only drafts can be deleted" ON public.coach_calendar_events
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (NOT published);
