import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { PlayerFaces } from '@/components/trak/PlayerFace'
import type { HairPick } from '@/lib/player-face'

const KEY = (coachId: string | undefined) => ['coach', coachId, 'player-avatars'] as const
const NONE: ReadonlyMap<string, HairPick> = new Map()

/**
 * TRAK-617: the avatar each of the coach's players has where the coach selected one, by squad player id. The rows are
 * the coach's own facts about their players (TRAK-260), so the database returns only this coach's players.
 */
export function usePlayerAvatars(coachId: string | undefined) {
  return useQuery({
    queryKey: KEY(coachId),
    enabled: !!coachId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('squad_player_profiles')
        .select('squad_player_id, face_hair_style, face_hair_colour')
        .not('face_hair_style', 'is', null)
      if (error) throw error
      const picks = new Map<string, HairPick>()
      for (const row of data ?? []) {
        if (row.face_hair_style != null && row.face_hair_colour != null) picks.set(row.squad_player_id, { style: row.face_hair_style, colour: row.face_hair_colour })
      }
      return picks as ReadonlyMap<string, HairPick>
    },
  })
}

/** Every coach screen draws a player's face with the avatar the coach selected. Until it loads, or if it fails, faces
 *  come from the name, as before: a face is never held back for it. */
export function PlayerAvatarsProvider({ coachId, children }: { coachId: string; children: ReactNode }) {
  const picks = usePlayerAvatars(coachId).data ?? NONE
  return <PlayerFaces.Provider value={picks}>{children}</PlayerFaces.Provider>
}

/** Saves one player's avatar; `null` returns it to the one from their name. Only the avatar's columns are written, so
 *  the player's foot, nationality and traits stay as they are. */
export function useSavePlayerAvatar(coachId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pick }: { id: string; pick: HairPick | null }) => {
      const { error } = await supabase.from('squad_player_profiles')
        .upsert({ squad_player_id: id, face_hair_style: pick?.style ?? null, face_hair_colour: pick?.colour ?? null }, { onConflict: 'squad_player_id' })
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY(coachId) }),
  })
}
