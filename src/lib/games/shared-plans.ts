import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { PlayerEvent } from '@/lib/player-events'
import { sharedPlan, type SharedPlan } from './share'

/* TRAK-286 (Games 4/8): a child's shared game plans, read as the child or as one of their guardians. The database
   opens only that child's copies, and the note to the child alone (game_for_family, game_for_player); a match that's
   cancelled, or an academy with Games off, opens none. Read through the child's roster rows, as "Can't make it" is. */

/** The child's roster rows: their copies are keyed by these. Also read by the reviews (TRAK-289). */
export async function rosterRows(childId: string, signal: AbortSignal) {
  const { data, error } = await supabase.from('squad_players').select('id').eq('linked_player_id', childId)
    .abortSignal(signal).retry(false)
  if (error) throw error
  return data ?? []
}

/** One match's plan as this reader may read it, or null when it isn't shared with this child. The coach's name comes
 *  with the copy: a player can't read their coach's profile (TRAK-300). */
export async function fetchSharedPlan(childId: string, eventId: string, asPlayer: boolean, signal: AbortSignal):
  Promise<{ plan: SharedPlan; coachName: string | null } | null> {
  const rows = await rosterRows(childId, signal)
  if (!rows.length) return null
  const { data: family, error } = await supabase.from('game_for_family').select('squad_player_id, role, job, has_note, changed_at, coach_name')
    .eq('event_id', eventId).in('squad_player_id', rows.map(row => row.id)).abortSignal(signal).retry(false).maybeSingle()
  if (error) throw error
  if (!family) return null
  const player = asPlayer ? await supabase.from('game_for_player').select('goals, note, changed_at').eq('event_id', eventId)
    .eq('squad_player_id', family.squad_player_id).abortSignal(signal).retry(false).maybeSingle() : null
  if (player?.error) throw player.error
  return { plan: sharedPlan(family, player?.data ?? null), coachName: family.coach_name.trim() || null }
}

/** The child's matches with a shared plan: true when a later share changed it for this reader. */
export async function fetchSharedPlans(childId: string, asPlayer: boolean, signal: AbortSignal): Promise<Map<string, boolean>> {
  const ids = (await rosterRows(childId, signal)).map(row => row.id)
  if (!ids.length) return new Map()
  const [family, player] = await Promise.all([
    supabase.from('game_for_family').select('event_id, changed_at').in('squad_player_id', ids).abortSignal(signal).retry(false),
    asPlayer ? supabase.from('game_for_player').select('event_id, changed_at').in('squad_player_id', ids).abortSignal(signal).retry(false) : null,
  ])
  if (family.error) throw family.error
  if (player?.error) throw player.error
  const plans = new Map((family.data ?? []).map(row => [row.event_id, row.changed_at != null]))
  for (const row of player?.data ?? []) if (row.changed_at != null && plans.has(row.event_id)) plans.set(row.event_id, true)
  return plans
}

export function useSharedPlan(event: PlayerEvent, childId: string, asPlayer: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['shared-plan', user?.id, childId, event.id, asPlayer],
    queryFn: ({ signal }) => fetchSharedPlan(childId, event.id, asPlayer, signal),
    enabled: !!user && event.kind === 'match',
    networkMode: 'always',
  })
}

export function useSharedPlans(childId: string | undefined, asPlayer: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['shared-plans', user?.id, childId, asPlayer],
    queryFn: ({ signal }) => fetchSharedPlans(childId!, asPlayer, signal),
    enabled: !!user && !!childId,
    networkMode: 'always',
  })
}

/** The event card's badge: none, Plan shared, or Updated, which lasts until kick-off (Imad, 28 Oct). */
export const planBadge = (updated: boolean | undefined, event: Pick<PlayerEvent, 'startsAt'>, now = Date.now()) =>
  updated === undefined ? null : updated && (!event.startsAt || now < Date.parse(event.startsAt)) ? 'updated' as const : 'shared' as const
