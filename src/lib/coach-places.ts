import { i18n } from '@/lib/i18n'

/* TRAK-259: where each coach page sits in the coach's frame (CoachFrame). */

export type CoachScreen = 'home' | 'calendar' | 'squad' | 'games' | 'training' | 'library' | 'settings'

/** TRAK-418: the coach's own How Trak works (players and parents keep /how-it-works). */
export const COACH_HOW_PATH = '/coach/how-trak-works'

export const COACH_SCREEN_PATH: Record<CoachScreen, string> = {
  home: '/coach/home', calendar: '/coach/schedule', squad: '/coach/squad', games: '/coach/matches', training: '/coach/training', library: '/coach/trainings', settings: '/settings',
}

type PlaceName = 'home' | 'events' | 'player' | 'squad' | 'matches' | 'drills' | 'training' | 'library' | 'settings'
  | 'howTrakWorks' | 'feedback' | 'assess' | 'evaluation' | 'seasonPlan' | 'log'

/** Which nav row a path belongs to, and the name in the laptop's top bar (its word in nav.json, TRAK-406). */
const PLACES: [prefix: string, screen: CoachScreen | null, title: PlaceName][] = [
  ['/coach/home', 'home', 'home'],
  ['/coach/schedule', 'calendar', 'events'], // TRAK-255; TRAK-449: the page is called Events, its address stays
  ['/coach/squad/player', 'squad', 'player'], // TRAK-351: a player's own page, in Squad
  ['/coach/squad', 'squad', 'squad'],
  ['/coach/matches', 'games', 'matches'], // TRAK-283: Games home and each game's page
  ['/coach/training/drills', 'training', 'drills'], // TRAK-367: so a page opened from Drills doesn't read Training / Training
  ['/coach/training', 'training', 'training'], // TRAK-294: Training home, its drills and plans
  ['/coach/trainings', 'library', 'library'],
  ['/settings', 'settings', 'settings'],
  // TRAK-418: the coach's How Trak works, opened from Settings.
  ['/coach/how-trak-works', 'settings', 'howTrakWorks'],
  ['/coach/feedback', null, 'feedback'],
  ['/coach/assess', null, 'assess'],
  // TRAK-364: the squad's evaluation opens from Home's Needs you.
  ['/coach/evaluation', 'home', 'evaluation'],
  // TRAK-433: the season plan opens from the same place on Home, so Home stays marked on it too.
  ['/coach/season-plan', 'home', 'seasonPlan'],
  // TRAK-186: the log's pages open from Home, so Home stays marked on them.
  ['/coach/sessions', 'home', 'log'],
]

export function placeOf(path: string): { screen: CoachScreen | null; title: string } {
  const hit = PLACES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))
  // In the language showing; a screen that shows it re-renders when the language changes (useTranslation).
  return hit ? { screen: hit[1], title: i18n.t(`nav:${hit[2]}`) } : { screen: null, title: i18n.t('nav:trak') }
}

/** TRAK-334: the nav row a page sits under, as the first crumb of its trail when nothing came before it (a link from
 *  outside, a refresh). Assess and Feedback sit under none, so they go Home. */
export function tabOf(path: string): { label: string; href: string } {
  const href = COACH_SCREEN_PATH[placeOf(path).screen ?? 'home']
  return { label: placeOf(href).title, href }
}

/** Pages with no bottom bar on a phone before (TRAK-254's `sideMenuOnly`) keep none: their own actions sit at the bottom,
 *  and Back leaves them. Settings, the manual, a player's page, and adding or editing a session (not History). */
export const BARLESS = /^\/(settings|coach\/(how-trak-works|assess|squad\/player\/.+|sessions\/(?!list$)[^/]+))$/
