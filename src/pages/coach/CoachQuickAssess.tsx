import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { MobileShell } from '@/components/trak'
import { SliderInput } from '@/components/trak/SliderInput'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { BandType } from '@/lib/types'
import { deriveCardStats } from '@/lib/cardStats'
import { needsCoachInput } from '@/lib/assessment-entry'
import { trackEvent, startTimer } from '@/lib/telemetry'
import { ChevronLeft, Check, MessageSquare } from 'lucide-react'

type Scores = {
  work_rate: number; tactical: number; attitude: number
  technical: number; physical: number; coachability: number
}

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

/* ========== main page ========== */

export default function CoachQuickAssess() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  /* --- squad data --- */
  const [players, setPlayers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  /* --- current index + tracking --- */
  const [currentIdx, setCurrentIdx] = useState(0)
  const [assessedIds, setAssessedIds] = useState<Set<string>>(new Set())
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())

  /* --- slider state --- */
  const [workRate, setWorkRate]         = useState(5)
  const [tactical, setTactical]         = useState(5)
  const [attitude, setAttitude]         = useState(5)
  const [technical, setTechnical]       = useState(5)
  const [physical, setPhysical]         = useState(5)
  const [coachability, setCoachability] = useState(5)
  const [touched, setTouched]           = useState(false)

  /* --- note --- */
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)

  /* --- saving --- */
  const [saving, setSaving] = useState(false)

  /* --- completion --- */
  const isComplete = currentIdx >= players.length && players.length > 0

  /* fetch squad players sorted by oldest assessment first, unassessed at top */
  useEffect(() => {
    if (!user) return
    ;(async () => {
      setLoading(true)
      // Get all squad players
      const { data: squadPlayers } = await supabase
        .from('squad_players')
        .select('*')
        .eq('coach_user_id', user.id)
        .order('player_name')

      if (!squadPlayers || squadPlayers.length === 0) {
        setPlayers([])
        setLoading(false)
        return
      }

      // Latest assessment per player. The scores are fetched too, not just the
      // date: a player rarely swings week to week, so starting each slider at
      // their previous value means the coach only moves what actually changed
      // instead of dragging six sliders from the midpoint every time.
      const { data: latestAssessments } = await supabase
        .from('coach_assessments')
        .select('squad_player_id, created_at, work_rate, tactical, attitude, technical, physical, coachability')
        .eq('coach_user_id', user.id)
        .order('created_at', { ascending: false })

      // Build a map: squad_player_id -> latest assessment date
      const lastAssessedMap = new Map<string, string>()
      const lastScoresMap = new Map<string, Scores>()
      latestAssessments?.forEach(a => {
        if (!lastAssessedMap.has(a.squad_player_id) && a.created_at) {
          lastAssessedMap.set(a.squad_player_id, a.created_at)
        }
        if (!lastScoresMap.has(a.squad_player_id)) {
          lastScoresMap.set(a.squad_player_id, {
            work_rate: a.work_rate, tactical: a.tactical, attitude: a.attitude,
            technical: a.technical, physical: a.physical, coachability: a.coachability,
          })
        }
      })

      // Sort: unassessed first, then by oldest assessment
      const sorted = [...squadPlayers].sort((a, b) => {
        const dateA = lastAssessedMap.get(a.id)
        const dateB = lastAssessedMap.get(b.id)
        if (!dateA && !dateB) return a.player_name.localeCompare(b.player_name)
        if (!dateA) return -1
        if (!dateB) return 1
        return new Date(dateA).getTime() - new Date(dateB).getTime()
      })

      // Carry each player's previous scores onto the row so the sliders can
      // start there rather than at the midpoint.
      setPlayers(sorted.map(p => ({ ...p, _lastScores: lastScoresMap.get(p.id) ?? null })))
      setLoading(false)
    })()
  }, [user])

  /* --- computed --- */
  const avg = (workRate + tactical + attitude + technical + physical + coachability) / 6
  const band = scoreToBand(avg)
  const overallCfg = bandConfig(band)
  const currentPlayer = players[currentIdx] ?? null

  /* Parental consent: same check and reasoning as CoachAssessPage. Since #80
     every player under 18 needs a parent's approval before they can be
     assessed. Ask the RLS policy's own predicate for the player on screen, so
     the coach sees why and can Skip, instead of a "try again" that always fails. */
  const [consentWait, setConsentWait] = useState(false)
  const currentPlayerId = currentPlayer?.id as string | undefined
  useEffect(() => {
    setConsentWait(false)
    if (!currentPlayerId) return
    let cancelled = false
    void supabase.rpc('squad_player_consent_required' as never, { p_squad_player_id: currentPlayerId } as never)
      .then(({ data, error }) => { if (!cancelled && !error) setConsentWait(data === true) })
    return () => { cancelled = true }
  }, [currentPlayerId])
  const total = players.length
  const displayIdx = Math.min(currentIdx + 1, total)

  /* --- has the coach actually entered anything for this player? ---
     A RETURNING player's sliders carry their previous scores, so leaving them
     alone is a real judgement: "nothing changed". That is the design and it is
     why the loop is fast.

     A FIRST assessment has nothing to carry, so the six 5s on screen are the
     control's default. Saving them writes "average on every metric" into a
     child's record as a deliberate coach judgement that nobody made — and the
     columns are NOT NULL DEFAULT 5, so nothing downstream can tell the
     difference afterwards. Skip already exists for a player the coach does not
     want to rate; this only stops the silent version. */
  const needsInput = needsCoachInput({
    hasPreviousScores: !!currentPlayer?._lastScores,
    touched,
  })
  const onSlide = (set: (n: number) => void) => (v: number) => { set(v); setTouched(true) }

  /* --- seed sliders for whichever player is now on screen ---
     Starts from their previous assessment when there is one, so the coach
     adjusts what changed instead of re-entering six values from scratch.
     A player with no history still starts at the neutral midpoint. */
  useEffect(() => {
    const prev = currentPlayer?._lastScores
    setWorkRate(prev?.work_rate ?? 5)
    setTactical(prev?.tactical ?? 5)
    setAttitude(prev?.attitude ?? 5)
    setTechnical(prev?.technical ?? 5)
    setPhysical(prev?.physical ?? 5)
    setCoachability(prev?.coachability ?? 5)
    setNote('')
    setNoteOpen(false)
    setTouched(false)
  }, [currentIdx, currentPlayer])

  /* --- advance to next player --- */
  const advance = () => {
    setCurrentIdx(prev => prev + 1)
  }

  /* --- save assessment --- */
  const handleNext = async () => {
    // Guarded here as well as on the button: the disabled attribute is a UI
    // affordance, and this is the line that actually decides what reaches a
    // child's record.
    if (!user || !currentPlayer || saving || needsInput || consentWait) return
    setSaving(true)

    const cardStats = deriveCardStats({ workRate, tactical, attitude, technical, physical, coachability })
    const { data: inserted, error: insertError } = await supabase.from('coach_assessments').insert([{
      coach_user_id: user.id,
      coach_name_snapshot: profile?.full_name || null,
      squad_player_id: currentPlayer.id,
      session_id: null,
      appearance: 'training',
      // raw coach inputs
      work_rate: workRate,
      tactical,
      attitude,
      technical,
      physical,
      coachability,
      // derived card stats
      ...cardStats,
    } as any]).select('id').maybeSingle()
    if (insertError) {
      console.error('Save failed:', insertError)
      // 42501 is an RLS refusal; re-ask the policy's predicate, never "try again".
      if (insertError.code === '42501') {
        const { data: waiting, error: waitingError } = await supabase.rpc('squad_player_consent_required' as never, { p_squad_player_id: currentPlayer.id } as never)
        // If the re-check itself fails we cannot say why; do not claim a reason.
        if (waitingError) {
          toast.error('Not saved, and the reason could not be confirmed. Check your connection and try again.')
        } else if (waiting === true) {
          setConsentWait(true)
          toast.error(`Not saved. ${currentPlayer.player_name} needs a parent's approval before they can be assessed. Skip for now.`)
        } else {
          toast.error('Not saved. You no longer have access to this player\'s record.')
        }
      } else {
        toast.error('Could not save assessment. Please try again.')
      }
      setSaving(false)
      return
    }
    if (inserted?.id && note.trim()) {
      const { error: noteError } = await supabase.from('coach_assessment_notes').insert({
        assessment_id: inserted.id,
        coach_user_id: user.id,
        note: note.trim(),
      })
      if (noteError) {
        console.error('Save failed:', noteError)
        toast.error('Assessment saved but note could not be saved.')
      }
    }

    setAssessedIds(prev => new Set(prev).add(currentPlayer.id))
    setSaving(false)
    advance()
  }

  /* --- skip --- */
  const handleSkip = () => {
    if (!currentPlayer) return
    setSkippedIds(prev => new Set(prev).add(currentPlayer.id))
    advance()
  }

  /* --- fire telemetry on completion ---
     Scorecard metric 4. The run is timed from the first player appearing;
     `players` lets the view normalise a squad run to a per-player median. */
  const runTimer = useRef<(() => number) | null>(null)
  useEffect(() => {
    if (players.length > 0 && !runTimer.current) runTimer.current = startTimer()
  }, [players.length])

  /* Reporting only on isComplete meant a coach had to walk the ENTIRE squad
     before any timing was recorded. Someone who assessed five players and put
     the phone down produced nothing at all — and abandoning halfway is exactly
     the behaviour metric 4 exists to detect. Report on the way out too. */
  const assessedRef = useRef(0)
  const skippedRef = useRef(0)
  const squadRef = useRef(0)
  const reportedRef = useRef(false)

  useEffect(() => { assessedRef.current = assessedIds.size }, [assessedIds])
  useEffect(() => { skippedRef.current = skippedIds.size }, [skippedIds])
  useEffect(() => { squadRef.current = players.length }, [players.length])

  const reportRun = (completed: boolean) => {
    if (reportedRef.current || assessedRef.current === 0) return
    reportedRef.current = true
    trackEvent('quick_assess_completed', {
      mode: 'quick',
      completed,
      assessed: assessedRef.current,
      skipped: skippedRef.current,
      players: assessedRef.current,
      squad_size: squadRef.current,
      duration_ms: runTimer.current?.() ?? null,
    })
  }

  useEffect(() => {
    if (isComplete && players.length > 0) reportRun(true)
  }, [isComplete])

  useEffect(() => () => reportRun(false), [])

  /* --- progress bar width --- */
  const progressPct = total > 0 ? (currentIdx / total) * 100 : 0

  /* ---- render ---- */
  if (loading) {
    return (
      <MobileShell>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="w-6 h-6 border-2 border-[#C8F25A] border-t-transparent rounded-full animate-spin" />
        </div>
      </MobileShell>
    )
  }

  if (players.length === 0) {
    return (
      <MobileShell>
        <div className="pt-6 space-y-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]"
            >
              <ChevronLeft size={16} className="text-white/70" />
            </button>
            <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90 -ml-[34px]">
              Quick Assess
            </h1>
          </div>
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-[15px] text-white/60">No players in your squad yet.</p>
            <button
              onClick={() => navigate('/coach/squad/add')}
              className="px-5 py-2.5 rounded-[10px] bg-[#C8F25A] text-black text-sm font-bold"
            >
              Add Players
            </button>
          </div>
        </div>
      </MobileShell>
    )
  }

  /* ---- completion screen ---- */
  if (isComplete) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center min-h-[80vh] gap-5 px-4">
          {/* Checkmark */}
          <div
            className="flex items-center justify-center w-[72px] h-[72px] rounded-full"
            style={{
              background: 'rgba(200,242,90,0.12)',
              border: '2px solid rgba(200,242,90,0.3)',
            }}
          >
            <Check size={36} style={{ color: '#C8F25A' }} />
          </div>

          <h2
            className="text-[24px] font-semibold"
            style={{ color: 'rgba(255,255,255,0.9)', fontFamily: "'DM Sans', sans-serif" }}
          >
            All done!
          </h2>

          <p
            className="text-[14px] text-center"
            style={{ color: 'rgba(255,255,255,0.45)', fontFamily: "'DM Sans', sans-serif" }}
          >
            {assessedIds.size} assessed, {skippedIds.size} skipped
          </p>

          <button
            onClick={() => navigate('/coach/home')}
            className="w-full max-w-[280px] py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm mt-4"
          >
            Back to Dashboard
          </button>
        </div>
      </MobileShell>
    )
  }

  /* ---- main assessment flow ---- */
  return (
    <MobileShell>
      <div className="pb-10 space-y-4">
        {/* ---- 1. Top bar ---- */}
        <div className="flex items-center gap-3 pt-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#17171a] border border-white/[0.11]"
          >
            <ChevronLeft size={16} className="text-white/70" />
          </button>
          <h1 className="flex-1 text-center text-[17px] font-semibold text-white/90">
            Quick Assess
          </h1>
          <span
            className="text-[13px] font-medium w-[34px] text-right"
            style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}
          >
            {displayIdx}/{total}
          </span>
        </div>

        {/* ---- 2. Progress bar ---- */}
        <div className="h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%`, background: '#C8F25A' }}
          />
        </div>

        {/* ---- 3. Player card ---- */}
        {currentPlayer && (
          <div
            className="flex items-center gap-3.5 p-4 rounded-[14px] border border-white/[0.06]"
            style={{ background: '#101012' }}
          >
            {/* Initials avatar */}
            <div
              className="flex items-center justify-center w-[48px] h-[48px] rounded-[14px] text-[15px] font-bold shrink-0"
              style={{ background: '#202024', color: '#C8F25A' }}
            >
              {initials(currentPlayer.player_name)}
            </div>
            <div className="min-w-0">
              <p
                className="text-[18px] font-medium truncate"
                style={{ color: 'rgba(255,255,255,0.9)', fontFamily: "'DM Sans', sans-serif" }}
              >
                {currentPlayer.player_name}
              </p>
              <p
                className="text-[11px] mt-0.5 truncate"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}
              >
                {currentPlayer.position?.toUpperCase() ?? 'Player'}
                {currentPlayer.squad_number ? ` \u00B7 #${currentPlayer.squad_number}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* ---- 4. Sliders ---- */}
        <div className="rounded-[14px] bg-[rgba(0,0,0,0.25)] p-[14px_16px] space-y-5">
          <SliderInput label="Work Rate"    value={workRate}     onChange={onSlide(setWorkRate)} />
          <SliderInput label="Tactical"     value={tactical}     onChange={onSlide(setTactical)} />
          <SliderInput label="Attitude"     value={attitude}     onChange={onSlide(setAttitude)} />
          <SliderInput label="Technical"    value={technical}    onChange={onSlide(setTechnical)} />
          <SliderInput label="Physical"     value={physical}     onChange={onSlide(setPhysical)} />
          <SliderInput label="Coachability" value={coachability} onChange={onSlide(setCoachability)} />
        </div>

        {/* ---- 5. Overall band preview ---- */}
        <div
          className="flex items-center justify-between px-4 py-3.5 rounded-[12px]"
          style={needsInput ? {
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          } : {
            background: overallCfg.bg,
            border: `1px solid ${overallCfg.border}`,
            boxShadow: `0 0 20px ${overallCfg.bg}`,
          }}
        >
          <span
            className="text-[9px] font-medium tracking-[0.12em] uppercase"
            style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.4)' }}
          >
            OVERALL
          </span>
          <div className="flex items-center gap-2.5">
            {/* Showing a band before any input states a conclusion about the
                child that nothing supports yet — the same invention as saving
                it. Held back until the coach has entered something. */}
            {needsInput ? (
              <span className="text-[13px] text-white/30 font-medium">
                Not yet rated
              </span>
            ) : (
              <>
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: overallCfg.color }}
                >
                  {overallCfg.word}
                </span>
                <span className="text-[13px] text-white/40 font-medium">
                  {(Math.round(avg * 10) / 10).toFixed(1)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* ---- 6. Optional note ---- */}
        {!noteOpen ? (
          <button
            onClick={() => setNoteOpen(true)}
            className="flex items-center gap-2 px-3 py-2.5 rounded-[10px] border border-white/[0.06] text-white/35 text-[12px] font-medium w-full"
            style={{ background: 'transparent' }}
          >
            <MessageSquare size={14} className="text-white/25" />
            Add note
          </button>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span
                className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                NOTE
              </span>
              <span className="text-[10px] text-white/25">{note.length}/200</span>
            </div>
            <textarea
              value={note}
              onChange={e => {
                if (e.target.value.length <= 200) setNote(e.target.value)
              }}
              maxLength={200}
              rows={2}
              autoFocus
              placeholder="Quick note about this player..."
              className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none resize-none placeholder:text-white/20"
            />
          </div>
        )}

        {/* ---- 7. Action buttons ---- */}
        {consentWait && currentPlayer ? (
          <div role="status" className="p-3 rounded-[12px] border border-[rgba(255,196,0,0.25)] bg-[rgba(255,196,0,0.06)]">
            <p className="text-[13px] font-medium text-white/85">Waiting for a parent</p>
            <p className="text-[12px] text-white/55 leading-relaxed mt-0.5">
              You can assess {currentPlayer.player_name} once a parent has approved their account.
              Skip for now. If no parent is linked yet, the player can send the invite from their profile.
            </p>
          </div>
        ) : needsInput && (
          <p className="text-[11px] text-white/35 leading-relaxed px-0.5">
            First assessment for this player — move a slider to rate them, or
            Skip. Nothing is recorded until you do.
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleSkip}
            className="flex-1 py-3.5 rounded-[10px] text-sm font-semibold transition-opacity active:scale-[0.97]"
            style={{
              background: 'transparent',
              border: '1.5px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            disabled={saving || needsInput || consentWait}
            className="flex-[2] py-3.5 rounded-[10px] text-sm font-bold transition-opacity active:scale-[0.97] disabled:opacity-40"
            style={{ background: '#C8F25A', color: '#000' }}
          >
            {saving ? 'Saving...' : 'Next \u2192'}
          </button>
        </div>
      </div>
    </MobileShell>
  )
}
