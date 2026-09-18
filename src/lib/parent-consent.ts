import { supabase } from '@/integrations/supabase/client'
import { createOnboardingSession } from './onboarding-session'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT, type ConsentPurposeKey } from './consent'

export interface AwaitingConsentChild {
  player_user_id: string
  full_name: string
  age_years: number
}

export interface ParentApproval {
  playerUserId: string
  relationship: 'parent' | 'legal_guardian'
  purposes: Record<ConsentPurposeKey, boolean>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An empty array is meaningful; a missing or malformed response is not. */
export function parseAwaitingConsent(data: unknown): AwaitingConsentChild[] {
  if (!Array.isArray(data)) throw new Error('Invalid pending approval response')
  const ids = new Set<string>()
  return data.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid pending approval response')
    const row = value as Record<string, unknown>
    if (typeof row.player_user_id !== 'string' || !uuid.test(row.player_user_id)
      || typeof row.full_name !== 'string' || !row.full_name.trim()
      || typeof row.age_years !== 'number' || !Number.isSafeInteger(row.age_years) || row.age_years < 0) {
      throw new Error('Invalid pending approval response')
    }
    const id = row.player_user_id.toLowerCase()
    if (ids.has(id)) throw new Error('Duplicate pending approval response')
    ids.add(id)
    return { player_user_id: id, full_name: row.full_name.trim(), age_years: row.age_years }
  })
}

export async function fetchAwaitingConsent(signal: AbortSignal): Promise<AwaitingConsentChild[]> {
  const { data, error } = await supabase.rpc('get_children_awaiting_consent')
    .abortSignal(signal).retry(false)
  if (error) throw error
  return parseAwaitingConsent(data)
}

/** Keep the approval on the account that clicked Save, even on a shared phone. */
export async function recordParentApproval(
  expectedParentId: string,
  approval: ParentApproval,
  signal: AbortSignal,
): Promise<string> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!sessionData.session || sessionData.session.user.id !== expectedParentId) {
    throw new Error('Your account changed')
  }
  const account = await createOnboardingSession(sessionData.session)
  if (signal.aborted) throw new DOMException('Approval cancelled', 'AbortError')
  if (!account.user.email || !account.user.email_confirmed_at) throw new Error('Verify your email first')
  const { data: profile, error: profileError } = await account.client.from('profiles')
    .select('role').eq('user_id', expectedParentId).abortSignal(signal).maybeSingle()
  if (profileError) throw profileError
  if (profile?.role !== 'parent') throw new Error('Use your parent account')
  if (signal.aborted) throw new DOMException('Approval cancelled', 'AbortError')
  const { data, error } = await account.client.rpc('record_parental_consent', {
    p_player_user_id: approval.playerUserId,
    p_relationship: approval.relationship,
    p_purposes: approval.purposes,
    p_notice_version: CONSENT_NOTICE_VERSION,
    p_consent_text: CONSENT_STATEMENT,
  }).abortSignal(signal).retry(false)
  if (error) throw error
  if (typeof data !== 'string' || !uuid.test(data)) throw new Error('Unconfirmed approval response')
  return data
}
