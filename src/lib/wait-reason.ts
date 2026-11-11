import { i18n } from '@/lib/i18n'
import { supabase } from '@/integrations/supabase/client'

/* TRAK-99 (J5): why a player the consent gate refuses isn't ready yet.
   'parent': no guardian has approved (or the approval was withdrawn).
   'signup': a guardian has approved; the child hasn't set up their account.
   'player': from the academy's consent age the player agrees for themselves (TRAK-177).
   Display only: the database refuses the write either way. */
export type WaitReason = 'parent' | 'signup' | 'player'

/** null when the read fails or disagrees with the gate: the screen never guesses a reason. */
export async function fetchWaitReason(squadPlayerId: string): Promise<WaitReason | null> {
  const { data, error } = await supabase.rpc('coach_squad_player_wait_reason' as never, { p_squad_player_id: squadPlayerId } as never)
  if (error) return null
  return data === 'parent' || data === 'signup' || data === 'player' ? data : null
}

export const WAIT_TITLE: Record<WaitReason | 'unknown', string> = {
  parent: 'Waiting for a parent',
  signup: 'Waiting for the player to sign up',
  player: 'Waiting for the player to agree',
  unknown: 'Not ready to assess yet',
}

export function waitText(reason: WaitReason | null, name: string): string {
  // TRAK-407: in the language showing (English as it was).
  if (reason === 'parent') return i18n.t('coachAssess:waitText_parent', { name })
  if (reason === 'player') return i18n.t('coachAssess:waitText_player', { name })
  if (reason === 'signup') return i18n.t('coachAssess:waitText_signup', { name })
  return i18n.t('coachAssess:waitText_unknown', { name })
}
