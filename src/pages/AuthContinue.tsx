import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SUPABASE_URL } from '@/integrations/supabase/client'

/**
 * TRAK-107: the invitation, sign-in and reset emails link here instead of
 * straight to Auth's one-time verify link. Email security scanners open every
 * link in an email: on 4 Oct, Microsoft's used all 10 test invitations within
 * 41 s, before anyone clicked. Here a scanner finds only this page. The
 * person's tap opens the same verify link the email used to carry, so
 * everything after it (onboarding, /reset-password) is unchanged. Supabase
 * docs, Auth email templates → Limitations → Email prefetching, option 2.
 */
const COPY = {
  invite: { title: 'Set up your Trak account', what: 'your invitation' },
  magiclink: { title: 'Sign in to Trak', what: 'your sign-in link' },
  recovery: { title: 'Reset your password', what: 'your reset link' },
} as const

/** Auth's verify link for these params, or null if they aren't a Trak email's. */
function verifyLink(params: URLSearchParams, origin: string): string | null {
  const type = params.get('type') ?? ''
  const token = params.get('token') ?? ''
  const redirect = params.get('redirect_to')
  if (!Object.prototype.hasOwnProperty.call(COPY, type) ||!/^(pkce_)?[0-9a-f]{20,128}$/i.test(token)) return null
  const verify = new URL(`${SUPABASE_URL}/auth/v1/verify`)
  verify.searchParams.set('token', token)
  verify.searchParams.set('type', type)
  if (redirect) {
    // Only back to this site: the page must not become a way to send a
    // signed-in session somewhere else.
    try { if (new URL(redirect).origin !== origin) return null } catch { return null }
    verify.searchParams.set('redirect_to', redirect)
  }
  return verify.href
}

export default function AuthContinue() {
  const [params] = useSearchParams()
  const href = verifyLink(params, window.location.origin)
  const copy = COPY[params.get('type') as keyof typeof COPY]

  return (
    <div className="app-container flex flex-col items-center justify-center px-6 py-12 min-h-screen text-center">
      {href ? (
        <>
          <h1 className="text-2xl text-foreground mb-3">{copy.title}</h1>
          <p className="text-sm text-muted-foreground mb-8 max-w-[320px]">
            Tap Continue to open {copy.what}. It works once, so open it on the device you want to use.
          </p>
          <Button asChild className="w-full max-w-[320px]"><a href={href}>Continue</a></Button>
        </>
      ) : (
        <>
          <h1 className="text-2xl text-foreground mb-3">Couldn't open this link</h1>
          <p role="alert" className="text-sm text-muted-foreground mb-8 max-w-[320px]">
            This link is incomplete or isn't a Trak link. Open the link in your email again, or ask your academy for a new one.
          </p>
          <a href="/" className="text-primary text-sm font-semibold">Go to sign in</a>
        </>
      )}
    </div>
  )
}
