import type { Position } from './types'

/**
 * The vocabulary `computeMatchScore` expects for countable match inputs.
 *
 * This exists because the writer and the engine had drifted apart. A coach
 * recording two goals for an attacker sent `'2+'`, which the attacker branch
 * has no case for, so a brace scored exactly the same as not scoring at all —
 * 7.20 either way, while a single goal scored 7.55. The engine already knew
 * what two and three goals were worth (7.75 and 7.95); the form simply could
 * not say it.
 *
 * The dialects are genuinely different and that is deliberate on the engine's
 * side: a midfielder's second goal is exceptional enough to cap at "2+", while
 * an attacker is scored on a finer scale because scoring is the job.
 *
 * Keeping the mapping here rather than inline in the form is the actual fix.
 * The bug was not a wrong value, it was two places holding the same knowledge
 * and only one of them being updated.
 */

/** Keys the engine reads for `goals`, per position. Order matters: ascending. */
const GOAL_KEYS: Record<Position, readonly string[]> = {
  gk:  ['0'],
  def: ['0'],
  mid: ['0', '1', '2+'],
  att: ['0', '1', '2', '3+'],
}

/** Assists are uniform across every position that reads them. */
const ASSIST_KEYS: readonly string[] = ['0', '1', '2+']

/**
 * Pick the highest key the position's scale defines that the count reaches.
 *
 * A `+` key is a ceiling, so six goals for a midfielder is `'2+'` and for an
 * attacker is `'3+'`. Counts above the ceiling are not lost — they are stored
 * as the real number on the match row; the key only drives the rating.
 */
function keyFor(scale: readonly string[], count: number): string {
  const n = Math.max(0, Math.floor(count))
  for (let i = scale.length - 1; i >= 0; i--) {
    const threshold = parseInt(scale[i], 10)
    if (n >= threshold) return scale[i]
  }
  return scale[0]
}

export function goalsKey(position: Position, count: number): string {
  return keyFor(GOAL_KEYS[position] ?? GOAL_KEYS.mid, count)
}

export function assistsKey(count: number): string {
  return keyFor(ASSIST_KEYS, count)
}

/** Exposed so a contract test can assert against the engine's real scales. */
export const MATCH_INPUT_SCALES = { GOAL_KEYS, ASSIST_KEYS } as const
