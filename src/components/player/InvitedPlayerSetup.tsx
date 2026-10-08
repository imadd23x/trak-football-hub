import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import { POSITIONS } from '@/lib/constants'
import { validatePassword, PASSWORD_HINT } from '@/lib/password'
import { isGuardianCreatedChild, WEAK_PASSWORD_MESSAGE } from '@/lib/child-login'
import { forgetPasswordJustSet, passwordJustSet } from '@/lib/password-recovery'
import { createOnboardingSession } from '@/lib/onboarding-session'

/* TRAK-11 phase 4, player side: a rostered child follows the invitation the
   academy's roster sent and arrives here already signed in, with no password
   and no profile. They set a password and confirm their name;
   provision_my_profile admits them from the roster, which supplies their date
   of birth, academy and age group (J1, TRAK-54). They never name a guardian
   (G2). The database refuses anyone the roster doesn't name, and (phase 2) an
   under-18 whose guardian hasn't approved; either refusal is shown as said.

   The guardian the roster names arrives the same way at /onboarding/parent
   (role 'parent'): the same password step, then just their name;
   provision_my_profile admits them from roster_guardians and claims those
   rows, and parent home lists the child waiting for their approval. */

export function InvitedPlayerSetup({ role = 'player' }: { role?: 'player' | 'parent' }) {
  const guardian = role === 'parent'
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const meta = (user?.user_metadata ?? {}) as { child_first_name?: unknown; academy_name?: unknown }
  const firstName = typeof meta.child_first_name === 'string' ? meta.child_first_name.trim() : ''
  const academy = typeof meta.academy_name === 'string' ? meta.academy_name.trim() : ''
  const guardianCreated = !guardian && isGuardianCreatedChild(user)

  const [step, setStep] = useState<'password' | 'profile'>(guardianCreated || passwordJustSet(user?.id) ? 'profile' : 'password')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  // A guardian types their own name. A child's name is the academy's roster
  // name: the database saves it, so the child is never asked (TRAK-103).
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // TRAK-103: the academy's name for this child, shown so a wrong one is
  // caught on day one. A failed read just leaves it out; it never blocks setup.
  const [rosterName, setRosterName] = useState<string | null>(null)
  useEffect(() => {
    if (guardian || !user?.id) return
    let current = true
    void supabase.rpc('my_roster_name' as never).then(({ data, error }) => {
      const name: unknown = data  // the generated types predate this function
      if (current && !error && typeof name === 'string' && name.trim()) setRosterName(name.trim())
    }, () => { /* unavailable: setup goes on without it */ })
    return () => { current = false }
  }, [guardian, user?.id])

  const savePassword = async () => {
    if (busy) return
    const weak = validatePassword(password)
    if (weak) { setProblem(weak); return }
    if (password !== confirm) { setProblem('Passwords do not match'); return }
    setBusy(true)
    setProblem(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    // TRAK-109: `same_password` means this already is their password (an
    // earlier visit or a reset set it), so carry on. A leaked-password refusal
    // is the password's fault, not the connection's.
    if (error && error.code !== 'same_password') {
      setProblem(error.code === 'weak_password' ? WEAK_PASSWORD_MESSAGE : "Couldn't set your password. Check your connection and try again.")
      return
    }
    setStep('profile')
  }

  const finish = async () => {
    if (busy) return
    if (guardian && !name.trim()) { setProblem('Please enter your name'); return }
    setBusy(true)
    setProblem(null)
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !sessionData.session || sessionData.session.user.id !== user?.id) {
        throw new Error('Account changed')
      }
      const account = await createOnboardingSession(sessionData.session)
      const { error } = await account.client.rpc('provision_my_profile' as never, {
        p: guardian
          ? { role: 'parent', full_name: name.trim() }
          : { role: 'player', player_details: position ? { position } : {} },
      } as never)
      if (error) {
        setBusy(false)
        // 42501 carries the academy's own reason (not on the roster, or waiting
        // for a guardian's approval); anything else is a fault, not a rule.
        setProblem(error.code === '42501' ? error.message : "Couldn't finish setting up your account. Please try again.")
        return
      }
      forgetPasswordJustSet()
      await refreshProfile()
      const { data: current, error: currentError } = await supabase.auth.getSession()
      if (currentError) throw currentError
      if (current.session?.user.id !== account.user.id) return
      navigate(guardian ? '/parent/home' : '/player/home', { replace: true })
    } catch {
      setBusy(false)
      setProblem("Couldn't finish setting up your account. Sign in again and retry.")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl text-foreground">{!guardian && firstName ? `Welcome, ${firstName}` : 'Welcome'}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {guardian
            ? `${academy || 'Your academy'} has added you as ${firstName ? `${firstName}'s` : "a child's"} parent or guardian.`
            : academy ? `${academy} has added you to Trak.` : 'Your academy has added you to Trak.'}{' '}
          {step === 'password' ? 'Choose a password to sign in with next time.'
            : guardian ? 'Check your name, then you’re in.' : 'One last step, then you’re in.'}
        </p>
      </div>

      {/* TRAK-120: real forms, so Enter submits like the button does. */}
      {step === 'password' ? (
        <form onSubmit={e => { e.preventDefault(); void savePassword() }} className="flex flex-col gap-4">
          <PasswordInput label="New password" autoComplete="new-password" placeholder={PASSWORD_HINT}
            value={password} onChange={e => setPassword(e.target.value)} className="bg-card" />
          <PasswordInput label="Confirm password" autoComplete="new-password" placeholder="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)} className="bg-card" />
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Set password'}</Button>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void finish() }} className="flex flex-col gap-4">
          {guardian && <>
            <label className="text-xs text-muted-foreground" htmlFor="invited-name">Your name</label>
            <Input id="invited-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="bg-card" />
          </>}
          {!guardian && <>
            <label className="text-xs text-muted-foreground" htmlFor="invited-position">Position (optional)</label>
            <select id="invited-position" value={position} onChange={e => setPosition(e.target.value)}
              className="w-full appearance-none bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground">
              <option value="">Choose later</option>
              {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {rosterName ? <>
              <p className="text-sm text-foreground">You're added as {rosterName}.</p>
              <p className="text-xs text-muted-foreground">Your academy has your date of birth and age group.</p>
            </> : <p className="text-xs text-muted-foreground">Your academy has your name, date of birth and age group.</p>}
          </>}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Finishing…' : 'Finish'}</Button>
        </form>
      )}
    </div>
  )
}
