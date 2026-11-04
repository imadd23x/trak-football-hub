import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowLeft, Bell, BookOpen, Building2, CalendarDays, KeyRound, LogOut, ShieldCheck, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { assertSettingsAccount, getSettingsAccount } from '@/lib/settings-account'
import { supabase } from '@/integrations/supabase/client'
import { isTechnicalChildAddress, childUsername } from '@/lib/child-login'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { WIDE_COLUMN } from '@/components/trak/MobileShell'
import { CalendarSettings } from '@/components/trak/AddToCalendar'
import { OwnConsentSettings } from '@/components/player/OwnConsentCard'
import { ParentFamilyContent } from '@/components/parent/ParentFamily'
import { ParentConnections } from '@/components/parent/ParentConnections'
import { ParentChildCredentials } from '@/components/parent/ParentChildCredentials'
import { ParentConsentWithdrawal } from '@/components/parent/ParentConsentWithdrawal'
import { RosterConsentWithdrawals } from '@/components/parent/ApprovedAwaitingSignup'
import { Avatar } from '@/components/arc/avatar/avatar'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { SettingsPage, SettingsRow, SettingsRows, type SettingsSection } from '@/components/arc/blocks/settings-page/settings-page'

const nameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Name is too short' })
  .max(80, { message: 'Name must be under 80 characters' })

export default function Settings() {
  const { user, profile } = useAuth()
  return <RouteGuard allowedRole={profile?.role ?? ''}>
    {user && <AccountSettings key={user.id} userId={user.id} />}
  </RouteGuard>
}

type Operation = 'name' | 'player' | 'delete' | 'password' | 'signout'

