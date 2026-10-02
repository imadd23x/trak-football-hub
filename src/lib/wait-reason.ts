import { supabase } from '@/integrations/supabase/client'

/* TRAK-99 (J5): why a player the consent gate refuses isn't ready yet.
   'parent': no guardian has approved (or the approval was withdrawn).
   'signup': a guardian has approved; the child hasn't set up their account.
   Display only: the database refuses the write either way. */
export type WaitReason = 'parent' | 'signup'

/** null when the read fails or disagrees with the gate: the screen never guesses a reason. */
export async function fetchWaitReason(squadPlayerId: string): Promise<WaitReason | null> {
  const { data, error } = await supabase.rpc('coach_squad_player_wait_reason' as never, { p_squad_player_id: squadPlayerId } as never)
  if (error) return null
  return data === 'parent' || data === 'signup' ? data : null
}

export const WAIT_TITLE: Record<WaitReason | 'unknown', string> = {
  parent: 'Waiting for a parent',
  signup: 'Waiting for the player to sign up',
  unknown: 'Not ready to assess yet',
}

export function waitText(reason: WaitReason | null, name: string): string {
  if (reason === 'parent') return `You can assess ${name} once a parent has approved their account.`
  if (reason === 'signup') return `A parent has approved. You can assess ${name} once they've set up their Trak account.`
  return `You can assess ${name} once a parent has approved and they've set up their Trak account.`
}
