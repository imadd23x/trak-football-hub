export type DedupableMatch = {
  id: string
  opponent: string | null
  team_score: number
  opponent_score: number
  competition: string
  match_date: string | null
  created_at: string | null
  computed_rating: number
}

/**
 * Collapse rows that are genuinely the same match logged twice.
 *
 * Identity is opponent + date + competition — not the scoreline. Two real 1–0
 * wins over the same club on different days are two matches, and both belong on
 * the player's screen. A row with no match_date cannot be proven a duplicate of
 * anything, so it is always kept.
 *
 * Where two rows do share an identity, the higher computed_rating wins: a
 * coach-logged row generally carries more complete data than a quick log.
 */
export function dedupeMatches<T extends DedupableMatch>(matches: T[] | null | undefined): T[] {
  const groups = new Map<string, T>()
  const undatable: T[] = []

  for (const m of matches || []) {
    if (!m.match_date) {
      undatable.push(m)
      continue
    }
    const key = [
      (m.opponent || '').trim().toLowerCase(),
      m.match_date,
      (m.competition || '').trim().toLowerCase(),
    ].join('|')
    const existing = groups.get(key)
    if (!existing || (m.computed_rating ?? 0) > (existing.computed_rating ?? 0)) {
      groups.set(key, m)
    }
  }

  return [...groups.values(), ...undatable].sort((a, b) => sortKey(b) - sortKey(a))
}

function sortKey(m: DedupableMatch): number {
  const stamp = m.match_date || m.created_at
  const t = stamp ? new Date(stamp).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}
