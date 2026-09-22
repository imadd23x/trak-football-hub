import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ArrowLeft, Pencil, Check, X, Camera } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { assertSettingsAccount, getSettingsAccount } from '@/lib/settings-account'
import { avatarObjectPath, resolveAvatarUrl } from '@/lib/avatar-url'
import { ParentConnections } from '@/components/parent/ParentConnections'
import { supabase } from '@/integrations/supabase/client'
import { POSITIONS, COACH_ROLES, AGE_GROUPS } from '@/lib/constants'

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

type Operation = 'name' | 'coach' | 'player' | 'avatar' | 'delete' | 'password' | 'signout'

function AccountSettings({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const { user, profile, signOut, completeAccountDeletion, refreshProfile } = useAuth()
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
  const uploadingAvatar = pending === 'avatar'
  const savingCoach = pending === 'coach'
  const savingPlayer = pending === 'player'

  const [editingName, setEditingName] = useState(false)
  const [displayName, setDisplayName] = useState(profile?.full_name ?? '')
  const [nameDraft, setNameDraft] = useState(profile?.full_name ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Never the raw `profiles.avatar_url` value — it is a storage key or a
  // legacy URL, not something an <img> can load. The effect below signs it.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [coachClub, setCoachClub] = useState('')
  const [coachTeam, setCoachTeam] = useState('')
  const [coachRoleVal, setCoachRoleVal] = useState('')
  const [playerPos, setPlayerPos] = useState('')
  const [playerShirt, setPlayerShirt] = useState('')
  const [linkedCoachNames, setLinkedCoachNames] = useState<string[]>([])
  const [linkedParentNames, setLinkedParentNames] = useState<string[]>([])
  const [connections, setConnections] = useState<'loading' | 'ready' | 'error'>('loading')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [roleData, setRoleData] = useState<'loading' | 'ready' | 'error'>(role === 'coach' || role === 'player' ? 'loading' : 'ready')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => { setDisplayName(profile?.full_name ?? '') }, [profile?.full_name])
  // F-3: `profiles.avatar_url` holds a bare storage key going forward (a
  // legacy public URL for anyone who uploaded before this fix), never
  // something renderable as-is — the `avatars` bucket has been private since
  // 26 May. Sign it into a URL that actually loads; null (no avatar, or a
  // signing failure) falls through to the initials placeholder rather than a
  // broken image.
  useEffect(() => {
    let cancelled = false
    const current = () => mounted.current && !cancelled
    if (!profile?.avatar_url) { setAvatarUrl(null); return }
    void (async () => {
      const { client } = await getSettingsAccount(userId, current)
      const signed = await resolveAvatarUrl(
        profile.avatar_url,
        (path, expiresIn) => client.storage.from('avatars').createSignedUrl(path, expiresIn),
        message => console.error('[avatar] could not sign stored avatar:', message),
      )
      if (current()) setAvatarUrl(signed)
    })()
    return () => { cancelled = true }
  }, [userId, profile?.avatar_url])

  // Stable identity/role dependencies preserve unfinished drafts on token refresh.
  useEffect(() => {
    if (role !== 'coach' && role !== 'player') return
    let cancelled = false
    const controller = new AbortController()
    const current = () => mounted.current && !cancelled
    setRoleData('loading')
    void (async () => {
      const { client } = await getSettingsAccount(userId, current)
      if (role === 'coach') {
        const { data, error } = await client.from('coach_details').select('current_club, team, coach_role')
          .eq('user_id', userId).abortSignal(controller.signal).maybeSingle()
        if (error) throw error
        if (!current()) return
        setCoachClub(data?.current_club ?? '')
        setCoachTeam(data?.team ?? '')
        setCoachRoleVal(data?.coach_role ?? '')
      } else {
        const { data, error } = await client.from('player_details').select('position, shirt_number')
          .eq('user_id', userId).abortSignal(controller.signal).maybeSingle()
        if (error) throw error
        if (!current()) return
        setPlayerPos(data?.position ?? '')
        setPlayerShirt(data?.shirt_number == null ? '' : String(data.shirt_number))
      }
      if (current()) setRoleData('ready')
    })().catch(() => { if (current()) setRoleData('error') })
    return () => { cancelled = true; controller.abort() }
  }, [userId, role, loadAttempt])

  // Ancillary connections cannot block editing the player's own details.
  useEffect(() => {
    if (role !== 'player') return
    let cancelled = false
    const controller = new AbortController()
    const current = () => mounted.current && !cancelled
    setConnections('loading')
    void (async () => {
      const { client } = await getSettingsAccount(userId, current)
      const [squad, parents] = await Promise.all([
        client.from('squad_players').select('coach_user_id').eq('linked_player_id', userId).eq('status', 'active').abortSignal(controller.signal),
        client.from('player_parent_links').select('parent_user_id').eq('player_user_id', userId).abortSignal(controller.signal),
      ])
      if (squad.error) throw squad.error
      if (parents.error) throw parents.error
      const coachIds = [...new Set((squad.data ?? []).flatMap(row => row.coach_user_id ? [row.coach_user_id] : []))]
      const parentIds = [...new Set((parents.data ?? []).map(row => row.parent_user_id))]
      const ids = [...new Set([...coachIds, ...parentIds])]
      const names = new Map<string, string>()
      if (ids.length) {
        const { data, error } = await client.from('profiles').select('user_id, full_name').in('user_id', ids).abortSignal(controller.signal)
        if (error) throw error
        for (const row of data ?? []) names.set(row.user_id, row.full_name)
      }
      if (!current()) return
      // A profile name may be hidden by RLS without invalidating the link.
      setLinkedCoachNames(coachIds.map(id => names.get(id) || 'Linked coach'))
      setLinkedParentNames(parentIds.map(id => names.get(id) || 'Linked parent'))
      setConnections('ready')
    })().catch(() => { if (current()) setConnections('error') })
    return () => { cancelled = true; controller.abort() }
  }, [userId, role, connectionAttempt])

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

  const saveCoachProfile = async () => {
    if (roleData !== 'ready') return
    if (!coachClub.trim()) { toast.error('Club name is required'); return }
    if (!begin('coach')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { data, error } = await client.from('coach_details')
        .upsert({ user_id: userId, current_club: coachClub, team: coachTeam, coach_role: coachRoleVal }, { onConflict: 'user_id' })
        .select('user_id').maybeSingle()
      if (error) throw error
      if (data?.user_id !== userId) throw new Error('Profile save was not confirmed')
      if (isCurrent()) toast.success('Profile updated')
    } catch { if (isCurrent()) toast.error('Could not save profile') }
    finally { finish() }
  }

  const savePlayerProfile = async () => {
    if (roleData !== 'ready') return
    if (!playerPos) { toast.error('Please select a position'); return }
    if (!begin('player')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { data, error } = await client.from('player_details')
        .upsert({ user_id: userId, position: playerPos, shirt_number: playerShirt ? Number(playerShirt) : null }, { onConflict: 'user_id' })
        .select('user_id').maybeSingle()
      if (error) throw error
      if (data?.user_id !== userId) throw new Error('Profile save was not confirmed')
      if (isCurrent()) toast.success('Profile updated')
    } catch { if (isCurrent()) toast.error('Could not save profile') }
    finally { finish() }
  }

  const deleteAccount = async () => {
    if (operation.current || !window.confirm(
      'Delete your account? Your sign-in and profile will be removed. Some academy history and consent records may be retained. This cannot be undone.'
    ) || !begin('delete')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      // Always clean the canonical key, even if its profile reference was lost.
      // A legacy reference may add only a path inside this same user's folder.
      const storedKey = avatarObjectPath(profile?.avatar_url)
      const keys = [userId]
      if (storedKey?.startsWith(`${userId}/`)) keys.push(storedKey)
      const { error: cleanupError } = await client.storage.from('avatars').remove(keys)
      if (cleanupError) {
        if (isCurrent()) toast.error('Could not remove your profile photo. Your account has not been deleted. Please try again.')
        return
      }
      await assertSettingsAccount(userId, isCurrent)
      setAvatarUrl(null)
      // The database independently refuses deletion if any owned avatar remains.
      const { error } = await client.rpc('delete_my_account')
      if (error) throw error
      // Record the acknowledged identity even if another account took over;
      // the provider only finalizes logout when that identity is still current.
      await completeAccountDeletion(userId)
    } catch { if (isCurrent()) toast.error('Could not delete account. Please contact support.') }
    finally { finish() }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return }
    if (!begin('avatar')) return
    try {
      const { client } = await getSettingsAccount(userId, isCurrent)
      const { error: uploadError } = await client.storage.from('avatars')
        .upload(userId, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError
      await assertSettingsAccount(userId, isCurrent)
      // F-3: store the bare object key, not getPublicUrl()'s output — the
      // `avatars` bucket is private, so a "public" URL 404s everywhere it is
      // rendered even though the upload and this save both report success.
      // No cache-buster: a signed URL is minted fresh per render below and
      // per read at every other call site, so there is nothing to bust.
      const { data, error } = await client.from('profiles').update({ avatar_url: userId })
        .eq('user_id', userId).select('user_id').maybeSingle()
      if (error) throw error
      if (data?.user_id !== userId) throw new Error('Profile photo save was not confirmed')
      await assertSettingsAccount(userId, isCurrent)
      const signed = await resolveAvatarUrl(
        userId,
        (path, expiresIn) => client.storage.from('avatars').createSignedUrl(path, expiresIn),
        message => console.error('[avatar] could not sign the upload for preview:', message),
      )
      if (isCurrent()) setAvatarUrl(signed)
      await refreshProfile()
      if (isCurrent()) toast.success('Profile photo updated')
    } catch (error) {
      if (isCurrent()) toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      finish()
      if (isCurrent() && fileInputRef.current) fileInputRef.current.value = ''
    }
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

        {/* Avatar */}
        <div className="flex flex-col items-center mb-7">
          <div className="relative">
            <div
              className="w-[72px] h-[72px] rounded-[22px] overflow-hidden flex items-center justify-center"
              style={{ background: '#202024', border: '1px solid rgba(200,242,90,0.18)' }}
            >
              {avatarUrl
                ? <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                : <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 600, color: '#C8F25A' }}>
                    {(displayName || '?').charAt(0).toUpperCase()}
                  </span>
              }
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!pending}
              className="absolute -bottom-1.5 -right-1.5 w-[26px] h-[26px] rounded-full flex items-center justify-center"
              style={{ background: '#C8F25A', border: '2px solid #0A0A0B' }}
              aria-label="Change profile photo"
            >
              <Camera size={13} color="#000" />
            </button>
          </div>
          {uploadingAvatar && (
            <span className="mt-3" style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
              Uploading…
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarChange}
          />
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
        {role === 'coach' && (
          <Section label="My Profile">
            <Row label="Club" right={
              <input value={coachClub} disabled={!!pending || roleData !== 'ready'} onChange={e => setCoachClub(e.target.value)}
                placeholder="Club name"
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right', width: 160 }} />
            } />
            <Row label="Age Group" right={
              <select value={coachTeam} disabled={!!pending || roleData !== 'ready'} onChange={e => setCoachTeam(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: coachTeam ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.35)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            } />
            <Row label="Role" right={
              <select value={coachRoleVal} disabled={!!pending || roleData !== 'ready'} onChange={e => setCoachRoleVal(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {COACH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            } />
            <div className="py-3">
              <button onClick={saveCoachProfile} disabled={!!pending || roleData !== 'ready'}
                style={{ fontSize: 13, color: '#C8F25A' }}>
                {savingCoach ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Section>
        )}

        {/* Player profile */}
        {role === 'player' && (
          <Section label="My Profile">
            <Row label="Position" right={
              <select value={playerPos} disabled={!!pending || roleData !== 'ready'} onChange={e => setPlayerPos(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            } />
            <Row label="Shirt number" right={
              <input value={playerShirt} disabled={!!pending || roleData !== 'ready'} onChange={e => setPlayerShirt(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" placeholder="—"
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right', width: 48 }} />
            } />
            <div className="py-3">
              <button onClick={savePlayerProfile} disabled={!!pending || roleData !== 'ready'}
                style={{ fontSize: 13, color: '#C8F25A' }}>
                {savingPlayer ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Section>
        )}

        {/* Connections — player */}
        {role === 'player' && (
          <Section label="Connections">
            {connections === 'loading' && <p role="status" className="py-3 text-sm text-white/50">Loading connections…</p>}
            {connections === 'error' && <div role="alert" className="py-3 text-sm text-white/50">
              Connections could not be loaded. <button onClick={() => setConnectionAttempt(value => value + 1)}>Retry connections</button>
            </div>}
            {connections === 'ready' && <>
              <ConnectionRow label={linkedCoachNames.length > 1 ? 'Coaches' : 'Coach'}
                status={linkedCoachNames.length ? 'connected' : 'none'} name={linkedCoachNames.join(', ') || undefined} />
              <ConnectionRow label={linkedParentNames.length > 1 ? 'Parents' : 'Parent'}
                status={linkedParentNames.length ? 'connected' : 'none'} name={linkedParentNames.join(', ') || undefined} />
              {(!linkedCoachNames.length || !linkedParentNames.length) && (
                <div className="py-3" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                  {!linkedCoachNames.length && 'Ask your coach for their TRK- code and enter it on your Profile to connect. '}
                  {!linkedParentNames.length && 'To add a parent, send them an invite from your Profile.'}
                </div>
              )}
            </>}
          </Section>
        )}

        {/* Connections — parent */}
        {role === 'parent' && (
          <Section label="Linked children">
            <ParentConnections />
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

function ConnectionRow({
  label,
  status,
  name,
  onRemove,
}: {
  label: string
  status: 'connected' | 'none'
  name?: string
  onRemove?: () => void
}) {
  const connected = status === 'connected'
  return (
    <div
      className="py-3.5 flex items-center justify-between gap-3"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: connected ? '#C8F25A' : 'rgba(255,255,255,0.15)',
            flexShrink: 0,
          }}
        />
        <div className="min-w-0">
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
          <div
            className="truncate"
            style={{ fontSize: 13, color: connected ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.4)' }}
          >
            {connected ? name : 'Not connected'}
          </div>
        </div>
      </div>
      {connected && onRemove && (
        <button
          onClick={onRemove}
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.4)',
            flexShrink: 0,
          }}
        >
          Remove
        </button>
      )}
    </div>
  )
}
