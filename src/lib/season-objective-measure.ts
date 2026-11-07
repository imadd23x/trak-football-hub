/* TRAK-363 (Season plan 15/18, spec TRAK-348): a season objective is measured only from matches, never from players
   (Tarek, 3 Nov). Its matches are the published ones whose plan carried it in an instruction; each answers "Did the plan
   work?" for that instruction's place: Worked, Partly or Didn't. The measure is the share that Worked: Good from 60 %,
   Watch from 40 %, At risk below. Two Didn'ts in a row need the coach's attention. An objective removed since keeps
   its past matches. */

export type Verdict = 'Good' | 'Watch' | 'At risk'
export type MeasuredMatch = { eventId: string; startsAt: string; goals: unknown; planWorked: (string | null)[] | null }
export type ObjectiveMeasure = {
  id: string; matches: number; worked: number; partly: number; didnt: number
  /** The share that Worked, 0–100, or null before any match. */
  pct: number | null; verdict: Verdict | null
  /** The last two matches that answered it both said Didn't. */
  stuck: boolean
}

export const verdictOf = (pct: number | null): Verdict | null => (pct == null ? null : pct >= 60 ? 'Good' : pct >= 40 ? 'Watch' : 'At risk')

/** Each objective's measure from these published matches, oldest to newest by kick-off. */
export function measureObjectives(objectiveIds: string[], matches: MeasuredMatch[]): Map<string, ObjectiveMeasure> {
  const ordered = [...matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return new Map(objectiveIds.map(id => {
    const answers = ordered.flatMap(match => {
      const goals = (Array.isArray(match.goals) ? match.goals : []) as { season_objective_id?: unknown }[]
      return goals.flatMap((goal, i) => (goal?.season_objective_id === id ? [match.planWorked?.[i] ?? null] : []))
    })
    const answered = answers.filter((a): a is string => a === 'worked' || a === 'partly' || a === 'didnt')
    const worked = answered.filter(a => a === 'worked').length
    const pct = answered.length ? Math.round((worked / answered.length) * 100) : null
    const lastTwo = answered.slice(-2)
    return [id, {
      id, matches: answered.length, worked, partly: answered.filter(a => a === 'partly').length, didnt: answered.filter(a => a === 'didnt').length,
      pct, verdict: verdictOf(pct), stuck: lastTwo.length === 2 && lastTwo.every(a => a === 'didnt'),
    }]
  }))
}
