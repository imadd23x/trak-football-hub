import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowLeft, Bell, BookOpen, Building2, CalendarDays, KeyRound, Languages, LogOut, ShieldCheck, UserRound, Users } from 'lucide-react'
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
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { i18n, isLanguage, LANGUAGES, showLanguage, useLanguage, useTranslation } from '@/lib/i18n'
import { COACH_HOW_PATH } from '@/lib/coach-places'

// TRAK-406: the messages are words in settings.json, read when shown, so they are in the language showing.
const nameSchema = z
  .string()
  .trim()
  .min(2, { message: 'nameTooShort' })
  .max(80, { message: 'nameTooLong' })

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
  const { t } = useTranslation()
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
    if (!parsed.success) { toast.error(t(`settings:${parsed.error.issues[0].message as 'nameTooShort' | 'nameTooLong'}`)); return }
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
      if (isCurrent()) toast.success(t('settings:nameUpdated'))
    } catch { if (isCurrent()) toast.error(t('settings:nameSaveError')) }
    finally { finish() }
  }

  const changePassword = async () => {
    if (childLogin) {toast.info(t('settings:childPassword'));return}
    if (!user?.email || !begin('password')) return
    try {
      const account = await getSettingsAccount(userId, isCurrent)
      if (isTechnicalChildAddress(account.user.email)) return
      const { error } = await supabase.auth.resetPasswordForEmail(account.user.email!, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      if (isCurrent()) toast.success(t('settings:resetSent'))
    } catch { if (isCurrent()) toast.error(t('settings:resetError')) }
    finally { finish() }
  }

  const deleteAccount = async () => {
    // TRAK-155: deleting a guardian account withdraws the approvals they gave.
    const approvals = role === 'parent' ? t('settings:deleteApprovals') : ''
    if (operation.current || !window.confirm(t('settings:deleteConfirm', { approvals })) || !begin('delete')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { error } = await client.rpc('delete_my_account')
      if (error) throw error
      await assertSettingsAccount(userId, isCurrent)
      // RouteGuard owns navigation after a confirmed sign-out.
      await signOut(userId)
    } catch { if (isCurrent()) toast.error(t('settings:deleteError')) }
    finally { finish() }
  }

  const signOutAccount = async () => {
    if (!begin('signout')) return
    try {
      await assertSettingsAccount(userId, isCurrent)
      await signOut(userId)
    } catch { if (isCurrent()) toast.error(t('settings:signOutError')) }
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
  const subtitle = role === 'coach' ? [coachRoleVal, coachClub].filter(Boolean).join(' · ') || t('settings:subtitleCoach')
    : role === 'parent' ? t('settings:subtitleParent') : role === 'player' ? t('settings:subtitlePlayer') : t('settings:subtitleAcademy')

  const sections: SettingsSection[] = [
    {
      id: 'profile', label: t('settings:profile'), icon: UserRound, pending: nameChanged ? 1 : 0,
      description: t('settings:profileDescription'),
      content: <>
        <div className="mb-4 flex items-center gap-4">
          {role === 'player' ? <PlayerFace name={displayName || '?'} size="xl" /> : <Avatar name={displayName || '?'} size="xl" />}
          <div className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm font-medium text-ink">{displayName || '—'}</strong>
            <span className="truncate text-sm text-ink-3">{subtitle}</span>
            <small className="text-xs text-ink-3">{t('settings:photosSoon')}</small>
          </div>
        </div>
        <SettingsRows>
          {named
            ? <div className="pb-3">
                <Input label={t('settings:fullName')} value={nameDraft} autoComplete="name" disabled={pending === 'name'}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') setNameDraft(displayName) }} />
              </div>
            // TRAK-103: a player's name is the academy's roster name; the database refuses a rename.
            : <SettingsRow label={t('settings:name')}>
                <span className="grid"><span className="text-ink">{displayName || '—'}</span><span className="text-xs text-ink-3">{t('settings:academySetsName')}</span></span>
              </SettingsRow>}
          <SettingsRow label={childLogin ? t('settings:username') : t('settings:email')}>{childLogin ? childUsername(user?.email) : user?.email || '—'}</SettingsRow>
        </SettingsRows>
      </>,
    },
    // TRAK-72 item 11: a coach's club, age group and role come from the academy (Trak sets up staff, TRAK-12).
    ...(role === 'coach' ? [{
      id: 'club', label: t('settings:club'), icon: Building2, description: t('settings:clubDescription'),
      content: roleData === 'loading' ? <p role="status" className="text-sm text-ink-3">{t('settings:loadingProfile')}</p>
        : roleData === 'error' ? <div role="alert" className="text-sm text-ink-3">
            <p>{t('settings:profileLoadError')}</p>
            <button onClick={() => setLoadAttempt(value => value + 1)} className="mt-2 text-brand">{t('common:retry')}</button>
          </div>
        : <SettingsRows>
            <SettingsRow label={t('settings:club')}>{coachClub || '—'}</SettingsRow>
            <SettingsRow label={t('settings:ageGroup')}>{coachTeam || '—'}</SettingsRow>
            <SettingsRow label={t('settings:role')}>{coachRoleVal || '—'}</SettingsRow>
          </SettingsRows>,
    }] : []),
    // TRAK-406: everyone picks the language Trak shows them; it is saved on their account.
    {
      id: 'language', label: t('settings:language'), icon: Languages, description: t('settings:languageDescription'),
      content: <LanguageChoice userId={userId} />,
    },
    // TRAK-261 (Imad, 22 Oct): a parent's linked children and consent are here too, as on their Profile tab.
    ...(role === 'parent' ? [{
      id: 'family', label: t('settings:family'), icon: Users, description: t('settings:familyDescription'),
      content: <div className="grid gap-3">
        <ParentFamilyContent><ParentConnections /></ParentFamilyContent>
        <ParentChildCredentials key={userId} />
      </div>,
    }, {
      id: 'consent', label: 'Consent', icon: ShieldCheck, description: "What your children's coaches may record, approved or withdrawn.",
      content: <ParentConsent />,
    }] : []),
    // TRAK-406: the two consent sections stay in English until counsel says whether consent wording must be in Greek
    // (TRAK-22); the same goes for the consent screen.
    // TRAK-177: a 15–17 player at a consent-age-15 academy, who agreed for themselves, withdraws here.
    ...(role === 'player' && decidesOwnConsent(consent.data) ? [{
      id: 'consent', label: 'Consent', icon: ShieldCheck, description: 'You agreed for yourself. You can withdraw it here.',
      content: <OwnConsentSettings Section={Bare} />,
    }] : []),
    // TRAK-136 (J8.13): the reminder 2 days before each event goes to guardians and to players with their own
    // email; a child's username login never gets email. TRAK-261: a coach's two in-app switches.
    ...(role === 'coach' ? [{
      id: 'notifications', label: t('settings:notifications'), icon: Bell, description: t('settings:notificationsCoachDescription'),
      content: <SettingsRows>
        <NotificationSwitch userId={userId} column="cant_make_it_alerts" words="cantMakeIt" />
        <NotificationSwitch userId={userId} column="needs_you" words="needsYou" />
      </SettingsRows>,
    }] : (role === 'parent' || (role === 'player' && !childLogin)) ? [{
      id: 'notifications', label: t('settings:notifications'), icon: Bell, description: t('settings:notificationsEmailDescription'),
      content: <EventReminders userId={userId} />,
    }] : []),
    // TRAK-133 (J8.10): add Trak to a phone calendar, see when it last synced, get a new link.
    ...((role === 'player' || role === 'parent') ? [{
      id: 'calendar', label: t('settings:calendar'), icon: CalendarDays, description: t('settings:calendarDescription'),
      content: <CalendarSettings />,
    }] : []),
    ...(role === 'club' ? [{
      id: 'access', label: t('settings:access'), icon: ShieldCheck, description: t('settings:accessDescription'),
      content: <p className="text-sm text-ink-2">{t('settings:accessText')}</p>,
    }] : []),
    // TRAK-261 (Imad, 22 Oct): Arc's Billing becomes How Trak works, for everyone.
    {
      id: 'how', label: t('settings:howTrakWorks'), icon: BookOpen, description: t('settings:howDescription'),
      // TRAK-418: a coach reads a page written for a coach; players and parents keep theirs.
      content: <Link to={role === 'coach' ? COACH_HOW_PATH : '/how-it-works'} className="text-sm font-medium text-brand">{t('settings:howLink')}</Link>,
    },
    {
      id: 'account', label: t('settings:account'), icon: KeyRound, description: t('settings:accountDescription'),
      content: <SettingsRows>
        <SettingsRow label={t('settings:password')}>
          <Button type="button" variant="secondary" size="sm" onClick={changePassword} disabled={!!pending}>{childLogin ? t('settings:askGuardian') : t('settings:sendResetEmail')}</Button>
        </SettingsRow>
        <SettingsRow label={t('settings:thisDevice')}>
          <Button type="button" variant="secondary" size="sm" onClick={signOutAccount} disabled={!!pending}><LogOut size={15} strokeWidth={1.8} aria-hidden="true" />{t('settings:signOut')}</Button>
        </SettingsRow>
        <SettingsRow label={t('settings:leaveTrak')}>
          <Button type="button" variant="danger" size="sm" onClick={deleteAccount} disabled={!!pending}>{t('settings:deleteAccount')}</Button>
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
          <button onClick={() => navigate(-1)} aria-label={t('common:back')}
            className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink">
            <ArrowLeft size={16} />
          </button>
          <span aria-hidden="true" className="text-[17px] text-ink">{t('settings:title')}</span>
        </div>}
        <SettingsPage title={t('settings:title')} sections={sections} bar={named ? {
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

/**
 * TRAK-406 (Languages 1/8): the language Trak shows. It changes at once on this device, then is saved on the account,
 * so Trak opens in it on every phone and laptop the person signs in on (AccountLanguage). If the words can't load
 * (offline), nothing changes. If only the account save fails, this device keeps the new language and says so.
 */
function LanguageChoice({ userId }: { userId: string }) {
  const { t, language } = useLanguage()
  const { refreshProfile } = useAuth()
  const busy = useRef(false)
  const choose = async (value: string) => {
    if (!isLanguage(value) || value === language || busy.current) return
    busy.current = true
    try {
      try { await showLanguage(value) } catch { toast.error(t('settings:languageLoadError')); return }
      // From here the words are the new language's: i18n.t, not this render's t.
      try {
        const { client } = await getSettingsAccount(userId, () => true)
        const { data, error } = await client.from('profiles').update({ language: value })
          .eq('user_id', userId).select('language').maybeSingle()
        if (error || data?.language !== value) throw error ?? new Error('Language save was not confirmed')
        await refreshProfile()
        toast.success(i18n.t('settings:languageNow'))
      } catch { toast.error(i18n.t('settings:languageDeviceOnly')) }
    } finally { busy.current = false }
  }
  return <SegmentedControl label={t('settings:language')} value={language} onValueChange={value => { void choose(value) }}
    options={LANGUAGES.map(option => ({ value: option.code, label: option.name }))} />
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
  return <NotificationSwitch userId={userId} column="event_reminders" words="eventReminders" />
}

/** One switch on the person's own notification_settings row (TRAK-136; TRAK-261 adds the coach's two). */
/** TRAK-406: `words` names the switch's words in settings.json: its label, its hint, and the noun its messages use. */
function NotificationSwitch({ userId, column, words }: { userId: string; column: SwitchColumn; words: 'cantMakeIt' | 'needsYou' | 'eventReminders' }) {
  const { t } = useTranslation()
  const label = t(`settings:${words}`)
  const hint = t(`settings:${words}Hint`)
  const noun = t(`settings:${words}Noun`)
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
      toast.success(next ? t('settings:switchOn', { label }) : t('settings:switchOff', { label }))
    } catch {
      toast.error(t('settings:switchSaveError', { noun, label }))
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <p role="status" className="py-3.5 text-sm text-muted-foreground">{t('common:loading')}</p>
  if (state === 'error') {
    return (
      <div role="alert" className="py-3.5 text-sm text-muted-foreground">
        <p>{t('settings:switchLoadError', { noun, label })}</p>
        <button onClick={() => setAttempt(value => value + 1)} className="mt-2 text-primary">{t('common:retry')}</button>
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
