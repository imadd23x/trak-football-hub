/**
 * TRAK-107 part 2 (J2, run 5, 5 Oct): Microsoft's scanner pressed Continue on
 * /auth/continue 47 and 75 s after sending, so a link a person must press is
 * still a link a scanner presses. The emails now carry a code; /auth/code
 * sends nothing until a person types it. Real App with MSW.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL } from '../../../tests/msw/supabase'

vi.mock('@/lib/leave-page', () => ({ leavePage: vi.fn() }))
import { leavePage } from '@/lib/leave-page'

const SESSION = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, expires_at: 1791300000, token_type: 'bearer', user: { id: 'u1' } }
let verifies: { method: string; body: unknown }[]
let reply: () => Response

beforeEach(() => {
  localStorage.clear()
  vi.mocked(leavePage).mockClear()
  verifies = []
  reply = () => HttpResponse.json(SESSION)
  server.use(http.all(`${SUPABASE_URL}/auth/v1/verify`, async ({ request }) => {
    verifies.push({ method: request.method, body: request.method === 'POST' ? await request.json() : null })
    return reply()
  }))
})
afterEach(() => cleanup())

const origin = () => window.location.origin
const open = (query: Record<string, string>) => renderApp(`/auth/code?${new URLSearchParams(query)}`)
const continueButton = () => screen.findByRole('button', { name: 'Continue' }, { timeout: 4000 })
const typeCode = (code: string) => fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } })

describe('TRAK-107: /auth/code', () => {
  it('sends nothing on load, and the typed code opens the redirect with the session Auth returned', async () => {
    open({ type: 'invite', email: 'guardian@example.test', redirect_to: `${origin()}/onboarding/parent` })
    await continueButton()
    expect(screen.getByLabelText('Email')).toHaveValue('guardian@example.test')
    expect(verifies).toHaveLength(0)

    typeCode('1234 5678')
    fireEvent.click(await continueButton())

    await waitFor(() => expect(leavePage).toHaveBeenCalledTimes(1))
    expect(verifies).toEqual([{ method: 'POST', body: { type: 'invite', email: 'guardian@example.test', token: '12345678' } }])
    const target = new URL(vi.mocked(leavePage).mock.calls[0][0])
    expect(`${target.origin}${target.pathname}`).toBe(`${origin()}/onboarding/parent`)
    expect(Object.fromEntries(new URLSearchParams(target.hash.slice(1)))).toEqual({
      access_token: 'access-1', expires_at: '1791300000', expires_in: '3600', refresh_token: 'refresh-1', token_type: 'bearer', type: 'invite',
    })
  })

  it('hands a reset code to /reset-password as a recovery callback, the shape its checks expect', async () => {
    open({ type: 'recovery', email: 'guardian@example.test', redirect_to: `${origin()}/reset-password` })
    typeCode('87654321')
    fireEvent.click(await continueButton())
    await waitFor(() => expect(leavePage).toHaveBeenCalledTimes(1))
    const target = new URL(vi.mocked(leavePage).mock.calls[0][0])
    expect(target.pathname).toBe('/reset-password')
    expect(new URLSearchParams(target.hash.slice(1)).get('type')).toBe('recovery')
    expect((verifies[0].body as { type: string }).type).toBe('recovery')
  })

  it('reads a + in an address the email template left unencoded', async () => {
    renderApp(`/auth/code?type=magiclink&email=parent+r5b@example.test&redirect_to=${encodeURIComponent(`${origin()}/`)}`)
    await continueButton()
    expect(screen.getByLabelText('Email')).toHaveValue('parent+r5b@example.test')
  })

  it('says so when the code is wrong or used, and stays on the page', async () => {
    reply = () => HttpResponse.json({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, { status: 403 })
    open({ type: 'invite', email: 'guardian@example.test', redirect_to: `${origin()}/onboarding/parent` })
    typeCode('11111111')
    fireEvent.click(await continueButton())
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent("That code didn't work")
    expect(leavePage).not.toHaveBeenCalled()
  })

  it('asks for the code before calling Auth', async () => {
    open({ type: 'invite', email: 'guardian@example.test', redirect_to: `${origin()}/onboarding/parent` })
    typeCode('12')
    fireEvent.click(await continueButton())
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Enter the code')
    expect(verifies).toHaveLength(0)
  })

  it.each([
    ['a redirect to another site', { type: 'invite', email: 'g@example.test', redirect_to: 'https://evil.example/onboarding/parent' }],
    ['an unknown type', { type: 'signup_admin', email: 'g@example.test' }],
  ])('refuses %s, with no form', async (_name, query) => {
    open(query as Record<string, string>)
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(/link/i)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(verifies).toHaveLength(0)
  })
})
