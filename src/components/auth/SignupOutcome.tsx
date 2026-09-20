import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/integrations/supabase/client'

interface SignupOutcomeProps {
  email: string
  parentEmail?: string
}
type EmailAction = 'confirmation' | 'recovery'

/** A signup response is not proof of a new account or email delivery. */
export function SignupOutcome({ email, parentEmail }: SignupOutcomeProps) {
  const [pending, setPending] = useState<EmailAction | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function requestEmail(action: EmailAction) {
    if (busy.current) return
    busy.current = true
    setPending(action); setMessage(''); setError('')
    try {
      const result = action === 'confirmation'
        ? await supabase.auth.resend({ type: 'signup', email })
        : await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      if (result.error) throw result.error
      if (mounted.current) setMessage(action === 'confirmation'
        ? 'Request received. If this account needs confirmation, check your inbox and spam folder for the link.'
        : 'Request received. If this email has a Trak account, check your inbox and spam folder for a password reset link.')
    } catch (cause: unknown) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not request the email. Please try again.')
    } finally {
      busy.current = false
      if (mounted.current) setPending(null)
    }
  }

  return <section className="flex flex-col items-center text-center py-6" aria-labelledby="signup-outcome-title">
    <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center mb-6" aria-hidden="true">
      <Mail className="w-10 h-10 text-primary" />
    </div>
    <h2 id="signup-outcome-title" className="text-2xl text-foreground mb-2">Check your email or sign in</h2>
    <p className="text-sm text-muted-foreground mb-2">If this email is new to Trak, check your inbox and spam folder for a confirmation link:</p>
    <p className="text-sm font-medium text-foreground break-all mb-4">{email}</p>
    <p className="text-sm text-muted-foreground mb-4">If you already use Trak as a player, parent, coach or administrator, sign in to that account. Use Reset password if you need help getting back in.</p>
    {parentEmail && <div className="text-sm text-muted-foreground mb-4">
      <p className="font-medium text-foreground mb-2">Parent approval comes next</p>
      <p>After confirming your email and signing in, review the invitation status for <span className="break-all">{parentEmail}</span>. Your coach needs your parent or guardian's approval before recording your progress.</p>
    </div>}
    {message && <p role="status" className="text-sm text-foreground mb-4">{message}</p>}
    {error && <p role="alert" className="text-sm text-destructive mb-4">{error}</p>}
    <div className="w-full flex flex-col gap-3">
      <Button asChild><a href="/">Sign in</a></Button>
      <Button variant="outline" disabled={pending !== null} onClick={() => { void requestEmail('recovery') }}>
        {pending === 'recovery' ? 'Requesting reset…' : 'Reset password'}
      </Button>
      <Button variant="outline" disabled={pending !== null} onClick={() => { void requestEmail('confirmation') }}>
        {pending === 'confirmation' ? 'Requesting confirmation…' : 'Resend confirmation email'}
      </Button>
    </div>
  </section>
}
