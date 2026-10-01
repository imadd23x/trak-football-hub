import { supabase } from '@/integrations/supabase/client'
import { createOnboardingSession } from './onboarding-session'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT, type ConsentPurposeKey } from './consent'
import { parseChildLogins, type ChildLoginState } from './child-login'

export interface AwaitingConsentChild {
  player_user_id: string
  full_name: string
  age_years: number
}

/** TRAK-11 phase 1: a rostered child who has no account yet. First name only. */
export interface RosterAwaitingChild {
  roster_child_id: string
  first_name: string
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

/** Same rules as parseAwaitingConsent, for get_roster_children_awaiting_consent(). */
export function parseRosterAwaitingConsent(data: unknown): RosterAwaitingChild[] {
  if (!Array.isArray(data)) throw new Error('Invalid pending approval response')
  const ids = new Set<string>()
  return data.map((value: unknown) => {
    const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    if (typeof row.roster_child_id !== 'string' || !uuid.test(row.roster_child_id)
      || typeof row.first_name !== 'string' || !row.first_name.trim()
      || typeof row.age_years !== 'number' || !Number.isSafeInteger(row.age_years) || row.age_years < 0) {
      throw new Error('Invalid pending approval response')
    }
    const id = row.roster_child_id.toLowerCase()
    if (ids.has(id)) throw new Error('Duplicate pending approval response')
    ids.add(id)
    return { roster_child_id: id, first_name: row.first_name.trim(), age_years: row.age_years }
  })
}

export async function fetchRosterAwaitingConsent(signal: AbortSignal): Promise<RosterAwaitingChild[]> {
  // `as never`: the generated types predate the phase 1 migration.
  const { data, error } = await supabase.rpc('get_roster_children_awaiting_consent' as never)
    .abortSignal(signal).retry(false)
  if (error) throw error
  return parseRosterAwaitingConsent(data)
}

export async function fetchAwaitingConsent(signal: AbortSignal): Promise<AwaitingConsentChild[]> {
  const { data, error } = await supabase.rpc('get_children_awaiting_consent')
    .abortSignal(signal).retry(false)
  if (error) throw error
  return parseAwaitingConsent(data)
}

/** Keep every write on the account that clicked, even on a shared phone. */
async function verifiedParentClient(expectedParentId: string, signal: AbortSignal) {
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
  return account.client
}

export async function recordParentApproval(
  expectedParentId: string,
  approval: ParentApproval,
  signal: AbortSignal,
): Promise<string> {
  const client = await verifiedParentClient(expectedParentId, signal)
  const { data, error } = await client.rpc('record_parental_consent', {
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

export interface RosterApproval {
  rosterChildId: string
  relationship: 'parent' | 'legal_guardian'
  purposes: Record<ConsentPurposeKey, boolean>
}

/** TRAK-11 phase 1: consent for a rostered child who has no account yet. */
export async function recordRosterApproval(
  expectedParentId: string,
  approval: RosterApproval,
  signal: AbortSignal,
): Promise<string> {
  const client = await verifiedParentClient(expectedParentId, signal)
  const { data, error } = await client.rpc('record_roster_consent' as never, {
    p_roster_child_id: approval.rosterChildId,
    p_relationship: approval.relationship,
    p_purposes: approval.purposes,
    p_notice_version: CONSENT_NOTICE_VERSION,
    p_consent_text: CONSENT_STATEMENT,
  } as never).abortSignal(signal).retry(false)
  if (error) throw error
  if (typeof data !== 'string' || !uuid.test(data)) throw new Error('Unconfirmed approval response')
  return data
}

/** TRAK-11 phase 3: ask Trak to email the child their invitation. True only
    when the email went; the database decides whether this guardian may ask. */
export async function requestChildInvitation(expectedParentId: string, rosterChildId: string, signal: AbortSignal): Promise<boolean> {
  const client = await verifiedParentClient(expectedParentId, signal)
  const { data, error } = await client.functions.invoke('send-roster-invites', { body: { roster_child_id: rosterChildId } })
  const sent = (data as { sent?: unknown } | null)?.sent
  return !error && typeof sent === 'number' && sent > 0
}

export async function fetchMyChildLogins(signal: AbortSignal): Promise<ChildLoginState[]> {
  const {data,error}=await supabase.rpc('get_my_child_logins' as never).abortSignal(signal).retry(false)
  if(error) throw error
  return parseChildLogins(data)
}

export async function createChildLogin(expectedParentId:string,rosterChildId:string,username:string,password:string,signal:AbortSignal) {
  const client=await verifiedParentClient(expectedParentId,signal)
  const {data,error}=await client.functions.invoke('create-child-login',{body:{roster_child_id:rosterChildId,username,password}})
  if(signal.aborted) throw new DOMException('Cancelled','AbortError')
  const reply=data as {username?:unknown;state?:unknown}|null
  if(error || reply?.username!==username || !['created','already_created'].includes(String(reply.state))) {
    throw new Error('Could not create the login. Check its status and try again.')
  }
  return {username,state:reply.state as 'created'|'already_created'}
}
