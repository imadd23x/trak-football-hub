import { parseChildLogins } from './child-login'
import { verifiedParentClient } from './parent-consent'

export interface ChildCredential {
  roster_child_id: string
  first_name: string
  username: string
}
export function parseChildCredentials(data: unknown): ChildCredential[] {
  if (!Array.isArray(data)) throw new Error('Invalid child credential response')
  const logins = parseChildLogins(data.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid child credential response')
    return { ...value, ready: true }
  }))
  return logins.map(({ roster_child_id, first_name, username }) => {
    if (!username) throw new Error('Invalid child credential response')
    return { roster_child_id, first_name, username }
  })
}
export async function fetchChildCredentials(parentId: string, signal: AbortSignal): Promise<ChildCredential[]> {
  const client = await verifiedParentClient(parentId, signal)
  const { data, error } = await client.rpc('get_my_child_credentials' as never).abortSignal(signal).retry(false)
  if (error) throw new Error('Could not load child logins')
  return parseChildCredentials(data)
}
/** TRAK-104: 'signed_out' when every device was signed out too; 'signout_failed' when only the password changed. */
export type ChildPasswordResult = 'signed_out' | 'signout_failed'
export async function resetChildPassword(parentId: string, childId: string, password: string, signal: AbortSignal): Promise<ChildPasswordResult> {
  const client = await verifiedParentClient(parentId, signal)
  const { data, error } = await client.functions.invoke('reset-child-password', {
    body: { roster_child_id: childId, password }, signal,
  })
  if (signal.aborted) throw new DOMException('Password update cancelled', 'AbortError')
  const response: unknown = data
  const state = !error && response && typeof response === 'object' && 'state' in response ? response.state : null
  if (state === 'password_updated') return 'signed_out'
  if (state === 'password_updated_signout_failed') return 'signout_failed'
  throw new Error('Could not set the password. Please try again.')
}
