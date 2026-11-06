import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { ObjectivePick } from '@/lib/player-objectives'

/* TRAK-354 (Season plan 6/18): every objective of the coach's players (row security keeps it to theirs), and the
   one save that writes a player's list. TRAK-356: the ones removed after sharing come too, for their history. */

export type PlayerObjective = ObjectivePick & { id: string; since: string }
/** TRAK-356: removed once the plan was shared, kept with when it was given and removed. */
export type RemovedPlayerObjective = { id: string; title: string; since: string; removed: string }

export const playerObjectivesKey = (coachId: string) => ['coach', coachId, 'player-objectives'] as const

const listOf = <T>(map: Map<string, T[]>, id: string) => map.get(id) ?? map.set(id, []).get(id)!

async function loadPlayerObjectives() {
  const { data, error } = await supabase.from('player_objectives')
    .select('id, squad_player_id, title, source, season_objective_id, created_at, status, retired_at').order('slot')
  if (error) throw error
  const open = new Map<string, PlayerObjective[]>()
  const removed = new Map<string, RemovedPlayerObjective[]>()
  // A row with no status is open.
  for (const row of data ?? []) {
    if (row.status === 'retired' && row.retired_at) listOf(removed, row.squad_player_id).push({ id: row.id, title: row.title, since: row.created_at, removed: row.retired_at })
    else listOf(open, row.squad_player_id).push({ id: row.id, title: row.title, source: row.source === 'own' ? 'own' : 'library', seasonObjectiveId: row.season_objective_id, since: row.created_at })
  }
  for (const list of removed.values()) list.sort((a, b) => b.removed.localeCompare(a.removed))
  return { open, removed }
}

const NONE: PlayerObjective[] = []
const NONE_REMOVED: RemovedPlayerObjective[] = []

/** `of(id)` is a player's open objectives, in their places; `removedOf(id)`, the ones removed since sharing, latest first. */
export function usePlayerObjectives(coachId: string | undefined, enabled = true) {
  const query = useQuery({ queryKey: playerObjectivesKey(coachId ?? ''), queryFn: loadPlayerObjectives, enabled: !!coachId && enabled })
  return { ...query, of: (id: string) => query.data?.open.get(id) ?? NONE, removedOf: (id: string) => query.data?.removed.get(id) ?? NONE_REMOVED }
}

export function useSavePlayerObjectives(coachId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, picked }: { id: string; picked: ObjectivePick[] }) => {
      const objectives = picked.map(o => ({ title: o.title, source: o.source, season_objective_id: o.seasonObjectiveId }))
      const { error } = await supabase.rpc('save_player_objectives', { p_squad_player_id: id, p_objectives: objectives })
      if (error) throw error
    },
    // Waited for, so the list behind the sheet already shows the save when the sheet moves on or closes. A shared plan
    // now lists the player under Not shared yet (TRAK-356).
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: playerObjectivesKey(coachId) }),
      client.invalidateQueries({ queryKey: ['coach', coachId, 'season-plan'] }),
    ]),
  })
}
