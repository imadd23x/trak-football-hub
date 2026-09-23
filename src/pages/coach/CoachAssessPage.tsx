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
  const { user } = useAuth()
  // A different signed-in coach must never render the previous account's
  // roster or draft, even during the render before effects clean up.
  return <CoachAssessmentForm key={user?.id ?? 'signed-out'} />
}

function CoachAssessmentForm() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = user?.id

  /* --- data --- */
  const [players, setPlayers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [choicesLoading, setChoicesLoading] = useState(true)
  const [choicesError, setChoicesError] = useState(false)
  const rosterAccount = useRef(userId)
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
  // The text the family can read right now, or null. J5: nothing reaches the
  // family until the coach presses Publish, so an edit to published text is a
  // new draft until it is published again.
  const [publishedBody,   setPublishedBody]   = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [noteExists, setNoteExists] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const scope = JSON.stringify([userId, playerId])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [loadState, setLoadState] = useState<{ scope: string; status: 'loading' | 'ready' | 'error' }>({ scope: '', status: 'loading' })
  const formReady = loadState.scope === scope && loadState.status === 'ready'
    && !choicesLoading && !choicesError && players.some(player => player.id === playerId)
  const saveRequest = useRef<AbortController | null>(null)
  useEffect(() => () => { saveRequest.current?.abort() }, [scope])

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
    let cancelled = false
    const controller = new AbortController()
    // The entire draft belongs to one account/player selection. Clear it
    // before loading, and never make a failed read look like a new assessment.
    setExistingId(null)
    setWorkRate(5); setTactical(5); setAttitude(5)
    setTechnical(5); setPhysical(5); setCoachability(5)
    setAppearance('started'); setSessionId('')
    setNote(''); setNoteExists(false)
    setShared(''); setSharedPublished(false); setSharedExists(false); setPublishedBody(null)
    setSaving(false)
    setLoadState({ scope, status: 'loading' })
    if (userId && playerId) {
      void (async () => {
        try {
          const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
          const { data, error } = await supabase.from('coach_assessments')
            .select('id, work_rate, tactical, attitude, technical, physical, coachability, appearance, session_id')
            .eq('coach_user_id', userId).eq('squad_player_id', playerId)
            .gte('created_at', startOfDay.toISOString())
            .order('created_at', { ascending: false }).limit(1).abortSignal(controller.signal).maybeSingle()
          if (cancelled) return
          if (error) throw error
          if (data) {
            // Load both independent text fields before enabling editing. A
            // stale or failed shared-text read must never restore another
            // child's text, hide a publication, or overwrite a coach's edit.
            const [privateResult, sharedResult] = await Promise.all([
              supabase.from('coach_assessment_notes').select('note')
                .eq('assessment_id', data.id).abortSignal(controller.signal).maybeSingle(),
              supabase.from('coach_shared_feedback' as any).select('body, published_at')
                .eq('assessment_id', data.id).abortSignal(controller.signal).maybeSingle(),
            ])
            if (cancelled) return
            if (privateResult.error) throw privateResult.error
            if (sharedResult.error) throw sharedResult.error
            const sf = sharedResult.data as { body: string; published_at: string | null } | null
            setExistingId(data.id)
            setWorkRate(data.work_rate); setTactical(data.tactical)
            setAttitude(data.attitude); setTechnical(data.technical)
            setPhysical(data.physical); setCoachability(data.coachability)
            setAppearance((data.appearance as 'started' | 'sub' | 'training') ?? 'started')
            setSessionId(data.session_id ?? '')
            setNote(privateResult.data?.note ?? '')
            setNoteExists(privateResult.data != null)
            setShared(sf?.body ?? '')
            setSharedPublished(sf?.published_at != null)
            setSharedExists(sf != null)
            setPublishedBody(sf?.published_at != null ? sf.body : null)
          }
          setLoadState({ scope, status: 'ready' })
        } catch (error) {
          if (cancelled) return
          console.error('Assessment load failed:', error)
          setLoadState({ scope, status: 'error' })
        }
      })()
    }
    return () => { cancelled = true; controller.abort() }
  }, [userId, playerId, scope, loadAttempt])

  /* Account-bound choices: a late response from another coach cannot repopulate them. */
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPlayers([]); setSessions([])
    setChoicesError(false); setChoicesLoading(true)
    if (rosterAccount.current !== userId) {
      rosterAccount.current = userId
      setPlayerId('')
    }
    if (userId) {
      void (async () => {
        try {
          const [roster, events] = await Promise.all([
            supabase.from('squad_players').select('*').eq('coach_user_id', userId)
              .order('player_name').abortSignal(controller.signal),
            supabase.from('coach_sessions').select('*').eq('coach_user_id', userId)
              .order('session_date', { ascending: false }).limit(20).abortSignal(controller.signal),
          ])
          if (cancelled) return
          if (roster.error) throw roster.error
          if (events.error) throw events.error
          setPlayers(roster.data ?? []); setSessions(events.data ?? [])
        } catch (error) {
          if (cancelled) return
          console.error('Assessment choices failed:', error)
          setChoicesError(true)
        } finally {
          if (!cancelled) setChoicesLoading(false)
        }
      })()
    } else setChoicesLoading(false)
    return () => { cancelled = true; controller.abort() }
  }, [userId, loadAttempt])

  /* --- computed --- */
  const avg = (workRate + tactical + attitude + technical + physical + coachability) / 6
  const band = scoreToBand(avg)
  const overallCfg = bandConfig(band)

  const selectedPlayer = useMemo(
    () => players.find(p => p.id === playerId),
    [players, playerId],
  )
  const firstName: string = selectedPlayer?.player_name?.trim().split(/\s+/)[0] || 'the player'
  const message = shared.trim()
  // True only while the box holds exactly what the family can already read.
  const liveUnchanged = sharedPublished && publishedBody !== null && message === publishedBody.trim()

  /* Parental consent. Since #80 every player under 18 needs a parent's
     approval before a coach can assess them, and the database refuses the
     insert until then. Ask the SAME predicate the RLS policy evaluates, when a
     player is chosen, so the coach learns why before setting six sliders, not
     from a raw row-level-security error after. The database stays the gate:
     if this check fails we do not block on a guess. */
  const [consentWait, setConsentWait] = useState(false)
  useEffect(() => {
    setConsentWait(false)
    if (!playerId) return
    let cancelled = false
    void supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: playerId } as never)
      .then(({ data, error }) => { if (!cancelled && !error) setConsentWait(data === true) })
    return () => { cancelled = true }
  }, [playerId])

  /* --- save ---
     J5: "Nothing reaches the family until the coach presses publish."
       save      — sliders, note and message as a draft. A published message
                   stays published only if its text is unchanged; edited text
                   is withdrawn until it is published again.
       publish   — the same, and the message goes to the player and parents.
       unpublish — the family stops seeing the message at once. */
  const handleSave = async (action: 'save' | 'publish' | 'unpublish' = 'save') => {
    if (!user || !playerId || saving || !formReady || consentWait || saveRequest.current) return
    if (action === 'publish' && !message) return
    const sharedPublishedNext =
      action === 'publish' ? true : action === 'unpublish' ? false : liveUnchanged
    // Rewriting an unchanged, still-published message would re-stamp it and
    // mark it "new" for the family again. Leave it alone.
    const writeShared = (message.length > 0 || sharedExists) && !(action === 'save' && liveUnchanged)
    const controller = new AbortController()
    saveRequest.current = controller
    const isCurrent = () => !controller.signal.aborted && currentScope.current === scope
    setSaving(true)
    try {
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
            .update(payload).eq('id', existingId)
            .eq('coach_user_id', user.id).eq('squad_player_id', playerId)
            .select('id').abortSignal(controller.signal).maybeSingle()
        : await supabase.from('coach_assessments')
            .insert(payload).select('id').abortSignal(controller.signal).maybeSingle()

      if (!isCurrent()) return
      if (saveError) {
        console.error('Save failed:', saveError)
        // 42501 is an RLS refusal. The likeliest cause is consent withdrawn or
        // never given; re-ask the policy's own predicate rather than guess.
        if (saveError.code === '42501') {
          const { data: waiting, error: waitingError } = await supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: playerId } as never)
          if (!isCurrent()) return
          // If the re-check itself fails we cannot say why; do not claim a reason.
          if (waitingError) {
            toast.error('Not saved, and the reason could not be confirmed. Check your connection and try again.')
          } else if (waiting === true) {
            setConsentWait(true)
            toast.error(`Not saved. ${selectedPlayer?.player_name ?? 'This player'} needs a parent's approval before they can be assessed.`)
          } else {
            toast.error('Not saved. You no longer have access to this player\'s record. They may have left your squad.')
          }
        } else {
          toast.error(`Could not save assessment: ${saveError.message}`)
        }
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

      setExistingId(saved.id)
      if (saved?.id && (note.trim() || noteExists)) {
        // upsert, so re-saving replaces the note rather than stacking another
        const { error: noteError } = await supabase.from('coach_assessment_notes').upsert({
          assessment_id: saved.id,
          coach_user_id: user.id,
          note: note.trim(),
        }, { onConflict: 'assessment_id' }).abortSignal(controller.signal)
        if (!isCurrent()) return
        if (noteError) {
          console.error('Note save failed:', noteError)
          const alsoMessage = writeShared ? ` and the message to ${firstName}` : ''
          toast.error(
            `The scores are saved. Not saved: your private note${alsoMessage} (${noteError.message}). ` +
              `Your text is still here — try again.`,
            { duration: 12000 },
          )
          return
        }
        setNoteExists(true)
      }

      // Shared feedback, written separately and published deliberately (K9).
      // Never derived from `note`. Saved whenever there is text OR a row already
      // exists, so clearing the box and unpublishing both take effect.
      if (saved?.id && writeShared) {
        // Cast for the same reason as the read above.
        const { error: sharedError } = await supabase.from('coach_shared_feedback' as any).upsert({
          assessment_id: saved.id,
          coach_user_id: user.id,
          body:          message,
          // NULL retracts: the child and their parents stop seeing it immediately.
          published_at:  sharedPublishedNext && message ? new Date().toISOString() : null,
        }, { onConflict: 'assessment_id' }).abortSignal(controller.signal)
        if (!isCurrent()) return
        if (sharedError) {
          // Stay put. Navigating away here loses the text the coach wrote for the
          // child and gives them no way to retry it — the same mistake K5 fixed
          // in the match flow, which I then repeated in my own new code an hour
          // later. The assessment itself is saved, so keep its id: pressing save
          // again updates that row rather than creating a second one.
          console.error('Shared feedback save failed:', sharedError)
          toast.error(
            `The scores${note.trim() ? ' and private note' : ''} are saved. Not saved: the message to ` +
              `${firstName} (${sharedError.message}), so ${action === 'unpublish' ? 'the family can still see the old one' : 'nothing new reached the family'}. ` +
              `Your text is still here — try again.`,
            { duration: 12000 },
          )
          setExistingId(saved.id)
          setSaving(false)
          return
        }
        setSharedExists(true)
        setSharedPublished(sharedPublishedNext && message.length > 0)
        setPublishedBody(sharedPublishedNext && message ? message : null)
      }
      if (action === 'publish') {
        toast.success(`Published. ${firstName} and their parents can read your message now.`)
      } else if (action === 'unpublish') {
        toast.success(`Unpublished. ${firstName} and their parents can no longer see the message.`)
      } else if (message && !sharedPublishedNext) {
        toast.success(`Assessment saved. Your message to ${firstName} has not been sent.`)
      } else {
        toast.success('Assessment saved.')
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
    } catch (error) {
      if (isCurrent()) {
        console.error('Assessment save interrupted:', error)
        toast.error('Could not finish saving. Your text is still here — please try again.')
      }
    } finally {
      if (saveRequest.current === controller) saveRequest.current = null
      if (isCurrent()) setSaving(false)
    }
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

        {selectedPlayer && consentWait ? (
          <div role="status" className="p-3 rounded-[12px] border border-[rgba(255,196,0,0.25)] bg-[rgba(255,196,0,0.06)]">
            <p className="text-[13px] font-medium text-white/85">Waiting for a parent</p>
            <p className="text-[12px] text-white/55 leading-relaxed mt-0.5">
              You can assess {selectedPlayer.player_name} once a parent has approved their account.
              The form stays locked until then, and nothing about them is recorded.
            </p>
          </div>
        ) : null}

        {/* player selector dropdown */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
            PLAYER
          </span>
          <div className="relative">
            <select
              aria-label="Player"
              disabled={saving || choicesLoading}
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

        {((playerId && !formReady) || choicesError) && (
          (choicesError || (loadState.scope === scope && loadState.status === 'error')) ? (
            <div role="alert" className="text-sm text-amber-300">
              Could not load this assessment. Retry before editing or saving.
              <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="ml-2 underline">Retry</button>
            </div>
          ) : <p role="status" className="text-sm text-white/50">Loading assessment…</p>
        )}
        {/* J5: a player waiting for a parent cannot be opened. If consent is
            withdrawn mid-edit, the refused save sets consentWait: the form
            locks, and everything the coach entered stays in state. */}
        <fieldset disabled={!formReady || saving || consentWait} className="contents">
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

        {/* ---- 7. message to the player (K9, J5) ----
            Two boxes rather than one, because the schema has two tables and the
            coach needs to see which words the family will read. Nothing copies
            the private note into here. Parents read published messages too
            (20260919150000), so the label says so. */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-message" className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
                Message to {firstName}
              </label>
              <p className="text-[10px] text-white/45 mt-0.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                They and their parents will see this.
              </p>
            </div>
            <span className="text-[10px] text-white/25">{shared.length}/300</span>
          </div>
          <textarea
            id="assess-message"
            value={shared}
            onChange={e => {
              if (e.target.value.length <= 300) setShared(e.target.value)
            }}
            maxLength={300}
            rows={3}
            placeholder="e.g. Great week. Keep working on your first touch — try the cone drill before training."
            className="w-full px-4 py-3 rounded-[10px] bg-[#0d0d0f] border border-white/[0.07] text-sm text-white/88 outline-none resize-none placeholder:text-white/20"
          />
          <p role="status" className="text-[10px] text-white/40" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            {liveUnchanged
              ? 'Published. They can read it now.'
              : sharedPublished
                ? 'Edited since you published it. Publish again to send the new version.'
                : message
                  ? 'Not sent. Nothing reaches them until you press Publish.'
                  : 'Optional. Nothing reaches them until you press Publish.'}
          </p>
        </div>

        {/* ---- 8. private note ----
            The label used to read "AI will expand these into personalised
            feedback for the player". K9 made that false: the note is private
            and no family role can read it. */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-note" className="text-[9px] font-medium tracking-[0.12em] uppercase text-white/45" style={{ fontFamily: "'DM Mono', monospace" }}>
                Private note <span className="text-white/25">— optional</span>
              </label>
              <p className="text-[10px] text-white/45 mt-0.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Only you can see this.
              </p>
            </div>
            <span className="text-[10px] text-white/25">{note.length}/300</span>
          </div>
          <textarea
            id="assess-note"
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

        {/* ---- 9. actions ---- */}
        <div className="space-y-2">
          {message && !liveUnchanged ? (
            <button
              type="button"
              onClick={() => handleSave('publish')}
              disabled={!playerId || saving || !formReady || consentWait}
              className="w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-40 transition-opacity"
            >
              {saving ? 'Saving...' : `Publish to ${firstName}`}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => handleSave('save')}
            disabled={!playerId || saving || !formReady || consentWait}
            className={message && !liveUnchanged
              ? 'w-full py-3 rounded-[10px] bg-white/[0.04] border border-white/[0.09] text-white/70 font-semibold text-sm disabled:opacity-40 transition-opacity'
              : 'w-full py-4 rounded-[10px] bg-[#C8F25A] text-black font-bold text-sm disabled:opacity-40 transition-opacity'}
          >
            {saving ? 'Saving...' : message && !liveUnchanged ? 'Save Assessment (message not sent)' : 'Save Assessment \u2192'}
          </button>
          {sharedPublished ? (
            <button
              type="button"
              onClick={() => handleSave('unpublish')}
              disabled={!playerId || saving || !formReady || consentWait}
              className="w-full py-2.5 rounded-[10px] text-[11px] font-semibold text-white/50 border border-white/[0.07] disabled:opacity-30"
            >
              Unpublish message
            </button>
          ) : null}
        </div>
        </fieldset>
      </div>

      {/* ---- 10. bottom nav ---- */}
      <NavBar role="coach" activeTab="/coach/assess" onNavigate={p => navigate(p)} />
    </div>
  )
}
