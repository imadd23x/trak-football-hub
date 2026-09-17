import type { User } from '@supabase/supabase-js'

const usersByToken = new Map<string, User>()
let sequence = 0

/** Synthetic Auth records are bound to issued tokens, never current storage. */
export function registerAuthUser(user: User): string {
  const token = `synthetic-test-token-${++sequence}`
  usersByToken.set(token, structuredClone(user))
  return token
}

export function authUserForToken(token: string): User | undefined {
  const user = usersByToken.get(token)
  return user ? structuredClone(user) : undefined
}

export function resetAuthUsers(): void {
  usersByToken.clear()
}
