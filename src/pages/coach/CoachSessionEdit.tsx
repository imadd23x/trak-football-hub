import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, MetadataLabel, LoadError } from '@/components/trak'
import { SessionChip as Chip } from '@/components/coach/SessionChip'
import { localTodayISO } from '@/lib/event-time'
import { TRAINING_FOCUS, trainingTypeFrom } from '@/lib/training-focus'
import {
  TRAINING_DURATIONS, TRAINING_INTENSITIES,
  parseTrainingNotes, parseTrainingTitle, trainingNotes, trainingTitle,
} from '@/lib/session-form'

/* J4 (TRAK-102): open a saved session and correct it. A coach who missed the
   note or an attendance tick used to have to log a second session, which the
   family then saw twice. Training and other sessions are editable: date,
   focus/title, notes, attendance. A match opens read-only; editing a logged
   match (score, scorers) is out of scope for TRAK-102. */

type Session = {
  id: string
  session_type: string
  title: string
  session_date: string | null
  training_type: string | null
  notes: string | null
}

/** One squad player as this session sees them. */
type Row = {
  id: string
  name: string
  /** The stored attendance: a present row, a row with another status (older
      screens wrote 'absent'), or none. Updated as saves land, so a retry
      after a partial failure only repeats what didn't. */
  saved: 'present' | 'other' | null
  /** Has an assessment on this session. Once also present, they stay present:
      the database refuses the removal (TRAK-100), so the screen doesn't offer it. */
  assessed: boolean
  /** Consent confirmed now. Only these can be added; the database refuses the rest. */
  ready: boolean
  /** Why not ready, for the note under the list. */
  waitReason: string | null
}

const locked = (r: Row) => r.assessed && r.saved === 'present'

