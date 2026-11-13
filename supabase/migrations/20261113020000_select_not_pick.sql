-- TRAK-454 (Kostas, 13 Nov: "Nothing should say pick"): the database's refusal messages say "select", as the app does.
-- Only the sentence changes. Each function is rewritten from its own live definition (pg_get_functiondef), so its
-- signature, SECURITY DEFINER, search_path and grants stay exactly as they are; a function no longer holding the
-- old sentence is left alone. The check at the end fails the migration if any "pick" is left in a refusal.
DO $migration$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_new text;
  v_pair text[];
  v_pairs text[][] := ARRAY[
    ARRAY['''Pick a start time: every event needs one.''', '''Select a start time: every event needs one.'''],
    ARRAY['''Pick the competition: league, tournament or friendly''', '''Select the competition: league, tournament or friendly'''],
    ARRAY['''Pick when it goes out''', '''Select when it goes out'''],
    ARRAY['''That time has passed: pick a later one, or share it now''', '''That time has passed: select a later one, or share it now'''],
    ARRAY['''Pick a time before kick-off''', '''Select a time before kick-off'''],
    ARRAY['''Pick between 1 and 50 matches''', '''Select between 1 and 50 matches''']
  ];
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'trak_private') AND p.prosrc ~* 'raise exception ''[^'']*\mpick'
  LOOP
    v_def := pg_get_functiondef(v_fn);
    v_new := v_def;
    FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
      v_new := replace(v_new, v_pair[1], v_pair[2]);
    END LOOP;
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'trak_private') AND p.prosrc ~* 'raise exception ''[^'']*\mpick'
  ) THEN
    RAISE EXCEPTION 'TRAK-454: a refusal still says "pick"';
  END IF;
END
$migration$;
