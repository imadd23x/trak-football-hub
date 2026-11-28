-- TRAK-617 (Dimos, 27 Nov): a coach selects the drawn avatar a player of theirs has on the coach's screens.
--
-- Not a photo. The avatar is TRAK-349's drawn face, whose hair is otherwise picked from the player's name
-- (src/lib/player-face.ts). The coach may select one of its hair styles and one of its hair colours instead; nothing
-- else about the drawing varies, and the skin tone stays the same for every child (Tarek, 3 Nov), so there is no
-- column for it. G7 (child photos stay closed) is untouched: nothing is uploaded, stored as an image or fetched.
--
-- The selection lives beside the coach's other facts about the player (TRAK-260), so the existing policies decide who
-- sees it: only that player's own coach reads or writes the row; a colleague, the player, a guardian and a visitor
-- read nothing. The two values are positions in fixed lists the app holds (HAIR_STYLE_COUNT = 3, HAIR_COLOURS has
-- 5 entries in src/lib/fixed-colours.ts), checked here, and set or cleared together: both NULL means "from the name".
ALTER TABLE public.squad_player_profiles
  ADD COLUMN face_hair_style  smallint CONSTRAINT squad_player_profiles_face_hair_style_listed CHECK (face_hair_style BETWEEN 0 AND 2),
  ADD COLUMN face_hair_colour smallint CONSTRAINT squad_player_profiles_face_hair_colour_listed CHECK (face_hair_colour BETWEEN 0 AND 4),
  ADD CONSTRAINT squad_player_profiles_face_together CHECK ((face_hair_style IS NULL) = (face_hair_colour IS NULL));
