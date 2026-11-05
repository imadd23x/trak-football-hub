import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { ObjectivePick } from '@/lib/player-objectives'

/* TRAK-354 (Season plan 6/18): every open objective of the coach's players (row security keeps it to theirs), and
   the one save that writes a player's list. */

export type PlayerObjective = ObjectivePick & { id: string; since: string }

export const playerObjectivesKey = (coachId: string) => ['coach', coachId, 'player-objectives'] as const

async function loadPlayerObjectives() {
  const { data, error } = await supabase.from('player_objectives')
    .select('id, squad_player_id, title, source, season_objective_id, created_at').eq('status', 'open').order('slot')
  if (error) throw error
  const byPlayer = new Map<string, PlayerObjective[]>()
  for (const row of data ?? []) {
    const list = byPlayer.get(row.squad_player_id) ?? byPlayer.set(row.squad_player_id, []).get(row.squad_player_id)!
    list.push({ id: row.id, title: row.title, source: row.source === 'own' ? 'own' : 'library', seasonObjectiveId: row.season_objective_id, since: row.created_at })
  }
  return byPlayer
}

const NONE: PlayerObjective[] = []

/** `of(id)` is a player's open objectives, in their places. */
export function usePlayerObjectives(coachId: string | undefined, enabled = true) {
  const query = useQuery({ queryKey: playerObjectivesKey(coachId ?? ''), queryFn: loadPlayerObjectives, enabled: !!coachId && enabled })
  return { ...query, of: (id: string) => query.data?.get(id) ?? NONE }
}

export function useSavePlayerObjectives(coachId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, picked }: { id: string; picked: ObjectivePick[] }) => {
      const objectives = picked.map(o => ({ title: o.title, source: o.source, season_objective_id: o.seasonObjectiveId }))
      const { error } = await supabase.rpc('save_player_objectives', { p_squad_player_id: id, p_objectives: objectives })
      if (error) throw error
    },
    // Waited for, so the list behind the sheet already shows the save when the sheet moves on or closes.
    onSuccess: () => client.invalidateQueries({ queryKey: playerObjectivesKey(coachId) }),
  })
}
