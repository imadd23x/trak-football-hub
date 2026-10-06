/**
 * TRAK-117: /auth/confirm confirms on page load, so an email scanner that runs
 * the page (Microsoft's does, run 5) confirms the account first. The person's
 * own click then gets Auth's "used or expired" answer, and the page must not
 * read as a failure. Real App with MSW.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../tests/support/render-app'
import { server } from '../../../tests/msw/server'
import { SUPABASE_URL } from '../../../tests/msw/supabase'

let reply: () => Response

beforeEach(() => {
  localStorage.clear()
  server.use(http.post(`${SUPABASE_URL}/auth/v1/verify`, () => reply()))
})
afterEach(() => cleanup())

const open = () => renderApp(`/auth/confirm?token_hash=${'b'.repeat(56)}&type=signup`)

describe('TRAK-117: /auth/confirm with a used link', () => {
  it('says the email is probably confirmed and to sign in with the password', async () => {
    reply = () => HttpResponse.json({ code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' }, { status: 403 })
    open()
    expect(await screen.findByRole('heading', { name: 'Link already used' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText(/already confirmed: sign in with your password/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/')
  })

  it("still shows Auth's own message for any other failure", async () => {
    reply = () => HttpResponse.json({ code: 500, error_code: 'unexpected_failure', msg: 'Database error confirming user' }, { status: 500 })
    open()
    expect(await screen.findByRole('heading', { name: "Couldn't confirm" }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Database error confirming user')).toBeInTheDocument()
  })
})
