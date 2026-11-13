import { i18n } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { Format } from '@/lib/games/formations'
import type { XI } from '@/lib/squad/formation-board'

/* TRAK-357 (Season plan 9/18): a squad's saved formations and their starters (row security keeps them to the coach),
   and the three functions that write them: save, delete, and the squad's first three, once. TRAK-360: and which
   matches each was copied to, whether it is the default for its format, and the functions that copy and set it. */

/** A match a formation was copied to ("Set for matchday"). */
export type Copy = { eventId: string; copiedAt: string; label: string; notComing: number; skipped: number }
export type Formation = { id: string; name: string; format: Format; shape: string; starters: XI; isDefault: boolean; copies: Copy[] }
export type FormationDraft = Omit<Formation, 'id' | 'isDefault' | 'copies'>

export const formationsKey = (coachId: string, squad: string) => ['coach', coachId, 'formations', squad] as const
const starterRows = (xi: XI) => Object.entries(xi).map(([slot, id]) => ({ slot: Number(slot), squad_player_id: id }))

export function useFormations(coachId: string, squad: string) {
  return useQuery({
    queryKey: formationsKey(coachId, squad),
    queryFn: async (): Promise<Formation[]> => {
      const { data, error } = await supabase.from('formations')
        .select('id, name, format, shape, is_default, formation_players(slot, squad_player_id), formation_copies(event_id, copied_at, not_coming, skipped, coach_calendar_events(opponent, title))')
        .eq('squad', squad).order('created_at')
      if (error) throw error
      return (data ?? []).map(row => ({
        id: row.id, name: row.name, format: row.format as Format, shape: row.shape,
        starters: Object.fromEntries((row.formation_players ?? []).map(p => [p.slot, p.squad_player_id])),
        isDefault: row.is_default === true,
        copies: (row.formation_copies ?? []).map(c => ({
          eventId: c.event_id, copiedAt: c.copied_at, notComing: c.not_coming, skipped: c.skipped,
          label: c.coach_calendar_events?.opponent ? i18n.t('coachSchedule:vsOpponent', { opponent: c.coach_calendar_events.opponent }) : c.coach_calendar_events?.title ?? i18n.t('coachSquad:fmAMatch'),
        })).sort((a, b) => b.copiedAt.localeCompare(a.copiedAt)),
      }))
    },
  })
}

/** Why a write was refused, in the coach's words; null for a dropped connection. */
export function refusal(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') return i18n.t('coachSquad:fmNameTaken')
  if (code === '42501') return i18n.t('coachSquad:fmPlayerGone')
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
  // TRAK-360: copies of a formation into matches; the matches' plans and line-ups are read again.
  const use = useMutation({
    mutationFn: async ({ id, eventIds }: { id: string; eventIds: string[] }) => {
      const { error } = await supabase.rpc('use_formation_for_matches', { p_formation_id: id, p_event_ids: eventIds })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['coach', coachId, 'game-plan'] }),
        client.invalidateQueries({ queryKey: ['coach', coachId, 'game-players'] }), client.invalidateQueries({ queryKey: ['coach', coachId, 'game-plans'] })])
    },
  })
  // TRAK-453: Undo after a copy puts each match back to what it held, and removes the copy's record.
  const undoCopy = useMutation({
    mutationFn: async ({ id, eventIds }: { id: string; eventIds: string[] }) => {
      const { error } = await supabase.rpc('undo_formation_copy', { p_formation_id: id, p_event_ids: eventIds })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['coach', coachId, 'game-plan'] }),
        client.invalidateQueries({ queryKey: ['coach', coachId, 'game-players'] }), client.invalidateQueries({ queryKey: ['coach', coachId, 'game-plans'] })])
    },
  })
  const setDefault = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const { error } = await supabase.rpc('set_default_formation', { p_id: id, p_default: on })
      if (error) throw error
    },
    onSuccess: refresh,
  })
  return { save, remove, start, use, undoCopy, setDefault }
}

/** TRAK-360: which of these matches already have a saved line-up, so the coach is asked before it is replaced. */
export function useSavedLineUps(eventIds: string[]) {
  return useQuery({
    queryKey: ['coach', 'saved-line-ups', [...eventIds].sort().join(',')],
    enabled: eventIds.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('game_plan_players').select('event_id').in('event_id', eventIds)
      if (error) throw error
      return new Set((data ?? []).map(row => row.event_id))
    },
  })
}
