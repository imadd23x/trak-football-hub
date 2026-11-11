import 'i18next'
import type coachHome from '@/locales/en/coachHome.json'
import type coachSchedule from '@/locales/en/coachSchedule.json'
import type coachSquad from '@/locales/en/coachSquad.json'
import type common from '@/locales/en/common.json'
import type nav from '@/locales/en/nav.json'
import type settings from '@/locales/en/settings.json'

/* TRAK-406: t('area:key') is checked against the English files, so a typo or a
   removed word fails the type check rather than showing a key on screen. Each
   new area file in src/locales/en/ is added here too (a test checks). */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      coachHome: typeof coachHome
      coachSchedule: typeof coachSchedule
      coachSquad: typeof coachSquad
      common: typeof common
      nav: typeof nav
      settings: typeof settings
    }
  }
}
