import { expect, it } from 'vitest'
import { signInAs } from '../support/session'
import { SUPABASE_URL } from './supabase'

function currentToken(): string {
  return JSON.parse(localStorage.getItem('sb-test-auth-token')!).access_token
}

it('returns the issued token owner even after another account replaces browser storage', async () => {
  signInAs({ id: 'account-a', email: 'a@example.test' })
  const tokenA = currentToken()
  signInAs({ id: 'account-b', email: 'b@example.test' })
  const tokenB = currentToken()
  for (const [token, id] of [[tokenA, 'account-a'], [tokenB, 'account-b']]) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id, email_confirmed_at: expect.any(String) })
  }
})

it('rejects unknown tokens instead of manufacturing a different user', async () => {
  signInAs({ id: 'account-a' })
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: 'Bearer not-issued' } })
  expect(response.status).toBe(401)
})
