/* TRAK-259: where each coach page sits in the coach's frame (CoachFrame). */

export type CoachScreen = 'home' | 'calendar' | 'squad' | 'games' | 'training' | 'library' | 'settings'

export const COACH_SCREEN_PATH: Record<CoachScreen, string> = {
  home: '/coach/home', calendar: '/coach/schedule', squad: '/coach/squad', games: '/coach/matches', training: '/coach/training', library: '/coach/trainings', settings: '/settings',
}

/** Which nav row a path belongs to, and the name in the laptop's top bar. */
const PLACES: [prefix: string, screen: CoachScreen | null, title: string][] = [
  ['/coach/home', 'home', 'Home'],
  ['/coach/schedule', 'calendar', 'Schedule'], // TRAK-255
  ['/coach/squad', 'squad', 'Squad'],
  ['/coach/player', 'squad', 'Player'],
  ['/coach/matches', 'games', 'Matches'], // TRAK-283: Games home and each game's page
  ['/coach/training', 'training', 'Training'], // TRAK-294: Training home, its drills and plans
  ['/coach/trainings', 'library', 'Library'],
  ['/settings', 'settings', 'Settings'],
  ['/coach/profile', 'settings', 'Profile'],
  ['/coach/manual', 'settings', 'How Trak works'],
  ['/coach/feedback', null, 'Feedback'],
  ['/coach/assess', null, 'Assess'],
  // TRAK-186: the log's pages open from Home, so Home stays marked on them.
  ['/coach/sessions', 'home', 'Log'],
]

export function placeOf(path: string): { screen: CoachScreen | null; title: string } {
  const hit = PLACES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))
  return hit ? { screen: hit[1], title: hit[2] } : { screen: null, title: 'Trak' }
}

/** Pages with no bottom bar on a phone before (TRAK-254's `sideMenuOnly`) keep none: their own actions sit at the bottom,
 *  and Back leaves them. Settings, the manual, a player's page, and adding or editing a session (not History). */
export const BARLESS = /^\/(settings|coach\/(manual|player\/.+|sessions\/(?!list$)[^/]+))$/
