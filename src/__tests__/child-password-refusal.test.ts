/**
 * TRAK-106: the edge functions turn Auth's refusal of a common password into
 * WeakPasswordError with isWeakPassword(error). This feeds that check the error
 * the real SDK produces from Auth's real 422 body (prod, 2 Oct 15:50 UTC:
 * "Password is known to be weak and easy to guess"), for both admin calls the
 * functions make. The functions pin supabase-js 2.45.0 (auth-js 2.64.4), which
 * builds the same AuthWeakPasswordError (code weak_password) as this version.
 */
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { server } from '../../tests/msw/server'
import { SUPABASE_URL } from '../../tests/msw/supabase'
import { isWeakPassword as resetIsWeak } from '../../supabase/functions/reset-child-password/handler'
import { isWeakPassword as createIsWeak } from '../../supabase/functions/create-child-login/handler'

const child = '98c00000-0000-4000-8000-000000000040'
const weak = { code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.', weak_password: { reasons: ['pwned'] } }
const admin = () => createClient(SUPABASE_URL, 'synthetic-server-key', { auth: { persistSession: false, autoRefreshToken: false } })
const answer = (status: number, body: Record<string, unknown>) => HttpResponse.json(body, { status, headers: { 'x-supabase-api-version': '2024-01-01' } })

describe('Auth\'s weak-password refusal, as the SDK reports it', () => {
  it.each([
    ['reset (updateUserById)', resetIsWeak, () => admin().auth.admin.updateUserById(child, { password: 'password123' })],
    ['create (createUser)', createIsWeak, () => admin().auth.admin.createUser({ email: 'striker7@child.trakfootball.com', password: 'password123', email_confirm: true })],
  ])('%s: a 422 weak_password is recognised', async (_name, isWeak, call) => {
    server.use(
      http.put(`${SUPABASE_URL}/auth/v1/admin/users/${child}`, () => answer(422, weak)),
      http.post(`${SUPABASE_URL}/auth/v1/admin/users`, () => answer(422, weak)),
    )
    const { error } = await call()
    expect(error).not.toBeNull()
    expect(isWeak(error)).toBe(true)
  })

  it.each([
    ['another 422 (email taken)', 422, { code: 'email_exists', message: 'A user with this email address has already been registered' }],
    ['a 400 validation error', 400, { code: 'validation_failed', message: 'Unable to validate' }],
    ['a 403', 403, { code: 'not_admin', message: 'User not allowed' }],
  ])('CONTROL %s is not a weak password', async (_name, status, body) => {
    server.use(http.put(`${SUPABASE_URL}/auth/v1/admin/users/${child}`, () => answer(status, body)))
    const { error } = await admin().auth.admin.updateUserById(child, { password: 'Synthetic-Pass9!' })
    expect(error).not.toBeNull()
    expect(resetIsWeak(error)).toBe(false)
    expect(createIsWeak(error)).toBe(false)
  })
})