function AccountSettings({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const { user, profile, signOut, refreshProfile } = useAuth()
  const role = profile?.role
  const childLogin = isTechnicalChildAddress(user?.email)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const isCurrent = () => mounted.current
  const operation = useRef<Operation | null>(null)
  const [pending, setPending] = useState<Operation | null>(null)
  const begin = (next: Operation) => {
    if (!isCurrent() || operation.current) return false
    operation.current = next
    setPending(next)
    return true
  }
  const finish = () => {
    if (isCurrent()) { operation.current = null; setPending(null) }
  }
  const [displayName, setDisplayName] = useState(profile?.full_name ?? '')
  // TRAK-261: the save bar says "Changes saved" for a moment after a confirmed save.
  const [justSaved, setJustSaved] = useState(false)
  const [nameDraft, setNameDraft] = useState(profile?.full_name ?? '')
  // TRAK-72 item 11: a coach's club, age group and role come from the academy
  // (Trak sets up staff, TRAK-12), so Settings shows them and edits none.
  const [coachClub, setCoachClub] = useState('')
  const [coachTeam, setCoachTeam] = useState('')
  const [coachRoleVal, setCoachRoleVal] = useState('')
  // Players have nothing to edit here (TRAK-71): position and shirt number are
  // coach-owned, and their connections are on the Profile tab.
  const [roleData, setRoleData] = useState<'loading' | 'ready' | 'error'>(role === 'coach' ? 'loading' : 'ready')
  const [loadAttempt, setLoadAttempt] = useState(0)

  // The name shown follows the profile; the field follows too, unless it holds an unsaved edit.
  const shownName = useRef(displayName)
  const showName = (next: string) => {
    const before = shownName.current
    setNameDraft(draft => (draft === before ? next : draft))
    shownName.current = next
    setDisplayName(next)
  }
  useEffect(() => { showName(profile?.full_name ?? '') }, [profile?.full_name])
  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => setJustSaved(false), 1800)
    return () => window.clearTimeout(timer)
  }, [justSaved])
  // Stable identity/role dependencies preserve unfinished drafts on token refresh.
  useEffect(() => {
    if (role !== 'coach') return
    let cancelled = false
    const controller = new AbortController()
    const current = () => mounted.current && !cancelled
    setRoleData('loading')
    void (async () => {
      const { client } = await getSettingsAccount(userId, current)
      const { data, error } = await client.from('coach_details').select('team, coach_role, organization_id')
        .eq('user_id', userId).abortSignal(controller.signal).maybeSingle()
      if (error) throw error
      // The club is the academy's name, not the free-text current_club (empty
      // for every staff account Trak sets up). "Coaches can read own org".
      let club = ''
      if (data?.organization_id) {
        const { data: org, error: orgError } = await client.from('organizations').select('name')
          .eq('id', data.organization_id).abortSignal(controller.signal).maybeSingle()
        if (orgError) throw orgError
        club = org?.name ?? ''
      }
      if (!current()) return
      setCoachClub(club)
      setCoachTeam(data?.team ?? '')
      setCoachRoleVal(data?.coach_role ?? '')
      if (current()) setRoleData('ready')
    })().catch(() => { if (current()) setRoleData('error') })
    return () => { cancelled = true; controller.abort() }
  }, [userId, role, loadAttempt])

  const saveName = async () => {
    const parsed = nameSchema.safeParse(nameDraft)
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return }
    if (!begin('name')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { data, error } = await client.from('profiles').update({ full_name: parsed.data })
        .eq('user_id', userId).select('user_id, full_name').maybeSingle()
      if (error) throw error
      if (!data || data.user_id !== userId || typeof data.full_name !== 'string') throw new Error('Name save was not confirmed')
      await assertSettingsAccount(userId, isCurrent)
      setNameDraft(data.full_name)
      shownName.current = data.full_name
      setDisplayName(data.full_name)
      setJustSaved(true)
      await refreshProfile()
      if (isCurrent()) toast.success('Name updated')
    } catch { if (isCurrent()) toast.error('Could not save name') }
    finally { finish() }
  }

  const changePassword = async () => {
    if (childLogin) {toast.info('Ask your parent or guardian to set a new password from their Trak profile.');return}
    if (!user?.email || !begin('password')) return
    try {
      const account = await getSettingsAccount(userId, isCurrent)
      if (isTechnicalChildAddress(account.user.email)) return
      const { error } = await supabase.auth.resetPasswordForEmail(account.user.email!, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      if (isCurrent()) toast.success('Check your email for a reset link')
    } catch { if (isCurrent()) toast.error('Could not send reset email') }
    finally { finish() }
  }

  const deleteAccount = async () => {
    // TRAK-155: deleting a guardian account withdraws the approvals they gave.
    const approvals = role === 'parent'
      ? ' It also withdraws the approvals you gave for your children.'
      : ''
    if (operation.current || !window.confirm(
      `Delete your account? Your sign-in and profile will be removed.${approvals} Some academy history and consent records may be retained. This cannot be undone.`
    ) || !begin('delete')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { error } = await client.rpc('delete_my_account')
      if (error) throw error
      await assertSettingsAccount(userId, isCurrent)
      // RouteGuard owns navigation after a confirmed sign-out.
      await signOut(userId)
    } catch { if (isCurrent()) toast.error('Could not delete account. Please contact support.') }
    finally { finish() }
  }

  const signOutAccount = async () => {
    if (!begin('signout')) return
    try {
      await assertSettingsAccount(userId, isCurrent)
      await signOut(userId)
    } catch { if (isCurrent()) toast.error('Could not sign out. Please try again.') }
    finally { finish() }
  }

  const wide = useSideMenuScreen()
  const consent = useQuery({
    queryKey: ['settings', userId, 'own-consent'],
    enabled: role === 'player',
    queryFn: async () => (await supabase.rpc('my_consent_status' as never)).data as OwnConsentStatus | null,
  })
  const named = role !== 'player'
  const nameChanged = named && nameDraft !== displayName
  const subtitle = role === 'coach' ? [coachRoleVal, coachClub].filter(Boolean).join(' · ') || 'Coach'
    : role === 'parent' ? 'Parent account' : role === 'player' ? 'Player' : 'Academy'

  const sections: SettingsSection[] = [
    {
      id: 'profile', label: 'Profile', icon: UserRound, pending: nameChanged ? 1 : 0,
      description: 'Your name, and how you sign in.',
      content: <>
        <div className="mb-4 flex items-center gap-4">
          {role === 'player' ? <PlayerFace name={displayName || '?'} size="xl" /> : <Avatar name={displayName || '?'} size="xl" />}
          <div className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm font-medium text-ink">{displayName || '—'}</strong>
            <span className="truncate text-sm text-ink-3">{subtitle}</span>
            <small className="text-xs text-ink-3">Profile photos are coming soon.</small>
          </div>
        </div>
        <SettingsRows>
          {named
            ? <div className="pb-3">
                <Input label="Full name" value={nameDraft} autoComplete="name" disabled={pending === 'name'}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setNameDraft(displayName) }} />
              </div>
            // TRAK-103: a player's name is the academy's roster name; the database refuses a rename.
            : <SettingsRow label="Name">
                <span className="grid"><span className="text-ink">{displayName || '—'}</span><span className="text-xs text-ink-3">Your academy sets your name.</span></span>
              </SettingsRow>}
          <SettingsRow label={childLogin ? 'Username' : 'Email'}>{childLogin ? childUsername(user?.email) : user?.email || '—'}</SettingsRow>
        </SettingsRows>
      </>,
    },
    // TRAK-72 item 11: a coach's club, age group and role come from the academy (Trak sets up staff, TRAK-12).
    ...(role === 'coach' ? [{
      id: 'club', label: 'Club', icon: Building2, description: 'Your academy sets these. Ask them if something is wrong.',
      content: roleData === 'loading' ? <p role="status" className="text-sm text-ink-3">Loading profile…</p>
        : roleData === 'error' ? <div role="alert" className="text-sm text-ink-3">
            <p>Could not load your profile details.</p>
            <button onClick={() => setLoadAttempt(value => value + 1)} className="mt-2 text-brand">Retry</button>
          </div>
        : <SettingsRows>
            <SettingsRow label="Club">{coachClub || '—'}</SettingsRow>
            <SettingsRow label="Age group">{coachTeam || '—'}</SettingsRow>
            <SettingsRow label="Role">{coachRoleVal || '—'}</SettingsRow>
          </SettingsRows>,
    }] : []),
    // TRAK-261 (Imad, 22 Oct): a parent's linked children and consent are here too, as on their Profile tab.
    ...(role === 'parent' ? [{
      id: 'family', label: 'Family', icon: Users, description: 'Your linked children, and the logins you made for them.',
      content: <div className="grid gap-3">
        <ParentFamilyContent><ParentConnections /></ParentFamilyContent>
        <ParentChildCredentials key={userId} />
      </div>,
    }, {
      id: 'consent', label: 'Consent', icon: ShieldCheck, description: "What your children's coaches may record, approved or withdrawn.",
      content: <ParentConsent />,
    }] : []),
    // TRAK-177: a 15–17 player at a consent-age-15 academy, who agreed for themselves, withdraws here.
    ...(role === 'player' && decidesOwnConsent(consent.data) ? [{
      id: 'consent', label: 'Consent', icon: ShieldCheck, description: 'You agreed for yourself. You can withdraw it here.',
      content: <OwnConsentSettings Section={Bare} />,
    }] : []),
    // TRAK-136 (J8.13): the reminder 2 days before each event goes to guardians and to players with their own
    // email; a child's username login never gets email. TRAK-261: a coach's two in-app switches.
    ...(role === 'coach' ? [{
      id: 'notifications', label: 'Notifications', icon: Bell, description: 'What Trak shows you in the app. On unless you turn it off.',
      content: <SettingsRows>
        <NotificationSwitch userId={userId} column="cant_make_it_alerts" label="Can't make it" noun="alert"
          hint="In the bell when a family says their child can't make an event." />
        <NotificationSwitch userId={userId} column="needs_you" label="Needs you" noun="Needs you"
          hint="Players to assess and drafts to finish, on Home." />
      </SettingsRows>,
    }] : (role === 'parent' || (role === 'player' && !childLogin)) ? [{
      id: 'notifications', label: 'Notifications', icon: Bell, description: 'Emails from Trak. On unless you turn them off.',
      content: <EventReminders userId={userId} />,
    }] : []),
    // TRAK-133 (J8.10): add Trak to a phone calendar, see when it last synced, get a new link.
    ...((role === 'player' || role === 'parent') ? [{
      id: 'calendar', label: 'Calendar', icon: CalendarDays, description: 'Your events in your phone’s calendar.',
      content: <CalendarSettings />,
    }] : []),
    ...(role === 'club' ? [{
      id: 'access', label: 'Access', icon: ShieldCheck, description: 'What this account can see.',
      content: <p className="text-sm text-ink-2">Read-only academy view. You can see all coaches and squads but cannot edit player or coach records.</p>,
    }] : []),
    // TRAK-261 (Imad, 22 Oct): Arc's Billing becomes How Trak works, for everyone.
    {
      id: 'how', label: 'How Trak works', icon: BookOpen, description: 'Performance bands and the rating engine.',
      content: <Link to="/how-it-works" className="text-sm font-medium text-brand">Read how Trak works</Link>,
    },
    {
      id: 'account', label: 'Account', icon: KeyRound, description: 'Your password, signing out, and leaving Trak.',
      content: <SettingsRows>
        <SettingsRow label="Password">
          <Button type="button" variant="secondary" size="sm" onClick={changePassword} disabled={!!pending}>{childLogin ? 'Ask your guardian' : 'Send reset email'}</Button>
        </SettingsRow>
        <SettingsRow label="This device">
          <Button type="button" variant="secondary" size="sm" onClick={signOutAccount} disabled={!!pending}><LogOut size={15} strokeWidth={1.8} aria-hidden="true" />Sign out</Button>
        </SettingsRow>
        <SettingsRow label="Leave Trak">
          <Button type="button" variant="danger" size="sm" onClick={deleteAccount} disabled={!!pending}>Delete my account</Button>
        </SettingsRow>
      </SettingsRows>,
    },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'rgb(var(--t-ground))', fontFamily: 'var(--t-font)' }}>
      {/* TRAK-307: a coach's Settings is a page in their menu, so it takes the menu pages' one column (a phone's is the
          phone column, as for everyone). */}
      <div className={`${role === 'coach' ? WIDE_COLUMN : 'mx-auto trak-read px-5'} pt-5 pb-12`}>
        {/* A phone's way back; a coach's laptop has the frame's side menu and top bar (TRAK-259). */}
        {!(role === 'coach' && wide) && <div className="relative flex items-center justify-center mb-4 h-10">
          <button onClick={() => navigate(-1)} aria-label="Back"
            className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink">
            <ArrowLeft size={16} />
          </button>
          <span aria-hidden="true" className="text-[17px] text-ink">Settings</span>
        </div>}
        <SettingsPage title="Settings" sections={sections} bar={named ? {
          state: pending === 'name' ? 'saving' : nameChanged ? 'edit' : justSaved ? 'saved' : null,
          count: nameChanged ? 1 : 0,
          onSave: () => { void saveName() },
          onDiscard: () => setNameDraft(displayName),
        } : undefined} />
      </div>
    </div>
  )
}