export default function CoachSessionEdit() {
  const { user } = useAuth()
  const { id } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [session, setSession] = useState<Session | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  // The form
  const [date, setDate] = useState('')
  const [title, setTitle] = useState('')
  const [focus, setFocus] = useState<Set<string>>(new Set())
  const [duration, setDuration] = useState<number | null>(null)
  const [intensity, setIntensity] = useState('')
  const [notes, setNotes] = useState('')
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user || !id) return
    let superseded = false
    setStatus('loading')
    ;(async () => {
      const { data: s, error } = await supabase
        .from('coach_sessions')
        .select('id, session_type, title, session_date, training_type, notes')
        .eq('id', id)
        .eq('coach_user_id', user.id)
        .maybeSingle()
      if (superseded) return
      // A failed read is not a missing session.
      if (error) { setStatus('failed'); return }
      if (!s) { setStatus('missing'); return }

      const [squadRes, attRes, assessedRes] = await Promise.all([
        supabase.from('squad_players').select('id, player_name').eq('coach_user_id', user.id).order('player_name'),
        supabase.from('session_attendance').select('squad_player_id, status').eq('session_id', id),
        supabase.from('coach_assessments').select('squad_player_id').eq('session_id', id),
      ])
      if (superseded) return
      if (squadRes.error || attRes.error || assessedRes.error) { setStatus('failed'); return }
      const players = squadRes.data ?? []
      // Same check as the add screen; a failed check counts as not confirmed.
      const required = await Promise.all(players.map(p =>
        supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: p.id } as never)
          .then(({ data: r, error: e }) => (e || typeof r !== 'boolean' ? null : r))))
      if (superseded) return

      const stored = new Map<string, Row['saved']>()
      for (const a of attRes.data ?? []) {
        // One present row is enough to count as present.
        if (stored.get(a.squad_player_id) !== 'present') {
          stored.set(a.squad_player_id, a.status === 'present' ? 'present' : 'other')
        }
      }
      const assessed = new Set((assessedRes.data ?? []).map(a => a.squad_player_id as string))
      const next: Row[] = players.map((p, i) => ({
        id: p.id,
        name: p.player_name,
        saved: stored.get(p.id) ?? null,
        assessed: assessed.has(p.id),
        ready: required[i] === false,
        waitReason: required[i] === false ? null
          : required[i] ? 'waiting for a parent' : "consent couldn't be checked",
      }))

      const session = s as Session
      setSession(session)
      setRows(next)
      setDate(session.session_date ?? localTodayISO())
      if (session.session_type === 'training') {
        const t = parseTrainingTitle(session.title, session.training_type)
        setFocus(new Set(t.focus))
        setTitle(t.theme)
        const n = parseTrainingNotes(session.notes)
        setDuration(n.duration)
        setIntensity(n.intensity)
        setNotes(n.notes)
      } else {
        setTitle(session.title)
        setNotes(session.notes ?? '')
      }
      setPresent(new Set(next.filter(r => r.saved === 'present').map(r => r.id)))
      setStatus('ready')
    })()
    return () => { superseded = true }
  }, [user, id, attempt])

  const isTraining = session?.session_type === 'training'
  const isMatch = session?.session_type === 'match'
  const futureDate = date > localTodayISO()
  const canSave = status === 'ready' && !isMatch && !saving && !!date && !futureDate && (
    isTraining ? focus.size > 0 : title.trim().length > 0
  )

  // Shown in the attendance grid: anyone who can be ticked, plus anyone already
  // present (who may be locked). The rest are named under the grid.
  const shown = rows.filter(r => r.ready || r.saved === 'present')
  const waiting = rows.filter(r => !r.ready && r.saved !== 'present')

  const toggle = (r: Row) => {
    if (!r.ready || locked(r)) return
    setPresent(prev => { const n = new Set(prev); if (n.has(r.id)) { n.delete(r.id) } else { n.add(r.id) } return n })
  }

  const handleSave = async () => {
    if (!user || !id || !session || !canSave) return
    setSaving(true)

    const { data: updated, error } = await supabase
      .from('coach_sessions')
      .update(isTraining
        ? {
            session_date: date,
            title: trainingTitle(focus, title),
            training_type: trainingTypeFrom(focus),
            notes: trainingNotes(duration, intensity, notes),
          }
        : { session_date: date, title: title.trim(), notes: notes.trim() || null })
      .eq('id', id)
      .eq('coach_user_id', user.id)
      .select('id')
    // Zero rows updated with no error is not a save.
    if (error || !updated?.length) {
      toast.error(error?.message ? `Could not save: ${error.message}` : 'Could not save this session. Try again.')
      setSaving(false)
      return
    }

    // Attendance, one player at a time, so one refusal doesn't block the rest
    // and can be named. Only players the coach could change are touched.
    const failures: string[] = []
    const savedNow = new Map(rows.map(r => [r.id, r.saved]))
    for (const r of rows) {
      if (!r.ready || locked(r)) continue
      const want = present.has(r.id)
      if (want && r.saved !== 'present') {
        const { data, error: attErr } = r.saved === 'other'
          ? await supabase.from('session_attendance').update({ status: 'present' })
              .eq('session_id', id).eq('squad_player_id', r.id).select('id')
          : await supabase.from('session_attendance')
              .insert({ session_id: id, squad_player_id: r.id, status: 'present' }).select('id')
        if (attErr || !data?.length) failures.push(r.name)
        else savedNow.set(r.id, 'present')
      } else if (!want && r.saved === 'present') {
        const { data, error: attErr } = await supabase.from('session_attendance').delete()
          .eq('session_id', id).eq('squad_player_id', r.id).select('id')
        if (attErr || !data?.length) failures.push(r.name)
        else savedNow.set(r.id, null)
      }
    }
    setRows(prev => prev.map(r => ({ ...r, saved: savedNow.get(r.id) ?? null })))

    if (failures.length > 0) {
      // The form stays as typed; pressing save again repeats only these.
      toast.error(
        `Saved, but attendance didn't change for: ${failures.join(', ')}. Press save again to retry just those.`,
        { duration: 12000 },
      )
      setSaving(false)
      return
    }
    toast.success('Session updated')
    setSaving(false)
    navigate('/coach/sessions/list')
  }

  const header = (
    <div className="flex items-center justify-between pt-3 pb-2 border-b border-white/[0.07]">
      <button onClick={() => navigate('/coach/sessions/list')} aria-label="Back to sessions"
        className="w-[34px] h-[34px] bg-[#17171A] border border-white/[0.11] rounded-[10px] flex items-center justify-center">
        <ChevronLeft size={14} className="text-white/88" />
      </button>
      <span className="text-[16px] font-medium text-white/88" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        {isMatch ? 'Match' : 'Edit session'}
      </span>
      <div className="w-[34px]" />
    </div>
  )

  if (status !== 'ready' || !session) {
    return (
      <MobileShell>
        {header}
        <div className="pt-5">
          {status === 'failed' ? (
            <LoadError what="this session" onRetry={() => setAttempt(n => n + 1)} retrying={false} />
          ) : status === 'missing' ? (
            <p role="status" className="text-[13px] text-white/55">This session isn't available. It may have been deleted.</p>
          ) : (
            <p role="status" className="text-[13px] text-white/45">Loading the session…</p>
          )}
        </div>
      </MobileShell>
    )
  }

  if (isMatch) {
    const attended = rows.filter(r => r.saved === 'present').map(r => r.name)
    return (
      <MobileShell>
        {header}
        <div className="pt-5 pb-24 space-y-5">
          <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
            <p className="text-[16px] text-white/88">{session.title}</p>
            <p className="text-[11px] text-white/45 mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>{session.session_date}</p>
            {session.notes && <p className="text-[13px] text-white/70 mt-3 whitespace-pre-line">{session.notes}</p>}
          </div>
          <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
            <MetadataLabel text={`PLAYED · ${attended.length}`} />
            <p className="text-[13px] text-white/70 mt-2">{attended.length ? attended.join(', ') : 'Nobody recorded.'}</p>
          </div>
          <p className="text-[12px] text-white/40">A logged match can't be edited yet.</p>
        </div>
      </MobileShell>
    )
  }

  return (
    <MobileShell>
      {header}
      <div className="pt-5 pb-32 space-y-5">
        {isTraining ? (
          <>
            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="SESSION FOCUS" />
              <div className="grid grid-cols-2 gap-2 mt-3">
                {TRAINING_FOCUS.map(({ key, sub }) => {
                  const on = focus.has(key)
                  return (
                    <button key={key} type="button" aria-pressed={on}
                      onClick={() => setFocus(prev => { const n = new Set(prev); if (n.has(key)) { n.delete(key) } else { n.add(key) } return n })}
                      className="text-left px-3 py-2.5 rounded-[12px] transition-colors"
                      style={{
                        background: on ? 'rgba(200,242,90,0.10)' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${on ? 'rgba(200,242,90,0.35)' : 'rgba(255,255,255,0.06)'}`,
                      }}>
                      <p className="text-[13px] font-medium" style={{ color: on ? '#C8F25A' : 'rgba(255,255,255,0.78)' }}>{key}</p>
                      <p className="text-[9px] mt-0.5" style={{ color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Mono', monospace" }}>{sub}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012] space-y-4">
              <div>
                <MetadataLabel text="DURATION" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {TRAINING_DURATIONS.map(d => (
                    <Chip key={d} active={duration === d} onClick={() => setDuration(prev => prev === d ? null : d)}>{d} min</Chip>
                  ))}
                </div>
              </div>
              <div>
                <MetadataLabel text="INTENSITY" />
                <div className="flex gap-2 mt-2">
                  {TRAINING_INTENSITIES.map(lvl => (
                    <Chip key={lvl} active={intensity === lvl} onClick={() => setIntensity(prev => prev === lvl ? '' : lvl)}>{lvl}</Chip>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
              <MetadataLabel text="THEME (OPTIONAL)" />
              <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Theme"
                placeholder="e.g. Pressing triggers, Crossing & finishing…"
                className="w-full bg-transparent text-[15px] text-white/88 placeholder-white/20 outline-none mt-2" />
            </div>
          </>
        ) : (
          <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
            <MetadataLabel text="TITLE" />
            <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Title"
              className="w-full bg-transparent text-[16px] text-white/88 placeholder-white/20 outline-none mt-2" />
          </div>
        )}

        <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
          <MetadataLabel text="DATE" />
          <input type="date" aria-label="Session date" max={localTodayISO()} value={date} onChange={e => setDate(e.target.value)}
            className="w-full bg-transparent text-[15px] text-white/88 outline-none mt-2" style={{ colorScheme: 'dark' }} />
        </div>

        <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
          <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-white/45 mb-3"
            style={{ fontFamily: "'DM Mono', monospace" }}>
            ATTENDED · {present.size}
          </span>
          {shown.length === 0 ? (
            <p role="status" className="text-[12px] text-white/40 py-2">No players can be recorded yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shown.map(r => {
                const on = present.has(r.id)
                const fixed = !r.ready || locked(r)
                return (
                  <button key={r.id} type="button" aria-pressed={on} disabled={fixed} onClick={() => toggle(r)}
                    className="text-left px-3 py-2.5 rounded-[10px] transition-colors disabled:cursor-default"
                    style={{
                      background: on ? 'rgba(200,242,90,0.08)' : 'rgba(0,0,0,0.35)',
                      border: `1px solid ${on ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.05)'}`,
                      color: on ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
                      fontSize: 13,
                    }}>
                    {r.name}
                    {fixed && (
                      <span className="block text-[10px] text-white/40 mt-0.5">
                        {locked(r) ? 'Assessed on this session' : `Kept as saved: ${r.waitReason}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {waiting.length > 0 && (
            <p className="text-[11px] text-white/40 pt-3">
              Not recorded until a parent approves: {waiting.map(r => `${r.name} (${r.waitReason})`).join(', ')}
            </p>
          )}
        </div>

        <div className="rounded-[18px] p-4 border border-white/[0.07] bg-[#101012]">
          <MetadataLabel text={isTraining ? 'SESSION NOTES' : 'NOTES'} />
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} aria-label="Notes"
            placeholder="What went well? What needs more work next session?"
            className="w-full bg-transparent text-[14px] text-white/88 placeholder-white/20 outline-none resize-none mt-2" />
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-5 pb-5 pt-3"
        style={{ background: 'linear-gradient(180deg,rgba(10,10,11,0) 0%,#0A0A0B 35%)' }}>
        {futureDate && (
          <p role="alert" className="text-[11px] text-center text-[rgb(251,191,36)] mb-2">
            A session can't be dated in the future.
          </p>
        )}
        <button onClick={handleSave} disabled={!canSave}
          className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
          style={{
            background: canSave ? '#C8F25A' : 'rgba(255,255,255,0.06)',
            color: canSave ? '#000' : 'rgba(255,255,255,0.3)',
            opacity: saving ? 0.6 : 1,
          }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </MobileShell>
  )
}
