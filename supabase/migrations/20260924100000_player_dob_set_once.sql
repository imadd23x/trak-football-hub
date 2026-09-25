-- J1 (MVP Requirements): a player cannot change their own date of birth, and a
-- missing date of birth counts as a minor. TRAK-48, slice 1.
--
-- The date of birth decides whether a guardian must consent. A child who could
-- rewrite it, or sign up without one and add an adult date later, could switch
-- the consent gate off for themselves. The player may write it only in the
-- request that creates their profile: provision_my_profile inserts the profile
-- and the details together, so profiles.created_at = now() there and in no
-- later request (now() is the transaction start, and re-running signup does
-- not touch created_at). An operator correcting it by hand (J3) has no
-- auth.uid(), so is never "the player".
--
-- A trigger, not a policy: provision_my_profile writes as its owner, which
-- bypasses RLS, and a policy cannot compare OLD with NEW.

CREATE OR REPLACE FUNCTION trak_private.player_dob_set_once()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- Compared with the stored row, not OLD: INSERT ... ON CONFLICT DO UPDATE
  -- (provision_my_profile) fires BEFORE INSERT first, where OLD is empty.
  IF auth.uid() = NEW.user_id
     AND NEW.date_of_birth IS DISTINCT FROM (
       SELECT date_of_birth FROM public.player_details WHERE user_id = NEW.user_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE user_id = NEW.user_id AND created_at = now())
  THEN
    RAISE EXCEPTION 'A player cannot change their own date of birth; the academy corrects it'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION trak_private.player_dob_set_once() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS player_dob_set_once ON public.player_details;
CREATE TRIGGER player_dob_set_once
  BEFORE INSERT OR UPDATE OF date_of_birth ON public.player_details
  FOR EACH ROW EXECUTE FUNCTION trak_private.player_dob_set_once();
