import 'i18next'
import type coachAssess from '@/locales/en/coachAssess.json'
import type coachHome from '@/locales/en/coachHome.json'
import type coachHowTrakWorks from '@/locales/en/coachHowTrakWorks.json'
import type coachMatches from '@/locales/en/coachMatches.json'
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
      coachAssess: typeof coachAssess
      coachHome: typeof coachHome
      coachHowTrakWorks: typeof coachHowTrakWorks
      coachMatches: typeof coachMatches
      coachSchedule: typeof coachSchedule
      coachSquad: typeof coachSquad
      common: typeof common
      nav: typeof nav
      settings: typeof settings
    }
  }
}
