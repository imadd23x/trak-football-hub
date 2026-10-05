/**
 * TRAK-107 (J2, run 4, 4 Oct): Microsoft's link scanner opened all 10
 * invitation links 15–41 s after sending, which used each one-time link
 * before the guardian could. The emails now point at /auth/continue, which
 * verifies nothing on load: only the person's tap opens Auth's verify link,
 * the same one the email used to carry. Real App with MSW.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL } from '../../../tests/msw/supabase'

const TOKEN = 'c0ffee'.repeat(9) + 'ab'
let verifies: number

beforeEach(() => {
  localStorage.clear()
  verifies = 0
  server.use(http.get(`${SUPABASE_URL}/auth/v1/verify`, () => { verifies++; return HttpResponse.json({}) }))
})
afterEach(() => cleanup())

const open = (query: Record<string, string>) => renderApp(`/auth/continue?${new URLSearchParams(query)}`)
const continueLink = () => screen.findByRole('link', { name: 'Continue' }, { timeout: 4000 })

describe('TRAK-107: /auth/continue', () => {
  it('uses nothing on load, and Continue opens the same verify link the email used to carry', async () => {
    const redirect = `${window.location.origin}/onboarding/parent`
    open({ type: 'invite', token: TOKEN, redirect_to: redirect })
    const link = await continueLink()
    expect(verifies).toBe(0)
    const target = new URL(link.getAttribute('href')!)
    expect(`${target.origin}${target.pathname}`).toBe(`${SUPABASE_URL}/auth/v1/verify`)
    expect(Object.fromEntries(target.searchParams)).toEqual({ token: TOKEN, type: 'invite', redirect_to: redirect })
  })

  it.each(['magiclink', 'recovery'])('works the same for a %s link', async type => {
    open({ type, token: TOKEN, redirect_to: `${window.location.origin}/reset-password` })
    const target = new URL((await continueLink()).getAttribute('href')!)
    expect(target.searchParams.get('type')).toBe(type)
    expect(verifies).toBe(0)
  })

  it('leaves the redirect to Auth when the email had none', async () => {
    open({ type: 'invite', token: TOKEN, redirect_to: '' })
    const target = new URL((await continueLink()).getAttribute('href')!)
    expect(target.searchParams.has('redirect_to')).toBe(false)
  })

  it.each([
    ['a redirect to another site', { type: 'invite', token: TOKEN, redirect_to: 'https://evil.example/onboarding/parent' }],
    ['an unknown link type', { type: 'signup_admin', token: TOKEN }],
    ['no token', { type: 'invite' }],
    ['a malformed token', { type: 'invite', token: 'not a token!' }],
  ])('refuses %s, with no Continue', async (_name, query) => {
    open(query as Record<string, string>)
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(/link/i)
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
    expect(verifies).toBe(0)
  })
})
