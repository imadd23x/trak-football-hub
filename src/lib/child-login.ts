import type { User } from '@supabase/supabase-js'

export const CHILD_LOGIN_DOMAIN = 'child.trakfootball.com'
export function isTechnicalChildAddress(value: string | undefined | null): boolean {
  return value?.trim().split('@')[1]?.toLowerCase() === CHILD_LOGIN_DOMAIN
}
/** Routing hint only. SQL admission checks the identity and academy roster. */
export function isGuardianCreatedChild(user: User | null): boolean {
  return user?.app_metadata?.trak_child_login === true && isTechnicalChildAddress(user.email)
}
export function validateChildUsername(value: string): string | null {
  return /^[a-z0-9._-]{4,30}$/.test(value) && /[0-9]/.test(value)
    ? null : 'Use 4–30 lowercase letters, numbers, dots, underscores or hyphens, including a number'
}
export function childUsername(email: string | undefined): string {
  return isTechnicalChildAddress(email) ? email!.split('@')[0] : ''
}
export function signInAddress(identity: string): string | null {
  const value = identity.trim().toLowerCase()
  if (value.includes('@')) return isTechnicalChildAddress(value) ? null : value
  return validateChildUsername(value) ? null : `${value}@${CHILD_LOGIN_DOMAIN}`
}

/** TRAK-106: why a child-login function refused. Only a 403 is about the guardian's
 * link or approval; Auth's 422 weak_password is about the password itself. */
export type ChildPasswordFailure = 'weak_password' | 'refused' | 'failed'
export class ChildPasswordError extends Error {
  constructor(readonly reason: ChildPasswordFailure) { super(`Child login request failed: ${reason}`) }
}
export const WEAK_PASSWORD_MESSAGE = 'That password is too easy to guess (it appears in known leaks). Choose a different one.'
/** Reads the function's reply from the SDK's FunctionsHttpError (error.context is the Response). */
export async function childPasswordFailure(error: unknown): Promise<ChildPasswordFailure> {
  const response = (error as { context?: { status?: unknown; clone?: () => Response } } | null)?.context
  if (!response || typeof response.status !== 'number') return 'failed'
  if (response.status === 403) return 'refused'
  if (response.status !== 422 || typeof response.clone !== 'function') return 'failed'
  try {
    const body: unknown = await response.clone().json()
    return body && typeof body === 'object' && (body as { reason?: unknown }).reason === 'weak_password' ? 'weak_password' : 'failed'
  } catch { return 'failed' }
}

export interface ChildLoginState {
  roster_child_id: string
  first_name: string
  username: string | null
  ready: boolean
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseChildLogins(data: unknown): ChildLoginState[] {
  if (!Array.isArray(data)) throw new Error('Invalid child login response')
  const ids=new Set<string>()
  return data.map(value=>{
    const r=(value && typeof value==='object' ? value : {}) as Record<string,unknown>
    if(typeof r.roster_child_id!=='string' || !uuid.test(r.roster_child_id) || ids.has(r.roster_child_id)
      || typeof r.first_name!=='string' || !r.first_name.trim() || typeof r.ready!=='boolean'
      || !(r.username===null || (typeof r.username==='string' && !validateChildUsername(r.username)))
      || (r.ready && !r.username)) throw new Error('Invalid child login response')
    ids.add(r.roster_child_id)
    return {roster_child_id:r.roster_child_id,first_name:r.first_name,username:r.username as string|null,ready:r.ready}
  })
}
