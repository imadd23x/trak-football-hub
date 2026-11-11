import i18n, { type CustomTypeOptions } from 'i18next'
import { initReactI18next, useTranslation as useAreaTranslation } from 'react-i18next'
import { isLanguage, languageOf, SOURCE_LANGUAGE, type Language } from './languages'

/* TRAK-406 (Languages 1/8, TRAK-201): every word a person reads comes from
   src/locales/<language>/<area>.json, through t('area:key') from
   useTranslation() below. Import it from here, never from react-i18next
   directly: importing this file is what starts the translations, so a screen
   (or a test) that renders alone still reads real words, not keys.

   English is part of the app's first download. Every other language's files
   load only when someone picks it, so each new language costs English
   readers nothing. A missing word falls back to English, never to blank. */

type Area = Record<string, unknown>
type AreaFile = { default: Area }

const ENGLISH = import.meta.glob<AreaFile>('../../locales/en/*.json', { eager: true })
const OTHERS = import.meta.glob<AreaFile>(['../../locales/*/*.json', '!../../locales/en/*.json'])

const areaOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length)
const languageOfPath = (path: string) => path.split('/').at(-2)

export const englishResources: Record<string, Area> = Object.fromEntries(
  Object.entries(ENGLISH).map(([path, file]) => [areaOf(path), file.default]))

void i18n.use(initReactI18next).init({
  resources: { [SOURCE_LANGUAGE]: englishResources },
  lng: SOURCE_LANGUAGE,
  fallbackLng: SOURCE_LANGUAGE,
  ns: Object.keys(englishResources),
  defaultNS: 'common',
  // React already escapes what it shows.
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  initAsync: false,
  react: { useSuspense: false },
})

const loaded = new Set<Language>([SOURCE_LANGUAGE])

async function load(code: Language) {
  if (loaded.has(code)) return
  const files = Object.entries(OTHERS).filter(([path]) => languageOfPath(path) === code)
  const areas = await Promise.all(files.map(async ([path, read]) => [areaOf(path), (await read()).default] as const))
  for (const [area, words] of areas) i18n.addResourceBundle(code, area, words, true, true)
  loaded.add(code)
}

/** The language the person picked on this device, kept for before they sign in. */
const DEVICE_KEY = 'trak.language'

export function deviceLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    return isLanguage(saved) ? saved : null
  } catch { return null }
}

function rememberOnDevice(code: Language) {
  try { localStorage.setItem(DEVICE_KEY, code) } catch { /* private window: this visit only */ }
}

function applyToPage(code: Language) {
  const root = document.documentElement
  root.lang = code
  root.dir = languageOf(code).dir
}

/** Show Trak in this language from now on, on this device. Its words load first, so nothing flashes half-translated;
 *  if they can't load (offline), Trak stays as it was and this throws. */
export async function showLanguage(code: Language) {
  await load(code)
  await i18n.changeLanguage(code)
  applyToPage(code)
  rememberOnDevice(code)
}

/** Before the first screen: the language last picked on this device, else English. The account's own language, once
 *  signed in, follows (AccountLanguage). */
export async function startLanguage() {
  const code = deviceLanguage() ?? SOURCE_LANGUAGE
  applyToPage(SOURCE_LANGUAGE)
  if (code !== SOURCE_LANGUAGE) await showLanguage(code).catch(() => { /* stays English */ })
}

/** The language Trak is showing now. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : SOURCE_LANGUAGE
}

/** date-fns's locale for the language showing, for day and month names: format(date, 'EEE d MMM', { locale }). */
export function dateLocale() {
  return languageOf(currentLanguage()).dates
}

/** Every area's words, as t('area:key'). */
type AreaName = keyof CustomTypeOptions['resources']
const AREAS = Object.keys(englishResources) as AreaName[]

/** react-i18next's, over every area, so any screen can say t('nav:home') or t('settings:title'). */
export function useTranslation() {
  return useAreaTranslation(AREAS)
}

/** As useTranslation, plus the language showing, which re-renders the screen when it changes. */
export function useLanguage() {
  const translation = useAreaTranslation(AREAS)
  return { ...translation, language: isLanguage(translation.i18n.language) ? translation.i18n.language : SOURCE_LANGUAGE }
}

export { i18n }
export { LANGUAGES, isLanguage, languageOf, SOURCE_LANGUAGE, type Language } from './languages'
