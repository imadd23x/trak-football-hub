import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'

/**
 * Confirms a new account WITHOUT signing the person in.
 *
 * Supabase's `{{ .ConfirmationURL }}` carries a session token, so clicking a
 * confirmation email used to drop you straight into the dashboard. Two problems
 * with that. It bypasses sign-in entirely, so nobody ever proves they know
 * their own password. And when a player and their parent share an inbox — which
 * is normal for a 13-year-old — clicking the wrong message signs the parent
 * into the child's account.
 *
 * So the template now sends `token_hash` here instead. We verify it, which does
 * briefly create a session, then immediately discard that session and send the
 * person to the sign-in form. The confirmation still happens; the free ride
 * does not.
 *
 * Password reset and parent invitations deliberately still carry a session:
 * both exist to set a password, which cannot be done signed out.
 */
// TRAK-117: Auth answers "used or expired" alike. Email scanners (Microsoft's,
// run 5) run this page before the person does, and that run confirmed them.
const USED_LINK = 'This link was already used or has expired. If your email app opened it before you did, your email is already confirmed: sign in with your password.'

const AuthConfirm = () => {
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    // StrictMode double-invokes effects in development; a token hash is
    // single-use, so the second run would always fail.
    if (ran.current) return
    ran.current = true

    const tokenHash = params.get('token_hash')
    const type = params.get('type') ?? 'signup'

    const run = async () => {
      if (!tokenHash) {
        setError('This confirmation link is incomplete. Try the link in your email again.')
        return
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as 'signup' | 'email_change',
      })

      if (verifyError) {
        setError(/expired/i.test(verifyError.message) ? USED_LINK : verifyError.message)
        return
      }

      // Drop the session verifyOtp just created, so they arrive at sign-in as
      // a signed-out visitor rather than already inside the app.
      await supabase.auth.signOut()
      window.location.replace('/?confirmed=1')
    }

    void run()
  }, [params])

  return (
    <div className="app-container flex flex-col items-center justify-center px-6 py-12 min-h-screen text-center">
      {error ? (
        <>
          <h1 className="text-2xl text-foreground mb-3">{error === USED_LINK ? 'Link already used' : "Couldn't confirm"}</h1>
          <p className="text-sm text-muted-foreground mb-8 max-w-[320px]">{error}</p>
          <a href="/" className="text-primary text-sm font-semibold">Go to sign in</a>
        </>
      ) : (
        <>
          <h1 className="text-2xl text-foreground mb-3">Confirming your email…</h1>
          <p className="text-sm text-muted-foreground">One moment.</p>
        </>
      )}
    </div>
  )
}

export default AuthConfirm
