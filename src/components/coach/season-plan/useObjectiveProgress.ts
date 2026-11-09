import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { isProgress, type ProgressRow } from '@/lib/objective-progress'
import { playerObjectivesKey } from './usePlayerObjectives'

/* TRAK-365 (Season plan 17/18): every status the coach has published for their players' objectives (row security
   keeps it to theirs), the objectives the database says are stuck, and the one call that records the coach's choice. */

export const objectiveProgressKey = (coachId: string) => ['coach', coachId, 'objective-progress'] as const
export const stuckObjectivesKey = (coachId: string) => ['coach', coachId, 'stuck-objectives'] as const

async function loadProgress(): Promise<ProgressRow[]> {
  const { data, error } = await supabase.from('objective_progress').select('player_objective_id, status, season_evaluations(due_on)').retry(false)
  if (error) throw error
  return (data ?? []).flatMap(row => {
    const evaluation = Array.isArray(row.season_evaluations) ? row.season_evaluations[0] : row.season_evaluations
    return evaluation?.due_on && isProgress(row.status) ? [{ objectiveId: row.player_objective_id, status: row.status, dueOn: evaluation.due_on }] : []
  })
}

export function useObjectiveProgress(coachId: string | undefined, enabled = true) {
  return useQuery({ queryKey: objectiveProgressKey(coachId ?? ''), queryFn: loadProgress, enabled: !!coachId && enabled })
}

export type StuckObjective = { player_objective_id: string; squad_player_id: string }

/** The coach's objectives with three Not yets in a row. Only asked where there is an evaluation to have been stuck in. */
export function useStuckObjectives(coachId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: stuckObjectivesKey(coachId ?? ''), enabled: !!coachId && enabled,
    queryFn: async (): Promise<StuckObjective[]> => {
      const { data, error } = await supabase.rpc('stuck_player_objectives')
      if (error) throw error
      return data ?? []
    },
  })
}

export type StuckChoice = { choice: 'simpler'; title: string } | { choice: 'keep_going' } | { choice: 'swap' }

export function useResolveStuck(coachId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, choice }: { id: string; choice: StuckChoice }) => {
      const { error } = await supabase.rpc('resolve_stuck_objective', {
        p_player_objective_id: id, p_choice: choice.choice, p_title: choice.choice === 'simpler' ? choice.title : undefined,
      })
      if (error) throw error
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: stuckObjectivesKey(coachId) }),
      client.invalidateQueries({ queryKey: playerObjectivesKey(coachId) }),
      client.invalidateQueries({ queryKey: ['coach', coachId, 'season-plan'] }),
    ]),
  })
}
