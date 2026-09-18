import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { MobileShell, BandPill, NavBar } from '@/components/trak'
import { SliderInput } from '@/components/trak/SliderInput'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { BandType } from '@/lib/types'
import { deriveCardStats } from '@/lib/cardStats'
import { trackEvent, startTimer } from '@/lib/telemetry'
import { ChevronLeft, ChevronDown } from 'lucide-react'
import { useLocation } from 'react-router-dom'

/* ---------- helpers ---------- */

function bandConfig(band: BandType) {
  return BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
}

function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/* ---------- option pill ---------- */

function OptPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-[10px] p-[11px_8px] text-center text-[13px] font-medium transition-colors"
      style={{
        background: active ? 'rgba(200,242,90,0.12)' : '#0d0d0f',
        border: active ? '1.5px solid #C8F25A' : '1.5px solid rgba(255,255,255,0.06)',
        color: active ? '#C8F25A' : 'rgba(255,255,255,0.55)',
      }}
    >
      {label}
    </button>
  )
}

/* ========== main page ========== */

export default function CoachAssessPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  /* --- data --- */
  const [players, setPlayers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [playerId, setPlayerId] = useState((location.state as any)?.preselectedPlayerId || '')
  const [sessionId, setSessionId] = useState('')
  const [appearance, setAppearance] = useState<'started' | 'sub' | 'training'>('started')
  const [workRate, setWorkRate]         = useState(5)
  const [tactical, setTactical]         = useState(5)
  const [attitude, setAttitude]         = useState(5)
  const [technical, setTechnical]       = useState(5)
  const [physical, setPhysical]         = useState(5)
  const [coachability, setCoachability] = useState(5)
  const [note, setNote] = useState('')

  // Shared feedback (K9). Deliberately separate state from `note`, mirroring
  // the schema: the note is the coach's private working record and the child
  // never sees it. This is written for the child to read, and only once the
  // coach publishes it. Nothing copies one into the other — that is the whole
  // point of the two tables, and it has to be true in the UI as well.
  const [shared,          setShared]          = useState('')
  const [sharedPublished, setSharedPublished] = useState(false)
  const [sharedExists,    setSharedExists]    = useState(false)
  const [saving, setSaving] = useState(false)

  /* Scorecard metric 4: median time to assess one player, target <90s.
     The clock starts when a player is chosen, not on mount, so a page left
     open on the drive home does not pollute the median. */
  const timerRef = useRef<(() => number) | null>(null)
  useEffect(() => {
    timerRef.current = playerId ? startTimer() : null
  }, [playerId])

  /* Today's existing assessment for the selected player, if any.
     The page only ever INSERTed, so a coach who saved and then came back to
     add a note created a SECOND assessment — with every slider at its default
     5, which reads as a real "Mixed" verdict. Same bad-data trap the quick
     assess fix closed. Now the day's assessment is loaded and updated. */
  const [existingId, setExistingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !playerId) { setExistingId(null); return }
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    supabase
      .from('coach_assessments')
      .select('id, work_rate, tactical, attitude, technical, physical, coachability, appearance, session_id')
      .eq('coach_user_id', user.id)
      .eq('squad_player_id', playerId)
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          setExistingId(null)
          setShared(''); setSharedPublished(false); setSharedExists(false)
          return
        }
        setExistingId(data.id)
        setWorkRate(data.work_rate); setTactical(data.tactical)
        setAttitude(data.attitude); setTechnical(data.technical)
        setPhysical(data.physical); setCoachability(data.coachability)
        if (data.appearance) setAppearance(data.appearance as 'started' | 'sub' | 'training')
        if (data.session_id) setSessionId(data.session_id)

        // Read back what the child can already see. A coach editing today's
        // assessment must be shown the published text — otherwise the box is
        // blank, they assume nothing is shared, and they cannot correct
        // something the child is currently reading.
        // Cast until src/integrations/supabase/types.ts is regenerated: the
        // table ships in this PR's migration, so it does not exist in the
        // project the types were generated from. Same idiom AuthContext uses
        // for link_player_to_coach. Regenerate once #44 is in production.
        supabase
          .from('coach_shared_feedback' as any)
          .select('body, published_at')
          .eq('assessment_id', data.id)
          .maybeSingle()
          .then(res => {
            // Shaped here rather than leaving `any` to spread through the file.
            const sf = res.data as { body: string | null; published_at: string | null } | null
            if (!sf) { setShared(''); setSharedPublished(false); setSharedExists(false); return }
            setShared(sf.body ?? '')
            setSharedPublished(sf.published_at != null)
            setSharedExists(true)
          })
      })
  }, [user, playerId])

  /* fetch squad players */
  useEffect(() => {
    if (!user) return
    supabase
      .from('squad_players')
      .select('*')
      .eq('coach_user_id', user.id)
      .order('player_name')
      .then(({ data }) => setPlayers(data || []))
  }, [user])

  /* fetch sessions/matches for the session dropdown */
  useEffect(() => {
    if (!user) return
    supabase
      .from('coach_sessions')
      .select('*')
      .eq('coach_user_id', user.id)
      .order('session_date', { ascending: false })
      .limit(20)
      .then(({ data }) => setSessions(data || []))
  }, [user])

  /* --- computed --- */
  const avg = (workRate + tactical + attitude + technical + physical + coachability) / 6
  const band = scoreToBand(avg)
  const overallCfg = bandConfig(band)

  const selectedPlayer = useMemo(
    () => players.find(p => p.id === playerId),
    [players, playerId],
  )

  /* --- save --- */
  const handleSave = async () => {
    if (!user || !playerId || saving) return
    setSaving(true)
    const cardStats = deriveCardStats({ workRate, tactical, attitude, technical, physical, coachability })
    const payload = {
      coach_user_id: user.id,
      coach_name_snapshot: profile?.full_name || null,
      squad_player_id: playerId,
      session_id: sessionId || null,
      appearance,
      // raw coach inputs
      work_rate: workRate,
      tactical,
      attitude,
      technical,
      physical,
      coachability,
      // derived card stats
      ...cardStats,
    }

    const { data: saved, error: saveError } = existingId
      ? await supabase.from('coach_assessments')
          .update(payload).eq('id', existingId).select('id').maybeSingle()
      : await supabase.from('coach_assessments')
          .insert(payload).select('id').maybeSingle()

    if (saveError) {
      console.error('Save failed:', saveError)
      toast.error(`Could not save assessment: ${saveError.message}`)
      setSaving(false)
      return
    }

    // A row is required, not just the absence of an error. .maybeSingle() on an
    // UPDATE that matched nothing returns data null with error null — an RLS
    // denial, or an assessment deleted or transferred since this page loaded.
    // Everything below is keyed on saved.id, so without this the note and the
    // shared feedback both silently skip and the coach is sent home believing
    // the assessment saved. Imad reproduced it on #44.
    if (!saved?.id) {
      console.error('Save matched no assessment row', { existingId })
      toast.error('Nothing was saved — the assessment may have been removed. Reload and try again.')
      setSaving(false)
      return
    }

    if (saved?.id && note.trim()) {
      // upsert, so re-saving replaces the note rather than stacking another
      const { error: noteError } = await supabase.from('coach_assessment_notes').upsert({
        assessment_id: saved.id,
        coach_user_id: user.id,
        note: note.trim(),
      }, { onConflict: 'assessment_id' })
      if (noteError) {
        console.error('Note save failed:', noteError)
        toast.error(`Assessment saved, note failed: ${noteError.message}`)
      }
    }

    // Shared feedback, written separately and published deliberately (K9).
    // Never derived from `note`. Saved whenever there is text OR a row already
    // exists, so clearing the box and unpublishing both take effect.
    if (saved?.id && (shared.trim() || sharedExists)) {
      // Cast for the same reason as the read above.
      const { error: sharedError } = await supabase.from('coach_shared_feedback' as any).upsert({
        assessment_id: saved.id,
        coach_user_id: user.id,
        body:          shared.trim(),
        // NULL retracts: the child stops seeing it immediately.
        published_at:  sharedPublished && shared.trim() ? new Date().toISOString() : null,
      }, { onConflict: 'assessment_id' })
      if (sharedError) {
        // Stay put. Navigating away here loses the text the coach wrote for the
        // child and gives them no way to retry it — the same mistake K5 fixed
        // in the match flow, which I then repeated in my own new code an hour
        // later. The assessment itself is saved, so keep its id: pressing save
        // again updates that row rather than creating a second one.
        console.error('Shared feedback save failed:', sharedError)
        toast.error(
          `Assessment saved, but the feedback for the player did not: ${sharedError.message}. ` +
            `Your text is still here — press save to try again.`,
          { duration: 12000 },
        )
        setExistingId(saved.id)
        setSaving(false)
        return
      }
      setSharedExists(true)
    }
    trackEvent('assessment_submitted', {
      mode: 'full',
      players: 1,
      squad_player_id: playerId,
      band,
      updated: existingId !== null,
      has_note: note.trim().length > 0,
      duration_ms: timerRef.current?.() ?? null,
    })
    navigate('/coach/home')
  }

  /* ---- render ---- */
  return (
    <div className="flex flex-col mx-auto max-w-[430px] bg-[#0A0A0B]" style={{ height: '100dvh' }}>
      {/* ---- header: always visible, never scrolls ---- */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={() => {
            const fromPlayer = (location.state as any)?.preselectedPlayerId
            navigate(fromPlayer ? `/coach/player/${fromPlayer}` : '/coach/home')
          }}
          className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]"
        >
          <ChevronLeft size={16} className="text-white/70" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px] pointer-events-none">
          Assessment
        </h1>
      </div>

      {/* ---- scrollable content ---- */}
      <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-5 pt-4">

        {/* ---- 2. player card (sq-item) ---- */}
        {selectedPlayer ? (
          <div className="flex items-center gap-3 p-3 rounded-[12px] bg-[#141416] border border-white/[0.06]">
            <div
              className="flex items-center justify-center w-[38px] h-[38px] rounded-full text-[13px] font-bold shrink-0"
              style={{ background: 'rgba(200,242,90,0.14)', color: '#C8F25A' }}
            >
              {initials(selectedPlayer.player_name)}
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-white/90 truncate">
                {selectedPlayer.player_name}
              </p>
              <p className="text-[11px] text-white/40 truncate">
                {selectedPlayer.position?.toUpperCase() ?? 'Player'}
                {selectedPlayer.club ? ` \u00B7 ${selectedPlayer.club}` : ''}
                {selectedPlayer.age_group ? ` ${selectedPlayer.age_group}` : ''}
                {selectedPlayer.squad_number ? ` \u00B7 #${selectedPlayer.squad_number}` : ''}
              </p>
            </div>
          </div>
        ) : null}

        {/* player selector dropdown */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
            PLAYER
          </span>
          <div className="relative">
            <select
              value={playerId}
              onChange={e => setPlayerId(e.target.value)}
              className="w-full px-4 py-3 pr-10 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none appearance-none"
            >
              <option value="">{selectedPlayer ? 'Change player...' : 'Select player...'}</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>
                  {p.player_name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          </div>
        </div>

        {/* ---- 3. session selector ---- */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
            SESSION <span className="text-white/25">— OPTIONAL</span>
          </span>
          <div className="relative">
            <select
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              className="w-full px-4 py-3 pr-10 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none appearance-none"
            >
              <option value="">{sessions.length ? 'No session' : 'No sessions yet — leave blank'}</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title || s.session_date || s.id}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          </div>
        </div>

        {/* ---- 4. appearance selector ---- */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
            APPEARANCE
          </span>
          <div className="grid grid-cols-3 gap-2">
            <OptPill label="Started" active={appearance === 'started'} onClick={() => setAppearance('started')} />
            <OptPill label="Sub" active={appearance === 'sub'} onClick={() => setAppearance('sub')} />
            <OptPill label="Training" active={appearance === 'training'} onClick={() => setAppearance('training')} />
          </div>
        </div>

        {/* ---- 5. sliders in dark container ---- */}
        <div className="rounded-[14px] bg-[rgba(0,0,0,0.25)] p-[14px_16px] space-y-5">
          <SliderInput label="Work Rate"    value={workRate}     onChange={setWorkRate} />
          <SliderInput label="Tactical"     value={tactical}     onChange={setTactical} />
          <SliderInput label="Attitude"     value={attitude}     onChange={setAttitude} />
          <SliderInput label="Technical"    value={technical}    onChange={setTechnical} />
          <SliderInput label="Physical"     value={physical}     onChange={setPhysical} />
          <SliderInput label="Coachability" value={coachability} onChange={setCoachability} />
        </div>

        {/* ---- 6. overall band card (amber glow) ---- */}
        <div
          className="flex flex-col items-center gap-2 py-5 rounded-[14px]"
          style={{
            background: overallCfg.bg,
            border: `1px solid ${overallCfg.border}`,
            boxShadow: `0 0 24px ${overallCfg.bg}`,
          }}
        >
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/40" style={{ fontFamily: "'DM Mono', monospace" }}>
            OVERALL BAND
          </span>
          <span
            className="inline-flex items-center justify-center px-5 rounded-full text-[16px] font-semibold"
            style={{
              height: 36,
              color: overallCfg.color,
              background: overallCfg.bg,
              border: `1.5px solid ${overallCfg.border}`,
            }}
          >
            {overallCfg.word}
          </span>
          <span className="text-[13px] text-white/50 font-medium">
            {(Math.round(avg * 10) / 10).toFixed(1)}
          </span>
        </div>

        {/* ---- 7. improvement areas (AI-powered player feedback) ---- */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
                IMPROVEMENT AREAS
              </span>
              {/* This used to read "AI will expand these into personalised
                  feedback for the player". K9 made that false: the note is
                  private and the player's feedback screen can no longer read
                  it. A label promising a coach their words reach the child,
                  when they do not, is worse than no label. */}
              <p className="text-[9px] text-white/25 mt-0.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Private to you. The player never sees this.
              </p>
            </div>
            <span className="text-[10px] text-white/25">{note.length}/300</span>
          </div>
          <textarea
            value={note}
            onChange={e => {
              if (e.target.value.length <= 300) setNote(e.target.value)
            }}
            maxLength={300}
            rows={3}
            placeholder="e.g. First touch under pressure, positioning when defending set pieces"
            className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none resize-none placeholder:text-white/20"
          />
        </div>

        {/* ---- 8b. shared feedback (K9) ---- */}
        {/* Two boxes rather than one, because the schema has two tables and the
            coach needs to see which words the child will read. Nothing copies
            the note into here. */}
        <div className="px-5 pb-5 space-y-2">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
                FEEDBACK FOR THE PLAYER
              </span>
              <p className="text-[9px] text-white/25 mt-0.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                {sharedPublished && shared.trim()
                  ? 'The player can read this'
                  : 'Only the player sees this, and only once you publish it'}
              </p>
            </div>
            <span className="text-[10px] text-white/25">{shared.length}/300</span>
          </div>
          <textarea
            value={shared}
            onChange={e => {
              if (e.target.value.length <= 300) setShared(e.target.value)
            }}
            maxLength={300}
            rows={3}
            placeholder="e.g. Great week. Keep working on your first touch — try the cone drill before training."
            className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none resize-none placeholder:text-white/20"
          />
          <button
            type="button"
            onClick={() => setSharedPublished(v => !v)}
            disabled={!shared.trim()}
            className="w-full py-2.5 rounded-[10px] text-[11px] font-semibold transition-colors disabled:opacity-30"
            style={{
              background: sharedPublished ? 'rgba(200,242,90,0.12)' : 'rgba(255,255,255,0.04)',
              color:      sharedPublished ? '#C8F25A' : 'rgba(255,255,255,0.4)',
              border:     `1px solid ${sharedPublished ? 'rgba(200,242,90,0.3)' : 'rgba(255,255,255,0.07)'}`,
            }}
          >
            {sharedPublished ? 'Published — tap to unpublish' : 'Publish to the player'}
          </button>
        </div>

        {/* ---- 9. save button ---- */}
        <button
          onClick={handleSave}
          disabled={!playerId || saving}
          className="w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-40 transition-opacity"
        >
          {saving ? 'Saving...' : 'Save Assessment \u2192'}
        </button>
      </div>

      {/* ---- 10. bottom nav ---- */}
      <NavBar role="coach" activeTab="/coach/assess" onNavigate={p => navigate(p)} />
    </div>
  )
}
