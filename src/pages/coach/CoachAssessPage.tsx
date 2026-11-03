import { useEffect, useState, useMemo, useRef } from 'react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { fetchWaitReason, WAIT_TITLE, waitText, type WaitReason } from '@/lib/wait-reason'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { MobileShell, BandPill, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { SliderInput } from '@/components/trak/SliderInput'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { BandType } from '@/lib/types'
import { deriveCardStats } from '@/lib/cardStats'
import { localTodayISO } from '@/lib/event-time'
import { trackEvent, startTimer } from '@/lib/telemetry'
import { ChevronLeft, ChevronDown } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Stepper } from '@/components/arc/stepper/stepper'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { Button } from '@/components/arc/button/button'
import { useCoachSquad } from '@/lib/coach-squad'
import { Select } from '@/components/arc/select/select'
import { APPEARANCE_LABEL } from '@/lib/types'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-219 (20 Oct live run, S7): a match is offered only to a player its log
   marks present, i.e. played (TRAK-100), so "Didn't play" would contradict the
   log. A player who didn't play isn't assessed (Imad, 19 Oct, option A); the
   match log carries that (TRAK-185). */
const MATCH_APPEARANCES = ['started', 'sub'] as const
type MatchAppearance = typeof MATCH_APPEARANCES[number]

/** TRAK-182 (Imad, 15 Oct): the assessment one step per screen. The message
    and the private note get their own steps, so player-visible words never sit
    beside private ones. */
const STEPS = [
  { id: 'who', label: 'Player' },
  { id: 'ratings', label: 'Ratings' },
  // Imad, 16 Oct: one step for both, still two boxes: the message (white)
  // reaches the player, the note (yellow) only the coach, and stands out.
  { id: 'message', label: 'Message & note' },
  { id: 'review', label: 'Review' },
]

/* ---------- helpers ---------- */

