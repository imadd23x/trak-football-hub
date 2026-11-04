import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useFeatureState } from '@/components/trak/parked'
import type { Tables } from '@/integrations/supabase/types'

/* TRAK-350 (Season plan 2/18, spec TRAK-348): a squad's season plan, set up once. This slice holds the season's dates
   and up to three season objectives, a draft only the squad's coach sees. A squad is the coach's roster rows with one
   age group (TRAK-176). The academy's season_plan switch gates every write; with it off nothing here is read. */

export type SeasonPlan = Pick<Tables<'season_plans'>, 'id' | 'squad' | 'starts_on' | 'ends_on' | 'shared_at'>
export type SeasonObjective = Pick<Tables<'season_objectives'>, 'id' | 'place' | 'title' | 'looks_like'>

export const MAX_SEASON_OBJECTIVES = 3
export const OBJECTIVE_TITLE_MAX = 80
export const OBJECTIVE_LINE_MAX = 300

/** The mockup's six (2 Nov), each with what it looks like. */
export const SEASON_OBJECTIVE_PRESETS = [
  { title: 'Win it back within 5 seconds', looksLike: 'The nearest three press the moment we lose it.' },
  { title: 'Play through the middle', looksLike: 'Show between the lines and play forward.' },
  { title: 'Attack the wide areas', looksLike: 'Get it wide early and cross before they set.' },
  { title: 'Stay compact', looksLike: 'No more than 35 m from back to front.' },
  { title: 'Own the set pieces', looksLike: 'Everyone knows their job at corners and free kicks.' },
  { title: 'React first', looksLike: 'Win it: look forward. Lose it: get back.' },
] as const

export const seasonPlanKey = (coachId: string | undefined, squad: string | null) => ['coach', coachId, 'season-plan', squad] as const
export const seasonObjectivesKey = (coachId: string | undefined, planId: string | undefined) => ['coach', coachId, 'season-objectives', planId] as const

export async function loadSeasonPlan(coachId: string, squad: string): Promise<SeasonPlan | null> {
  const { data, error } = await supabase.from('season_plans').select('id, squad, starts_on, ends_on, shared_at')
    .eq('coach_user_id', coachId).eq('squad', squad).maybeSingle()
  if (error) throw error
  return data
}

export async function loadSeasonObjectives(planId: string): Promise<SeasonObjective[]> {
  const { data, error } = await supabase.from('season_objectives').select('id, place, title, looks_like')
    .eq('plan_id', planId).order('place')
  if (error) throw error
  return data ?? []
}

/** The squad a season plan is for: the picked one, or the only one. None under All, or before the squads load. */
export function planSquad({ squads, squad, everySquad }: { squads: string[]; squad: string | null; everySquad: boolean }): string | null {
  if (squads.length === 1) return squads[0]
  return everySquad ? null : squad
}

/** The squad's plan, read only where the switch is on. `on` is false while the switch is unknown or off; `isPending`
 *  stays true until the switch has answered, so a screen never shows "Not started" for a plan it hasn't asked for. */
export function useSeasonPlan(coachId: string | undefined, squad: string | null) {
  const { on, known } = useFeatureState('season_plan')
  const query = useQuery({
    queryKey: seasonPlanKey(coachId, squad),
    queryFn: () => loadSeasonPlan(coachId!, squad!),
    enabled: on && !!coachId && !!squad,
  })
  return { on, plan: query.data ?? null, isPending: !known || (on && !!squad && query.isPending), error: query.error, retry: () => void query.refetch() }
}

/** "1 September", for "since …" lines. */
export function seasonStartLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}
