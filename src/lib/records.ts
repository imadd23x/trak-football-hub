export interface PersonalRecords {
  highestRating: { value: number; matchId: string; date: string } | null
  mostGoalsInMatch: { value: number; matchId: string; date: string } | null
  longestGoodStreak: number // Consecutive matches in Good+ band (>=7.2)
  totalMatches: number
  totalGoals: number
  totalAssists: number
  firstMatchDate: string | null
}

interface MatchRecord {
  id: string
  computed_rating: number | null
  created_at: string
  goals: number | null
  assists: number | null
  opponent?: string | null
}

export function calculateRecords(matches: MatchRecord[]): PersonalRecords {
  if (!matches || matches.length === 0) {
    return {
      highestRating: null,
      mostGoalsInMatch: null,
      longestGoodStreak: 0,
      totalMatches: 0,
      totalGoals: 0,
      totalAssists: 0,
      firstMatchDate: null,
    }
  }

  // Sort by date ascending for streak calculation
  const sorted = [...matches].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  let highestRating: PersonalRecords['highestRating'] = null
  let mostGoalsInMatch: PersonalRecords['mostGoalsInMatch'] = null
  let longestGoodStreak = 0
  let currentStreak = 0
  let totalGoals = 0
  let totalAssists = 0

  for (const m of sorted) {
    const rating = m.computed_rating ?? 0
    const goals = m.goals ?? 0
    const assists = m.assists ?? 0

    totalGoals += goals
    totalAssists += assists

    // Highest rating
    if (m.computed_rating != null && (highestRating === null || rating > highestRating.value)) {
      highestRating = { value: rating, matchId: m.id, date: m.created_at }
    }

    // Most goals in a match
    if (goals > 0 && (mostGoalsInMatch === null || goals > mostGoalsInMatch.value)) {
      mostGoalsInMatch = { value: goals, matchId: m.id, date: m.created_at }
    }

    // Good+ streak (rating >= 7.2). TRAK-289: a Games match has no rating; it neither extends nor breaks a streak.
    if (m.computed_rating == null) continue
    if (rating >= 7.2) {
      currentStreak++
      if (currentStreak > longestGoodStreak) {
        longestGoodStreak = currentStreak
      }
    } else {
      currentStreak = 0
    }
  }

  return {
    highestRating,
    mostGoalsInMatch,
    longestGoodStreak,
    totalMatches: matches.length,
    totalGoals,
    totalAssists,
    firstMatchDate: sorted[0].created_at,
  }
}
