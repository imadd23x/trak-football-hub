import type { Position } from '@/lib/positions'

/* TRAK-407: a saved position ('Goalkeeper') stays as saved; this is the word shown for it, t(POSITION_WORD[position]). */
export const POSITION_WORD = {
  Goalkeeper: 'coachSquad:positionGoalkeeper',
  Defender: 'coachSquad:positionDefender',
  Midfielder: 'coachSquad:positionMidfielder',
  Attacker: 'coachSquad:positionAttacker',
} as const satisfies Record<Position, string>
