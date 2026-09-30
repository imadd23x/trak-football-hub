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