type OwnConsentStatus = { age?: number | null; consent_age?: number; threshold?: number; own_choice?: boolean | null }
/** As OwnConsentSettings: the player is of the academy's consent age, under 18, and agreed for themselves. */
const decidesOwnConsent = (s: OwnConsentStatus | null | undefined) =>
  s?.age != null && s.consent_age != null && s.age >= s.consent_age && s.age < (s.threshold ?? 18) && s.own_choice === true

/** OwnConsentSettings brings its own section; here the Arc section is already around it. */
function Bare({ children }: { label: string; children: ReactNode }) {
  return <>{children}</>
}

/** A parent's consent: each signed-up child's withdrawal, and approved children who have no account yet (TRAK-98). */
function ParentConsent() {
  const family = useParentChildren()
  return <div className="grid gap-3">
    {family.selectedChild && <ParentConsentWithdrawal />}
    <RosterConsentWithdrawals />
  </div>
}

/* ------- notifications ------- */

type SwitchColumn = 'event_reminders' | 'cant_make_it_alerts' | 'needs_you'

/**
 * TRAK-136 (J8.13): the one place reminders are turned off. There is no
 * unsubscribe link in the email: Microsoft's scanner clicks links (TRAK-107).
 * No row means on. Shows only what the database confirmed; a failed read
 * offers a retry rather than a switch that may be wrong.
 */
