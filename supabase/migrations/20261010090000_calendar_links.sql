-- TRAK-132 (J8.9): private calendar links, one per person.
--
-- A phone's calendar app fetches the feed with no login, so the link is the
-- credential. The database keeps only the sha256 of the token: a copy of this
-- table (a backup, a leak, an operator's screen) never contains a working link.
-- A player or parent makes their own link; making a new one revokes the old
-- one, which is how a lost or forwarded link is fixed. Nobody reads or writes
-- the table directly. What a link shows (published events of children with
-- active consent, in their own squad) is calendar_feed_for_token, which
-- follows J8.2's columns.
--
-- `label` stays NULL for the personal link. TRAK-140's named family links
-- (a grandparent, a driver) will be labelled rows of the same table.

CREATE TABLE public.calendar_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  -- Set by the feed on each fetch: who is actually subscribed (rehearsal,
  -- support). A fetch is a request, not proof anyone read the calendar.
  last_fetched_at timestamptz
);

-- One live personal link per person, whatever the functions below do.
CREATE UNIQUE INDEX calendar_links_one_live_personal
  ON public.calendar_links (user_id)
  WHERE revoked_at IS NULL AND label IS NULL;

ALTER TABLE public.calendar_links ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: app roles reach links only through the functions.
REVOKE ALL ON TABLE public.calendar_links FROM PUBLIC, anon, authenticated;

-- Make the caller's personal link, revoking any previous one. Returns the
-- token once; it cannot be shown again, only replaced.
CREATE FUNCTION public.create_my_calendar_link()
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.role IN ('player', 'parent')
  ) THEN
    RAISE EXCEPTION 'Only a player or parent can make a calendar link' USING ERRCODE = '42501';
  END IF;

  -- 32 bytes from two random UUIDs (244 random bits; gen_random_uuid uses the
  -- server's strong random source), as unpadded base64url: 43 characters, the
  -- format the calendar-feed endpoint accepts.
  v_token := rtrim(translate(
    encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'),
    '+/', '-_'), '=');

  UPDATE public.calendar_links SET revoked_at = now()
  WHERE user_id = v_uid AND label IS NULL AND revoked_at IS NULL;

  INSERT INTO public.calendar_links (user_id, token_hash)
  VALUES (v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));

  RETURN v_token;
END;
$$;

-- Revoke the caller's personal link. True if a live link was revoked.
CREATE FUNCTION public.revoke_my_calendar_link()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage your calendar link' USING ERRCODE = '42501';
  END IF;
  UPDATE public.calendar_links SET revoked_at = now()
  WHERE user_id = auth.uid() AND label IS NULL AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

-- The caller's live personal link, without its token or hash: for Settings
-- ("Added 9 Oct, last updated by your calendar 10 minutes ago").
CREATE FUNCTION public.my_calendar_link()
RETURNS TABLE (created_at timestamptz, last_fetched_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.created_at, l.last_fetched_at
  FROM public.calendar_links l
  WHERE l.user_id = auth.uid() AND l.label IS NULL AND l.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.create_my_calendar_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_calendar_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_calendar_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_calendar_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_calendar_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_calendar_link() TO authenticated;
