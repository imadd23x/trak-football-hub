/**
 * What a coach may claim happened in a match.
 *
 * These rules exist because today there are none. `matches.goals`, `.assists`
 * and `.minutes_played` are plain `integer NOT NULL DEFAULT 0`, the only CHECK
 * constraint on the table governs `logged_by_role`, and `log_match_for_player`
 * passes all three straight through. Measured on a fresh replay: 999 goals,
 * −45 minutes and −3 goals were each accepted and stored.
 *
 * The same rules are enforced twice, deliberately:
 *
 *   here                     so the coach is told before saving
 *   20260920150000 (SQL)     so the RPC refuses it regardless of the client
 *
 * A screen-only rule is a suggestion — anyone calling the RPC directly skips
 * it, and the pilot's whole point is that the numbers can be trusted later.
 *
 * Kept as a pure module rather than inside the component so the boundaries are
 * testable as a truth table. The lesson from #44's discarded render test:
 * four blocks mounting one page into a single jsdom left exactly one mounted,
 * and which one changed between runs.
 */

/** The agreed limits. Exported so the UI renders from them rather than
 *  restating numbers that could then drift from the ones enforced. */
export const MATCH_LIMITS = {
  minutesMin: 0,
  minutesMax: 120,
  /** Hard backstop. The relational rules below bind far tighter in practice. */
  goalsMax: 20,
  assistsMax: 20,
  /**
   * Contributions allowed regardless of time on the pitch.
   *
   * Without this, `goals + assists <= minutes / 5` rejects real football: a
   * substitute on for five minutes who scores twice computes 5/5 = 1 and is
   * refused, and someone brought on in the 89th minute who scores at once
   * computes 1/5 = 0. The ratio is a sanity check on absurd claims, not a
   * model of scoring rate, so it needs a floor.
   */
  contributionFloor: 3,
  /** Above the floor, one goal or assist per this many minutes. */
  minutesPerContribution: 5,
} as const

export interface MatchInput {
  minutes: number
  goals: number
  assists: number
  /** The player's OWN team's score. Undefined when not yet entered. */
  teamScore?: number
}

export interface Violation {
  field: 'minutes' | 'goals' | 'assists'
  message: string
}

const isWholeNumber = (n: number): boolean => Number.isInteger(n)

/**
 * Every reason this record cannot be true, not just the first.
 *
 * Returning all of them means a coach fixing one does not discover the next on
 * the following save. An empty array means the record is permitted — which is
 * not the same as correct, and these rules deliberately do not try to decide
 * that.
 */
export function validateMatchInput(input: MatchInput): Violation[] {
  const { minutes, goals, assists, teamScore } = input
  const v: Violation[] = []

  // ── Whole numbers ────────────────────────────────────────────
  // Checked before range, so 1.5 is reported as "not a whole number" rather
  // than passing a range check that Number.isInteger would have caught.
  for (const [field, value] of [
    ['minutes', minutes], ['goals', goals], ['assists', assists],
  ] as const) {
    if (!Number.isFinite(value)) {
      v.push({ field, message: `${field} must be a number` })
    } else if (!isWholeNumber(value)) {
      v.push({ field, message: `${field} must be a whole number` })
    }
  }
  // A non-numeric value makes every rule below meaningless, so stop here
  // rather than reporting consequences of it.
  if (v.length > 0) return v

  // ── Ranges ───────────────────────────────────────────────────
  if (minutes < MATCH_LIMITS.minutesMin || minutes > MATCH_LIMITS.minutesMax) {
    v.push({
      field: 'minutes',
      message: `Minutes must be between ${MATCH_LIMITS.minutesMin} and ${MATCH_LIMITS.minutesMax}`,
    })
  }
  if (goals < 0 || goals > MATCH_LIMITS.goalsMax) {
    v.push({ field: 'goals', message: `Goals must be between 0 and ${MATCH_LIMITS.goalsMax}` })
  }
  if (assists < 0 || assists > MATCH_LIMITS.assistsMax) {
    v.push({ field: 'assists', message: `Assists must be between 0 and ${MATCH_LIMITS.assistsMax}` })
  }
  if (v.length > 0) return v

  // ── A player who did not play did not contribute ─────────────
  if (minutes === 0 && (goals > 0 || assists > 0)) {
    v.push({
      field: 'minutes',
      message: 'A player with no minutes cannot have goals or assists',
    })
  }

  // ── Goals cannot exceed the team's score ─────────────────────
  // Only when the score is known. An unknown score is not a violation; it is
  // an unanswered question, and inventing a comparison against 0 would refuse
  // every record entered goals-first.
  if (teamScore !== undefined && Number.isInteger(teamScore) && goals > teamScore) {
    v.push({
      field: 'goals',
      message: `A player cannot score more than the team's ${teamScore}`,
    })
  }

  // ── Contributions against time on the pitch ──────────────────
  const allowed = Math.max(
    MATCH_LIMITS.contributionFloor,
    Math.floor(minutes / MATCH_LIMITS.minutesPerContribution),
  )
  if (minutes > 0 && goals + assists > allowed) {
    v.push({
      field: 'goals',
      message: `${goals + assists} goals and assists in ${minutes} minutes is not possible (max ${allowed})`,
    })
  }

  return v
}

/**
 * Across the whole match: our players cannot score more than our team did
 * (TRAK-66). Fewer is allowed: own goals and unrostered scorers exist. Like
 * the per-player rule, an unknown score is not a violation.
 *
 * ponytail: client-side only. The RPC logs one player at a time, so the
 * database cannot see the other scorers; a match-level check needs a match
 * row that owns its players' records.
 */
export function teamGoalsViolation(playerGoals: number[], teamScore: number | undefined): string | null {
  if (teamScore === undefined || !Number.isInteger(teamScore)) return null
  const total = playerGoals.reduce((sum, goals) => sum + goals, 0)
  return total > teamScore ? `${total} goals entered, but the team scored ${teamScore}` : null
}

/** Convenience for call sites that only need the verdict. */
export const isValidMatchInput = (input: MatchInput): boolean =>
  validateMatchInput(input).length === 0
