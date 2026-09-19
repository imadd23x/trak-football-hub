-- =============================================================
-- DEV SEED DATA — run once in Supabase Dashboard → SQL Editor
-- Creates 3 test accounts with full realistic data
--
-- Login credentials after running:
--   coach@trak.dev, player@trak.dev, parent@trak.dev
--
-- The password is NOT in this file. Set it for the session before running:
--   SET trak.dev_password = '<a fresh value, never committed>';
--   \i supabase/seeds/dev_data.sql
--
-- It used to be a literal here, which meant running this seed AFTER rotating
-- the compromised accounts would silently restore the compromised password.
-- =============================================================

DO $guard$
BEGIN
  IF COALESCE(current_setting('trak.dev_password', true), '') = '' THEN
    RAISE EXCEPTION 'Set trak.dev_password before running this seed. It is deliberately not in the file.';
  END IF;
END;
$guard$;

DO $$
DECLARE
  coach_id  UUID := '11111111-1111-1111-1111-111111111111';
  player_id UUID := '22222222-2222-2222-2222-222222222222';
  parent_id UUID := '33333333-3333-3333-3333-333333333333';
  squad_id  UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
BEGIN

  -- ==========================================
  -- 1. Auth users (pre-confirmed; password comes from trak.dev_password)
  -- ==========================================
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'coach@trak.dev') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
    ) VALUES (
      coach_id, '00000000-0000-0000-0000-000000000000',
      'coach@trak.dev', crypt(current_setting('trak.dev_password'), gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      'authenticated', 'authenticated', now(), now()
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    VALUES (gen_random_uuid(), coach_id,
      jsonb_build_object('sub', coach_id::text, 'email', 'coach@trak.dev'),
      'email', 'coach@trak.dev', now(), now(), now());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'player@trak.dev') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
    ) VALUES (
      player_id, '00000000-0000-0000-0000-000000000000',
      'player@trak.dev', crypt(current_setting('trak.dev_password'), gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      'authenticated', 'authenticated', now(), now()
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    VALUES (gen_random_uuid(), player_id,
      jsonb_build_object('sub', player_id::text, 'email', 'player@trak.dev'),
      'email', 'player@trak.dev', now(), now(), now());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'parent@trak.dev') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at
    ) VALUES (
      parent_id, '00000000-0000-0000-0000-000000000000',
      'parent@trak.dev', crypt(current_setting('trak.dev_password'), gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      'authenticated', 'authenticated', now(), now()
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    VALUES (gen_random_uuid(), parent_id,
      jsonb_build_object('sub', parent_id::text, 'email', 'parent@trak.dev'),
      'email', 'parent@trak.dev', now(), now(), now());
  END IF;

  -- ==========================================
  -- 2. Profiles
  -- ==========================================
  INSERT INTO public.profiles (user_id, role, full_name, invite_code)
  VALUES
    (coach_id,  'coach',  'Alex Martinez', 'DEMO'),
    (player_id, 'player', 'Jamie Wilson',  NULL),
    (parent_id, 'parent', 'Sarah Wilson',  NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    full_name   = EXCLUDED.full_name,
    invite_code = COALESCE(profiles.invite_code, EXCLUDED.invite_code);

  -- ==========================================
  -- 3. Coach details
  -- ==========================================
  INSERT INTO public.coach_details (user_id, current_club, team, coach_role)
  VALUES (coach_id, 'City FC Academy', 'U15s', 'Head Coach')
  ON CONFLICT (user_id) DO NOTHING;

  -- ==========================================
  -- 4. Player details
  -- ==========================================
  INSERT INTO public.player_details (user_id, date_of_birth, position, current_club, age_group, shirt_number)
  VALUES (player_id, '2010-05-15', 'CM', 'City FC Academy', 'U15', 8)
  ON CONFLICT (user_id) DO NOTHING;

  -- ==========================================
  -- 5. Squad player — links Jamie to Alex
  -- ==========================================
  INSERT INTO public.squad_players (id, coach_user_id, player_name, position, shirt_number, linked_player_id)
  VALUES (squad_id, coach_id, 'Jamie Wilson', 'CM', 8, player_id)
  ON CONFLICT (id) DO NOTHING;

  -- ==========================================
  -- 6. Matches (10 for Jamie — spread over ~10 weeks)
  -- ==========================================
  INSERT INTO public.matches (
    user_id, team_score, opponent_score, opponent, competition,
    venue, position, age_group, minutes_played, goals, assists,
    self_rating, body_condition, card_received, computed_rating, created_at
  ) VALUES
    (player_id, 3, 1, 'Riverside United', 'League',  'Home', 'CM', 'U15', 90, 1, 1, 8, 'good',      'None',   8.5, now() - interval '1 day'),
    (player_id, 1, 2, 'North Academy',    'League',  'Away', 'CM', 'U15', 90, 0, 0, 5, 'average',   'Yellow', 5.2, now() - interval '8 days'),
    (player_id, 2, 2, 'East City FC',     'Cup',     'Home', 'CM', 'U15', 90, 1, 0, 7, 'good',      'None',   6.8, now() - interval '15 days'),
    (player_id, 4, 0, 'Valley Rangers',   'League',  'Home', 'CM', 'U15', 90, 2, 1, 9, 'excellent', 'None',   9.2, now() - interval '22 days'),
    (player_id, 0, 3, 'Metro Boys',       'League',  'Away', 'CM', 'U15', 75, 0, 0, 4, 'tired',     'None',   4.7, now() - interval '29 days'),
    (player_id, 2, 1, 'Hillside FC',      'League',  'Home', 'CM', 'U15', 90, 0, 2, 7, 'good',      'None',   7.4, now() - interval '36 days'),
    (player_id, 1, 1, 'South Stars',      'Cup',     'Away', 'CM', 'U15', 90, 1, 0, 6, 'average',   'None',   6.3, now() - interval '43 days'),
    (player_id, 3, 2, 'Park City',        'League',  'Home', 'CM', 'U15', 90, 0, 1, 8, 'good',      'None',   7.9, now() - interval '50 days'),
    (player_id, 2, 0, 'West United',      'League',  'Away', 'CM', 'U15', 85, 1, 0, 7, 'good',      'None',   7.1, now() - interval '57 days'),
    (player_id, 1, 4, 'Crestwood FC',     'League',  'Away', 'CM', 'U15', 90, 0, 0, 5, 'tired',     'None',   5.6, now() - interval '64 days');

  -- ==========================================
  -- 7. Coach assessments
  -- ==========================================
  INSERT INTO public.coach_assessments (
    coach_user_id, squad_player_id, appearance,
    work_rate, tactical, attitude, technical, physical, coachability,
    private_note, flag, created_at
  ) VALUES
    (coach_id, squad_id, 'started', 8, 7, 9, 7, 8, 8,
     'Great attitude this week — pressed well in the first half and won the ball back consistently.',
     'fair', now() - interval '1 day'),
    (coach_id, squad_id, 'started', 6, 6, 7, 6, 7, 7,
     'Struggled away from home but kept working hard. Need to improve positioning off the ball.',
     'generous', now() - interval '8 days'),
    (coach_id, squad_id, 'started', 9, 8, 9, 8, 9, 9,
     'Outstanding performance — best of the season. Showed real leadership and dominated midfield.',
     'fair', now() - interval '22 days');

  -- ==========================================
  -- 8. Recognition award
  -- ==========================================
  INSERT INTO public.recognition_awards (
    coach_user_id, squad_player_id, award_type, awarded_for, note, created_at
  ) VALUES (
    coach_id, squad_id, 'player_of_week', 'Week of 14 Apr',
    'Best performance of the week against Valley Rangers — 2 goals, 1 assist, dominant in midfield.',
    now() - interval '6 days'
  );

  -- ==========================================
  -- 9. Player goals
  -- ==========================================
  INSERT INTO public.player_goals (user_id, goal_type, target_value, category, current_value, completed)
  VALUES
    (player_id, 'goals_scored',    5,   'performance', 4,  false),
    (player_id, 'matches_logged',  10,  'consistency', 10, false),
    (player_id, 'minutes_played',  500, 'consistency', 425, false)
  ON CONFLICT DO NOTHING;

  -- ==========================================
  -- 10. Parent invite + link
  -- ==========================================
  INSERT INTO public.parent_invites (player_user_id, parent_email)
  VALUES (player_id, 'parent@trak.dev')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
  VALUES (player_id, parent_id)
  ON CONFLICT DO NOTHING;

END $$;
