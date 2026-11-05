import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { isPosition, type Position } from '@/lib/positions'
import type { Tables } from '@/integrations/supabase/types'

/* TRAK-353 (Season plan 5/18): every player's Can also play and roles, for the coach (row security keeps it to
   theirs), and the one save that writes a player's main position, Can also play and roles together. Only the
   main position has a history (Tarek, 5 Nov). */

export type PlayerRoles = { also: Position[]; roles: string[] }
export type PositionChange = { from: string | null; to: string; at: string }

export const playerRolesKey = (coachId: string) => ['coach', coachId, 'player-roles'] as const
const historyKey = (coachId: string, playerId: string) => ['coach', coachId, 'position-history', playerId] as const
const NONE: PlayerRoles = { also: [], roles: [] }

async function loadPlayerRoles() {
  const [also, roles] = await Promise.all([
    supabase.from('squad_player_also_plays').select('squad_player_id, position').order('added_at'),
    supabase.from('squad_player_roles').select('squad_player_id, role').order('added_at'),
  ])
  if (also.error) throw also.error
  if (roles.error) throw roles.error
  const byPlayer = new Map<string, PlayerRoles>()
  const of = (id: string) => byPlayer.get(id) ?? byPlayer.set(id, { also: [], roles: [] }).get(id)!
  for (const row of also.data ?? []) if (isPosition(row.position)) of(row.squad_player_id).also.push(row.position)
  for (const row of roles.data ?? []) of(row.squad_player_id).roles.push(row.role)
  return { byPlayer, held: (roles.data ?? []).map(row => row.role) }
}

/** `of(id)` is a player's Can also play and roles; `held` every role across the coach's players. */
export function usePlayerRoles(coachId: string | undefined, enabled = true) {
  const query = useQuery({ queryKey: playerRolesKey(coachId ?? ''), queryFn: loadPlayerRoles, enabled: !!coachId && enabled })
  return { ...query, of: (id: string) => query.data?.byPlayer.get(id) ?? NONE, held: query.data?.held ?? [] }
}

/** A player's main-position changes, newest first. */
export function usePositionHistory(coachId: string, playerId: string, enabled: boolean) {
  return useQuery({
    queryKey: historyKey(coachId, playerId), enabled,
    queryFn: async (): Promise<PositionChange[]> => {
      const { data, error } = await supabase.from('squad_position_history').select('from_position, to_position, changed_at')
        .eq('squad_player_id', playerId).order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map(row => ({ from: row.from_position, to: row.to_position, at: row.changed_at }))
    },
  })
}

export function useSavePositionAndRoles(coachId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, position, also, roles }: { id: string; position: Position } & PlayerRoles) => {
      const { error } = await supabase.rpc('save_player_position_and_roles', { p_squad_player_id: id, p_position: position, p_also_plays: also, p_roles: roles })
      if (error) throw error
    },
    onSuccess: (_saved, { id, position, also, roles }) => {
      // The roster everyone shares (Home, Squad, Positions) gets the main position at once, and the coach's lists the
      // new choices, so a role just written shows for the next player before the lists are read again.
      client.setQueryData<Tables<'squad_players'>[]>(['coach', coachId, 'squad-roster', 'players'],
        rows => rows?.map(row => (row.id === id ? { ...row, position } : row)))
      client.setQueryData<Awaited<ReturnType<typeof loadPlayerRoles>>>(playerRolesKey(coachId), current => {
        if (!current) return current
        const before = current.byPlayer.get(id)?.roles ?? []
        const held = [...current.held]
        for (const role of before) held.splice(held.indexOf(role), 1)
        return { byPlayer: new Map(current.byPlayer).set(id, { also, roles }), held: [...held, ...roles] }
      })
      void client.invalidateQueries({ queryKey: playerRolesKey(coachId) })
      void client.invalidateQueries({ queryKey: historyKey(coachId, id) })
    },
  })
}
