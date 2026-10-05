import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/integrations/supabase/client'
import { leavePage } from '@/lib/leave-page'

/**
 * TRAK-107, part 2: the invitation, sign-in and reset emails carry a code
 * instead of a link that does anything. Run 5 (5 Oct) showed that Microsoft's
 * scanner doesn't stop at /auth/continue: it pressed Continue 47 and 75 s
 * after sending and used both invitations. A scanner can follow links and
 * press buttons, but it can't type the code from the email. Supabase docs,
 * Auth email templates → Limitations → Email prefetching, option 1.
 *
 * The page posts the code to Auth's verify endpoint itself (no SDK, so no
 * session is stored here), then opens the email's redirect with the same
 * #access_token fragment Auth's own verify redirect produces. Everything
 * after that (onboarding, /reset-password and its recovery checks) is
 * unchanged, because it starts from a fresh page load exactly as before.
 */
const COPY = {
  invite: { title: 'Set up your Trak account', what: 'invitation' },
  magiclink: { title: 'Sign in to Trak', what: 'sign-in email' },
  recovery: { title: 'Reset your password', what: 'reset email' },
} as const
type CodeType = keyof typeof COPY

/** Where to go after the code works: the email's redirect, only on this site. */
function target(params: URLSearchParams, origin: string): string | null {
  const redirect = params.get('redirect_to')
  if (!redirect) return `${origin}/`
  try {
    const url = new URL(redirect)
    return url.origin === origin ? `${url.origin}${url.pathname}${url.search}` : null
  } catch {
    return null
  }
}

/** An email template may not encode the address, and a raw `+` reads as a space. */
const emailFromLink = (value: string | null) => (value ?? '').trim().replace(/ /g, '+')

function failure(status: number, errorCode: string | undefined): string {
  if (status === 429) return 'Too many tries. Wait a few minutes and try again.'
  if (errorCode === 'otp_expired' || status === 403) {
    return "That code didn't work. Check you typed the code from the latest email. Codes work once and expire after an hour."
  }
  return "Couldn't check the code. Check your connection and try again."
}

export default function AuthCode() {
  const [params] = useSearchParams()
  const type = params.get('type') ?? ''
  const valid = Object.prototype.hasOwnProperty.call(COPY, type)
  const next = target(params, window.location.origin)
  const [email, setEmail] = useState(() => emailFromLink(params.get('email')))
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  if (!valid || !next) {
    return (
      <div className="app-container flex flex-col items-center justify-center px-6 py-12 min-h-screen text-center">
        <h1 className="text-2xl text-foreground mb-3">Couldn't open this page</h1>
        <p role="alert" className="text-sm text-muted-foreground mb-8 max-w-[320px]">
          This link is incomplete or isn't a Trak link. Open the button in your email again, or ask your academy for a new email.
        </p>
        <a href="/" className="text-primary text-sm font-semibold">Go to sign in</a>
      </div>
    )
  }

  const copy = COPY[type as CodeType]
  const digits = code.replace(/\D/g, '')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (checking) return
    if (!email.includes('@')) return setError('Enter the email address the email was sent to.')
    if (digits.length < 6 || digits.length > 10) return setError('Enter the code from the email. It is a number, like 12345678.')
    setChecking(true)
    setError(null)
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, email: email.trim().toLowerCase(), token: digits }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.access_token || !body.refresh_token) {
        setError(failure(res.status, body.error_code))
        setChecking(false)
        return
      }
      const fragment = new URLSearchParams({
        access_token: body.access_token,
        expires_at: String(body.expires_at ?? Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600)),
        expires_in: String(body.expires_in ?? 3600),
        refresh_token: body.refresh_token,
        token_type: body.token_type ?? 'bearer',
        type,
      })
      leavePage(`${next}#${fragment}`)
    } catch {
      setError(failure(0, undefined))
      setChecking(false)
    }
  }

  return (
    <div className="app-container flex flex-col items-center justify-center px-6 py-12 min-h-screen">
      <form onSubmit={submit} noValidate className="w-full max-w-[320px] space-y-4">
        <div className="text-center">
          <h1 className="text-2xl text-foreground mb-3">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">Type the code from your {copy.what}.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-code-email">Email</Label>
          <Input id="auth-code-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-code">Code</Label>
          <Input
            id="auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value)}
            className="text-lg tracking-widest"
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={checking}>{checking ? 'Checking…' : 'Continue'}</Button>
        <p className="text-xs text-muted-foreground text-center">The code works once and expires after an hour.</p>
      </form>
    </div>
  )
}
