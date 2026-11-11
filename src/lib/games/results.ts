/* TRAK-362 (Season plan 14/18): a published match's result, said one way wherever it shows: Matches home's Previous
   matches (TRAK-320) and Home's Season plan card. And how each instruction went, from "Did the plan work?" (TRAK-288). */

import { i18n } from '@/lib/i18n'

export type ResultTone = 'success' | 'neutral' | 'danger'

/** "Won 2–1", "Drew 0–0", "Lost 1–3", or "Published" before a score is in. */
export function matchResult(our: number | null, their: number | null): { label: string; tone: ResultTone } {
  if (our == null || their == null) return { label: i18n.t('coachHome:notePublished'), tone: 'neutral' }
  const [said, tone] = our > their ? ['coachMatches:resultWon', 'success'] as const : our === their ? ['coachMatches:resultDrew', 'neutral'] as const : ['coachMatches:resultLost', 'danger'] as const
  return { label: i18n.t(said, { our, their }), tone }
}

const WENT: Record<string, string> = { worked: 'Worked', partly: 'Partly', didnt: 'Didn’t' }

/** Each instruction of the match's plan with how it went, in their order. An answer that's missing says nothing. */
/** Each instruction of the match's plan with how it went, in their order, and (TRAK-363) the season objective it
 *  carries. An answer that's missing says nothing. */
export function instructionsWent(goals: unknown, planWorked: (string | null)[] | null | undefined): { title: string; went: string | null; seasonObjectiveId: string | null }[] {
  const list = (Array.isArray(goals) ? goals : []) as { title?: unknown; season_objective_id?: unknown }[]
  return list.flatMap((goal, i) => {
    const title = typeof goal?.title === 'string' ? goal.title.trim() : ''
    if (!title) return []
    const answer = planWorked?.[i]
    const objective = typeof goal?.season_objective_id === 'string' ? goal.season_objective_id : null
    return [{ title, went: answer ? WENT[answer] ?? null : null, seasonObjectiveId: objective }]
  })
}
