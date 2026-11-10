import type { Locale } from 'date-fns'
import { el } from 'date-fns/locale'

/* TRAK-406 (Languages 1/8, TRAK-201): the languages Trak speaks. Adding one is
   one entry here and one folder of text, src/locales/<code>/, holding the same
   files as src/locales/en/ (a test checks every key is there). Anything not
   translated yet shows in English.

   `name` is the language's name in itself, so a person who reads only that
   language can find it. `dir` is the reading direction; Arabic will be 'rtl'.
   `dates` is date-fns's locale for day and month names (English: date-fns's
   own default, as before). */
export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr', dates: undefined },
  { code: 'el', name: 'Ελληνικά', dir: 'ltr', dates: el },
] as const satisfies readonly { code: string; name: string; dir: 'ltr' | 'rtl'; dates: Locale | undefined }[]

export type Language = typeof LANGUAGES[number]['code']

/** The language every word is written in first, and shown when a translation is missing. */
export const SOURCE_LANGUAGE: Language = 'en'

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some(language => language.code === value)
}

export function languageOf(code: Language) {
  return LANGUAGES.find(language => language.code === code) ?? LANGUAGES[0]
}
