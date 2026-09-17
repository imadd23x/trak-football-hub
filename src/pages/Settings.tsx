import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ArrowLeft, Pencil, Check, X, Camera } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { ParentConnections } from '@/components/parent/ParentConnections'
import { supabase } from '@/integrations/supabase/client'
import { POSITIONS, COACH_ROLES, AGE_GROUPS } from '@/lib/constants'

type PassportVisibility = 'coach_only' | 'link'

const nameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Name is too short' })
  .max(80, { message: 'Name must be under 80 characters' })

const STORAGE_KEY = 'trak.settings.v1'

interface LocalSettings {
  // Player
  notifyMatchUpdates: boolean
  notifyCoachFeedback: boolean
  // Coach
  notifySquadUpdates: boolean
  notifyMeetingRequests: boolean
  // Parent
  notifyChildMatchUpdates: boolean
  notifyChildCoachFeedback: boolean
  passportVisibility: PassportVisibility
}

const DEFAULTS: LocalSettings = {
  notifyMatchUpdates: true,
  notifyCoachFeedback: true,
  notifySquadUpdates: true,
  notifyMeetingRequests: true,
  notifyChildMatchUpdates: true,
  notifyChildCoachFeedback: true,
  passportVisibility: 'coach_only',
}

function loadLocal(): LocalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export default function Settings() {
  const navigate = useNavigate()
  const { user, profile, signOut, refreshProfile } = useAuth()

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<LocalSettings>(loadLocal)

  // Avatar
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // Coach profile fields
  const [coachClub,     setCoachClub]     = useState('')
  const [coachTeam,     setCoachTeam]     = useState('')
  const [coachRoleVal,  setCoachRoleVal]  = useState('')
  const [savingCoach,   setSavingCoach]   = useState(false)

  // Player profile fields
  const [playerPos,     setPlayerPos]     = useState('')
  const [playerShirt,   setPlayerShirt]   = useState('')
  const [savingPlayer,  setSavingPlayer]  = useState(false)

  // Player: linked coach + parent names
  const [linkedCoachName,  setLinkedCoachName]  = useState<string | null>(null)
  const [linkedParentName, setLinkedParentName] = useState<string | null>(null)

  useEffect(() => {
    if (profile?.full_name) setNameDraft(profile.full_name)
    if (profile?.avatar_url) setAvatarUrl(profile.avatar_url)
  }, [profile?.full_name, profile?.avatar_url])

  // Load role-specific data
  useEffect(() => {
    if (!user || !profile) return
    if (profile.role === 'coach') {
      supabase.from('coach_details').select('current_club, team, coach_role')
        .eq('user_id', user.id).maybeSingle()
        .then(({ data }) => {
          if (!data) return
          setCoachClub(data.current_club || '')
          setCoachTeam(data.team || '')
          setCoachRoleVal(data.coach_role || '')
        })
    }
    if (profile.role === 'player') {
      supabase.from('player_details').select('position, shirt_number')
        .eq('user_id', user.id).maybeSingle()
        .then(({ data }) => {
          if (!data) return
          setPlayerPos(data.position || '')
          setPlayerShirt(data.shirt_number ? String(data.shirt_number) : '')
        })
    }
    if (profile.role === 'player') {
      // Linked coach
      supabase.from('squad_players').select('coach_user_id')
        .eq('linked_player_id', user.id).maybeSingle()
        .then(async ({ data }) => {
          if (!data?.coach_user_id) return
          const { data: c } = await supabase.from('profiles')
            .select('full_name').eq('user_id', data.coach_user_id).maybeSingle()
          setLinkedCoachName(c?.full_name || null)
        })
      // Linked parent
      supabase.from('player_parent_links').select('parent_user_id')
        .eq('player_user_id', user.id).maybeSingle()
        .then(async ({ data }) => {
          if (!data?.parent_user_id) return
          const { data: p } = await supabase.from('profiles')
            .select('full_name').eq('user_id', data.parent_user_id).maybeSingle()
          setLinkedParentName(p?.full_name || null)
        })
    }
  }, [user, profile])

  const persist = (next: LocalSettings) => {
    setSettings(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const saveName = async () => {
    if (!user || !profile) return
    const parsed = nameSchema.safeParse(nameDraft)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: parsed.data })
      .eq('user_id', user.id)
    setSaving(false)
    if (error) {
      toast.error('Could not save name')
      return
    }
    toast.success('Name updated')
    setEditingName(false)
  }

  const changePassword = async () => {
    if (!user?.email) return
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) toast.error('Could not send reset email')
    else toast.success('Check your email for a reset link')
  }

  const saveCoachProfile = async () => {
    if (!user) return
    if (!coachClub.trim()) { toast.error('Club name is required'); return }
    setSavingCoach(true)
    const { error } = await supabase.from('coach_details')
      .upsert({ user_id: user.id, current_club: coachClub, team: coachTeam, coach_role: coachRoleVal }, { onConflict: 'user_id' })
    setSavingCoach(false)
    if (error) toast.error('Could not save profile')
    else toast.success('Profile updated')
  }

  const savePlayerProfile = async () => {
    if (!user) return
    if (!playerPos) { toast.error('Please select a position'); return }
    setSavingPlayer(true)
    const { error } = await supabase.from('player_details')
      .upsert({ user_id: user.id, position: playerPos, shirt_number: playerShirt ? Number(playerShirt) : null }, { onConflict: 'user_id' })
    setSavingPlayer(false)
    if (error) toast.error('Could not save profile')
    else toast.success('Profile updated')
  }

  const deleteAccount = async () => {
    const confirmed = window.confirm(
      'This permanently deletes all your data and cannot be undone. Are you sure?'
    )
    if (!confirmed) return

    try {
      const { error } = await (supabase.rpc as any)('delete_my_account')
      if (error) {
        console.error('delete_my_account error:', error)
        toast.error('Could not delete account. Please contact support.')
        return
      }
      const { error: signOutError } = await signOut()
      if (signOutError) return
      navigate('/', { replace: true })
    } catch (err) {
      console.error('deleteAccount unexpected error:', err)
      toast.error('Something went wrong. Please contact support.')
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB')
      return
    }
    setUploadingAvatar(true)
    try {
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(user.id, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(user.id)

      // Bust the browser cache with a timestamp
      const urlWithBust = `${publicUrl}?t=${Date.now()}`

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: urlWithBust } as any)
        .eq('user_id', user.id)
      if (updateError) throw updateError

      setAvatarUrl(urlWithBust)
      await refreshProfile()
      toast.success('Profile photo updated')
    } catch (err: any) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const role = profile?.role

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
                    {(profile?.full_name || '?').charAt(0).toUpperCase()}
                  </span>
              }
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
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
                  <button onClick={saveName} disabled={saving} aria-label="Save" style={{ color: '#C8F25A' }}>
                    <Check size={16} />
                  </button>
                  <button onClick={() => { setEditingName(false); setNameDraft(profile?.full_name || '') }} aria-label="Cancel" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="flex items-center gap-2"
                  style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)' }}
                >
                  {profile?.full_name || '—'}
                  <Pencil size={12} style={{ color: 'rgba(255,255,255,0.35)' }} />
                </button>
              )
            }
          />
          <Row label="Email" right={<Value>{user?.email || '—'}</Value>} />
          <Row
            label="Password"
            right={
              <button onClick={changePassword} style={{ fontSize: 13, color: '#C8F25A' }}>
                Send reset email
              </button>
            }
          />
        </Section>

        {/* Coach profile */}
        {role === 'coach' && (
          <Section label="My Profile">
            <Row label="Club" right={
              <input value={coachClub} onChange={e => setCoachClub(e.target.value)}
                placeholder="Club name"
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right', width: 160 }} />
            } />
            <Row label="Age Group" right={
              <select value={coachTeam} onChange={e => setCoachTeam(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: coachTeam ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.35)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {AGE_GROUPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            } />
            <Row label="Role" right={
              <select value={coachRoleVal} onChange={e => setCoachRoleVal(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {COACH_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            } />
            <div className="py-3">
              <button onClick={saveCoachProfile} disabled={savingCoach}
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
              <select value={playerPos} onChange={e => setPlayerPos(e.target.value)}
                style={{ background: '#101012', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right' }}>
                <option value="">Select…</option>
                {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            } />
            <Row label="Shirt number" right={
              <input value={playerShirt} onChange={e => setPlayerShirt(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" placeholder="—"
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 13, color: 'rgba(255,255,255,0.88)', textAlign: 'right', width: 48 }} />
            } />
            <div className="py-3">
              <button onClick={savePlayerProfile} disabled={savingPlayer}
                style={{ fontSize: 13, color: '#C8F25A' }}>
                {savingPlayer ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </Section>
        )}

        {/* Connections — player */}
        {role === 'player' && (
          <Section label="Connections">
            <ConnectionRow
              label="Coach"
              status={linkedCoachName ? 'connected' : 'none'}
              name={linkedCoachName ?? undefined}
            />
            <ConnectionRow
              label="Parent"
              status={linkedParentName ? 'connected' : 'none'}
              name={linkedParentName ?? undefined}
            />
            {(!linkedCoachName || !linkedParentName) && (
              <div className="py-3" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                Share your invite code from your profile to connect with a coach or parent.
              </div>
            )}
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

        {/* Notifications */}
        <Section label="Notifications">
          {role === 'player' && (
            <>
              <ToggleRow
                label="Match updates"
                value={settings.notifyMatchUpdates}
                onChange={v => persist({ ...settings, notifyMatchUpdates: v })}
              />
              <ToggleRow
                label="Coach feedback"
                value={settings.notifyCoachFeedback}
                onChange={v => persist({ ...settings, notifyCoachFeedback: v })}
              />
            </>
          )}
          {role === 'coach' && (
            <>
              <ToggleRow
                label="Squad updates"
                value={settings.notifySquadUpdates}
                onChange={v => persist({ ...settings, notifySquadUpdates: v })}
              />
              <ToggleRow
                label="Meeting requests"
                value={settings.notifyMeetingRequests}
                onChange={v => persist({ ...settings, notifyMeetingRequests: v })}
              />
            </>
          )}
          {role === 'parent' && (
            <>
              <ToggleRow
                label="Match updates"
                value={settings.notifyChildMatchUpdates}
                onChange={v => persist({ ...settings, notifyChildMatchUpdates: v })}
              />
              <ToggleRow
                label="Coach feedback"
                value={settings.notifyChildCoachFeedback}
                onChange={v => persist({ ...settings, notifyChildCoachFeedback: v })}
              />
            </>
          )}
        </Section>

        {/* Privacy — player only */}
        {role === 'player' && (
          <Section label="Privacy">
            <Row
              label="Who can see my passport"
              right={
                <Segmented
                  value={settings.passportVisibility}
                  options={[
                    { value: 'coach_only', label: 'Coach only' },
                    { value: 'link', label: 'Anyone with link' },
                  ]}
                  onChange={v => persist({ ...settings, passportVisibility: v as PassportVisibility })}
                />
              }
              stack
            />
          </Section>
        )}

        {/* Sign out */}
        <button
          onClick={async () => {
            const { error } = await signOut()
            if (error) return
            navigate('/', { replace: true })
          }}
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

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row
      label={label}
      right={
        <button
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          style={{
            position: 'relative',
            width: 38,
            height: 22,
            borderRadius: 999,
            background: value ? '#C8F25A' : 'rgba(255,255,255,0.1)',
            transition: 'background 150ms ease',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: value ? 18 : 2,
              width: 18,
              height: 18,
              borderRadius: 999,
              background: value ? '#000' : '#0A0A0B',
              transition: 'left 150ms ease',
            }}
          />
        </button>
      }
    />
  )
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div
      className="inline-flex p-1 rounded-full"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="px-3 py-1 rounded-full"
            style={{
              fontSize: 11,
              color: active ? '#000' : 'rgba(255,255,255,0.55)',
              background: active ? '#C8F25A' : 'transparent',
              transition: 'all 150ms ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
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
