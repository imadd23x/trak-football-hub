import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useFeatureState } from '@/components/trak/parked'
import { loadSeasonPlan, seasonPlanKey, type SeasonPlan } from '@/lib/season-plan'
import { evaluationDates, evaluationDue, rhythmOf, type EvaluationDue } from '@/lib/evaluation'
import { dayIn } from '@/lib/watch-first'
import { useAcademyTimeZone } from './useWatching'

/* TRAK-364 (Season plan 16/18): where each of the coach's squads stands with its evaluation. Only where the season
   plan is on, and only for a squad whose plan is shared: there the evaluation replaces the per-player Assess
   reminders (TRAK-197). Days are the academy's, in its time zone; the evaluations and the time zone are read only
   once some plan is shared, so a coach without one asks for nothing new. */

export const seasonEvaluationsKey = (coachId: string | undefined) => ['coach', coachId, 'season-evaluations'] as const

/** The coach's published evaluations: which plan, and the date each closed. */
export async function loadSeasonEvaluations(): Promise<{ plan_id: string; due_on: string }[]> {
  const { data, error } = await supabase.from('season_evaluations').select('plan_id, due_on')
  if (error) throw error
  return data ?? []
}

/** Each squad's plan, read only where the switch is on (the same reads as useSeasonPlan(), so they're shared). `shared`
 *  names the squads whose plan is shared; `ready` is false until the switch and every plan have answered. */
export function useSharedPlans(coachId: string | undefined, squads: string[]) {
  const { on, known } = useFeatureState('season_plan')
  const reads = useQueries({
    queries: squads.map(squad => ({
      queryKey: seasonPlanKey(coachId, squad),
      queryFn: () => loadSeasonPlan(coachId!, squad),
      enabled: on && !!coachId,
    })),
  })
  const plans = reads.flatMap((read, i) => (read.data?.shared_at ? [{ squad: squads[i], plan: read.data }] : []))
  const failed = on && reads.some(read => read.isError)
  const ready = known && (!on || failed || reads.every(read => !read.isPending))
  const key = plans.map(p => `${p.squad}:${p.plan.id}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shared plans themselves, not the array's identity
  const shared = useMemo(() => new Set(plans.map(p => p.squad)), [key])
  return { on, plans, shared, ready, failed, retry: () => { reads.forEach(read => { void read.refetch() }) } }
}

/** `sharedOn` and `lastDueOn` are what the dates count from: the day the plan was first shared, the last evaluation. */
export type SquadEvaluation = { squad: string; plan: SeasonPlan; due: EvaluationDue; sharedOn: string; lastDueOn: string | null }

/** Each shared plan's evaluation: what's due and what's next, on the academy's `today`. */
export function useSquadEvaluations(coachId: string | undefined, squads: string[]) {
  const shared = useSharedPlans(coachId, squads)
  const some = shared.plans.length > 0
  const zone = useAcademyTimeZone(coachId, some)
  const evaluations = useQuery({ queryKey: seasonEvaluationsKey(coachId), queryFn: loadSeasonEvaluations, enabled: some && !!coachId })
  const failed = shared.failed || (some && (zone.isError || evaluations.isError))
  const ready = shared.ready && (failed || !some || (!zone.isPending && !evaluations.isPending))
  const today = dayIn(zone.zone, new Date())
  const list: SquadEvaluation[] = !ready || failed ? [] : shared.plans.map(({ squad, plan }) => {
    const { every, day } = rhythmOf(plan)
    const lastDueOn = (evaluations.data ?? []).filter(e => e.plan_id === plan.id).map(e => e.due_on).sort().at(-1) ?? null
    const sharedOn = dayIn(zone.zone, new Date(plan.shared_at!))
    return {
      squad, plan, sharedOn, lastDueOn,
      due: evaluationDue({ dates: evaluationDates({ startsOn: plan.starts_on, endsOn: plan.ends_on, every, day }), sharedOn, lastDueOn, today }),
    }
  })
  return {
    list, today, zone: zone.zone, ready, failed,
    /** The squads whose per-player Assess reminders give way to the evaluation: the plan is shared. */
    evaluated: shared.shared,
    retry: () => { shared.retry(); void zone.refetch(); void evaluations.refetch() },
  }
}