function EventReminders({ userId }: { userId: string }) {
  return <NotificationSwitch userId={userId} column="event_reminders" label="Event reminders" noun="reminder"
    hint="An email 2 days before each event, listing what's on, when and where. One email a day, whatever the number of children." />
}

/** One switch on the person's own notification_settings row (TRAK-136; TRAK-261 adds the coach's two). */
function NotificationSwitch({ userId, column, label, noun, hint }: { userId: string; column: SwitchColumn; label: string; noun: string; hint: string }) {
  const client = useQueryClient()
  const [on, setOn] = useState<boolean | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      const { client } = await getSettingsAccount(userId, () => !cancelled)
      const { data, error } = await client.from('notification_settings').select(column)
        .eq('user_id', userId).maybeSingle()
      if (error) throw error
      if (cancelled) return
      setOn((data as Record<SwitchColumn, boolean> | null)?.[column] ?? true)
      setState('ready')
    })().catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [userId, column, attempt])

  const toggle = async () => {
    if (on === null || saving) return
    const next = !on
    setSaving(true)
    try {
      const { client: account } = await getSettingsAccount(userId, () => true)
      const { data, error } = await account.from('notification_settings')
        .upsert({ user_id: userId, [column]: next } as { user_id: string } & Partial<Record<SwitchColumn, boolean>>, { onConflict: 'user_id' })
        .select(column).single()
      if (error || (data as Record<SwitchColumn, boolean> | null)?.[column] !== next) throw error ?? new Error('Setting was not confirmed')
      setOn(next)
      // Home's Needs you and the bell read the same row (TRAK-262).
      void client.invalidateQueries({ queryKey: ['coach', userId] })
      toast.success(next ? `${label} on` : `${label} off`)
    } catch {
      toast.error(`Couldn't save your ${noun} setting. Try again.`)
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <p role="status" className="py-3.5 text-sm text-muted-foreground">Loading…</p>
  if (state === 'error') {
    return (
      <div role="alert" className="py-3.5 text-sm text-muted-foreground">
        <p>Couldn't load your {noun} setting.</p>
        <button onClick={() => setAttempt(value => value + 1)} className="mt-2 text-primary">Retry</button>
      </div>
    )
  }
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="grid gap-0.5">
        <span className="text-sm text-ink">{label}</span>
        <span className="text-xs text-ink-3">{hint}</span>
      </div>
      <button
        role="switch"
        aria-checked={!!on}
        aria-label={label}
        disabled={saving}
        onClick={toggle}
        className="relative flex-none rounded-full transition-colors"
        style={{ width: 40, height: 24, background: on ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))' }}
      >
        <span
          className="absolute top-[3px] rounded-full transition-all"
          style={{ width: 18, height: 18, left: on ? 19 : 3, background: on ? 'rgb(var(--t-ground))' : 'rgb(var(--t-ink) / 0.7)' }}
        />
      </button>
    </div>
  )
}
