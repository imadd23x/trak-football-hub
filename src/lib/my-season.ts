import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { Database } from '@/integrations/supabase/types'
import type { Progress } from '@/lib/objective-progress'

/* TRAK-397, TRAK-398 (Season plan 18/18 builds 2 and 3, spec TRAK-366): what a player reads of their season plan. One
   read, season_plan_for_player() (TRAK-396): the plan as the coach last SHARED it, or no row at all when the coach has
   not shared this player, the academy's switch is off, or consent is withdrawn. The database decides every one of
   those; the app never checks them again. The family builds (399, 400) read the same function with p_child. */

type Row = Database['public']['Functions']['season_plan_for_player']['Returns'][number]
export type MySeasonObjective = { id: string; place: number; title: string; looks_like: string }
export type MyObjective = {
  id: string; slot: number; title: string; status: 'open' | 'met'
  /** The latest published evaluation's word; null before the first. */
  current: Progress | null
  supports: string | null
  /** One entry per published evaluation, oldest first. */
  history: { due_on: string; status: Progress }[]
}
export type MySeason = Omit<Row, 'objectives' | 'season_objectives'> & { objectives: MyObjective[]; season_objectives: MySeasonObjective[] }

export const mySeasonKey = (userId: string | undefined, child?: string) => ['season-plan-for-player', userId, child ?? null] as const

/** `enabled` false asks for nothing: a guardian with no child chosen yet must not ask for a plan of their own. */
export function useMySeason(child?: string, enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: mySeasonKey(user?.id, child),
    enabled: !!user && enabled,
    queryFn: async (): Promise<MySeason | null> => {
      const { data, error } = await supabase.rpc('season_plan_for_player', child ? { p_child: child } : {})
      if (error) throw error
      // A player is in one squad; if there were two, the oldest shows.
      return (data?.[0] as unknown as MySeason | undefined) ?? null
    },
  })
}

/** Opening the page, or Got it: not a sign-off, and the coach never reads it. */
export function useMarkSeen(child?: string) {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_season_plan_seen', child ? { p_child: child } : {})
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: mySeasonKey(user?.id, child) }),
  })
}

/** The word a player's objective shows: Met once closed, otherwise the latest evaluation's, nothing before the first. */
export const objectiveWord = (o: Pick<MyObjective, 'status' | 'current'>): Progress | null => (o.status === 'met' ? 'met' : o.current)
