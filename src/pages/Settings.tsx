import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ArrowLeft, Pencil, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { assertSettingsAccount, getSettingsAccount } from '@/lib/settings-account'
import { supabase } from '@/integrations/supabase/client'

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
  const saving = pending === 'name'

  const [editingName, setEditingName] = useState(false)
  const [displayName, setDisplayName] = useState(profile?.full_name ?? '')
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

  useEffect(() => { setDisplayName(profile?.full_name ?? '') }, [profile?.full_name])
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
      setDisplayName(data.full_name)
      setNameDraft(data.full_name)
      setEditingName(false)
      await refreshProfile()
      if (isCurrent()) toast.success('Name updated')
    } catch { if (isCurrent()) toast.error('Could not save name') }
    finally { finish() }
  }

  const changePassword = async () => {
    if (!user?.email || !begin('password')) return
    try {
      const account = await getSettingsAccount(userId, isCurrent)
      const { error } = await supabase.auth.resetPasswordForEmail(account.user.email!, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      if (isCurrent()) toast.success('Check your email for a reset link')
    } catch { if (isCurrent()) toast.error('Could not send reset email') }
    finally { finish() }
  }

  const deleteAccount = async () => {
    if (operation.current || !window.confirm(
      'Delete your account? Your sign-in and profile will be removed. Some academy history and consent records may be retained. This cannot be undone.'
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

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0B', fontFamily: "'DM Sans', sans-serif" }}>
      <div className="mx-auto max-w-[430px] px-5 pt-5 pb-12">
        {/* Header */}
        <div className="relative flex items-center justify-center mb-6 h-10">
          <button
            onClick={() => navigate(-1)}
            className="absolute left-0 flex items-center justify-center"
            style={{
              width: 36, height: 36, borderRadius: 999,
              background: '#101012', border: '1px solid rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.88)',
            }}
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.88)' }}>
            Settings
          </h1>
        </div>

        <div className="flex flex-col items-center mb-7">
          <div className="w-[72px] h-[72px] rounded-[22px] bg-card border border-border flex items-center justify-center">
            <span className="font-mono text-2xl font-semibold text-primary" aria-hidden="true">
              {(displayName || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Profile photos are coming soon.</p>
        </div>

        {/* Account */}
        <Section label="Account">
          <Row
            label="Display name"
            right={
              editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    disabled={saving}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                    style={{
                      background: '#202024',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      fontSize: 13,
                      color: 'rgba(255,255,255,0.88)',
                      width: 160,
                    }}
                  />
                  <button onClick={saveName} disabled={!!pending} aria-label="Save" style={{ color: '#C8F25A' }}>
                    <Check size={16} />
                  </button>
                  <button disabled={!!pending} onClick={() => { setEditingName(false); setNameDraft(displayName) }} aria-label="Cancel" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  disabled={!!pending} onClick={() => { setNameDraft(displayName); setEditingName(true) }}
                  className="flex items-center gap-2"
                  style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)' }}
                >
                  {displayName || '—'}
                  <Pencil size={12} style={{ color: 'rgba(255,255,255,0.35)' }} />
                </button>
              )
            }
          />
          <Row label="Email" right={<Value>{user?.email || '—'}</Value>} />
          <Row
            label="Password"
            right={
              <button onClick={changePassword} disabled={!!pending} style={{ fontSize: 13, color: '#C8F25A' }}>
                Send reset email
              </button>
            }
          />
        </Section>

        {roleData === 'loading' && <p role="status" className="text-sm text-muted-foreground mb-4">Loading profile…</p>}
        {roleData === 'error' && <div role="alert" className="text-sm text-muted-foreground mb-4">
          <p>Could not load your profile details.</p>
          <button onClick={() => setLoadAttempt(value => value + 1)} className="mt-2 text-primary">Retry</button>
        </div>}

        {/* Coach profile */}
        {role === 'coach' && roleData === 'ready' && (
          <Section label="My Profile">
            <Row label="Club" right={<Value>{coachClub || '—'}</Value>} />
            <Row label="Age Group" right={<Value>{coachTeam || '—'}</Value>} />
            <Row label="Role" right={<Value>{coachRoleVal || '—'}</Value>} />
            <p className="py-3" style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              Your academy sets these. Ask them if something is wrong.
            </p>
          </Section>
        )}

        {/* Club admin info */}
        {role === 'club' && (
          <Section label="Access">
            <div className="py-3" style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
              Read-only academy view. You can see all coaches and squads but cannot edit player or coach records.
            </div>
          </Section>
        )}

        {/* Sign out */}
        <button
          onClick={signOutAccount}
          disabled={!!pending}
          className="w-full py-3 rounded-lg mt-2"
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.78)',
            fontSize: 13,
          }}
        >
          Sign out
        </button>

        {/* Danger zone */}
        <div className="mt-10 flex justify-center">
          <button
            onClick={deleteAccount}
            disabled={!!pending}
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'rgba(220,80,80,0.55)',
            }}
          >
            Delete my account
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------- atoms ------- */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.22)',
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        className="px-4"
        style={{
          background: '#101012',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 18,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Row({ label, right, stack = false }: { label: string; right: React.ReactNode; stack?: boolean }) {
  return (
    <div
      className={`py-3.5 ${stack ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-3'}`}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.45)',
        }}
      >
        {label}
      </div>
      <div className={stack ? '' : 'flex items-center'}>{right}</div>
    </div>
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>{children}</span>
}

