-- TRAK-406 (Languages 1/8, parent TRAK-201): each person's language, saved on their account, so Trak opens in it on
-- any phone or laptop they sign in on. Empty means they have never picked one: the app then uses the language last
-- picked on that device, else English.
--
-- The column holds a language tag ('en', 'el', later 'fr', 'ar', 'pt-BR'). Only its shape is checked here, so adding a
-- language to the app (LANGUAGES in src/lib/i18n/languages.ts) needs no migration; the app treats a tag it does not
-- know as English.
--
-- A person changes their own through "Users can update own profile" (own row, role unchanged), as they do their name.
-- Nobody gains a new read: the profile reads that exist already now include the language too, which later lets an
-- email go out in its receiver's language (TRAK-412).

ALTER TABLE public.profiles
  ADD COLUMN language text CHECK (language IS NULL OR language ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$');

COMMENT ON COLUMN public.profiles.language IS
  'TRAK-406: the language the person picked in Trak (a tag such as en or el). NULL: never picked.';
