import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Format } from '@/lib/games/formations'
import type { XI } from '@/lib/squad/formation-board'

/* TRAK-357 (Season plan 9/18): a squad's saved formations and their starters (row security keeps them to the coach),
   and the three functions that write them: save, delete, and the squad's first three, once. */

export type Formation = { id: string; name: string; format: Format; shape: string; starters: XI }
export type FormationDraft = Omit<Formation, 'id'>

export const formationsKey = (coachId: string, squad: string) => ['coach', coachId, 'formations', squad] as const
const starterRows = (xi: XI) => Object.entries(xi).map(([slot, id]) => ({ slot: Number(slot), squad_player_id: id }))

export function useFormations(coachId: string, squad: string) {
  return useQuery({
    queryKey: formationsKey(coachId, squad),
    queryFn: async (): Promise<Formation[]> => {
      const { data, error } = await supabase.from('formations')
        .select('id, name, format, shape, formation_players(slot, squad_player_id)').eq('squad', squad).order('created_at')
      if (error) throw error
      return (data ?? []).map(row => ({
        id: row.id, name: row.name, format: row.format as Format, shape: row.shape,
        starters: Object.fromEntries((row.formation_players ?? []).map(p => [p.slot, p.squad_player_id])),
      }))
    },
  })
}

/** Why a write was refused, in the coach's words; null for a dropped connection. */
export function refusal(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') return 'You already have a formation with that name in this squad.'
  if (code === '42501') return "One of these players can't be picked any more: they left the squad, or consent isn't in place. Take them off and save again."
  return null
}

export function useFormationWrites(coachId: string, squad: string) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: formationsKey(coachId, squad) })
  const save = useMutation({
    mutationFn: async ({ id, draft }: { id: string | null; draft: FormationDraft }) => {
      const { data, error } = await supabase.rpc('save_formation', {
        p_id: id, p_squad: squad, p_name: draft.name, p_format: draft.format, p_shape: draft.shape, p_starters: starterRows(draft.starters),
      })
      if (error) throw error
      return data
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_formation', { p_id: id })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const start = useMutation({
    mutationFn: async (drafts: FormationDraft[]) => {
      const { data, error } = await supabase.rpc('start_formations', {
        p_squad: squad, p_formations: drafts.map(d => ({ name: d.name, format: d.format, shape: d.shape, starters: starterRows(d.starters) })),
      })
      if (error) throw error
      return data
    },
    onSuccess: refresh,
  })
  return { save, remove, start }
}
