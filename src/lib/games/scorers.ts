/* TRAK-321 (Imad, 30 Oct): the season's scorers and assists, counted from the coach's published evaluations (each goal
   names its scorer and assist as squad rows; who played counts the matches). Only players still on the roster are
   listed, and only those with a goal or an assist. The league table that went with it is parked (TRAK-325). */

export type Scorer = { id: string; name: string; goals: number; assists: number; played: number }
export type ScoredMatch = { goals: { scorer: string; assist: string | null }[]; played: string[] }

export function scorers(matches: ScoredMatch[], names: Map<string, string>): Scorer[] {
  const rows = new Map<string, Scorer>()
  const row = (id: string | null) => {
    if (!id || !names.has(id)) return null
    if (!rows.has(id)) rows.set(id, { id, name: names.get(id)!, goals: 0, assists: 0, played: 0 })
    return rows.get(id)!
  }
  for (const match of matches) for (const goal of match.goals) {
    const scorer = row(goal.scorer)
    if (scorer) scorer.goals++
    const assist = row(goal.assist)
    if (assist) assist.assists++
  }
  for (const match of matches) for (const id of match.played) { const listed = rows.get(id); if (listed) listed.played++ }
  return [...rows.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.played - b.played || a.name.localeCompare(b.name))
}

/** The season a day falls in: from 1 August (the season starts in the last week of August; pre-season friendlies count). */
export const seasonStart = (now: number) => {
  const day = new Date(now)
  return Date.UTC(day.getUTCMonth() >= 7 ? day.getUTCFullYear() : day.getUTCFullYear() - 1, 7, 1)
}