function bandConfig(band: BandType) {
  return BANDS.find(b => b.word.toLowerCase() === band) ?? BANDS[BANDS.length - 1]
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
  // TRAK-176/305: the picker offers the squad picked at the top, or All (a player already chosen stays).
  const { inSquad } = useCoachSquad(userId)

  /* --- data --- */
  const [players, setPlayers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [choicesLoading, setChoicesLoading] = useState(true)
  const [choicesError, setChoicesError] = useState(false)
  const rosterAccount = useRef(userId)
  const [playerId, setPlayerId] = useState((location.state as any)?.preselectedPlayerId || '')
  const [sessionId, setSessionId] = useState('')
  /* TRAK-69: /coach/assess?assessment=<id> opens that exact saved row. It is
     resolved to its player and session, and loaded by id while that pair stays
     selected, so a row from before sessions were required, or one whose session
     is older than the picker's list, still opens and saves in place. */
  const openId = new URLSearchParams(location.search).get('assessment')
  const [opened, setOpened] = useState<{ id: string; playerId: string; sessionId: string; createdAt: string; session: any | null } | null>(null)
  const [openState, setOpenState] = useState<'idle' | 'loading' | 'missing' | 'error'>(openId ? 'loading' : 'idle')
  // Imad, 19 Oct (J4, no invented defaults): nothing pre-picked; a match waits for the coach's choice.
  const [appearance, setAppearance] = useState<MatchAppearance | null>(null)
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
  // TRAK-200: a draft assessment (published_at NULL) is the coach's alone, bands included.
  const [assessmentPublished, setAssessmentPublished] = useState(false)
  const [sharedExists,    setSharedExists]    = useState(false)
  // The text the family can read right now, or null. J5: nothing reaches the
  // family until the coach presses Publish, so an edit to published text is a
  // new draft until it is published again.
  const [publishedBody,   setPublishedBody]   = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [noteExists, setNoteExists] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const byId = opened !== null && opened.playerId === playerId && opened.sessionId === sessionId
  /* TRAK-100: only sessions this player was marked present at. In the TRAK-24
     rerun the coach picked a same-name session from earlier that day with no
     attendance, and the child's history showed the assessment against it.
     Keyed by player, so a late read for the previous player is never used. */
  const [attendance, setAttendance] = useState<{ playerId: string; sessionIds: Set<string> } | null>(null)
  const [attendanceError, setAttendanceError] = useState(false)
  const attendanceReady = attendance !== null && attendance.playerId === playerId
  const sessionOptions = useMemo(() => {
    const attended = attendanceReady ? sessions.filter(s => attendance.sessionIds.has(s.id)) : []
    // An opened saved assessment keeps its own session, attended or not, so it still opens and saves in place.
    return opened?.session && opened.playerId === playerId && !attended.some(s => s.id === opened.session.id)
      ? [...attended, opened.session] : attended
  }, [sessions, opened, playerId, attendance, attendanceReady])
  const scope = JSON.stringify([userId, playerId, sessionId, byId ? opened?.id : null])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [loadState, setLoadState] = useState<{ scope: string; status: 'loading' | 'ready' | 'error' }>({ scope: '', status: 'loading' })
  const formReady = loadState.scope === scope && loadState.status === 'ready'
    && !choicesLoading && !choicesError && players.some(player => player.id === playerId)
    && (sessionOptions.some(session => session.id === sessionId) || (byId && sessionId === ''))
  const saveRequest = useRef<AbortController | null>(null)
  useEffect(() => () => { saveRequest.current?.abort() }, [scope])

  /* Scorecard metric 4: median time to assess one player, target <90s.
     The clock starts when a player is chosen, not on mount, so a page left
     open on the drive home does not pollute the median. */
  const timerRef = useRef<(() => number) | null>(null)
  useEffect(() => {
    timerRef.current = playerId ? startTimer() : null
  }, [playerId])

  /* The existing assessment for this player in this session, if any (TRAK-68).
     One assessment per player per session: coming back to add a note edits it,
     and a second session the same day gets its own assessment. Keying on the
     day instead silently moved the first one to the second match. */
  const [existingId, setExistingId] = useState<string | null>(null)
  const openedRowId = byId ? opened?.id ?? null : null

  // Resolve ?assessment=<id> to its player and session. Owner-scoped: another
  // coach's id resolves to nothing, and the form stays blank.
  useEffect(() => {
    if (!userId || !openId) return
    let cancelled = false
    const controller = new AbortController()
    setOpenState('loading')
    void (async () => {
      const { data, error } = await supabase.from('coach_assessments')
        .select('id, squad_player_id, session_id, created_at, coach_sessions(id, title, session_date, session_type)')
        .eq('id', openId).eq('coach_user_id', userId).abortSignal(controller.signal).maybeSingle()
      if (cancelled) return
      if (error) { console.error('Opening the assessment failed:', error); setOpenState('error'); return }
      if (!data) { setOpenState('missing'); return }
      const row = data as any
      setOpened({ id: row.id, playerId: row.squad_player_id, sessionId: row.session_id ?? '',
        createdAt: row.created_at, session: row.coach_sessions ?? null })
      setPlayerId(row.squad_player_id)
      setSessionId(row.session_id ?? '')
      setOpenState('idle')
    })()
    return () => { cancelled = true; controller.abort() }
  }, [userId, openId, loadAttempt])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    // The entire draft belongs to one account/player selection. Clear it
    // before loading, and never make a failed read look like a new assessment.
    setExistingId(null)
    setWorkRate(5); setTactical(5); setAttitude(5)
    setTechnical(5); setPhysical(5); setCoachability(5)
    setAppearance(null)
    setNote(''); setNoteExists(false)
    setShared(''); setSharedPublished(false); setSharedExists(false); setPublishedBody(null); setAssessmentPublished(false)
    setSaving(false)
    setLoadState({ scope, status: 'loading' })
    if (userId && playerId && (sessionId || openedRowId)) {
      void (async () => {
        try {
          const query = supabase.from('coach_assessments')
            .select('id, work_rate, tactical, attitude, technical, physical, coachability, appearance, session_id, published_at')
            .eq('coach_user_id', userId).eq('squad_player_id', playerId)
          const { data, error } = await (openedRowId ? query.eq('id', openedRowId) : query.eq('session_id', sessionId))
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
            setAssessmentPublished(data.published_at != null)
            setWorkRate(data.work_rate); setTactical(data.tactical)
            setAttitude(data.attitude); setTechnical(data.technical)
            setPhysical(data.physical); setCoachability(data.coachability)
            setAppearance(MATCH_APPEARANCES.includes(data.appearance as MatchAppearance) ? data.appearance as MatchAppearance : null)
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
  }, [userId, playerId, sessionId, openedRowId, scope, loadAttempt])

  /* Account-bound choices: a late response from another coach cannot repopulate them. */
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPlayers([]); setSessions([])
    setChoicesError(false); setChoicesLoading(true)
    if (rosterAccount.current !== userId) {
      rosterAccount.current = userId
      setPlayerId('')
      setStep(0)
    }
    if (userId) {
      void (async () => {
        try {
          const [roster, events] = await Promise.all([
            supabase.from('squad_players').select('*').eq('coach_user_id', userId)
              .order('player_name').abortSignal(controller.signal),
            // Only sessions that already happened can be assessed (TRAK-68).
            supabase.from('coach_sessions').select('*').eq('coach_user_id', userId)
              .lte('session_date', localTodayISO())
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

  /* TRAK-100: the chosen player's attendance. A failed read offers no
     sessions (and a Retry), never every session as a fallback. */
  useEffect(() => {
    setAttendanceError(false)
    if (!userId || !playerId) return
    let cancelled = false
    const controller = new AbortController()
    void (async () => {
      const { data, error } = await supabase.from('session_attendance').select('session_id')
        .eq('squad_player_id', playerId).eq('status', 'present').abortSignal(controller.signal)
      if (cancelled) return
      if (error) { console.error('Attendance read failed:', error); setAttendanceError(true); return }
      setAttendance({ playerId, sessionIds: new Set((data ?? []).map(row => row.session_id as string)) })
    })()
    return () => { cancelled = true; controller.abort() }
  }, [userId, playerId, loadAttempt])

  // A session chosen for the previous player stays only if this player attended it too.
  // Not while the sessions reload (Retry empties them first): that is not a "no".
  useEffect(() => {
    if (attendanceReady && !choicesLoading && !choicesError && sessionId && !sessionOptions.some(s => s.id === sessionId)) setSessionId('')
  }, [attendanceReady, choicesLoading, choicesError, sessionId, sessionOptions])

  /* --- computed --- */
  const avg = (workRate + tactical + attitude + technical + physical + coachability) / 6
  const band = scoreToBand(avg)
  const overallCfg = bandConfig(band)

  const selectedPlayer = useMemo(
    () => players.find(p => p.id === playerId),
    [players, playerId],
  )
  const firstName: string = selectedPlayer?.player_name?.trim().split(/\s+/)[0] || 'the player'
  const selectedSession = sessionOptions.find(s => s.id === sessionId)
  // TRAK-182 (live run 3, 16 Oct): a training is a training, so Started or Sub isn't asked.
  const isTraining = selectedSession?.session_type === 'training'
  const savedAppearance = isTraining ? 'training' : appearance
  // TRAK-100: the time it was logged tells two same-day, same-title sessions apart.
  const loggedAt = (s: any) => s.created_at
    ? ` · logged ${new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''
  const sessionLabel = (s: any) => `${s.title || 'Session'}${s.session_date ? ` · ${s.session_date}` : ''}${loggedAt(s)}`
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
  // TRAK-182 (Imad, 15 Oct): one step per screen; the review step saves.
  const [step, setStep] = useState(0)
  useEffect(() => {
    setConsentWait(false)
    if (!playerId) return
    let cancelled = false
    void supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: playerId } as never)
      .then(({ data, error }) => { if (!cancelled && !error) setConsentWait(data === true) })
    return () => { cancelled = true }
  }, [playerId])
  // TRAK-99: say which of the two waits it is. null until read, or if it can't be.
  const [waitReason, setWaitReason] = useState<WaitReason | null>(null)
  useEffect(() => {
    setWaitReason(null)
    if (!playerId || !consentWait) return
    let cancelled = false
    void fetchWaitReason(playerId).then(reason => { if (!cancelled) setWaitReason(reason) })
    return () => { cancelled = true }
  }, [playerId, consentWait])

  /* --- save ---
     TRAK-64 (Imad, 25 Sep): saving stores the sliders and the private note and
     sends the message to the player; an edited message is sent again, and an
     emptied box takes a published one back. TRAK-182 (Imad, 15 Oct): the
     review step also offers Save draft, which keeps the message unpublished
     (published_at NULL, as Unpublish), so only the coach sees it.
     Unpublish is not a save: see handleUnpublish below. */
  const handleSave = async (draft = false) => {
    if (!user || !playerId || saving || !formReady || consentWait || saveRequest.current) return
    // Option A (Imad, 19 Oct): a player who didn't play isn't assessed, even if Review is reached another way.
    if (!isTraining && !appearance) return
    // Rewriting an unchanged, still-published message would re-stamp it and
    // mark it "new" for the player again. Leave it alone, unless it's being
    // taken back to a draft.
    const writeShared = (message.length > 0 || sharedExists) && !(liveUnchanged && !draft)
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
        // Null only for a row opened by id that predates required sessions.
        session_id: sessionId || null,
        appearance: savedAppearance,
        // raw coach inputs
        work_rate: workRate,
        tactical,
        attitude,
        technical,
        physical,
        coachability,
        // derived card stats
        ...cardStats,
        // TRAK-200: Save draft hides the bands from the family; Publish shows them.
        // An already published row keeps its date; a new one takes the database's now().
        // TRAK-248: Save draft never takes back bands the family already sees; that's Unpublish.
        ...(draft ? (assessmentPublished ? {} : { published_at: null }) : existingId && !assessmentPublished ? { published_at: new Date().toISOString() } : {}),
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
          // NULL retracts: the child stops seeing it immediately.
          published_at:  message && !draft ? new Date().toISOString() : null,
        }, { onConflict: 'assessment_id' }).abortSignal(controller.signal)
        if (!isCurrent()) return
        if (sharedError) {
          // Stay put. Navigating away here loses the text the coach wrote for the
          // child and gives them no way to retry it — the same mistake K5 fixed
          // in the match flow, which I then repeated in my own new code an hour
          // later. The assessment itself is saved, so keep its id: pressing save
          // again updates that row rather than creating a second one.
          console.error('Shared feedback save failed:', sharedError)
          // TRAK-200: the scores saved above are published unless this is a draft,
          // so the family can already see them; only a draft keeps everything back.
          toast.error(
            (draft
              ? `The scores${note.trim() ? ' and private note' : ''} are saved as a draft, so nothing reached the family. `
              : `The scores${note.trim() ? ' and private note' : ''} are saved, and ${firstName} and their family can see the scores. `) +
              `Not saved: the message to ${firstName} (${sharedError.message}). Your text is still here — try again.`,
            { duration: 12000 },
          )
          setExistingId(saved.id)
          setSaving(false)
          return
        }
        setSharedExists(true)
        setSharedPublished(message.length > 0 && !draft)
        setPublishedBody(message && !draft ? message : null)
      }
      toast.success(writeShared && message
        ? draft ? `Saved. Your message is a draft; ${firstName} can't see it yet.` : `Saved. ${firstName} can read your message now.`
        : 'Assessment saved.')
      trackEvent('assessment_submitted', {
        mode: 'full',
        players: 1,
        // J7 counts distinct assessments per coach, checked against this row.
        assessment_id: saved.id,
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

  /* --- unpublish ---
     Retraction only: the family stops seeing the message, and nothing else is
     written. It must not depend on the scores or the private note saving, and
     it stays available after consent is withdrawn, because the database keeps
     the coach's right to retract then too (20260921110000, TRAK-14). Unsaved
     edits on the screen stay on the screen. */
  const handleUnpublish = async () => {
    if (!user || !existingId || !sharedPublished || saving || !formReady || saveRequest.current) return
    const controller = new AbortController()
    saveRequest.current = controller
    const isCurrent = () => !controller.signal.aborted && currentScope.current === scope
    setSaving(true)
    try {
      const { data, error } = await supabase.from('coach_shared_feedback' as any)
        .update({ published_at: null })
        .eq('assessment_id', existingId).eq('coach_user_id', user.id)
        .select('assessment_id').abortSignal(controller.signal).maybeSingle()
      if (!isCurrent()) return
      if (error) {
        console.error('Unpublish failed:', error)
        toast.error(`Not unpublished (${error.message}). ${firstName} can still see the message. Try again.`, { duration: 12000 })
        return
      }
      // No row back means nothing changed: the message may have been removed,
      // or this coach no longer owns it. Never report a retraction that did
      // not happen.
      if (!data) {
        toast.error(`Not unpublished: the message could not be found. Reload to see what ${firstName} can read.`, { duration: 12000 })
        return
      }
      setSharedPublished(false)
      setPublishedBody(null)
      toast.success(`Unpublished. ${firstName} can no longer see the message.`)
    } catch (error) {
      if (isCurrent()) {
        console.error('Unpublish interrupted:', error)
        toast.error(`Could not confirm the message was unpublished. ${firstName} may still see it. Try again.`)
      }
    } finally {
      if (saveRequest.current === controller) saveRequest.current = null
      if (isCurrent()) setSaving(false)
    }
  }

  /* ---- render ---- */
  return (
    <div className="flex flex-col mx-auto trak-read bg-ground" style={{ height: '100dvh' }}>
      {/* ---- header: always visible, never scrolls ---- */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgb(var(--t-line))' }}>
        {/* TRAK-334: the trail, in place of TRAK-179's Back: the screens the coach came through (Squad, the player,
            Home); opened from a link, Home. */}
        <CoachTrail current="Assessment" />
        <h1 className="sr-only">Assessment</h1>
      </div>

      {/* ---- scrollable content ---- */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5 pt-4">
        <div className="arc">
          <Stepper label="Assessment steps" steps={STEPS} current={step} onStepSelect={setStep} />
        </div>

        {/* Shown on every step: a refused save (consent withdrawn mid-edit) says why where the coach is. */}
        {selectedPlayer && consentWait ? (
          <div role="status" className="p-3 rounded-[12px] border border-warning/[0.25] bg-warning/[0.06]">
            <p className="text-[13px] font-medium text-ink">{WAIT_TITLE[waitReason ?? 'unknown']}</p>
            <p className="text-[12px] text-ink-2 leading-relaxed mt-0.5">
              {waitText(waitReason, selectedPlayer.player_name)}{' '}
              The form stays locked until then, and nothing about them is recorded.
            </p>
          </div>
        ) : null}
        {step === 0 && <>
        {/* ---- 2. player card (sq-item) ---- */}
        {selectedPlayer ? (
          <div className="flex items-center gap-3 p-3 rounded-[12px] bg-surface border border-line">
            <PlayerFace name={selectedPlayer.player_name} size="md" className="arc" aria-hidden />
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-ink truncate">
                {selectedPlayer.player_name}
              </p>
              <p className="text-[11px] text-ink-3 truncate">
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
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
            PLAYER
          </span>
          <div className="relative">
            <select
              aria-label="Player"
              disabled={saving || choicesLoading}
              value={playerId}
              onChange={e => setPlayerId(e.target.value)}
              className="w-full px-4 py-3 pr-10 rounded-[10px] bg-surface border border-line text-sm text-ink outline-none appearance-none"
            >
              <option value="">{selectedPlayer ? 'Change player...' : 'Select player...'}</option>
              {players.filter(p => inSquad(p.age_group) || p.id === playerId).map(p => (
                <option key={p.id} value={p.id}>
                  {p.player_name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          </div>
        </div>

        {/* ---- 3. session selector (required, TRAK-68) ----
            Outside the locked fieldset: the form stays locked until a session
            is chosen, so the coach must be able to choose one. */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
            SESSION
          </span>
          {openState === 'missing' || openState === 'error' ? (
            <p role="alert" className="text-[12px] text-warning">
              {openState === 'missing'
                ? "We couldn't open that assessment. It may have been removed, or it isn't one of yours."
                : "We couldn't open that assessment. Check your connection and try again."}
            </p>
          ) : null}
          {!choicesLoading && !choicesError && sessions.length === 0 && !(opened?.session && opened.playerId === playerId) ? (
            <p role="status" className="text-[12px] text-ink-2">
              No past sessions yet. Log the session first, then assess it.{' '}
              <Link to="/coach/sessions" className="underline text-brand">Log a session</Link>
            </p>
          ) : playerId && attendanceError ? (
            <div role="alert" className="text-[12px] text-warning">
              Couldn't load which sessions {firstName} was at.
              <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="ml-2 underline">Retry</button>
            </div>
          ) : !choicesLoading && !choicesError && attendanceReady && sessionOptions.length === 0 ? (
            <p role="status" className="text-[12px] text-ink-2">
              {firstName} isn't marked present at any past session. Log the session with them present, then assess it.{' '}
              <Link to="/coach/sessions" className="underline text-brand">Log a session</Link>
            </p>
          ) : (
            <div className="relative">
              <select
                aria-label="Session"
                disabled={saving || choicesLoading || !playerId}
                value={sessionId}
                onChange={e => setSessionId(e.target.value)}
                className="w-full px-4 py-3 pr-10 rounded-[10px] bg-surface border border-line text-sm text-ink outline-none appearance-none"
              >
                <option value="" disabled>{playerId ? 'Select session...' : 'Choose a player first'}</option>
                {sessionOptions.map(s => (
                  <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            </div>
          )}
          {existingId && formReady && selectedSession ? (
            <p role="status" className="text-[11px] text-ink-2">
              Editing your assessment for {sessionLabel(selectedSession)}
            </p>
          ) : existingId && formReady && openedRowId && opened ? (
            <p role="status" className="text-[11px] text-ink-2">
              Editing your assessment from {new Date(opened.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (no session recorded)
            </p>
          ) : null}
        </div>

        {((playerId && (sessionId || openedRowId) && !formReady) || choicesError) && (
          (choicesError || (loadState.scope === scope && loadState.status === 'error')) ? (
            <div role="alert" className="text-sm text-warning">
              Could not load this assessment. Retry before editing or saving.
              <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="ml-2 underline">Retry</button>
            </div>
          ) : <LoadingSkeleton label="Loading assessment…" rows={2} />
        )}
        </>}
        {/* J5: a player waiting for a parent cannot be opened. If consent is
            withdrawn mid-edit, the refused save sets consentWait: the form
            locks, and everything the coach entered stays in state. */}
        <fieldset disabled={!formReady || saving || consentWait} className="contents">
        {step === 0 && <>
        {/* ---- 4. appearance (pilot coach's item 13; Imad, 19 Oct): Started or Sub, for a
            match the log has them playing (TRAK-219). A training isn't asked (TRAK-182). ---- */}
        {!isTraining && <div className="arc">
          <Select label="Appearance" placeholder="Choose" value={appearance ?? ''} onValueChange={value => setAppearance(value as MatchAppearance)}
            options={MATCH_APPEARANCES.map(value => ({ value, label: APPEARANCE_LABEL[value] }))} />
          {selectedSession && <p className="mt-2 text-sm text-muted-foreground">The match log has {firstName} as played.</p>}
        </div>}

        </>}
        {step === 1 && <>
        {/* ---- 5. sliders on a light card (TRAK-229); each fill takes its band's colour ---- */}
        <div className="rounded-[14px] bg-surface border border-line p-[14px_16px] space-y-5">
          <SliderInput label="Work Rate"    value={workRate}     onChange={setWorkRate} disabled={!formReady || saving || consentWait} />
          <SliderInput label="Tactical"     value={tactical}     onChange={setTactical} disabled={!formReady || saving || consentWait} />
          <SliderInput label="Attitude"     value={attitude}     onChange={setAttitude} disabled={!formReady || saving || consentWait} />
          <SliderInput label="Technical"    value={technical}    onChange={setTechnical} disabled={!formReady || saving || consentWait} />
          <SliderInput label="Physical"     value={physical}     onChange={setPhysical} disabled={!formReady || saving || consentWait} />
          <SliderInput label="Coachability" value={coachability} onChange={setCoachability} disabled={!formReady || saving || consentWait} />
        </div>

        {/* ---- 6. overall band card, in the band's light tint (TRAK-229) ---- */}
        <div
          className="flex flex-col items-center gap-2 py-5 rounded-[14px]"
          style={{
            background: `linear-gradient(${overallCfg.bg}, ${overallCfg.bg}), rgb(var(--t-surface))`,
            border: `1px solid ${overallCfg.border}`,
            boxShadow: `0 0 24px ${overallCfg.bg}`,
          }}
        >
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
            OVERALL BAND
          </span>
          <span
            className="inline-flex items-center justify-center px-5 rounded-full text-[16px] font-semibold"
            style={{
              height: 36,
              color: overallCfg.text,
              background: overallCfg.bg,
              border: `1.5px solid ${overallCfg.border}`,
            }}
          >
            {overallCfg.word}
          </span>
          <span className="text-[13px] text-ink-2 font-medium">
            {(Math.round(avg * 10) / 10).toFixed(1)}
          </span>
        </div>

        </>}
        {step === 2 && <>
        {/* ---- 7. message to the player (K9, J5) ----
            Two boxes rather than one, because the schema has two tables and the
            coach needs to see which words the player will read. Nothing copies
            the private note into here. Parents see the bands only, never this
            message (TRAK-63, 25 Sep), so the label names the player alone. */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-message" className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-2" style={{ fontFamily: 'var(--t-font-mono)' }}>
                Message to {firstName}
              </label>
              <p className="text-[10px] text-ink-3 mt-0.5" style={{ fontFamily: 'var(--t-font)' }}>
                Only {firstName} sees this.
              </p>
            </div>
            <span className="text-[10px] text-ink-3">{shared.length}/300</span>
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
            // Blue: words the player reads. The private note is yellow and the
            // same size, so the two never look interchangeable (TRAK-72 item 7).
            data-tone="message"
            className="w-full px-4 py-3 rounded-[10px] bg-raised border border-line-strong text-sm text-ink outline-none resize-none placeholder:text-ink-3 disabled:opacity-40"
          />
          <p role="status" className="text-[10px] text-ink-3" style={{ fontFamily: 'var(--t-font)' }}>
            {liveUnchanged
              ? `Published. ${firstName} can read it now.`
              : sharedPublished
                ? `Edited. Publish sends ${firstName} the new version.`
                : message
                  ? `Not sent yet. Publish sends it to ${firstName}.`
                  : 'Optional.'}
          </p>
        </div>

        {/* ---- 8. private note ----
            The label used to read "AI will expand these into personalised
            feedback for the player". K9 made that false: the note is private
            and no family role can read it. */}
        <div className="space-y-1.5 pt-4">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-note" className="text-[9px] font-medium tracking-[0.12em] uppercase text-warning" style={{ fontFamily: 'var(--t-font-mono)' }}>
                Private note <span className="text-ink-3">— optional</span>
              </label>
              <p className="text-[10px] text-ink-3 mt-0.5" style={{ fontFamily: 'var(--t-font)' }}>
                Only you can see this.
              </p>
            </div>
            <span className="text-[10px] text-ink-3">{note.length}/300</span>
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
            data-tone="private"
            className="w-full px-4 py-3 rounded-[10px] bg-warning/[0.08] border border-warning/40 text-sm text-ink outline-none resize-none placeholder:text-ink-3 disabled:opacity-40"
          />
        </div>

        </>}
        {/* ---- 9. review and save (TRAK-182) ---- */}
        {step === 3 && <>
          <dl className="rounded-[14px] border border-line divide-y divide-line text-[13px]">
            {([
              ['Player', selectedPlayer?.player_name ?? ''],
              ['Session', selectedSession ? sessionLabel(selectedSession) : opened ? 'No session recorded' : ''],
              ['Appearance', savedAppearance ? APPEARANCE_LABEL[savedAppearance] : ''],
              ['Overall', `${overallCfg.word} · ${(Math.round(avg * 10) / 10).toFixed(1)}`],
              ['Ratings', `Work rate ${workRate} · Tactical ${tactical} · Attitude ${attitude} · Technical ${technical} · Physical ${physical} · Coachability ${coachability}`],
              [`Message to ${firstName}`, message || 'None'],
              ['Private note', <>{note.trim() || 'None'}<span className="block mt-0.5 text-[11px] text-ink-3">Only you see this.</span></>],
            ] as const).map(([term, value]) => (
              <div key={term} className="flex gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-ink-3">{term}</dt>
                <dd className="text-ink break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        </>}
        </fieldset>
        {/* Outside the consent-locked fieldset: retracting what the family can
            already read is always allowed, even while the form is locked. It
            sits with the message, and on the first step when consent locks the
            rest of the steps away (TRAK-182). */}
        {(step === 2 || (step === 0 && consentWait)) && sharedPublished && existingId ? (
          <button
            type="button"
            onClick={() => void handleUnpublish()}
            disabled={saving || !formReady}
            className="w-full py-2.5 rounded-[10px] text-[11px] font-semibold text-ink-2 border border-line disabled:opacity-30"
          >
            Unpublish message
          </button>
        ) : null}
      </div>

      {/* Above the floating glass tab bar (TRAK-259: 62px, 12px off the bottom, plus the home indicator's inset),
          so Back and Next are never under it. TRAK-199: beside a laptop's sidebar there is no bar, so no room (trak-bar-room). */}
      <div className="trak-bar-room arc flex gap-2 px-5 pb-3 pt-2 mb-[calc(84px+env(safe-area-inset-bottom))] shrink-0 border-t border-line">
        {step === STEPS.length - 1 ? <>
          {/* Review: the decision sits where the thumb is; Back shrinks to an icon. */}
          <Button size="lg" variant="secondary" aria-label={`Back to ${STEPS[step - 1].label}`} onClick={() => setStep(step - 1)}><ChevronLeft size={18} aria-hidden="true" /></Button>
          {/* Save draft only for a message the player hasn't got: on a published
              one it would take it back (Kostas, #313). That stays Unpublish's job. */}
          {message && !sharedPublished ? <>
            <Button size="lg" variant="secondary" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait} onClick={() => void handleSave(true)}>Save draft</Button>
            <Button size="lg" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait} onClick={() => void handleSave()}>Publish</Button>
          </> : (
            <Button size="lg" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait} onClick={() => void handleSave()}>
              {message && !liveUnchanged ? 'Publish' : 'Save'}
            </Button>
          )}
        </> : <>
          {/* Named for its step: the header's Back leaves the screen (TRAK-179). */}
          {step > 0 && <Button size="lg" variant="secondary" className="flex-1" aria-label={`Back to ${STEPS[step - 1].label}`}
            onClick={() => setStep(step - 1)}>Back</Button>}
          {/* The first step opens only once the player can be assessed: the form below it stays locked otherwise. */}
          <Button size="lg" className="flex-1" disabled={step === 0 && (!playerId || !formReady || consentWait || (!isTraining && !appearance))}
            onClick={() => setStep(step + 1)}>Next</Button>
        </>}
      </div>

      {/* ---- 10. bottom nav ---- */}
      {/* TRAK-254: "+ Create" in the side menu on a laptop; no "+" here on a phone. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" activeTab="/coach/assess" onNavigate={p => navigate(p)} />
    </div>
  )
}
