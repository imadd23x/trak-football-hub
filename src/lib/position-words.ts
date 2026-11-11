import { i18n } from '@/lib/i18n'
import { isPosition, type Position } from '@/lib/positions'

/* TRAK-407: a saved position ('Goalkeeper') stays as saved; this is the word shown for it, t(POSITION_WORD[position]). */
export const POSITION_WORD = {
  Goalkeeper: 'coachSquad:positionGoalkeeper',
  Defender: 'coachSquad:positionDefender',
  Midfielder: 'coachSquad:positionMidfielder',
  Attacker: 'coachSquad:positionAttacker',
} as const satisfies Record<Position, string>

/** lineName's word ('Goalkeeper', 'Defender', 'Midfielder', 'Forward' or 'Player') in the language showing. */
export const lineWord = (line: string) => (line === 'Forward' ? i18n.t('coachSquad:fmForward') : line === 'Player' ? i18n.t('nav:player')
  : isPosition(line) ? i18n.t(POSITION_WORD[line]) : line)

const SHORT_WORD = { Goalkeeper: 'coachSquad:filterGK', Defender: 'coachSquad:filterDEF', Midfielder: 'coachSquad:filterMID', Attacker: 'coachSquad:filterATT' } as const

/** A player's positions, main first, as a bench shows them ("MID / DEF"), in the language showing. */
export const positionsShown = (position: string | null, also: readonly string[] = []) =>
  [position, ...also].filter(isPosition).map(p => i18n.t(SHORT_WORD[p])).join(' / ') || i18n.t('coachSquad:fmNoPosition')
