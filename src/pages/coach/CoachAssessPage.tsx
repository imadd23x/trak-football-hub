import { currentLanguage, useTranslation } from '@/lib/i18n'
import { appearanceWord, bandWord } from '@/lib/band-words'
import { useEffect, useState, useMemo, useRef } from 'react'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import { fetchWaitReason, waitText, type WaitReason } from '@/lib/wait-reason'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { MobileShell, BandPill, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { SliderInput } from '@/components/trak/SliderInput'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { BandType } from '@/lib/types'
import { deriveCardStats } from '@/lib/cardStats'
import { trackEvent, startTimer } from '@/lib/telemetry'
import { ChevronLeft } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Stepper } from '@/components/arc/stepper/stepper'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { Button } from '@/components/arc/button/button'
import { useCoachSquad } from '@/lib/coach-squad'
import { Select } from '@/components/arc/select/select'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFeatureState } from '@/components/trak/parked'
import { LoadError } from '@/components/trak/LoadError'
import { loadSeasonPlan, seasonPlanKey } from '@/lib/season-plan'
import { usePlayerObjectives } from '@/components/coach/season-plan/usePlayerObjectives'
import { ObjectivesSection } from '@/components/coach/season-plan/Evaluation'
import { allRated, emptyObjectives, isProgress, progressLabel, type ObjectivesEntry, type Progress } from '@/lib/objective-progress'

/** TRAK-559 (phone review, 23 Nov): 3 steps, not 5. The player and the bands; then the objectives (TRAK-526, only where
    the player's squad has a shared season plan) with the message and the private note, still two boxes (Imad, 16 Oct):
    the message (white) reaches the player, the note (yellow) only the coach; then Review, which saves. */
const STEPS = [
  { id: 'player', label: 'coachAssess:stepPlayerBands' },
  { id: 'notes', label: 'coachAssess:stepObjectivesNotes' },
  { id: 'review', label: 'coachSchedule:stepReview' },
] as const

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
  const { t } = useTranslation()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = user?.id
  // TRAK-176/305: the picker offers the squad picked at the top, or All (a player already chosen stays).
  const { inSquad } = useCoachSquad(userId)

  /* --- data --- */
  const [players, setPlayers] = useState<any[]>([])
  const [choicesLoading, setChoicesLoading] = useState(true)
  const [choicesError, setChoicesError] = useState(false)
  const rosterAccount = useRef(userId)
  const [playerId, setPlayerId] = useState((location.state as any)?.preselectedPlayerId || '')
  /* TRAK-500 (Imad, 19 Nov): Assess player asks for no session; each one is a
     new assessment with none. TRAK-69: /coach/assess?assessment=<id> opens that
     exact saved row, loaded by id while its player stays selected, and saving
     edits it in place, keeping any session or Started/Sub it was saved with. */
  const openId = new URLSearchParams(location.search).get('assessment')
  const [opened, setOpened] = useState<{ id: string; playerId: string; createdAt: string; session: any | null } | null>(null)
  const [openState, setOpenState] = useState<'idle' | 'loading' | 'missing' | 'error'>(openId ? 'loading' : 'idle')
  // Shown on Review for an opened row saved with one; never asked any more (TRAK-500).
  const [appearance, setAppearance] = useState<string | null>(null)
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
  const byId = opened !== null && opened.playerId === playerId
  const scope = JSON.stringify([userId, playerId, byId ? opened?.id : null])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [loadState, setLoadState] = useState<{ scope: string; status: 'loading' | 'ready' | 'error' }>({ scope: '', status: 'loading' })
  // Not while ?assessment=<id> resolves: a preselected player must not start a new row in its place.
  const formReady = loadState.scope === scope && loadState.status === 'ready'
    && !choicesLoading && !choicesError && openState !== 'loading' && players.some(player => player.id === playerId)
  const saveRequest = useRef<AbortController | null>(null)
  useEffect(() => () => { saveRequest.current?.abort() }, [scope])

  /* Scorecard metric 4: median time to assess one player, target <90s.
     The clock starts when a player is chosen, not on mount, so a page left
     open on the drive home does not pollute the median. */
  const timerRef = useRef<(() => number) | null>(null)
  useEffect(() => {
    timerRef.current = playerId ? startTimer() : null
  }, [playerId])

  /* The saved row being edited: only one opened by id (TRAK-69). Without one,
     saving inserts a new assessment (TRAK-500). */
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
        .select('id, squad_player_id, created_at, coach_sessions(id, title, session_date, session_type)')
        .eq('id', openId).eq('coach_user_id', userId).abortSignal(controller.signal).maybeSingle()
      if (cancelled) return
      if (error) { console.error('Opening the assessment failed:', error); setOpenState('error'); return }
      if (!data) { setOpenState('missing'); return }
      const row = data as any
      setOpened({ id: row.id, playerId: row.squad_player_id, createdAt: row.created_at, session: row.coach_sessions ?? null })
      setPlayerId(row.squad_player_id)
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
    // A new assessment starts blank: nothing to read (TRAK-500).
    if (userId && playerId && !openedRowId) setLoadState({ scope, status: 'ready' })
    if (userId && playerId && openedRowId) {
      void (async () => {
        try {
          const { data, error } = await supabase.from('coach_assessments')
            .select('id, work_rate, tactical, attitude, technical, physical, coachability, appearance, published_at')
            .eq('coach_user_id', userId).eq('squad_player_id', playerId).eq('id', openedRowId)
            .abortSignal(controller.signal).maybeSingle()
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
            setAppearance(data.appearance ?? null)
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
  }, [userId, playerId, openedRowId, scope, loadAttempt])

  /* Account-bound choices: a late response from another coach cannot repopulate them. */
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setPlayers([])
    setChoicesError(false); setChoicesLoading(true)
    if (rosterAccount.current !== userId) {
      rosterAccount.current = userId
      setPlayerId('')
      setStep(0)
    }
    if (userId) {
      void (async () => {
        try {
          const roster = await supabase.from('squad_players').select('*').eq('coach_user_id', userId)
            .order('player_name').abortSignal(controller.signal)
          if (cancelled) return
          if (roster.error) throw roster.error
          setPlayers(roster.data ?? [])
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
  const firstName: string = selectedPlayer?.player_name?.trim().split(/\s+/)[0] || t('coachAssess:thePlayer')
  // The session an opened row was saved against, if any (TRAK-500: a new one has none).
  const openedSession = byId ? opened?.session ?? null : null
  // TRAK-100: the time it was logged tells two same-day, same-title sessions apart.
  const loggedAt = (s: any) => s.created_at
    ? t('coachAssess:logged', { time: new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }) : ''
  // TRAK-425: the day reads "Mon 9 Nov" as everywhere else; the logged time still tells two same-day, same-title sessions apart (TRAK-100).
  const sessionLabel = (s: any) => `${s.title || t('coachAssess:sessionFallback')}${s.session_date ? ` · ${format(parseISO(s.session_date), 'EEE d MMM')}` : ''}${loggedAt(s)}`
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
  // TRAK-425: step 1 is done once the player can be assessed; only then may the steps be jumped (ahead as well as back).
  const playerReady = !!playerId && formReady && !consentWait
  // TRAK-182 (Imad, 15 Oct): one step per screen; the review step saves.
  const [step, setStep] = useState(0)
  // TRAK-559: the coach has gone past step 1 for this player, so a lock that comes later keeps the bands on screen.
  const [started, setStarted] = useState(false)
  useEffect(() => { if (step > 0) setStarted(true) }, [step])

  /* TRAK-526 (Imad, 21 Nov): after Ratings, how each open objective is going, as the squad evaluation asks, where the
     season plan is on and the player's squad has a shared plan. A draft keeps the answers; Met closes an objective and
     an added one starts once the assessment is published (Tarek, 21 Nov), and then they're final. */
  const queryClient = useQueryClient()
  const seasonPlanOn = useFeatureState('season_plan').on
  const squad = (selectedPlayer?.age_group as string | undefined)?.trim() || null
  const plan = useQuery({ queryKey: seasonPlanKey(userId, squad), queryFn: () => loadSeasonPlan(userId!, squad!), enabled: seasonPlanOn && !!userId && !!squad })
  const asksObjectives = seasonPlanOn && !!plan.data?.shared_at
  // TRAK-532 (Imad, 21 Nov): there, one Save (no Publish, no Save draft) and no message to the player; the private
  // note stays. TRAK-585 (Imad, 25 Nov): that Save publishes, so the player and parents read the bands.
  const oneSave = asksObjectives
  // Until the plan is read, it isn't known which Save this is: Save waits.
  const planKnown = !seasonPlanOn || !squad || plan.isSuccess
  const playerObjectives = usePlayerObjectives(userId, asksObjectives)
  const openObjectives = asksObjectives ? playerObjectives.of(playerId).map(o => ({ id: o.id, title: o.title })) : []
  const [checkIn, setCheckIn] = useState<ObjectivesEntry>(emptyObjectives)
  type SavedAnswer = { player_objective_id: string | null; status: string | null; added_title: string | null; applied_at: string | null; player_objectives: { title: string } | null }
  const savedCheckIn = useQuery({
    queryKey: ['coach', userId, 'assessment-objectives', openedRowId],
    enabled: asksObjectives && !!openedRowId,
    queryFn: async () => {
      const { data, error } = await supabase.from('assessment_objectives' as never)
        .select('player_objective_id, status, added_title, applied_at, player_objectives(title)').eq('assessment_id', openedRowId!)
      if (error) throw error
      return (data ?? []) as unknown as SavedAnswer[]
    },
  })
  const finalCheckIn = savedCheckIn.data?.some(row => row.applied_at) ? savedCheckIn.data : null
  useEffect(() => { setCheckIn(emptyObjectives()) }, [scope])
  // A draft's answers come back to be changed.
  useEffect(() => {
    const rows = savedCheckIn.data
    if (!rows || rows.some(row => row.applied_at)) return
    setCheckIn({
      progress: Object.fromEntries(rows.filter(row => row.player_objective_id && isProgress(row.status)).map(row => [row.player_objective_id!, row.status as Progress])),
      add: rows.flatMap(row => row.added_title ? [row.added_title] : []),
    })
  }, [savedCheckIn.data])
  const objectivesReady = !asksObjectives || !!finalCheckIn || (playerObjectives.isSuccess && (!openedRowId || savedCheckIn.isSuccess) && allRated(openObjectives, checkIn))
  // TRAK-542: the coach can jump past Objectives, so the steps and Review say when one still has no answer.
  const objectivesMissing = asksObjectives && !finalCheckIn && playerObjectives.isSuccess && !allRated(openObjectives, checkIn)
  // TRAK-407: the steps' names in the language showing.
  // Without a shared plan the second step holds the message and the note alone, and says so.
  const steps = STEPS.map((entry, index) => ({ id: entry.id, label: t(entry.id === 'notes' && !asksObjectives ? 'coachAssess:stepMessage' : entry.label),
    error: entry.id === 'notes' && objectivesMissing && index < step ? t('coachAssess:objectiveNoAnswer') : undefined }))
  const stepId = steps[step]?.id
  useEffect(() => {
    setConsentWait(false)
    setStarted(false)
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
  const handleSave = async (asDraft = false) => {
    if (!user || !playerId || saving || !formReady || consentWait || !planKnown || saveRequest.current) return
    // TRAK-532: with one Save, the message is left as it was. TRAK-585: and that Save publishes.
    const draft = asDraft
    // Rewriting an unchanged, still-published message would re-stamp it and
    // mark it "new" for the player again. Leave it alone, unless it's being
    // taken back to a draft.
    const writeShared = !oneSave && (message.length > 0 || sharedExists) && !(liveUnchanged && !draft)
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
        // No session_id or appearance (TRAK-500): a new row has neither, and an edit keeps what it was saved with.
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

      // TRAK-526: with a check-in, the assessment and its answers are one save (as the coach, under the same policies).
      // A published assessment's answers are final, so an edit of one sends none.
      const { data: saved, error: saveError } = asksObjectives
        ? await supabase.rpc('save_assessment_with_objectives' as never, {
            p_assessment_id: existingId, p_row: payload,
            p_progress: finalCheckIn ? null : openObjectives.map(o => ({ player_objective_id: o.id, status: checkIn.progress[o.id] })),
            p_add: finalCheckIn ? null : checkIn.add,
          } as never).abortSignal(controller.signal).then(({ data, error }) => ({ data: data ? { id: data as unknown as string } : null, error }))
        : existingId
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
            toast.error(t('coachAssess:notSavedUnconfirmed'))
          } else if (waiting === true) {
            setConsentWait(true)
            toast.error(t('coachAssess:notSavedNeedsParent', { name: selectedPlayer?.player_name ?? t('coachAssess:thisPlayer') }))
          } else {
            toast.error(t('coachAssess:notSavedNoAccess'))
          }
        } else {
          toast.error(t('coachAssess:couldNotSave', { error: saveError.message }))
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
        toast.error(t('coachAssess:nothingSaved'))
        setSaving(false)
        return
      }

      setExistingId(saved.id)
      // Met and an added objective change the player's list; the card reads the answers.
      if (asksObjectives) void queryClient.invalidateQueries({ queryKey: ['coach', user.id] })
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
          const alsoMessage = writeShared ? t('coachAssess:alsoMessage', { name: firstName }) : ''
          toast.error(
            t('coachAssess:noteNotSaved', { also: alsoMessage, error: noteError.message }),
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
              ? t('coachAssess:scoresDraft', { note: note.trim() ? t('coachAssess:andPrivateNote') : '' })
              : t('coachAssess:scoresPublished', { note: note.trim() ? t('coachAssess:andPrivateNote') : '', name: firstName })) +
              t('coachAssess:messageNotSaved', { name: firstName, error: sharedError.message }),
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
        ? draft ? t('coachAssess:savedDraftMsg', { name: firstName }) : t('coachAssess:savedCanRead', { name: firstName })
        : t('coachAssess:assessmentSaved'))
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
        toast.error(t('coachAssess:couldNotFinish'))
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
        toast.error(t('coachAssess:notUnpublished', { error: error.message, name: firstName }), { duration: 12000 })
        return
      }
      // No row back means nothing changed: the message may have been removed,
      // or this coach no longer owns it. Never report a retraction that did
      // not happen.
      if (!data) {
        toast.error(t('coachAssess:notUnpublishedMissing', { name: firstName }), { duration: 12000 })
        return
      }
      setSharedPublished(false)
      setPublishedBody(null)
      toast.success(t('coachAssess:unpublished', { name: firstName }))
    } catch (error) {
      if (isCurrent()) {
        console.error('Unpublish interrupted:', error)
        toast.error(t('coachAssess:couldNotConfirmUnpublish', { name: firstName }))
      }
    } finally {
      if (saveRequest.current === controller) saveRequest.current = null
      if (isCurrent()) setSaving(false)
    }
  }

  /* ---- render ---- */
  // TRAK-425: the page width every coach page uses (a laptop filled, not a 640 px column); a phone is unchanged.
  return (
    <div className="flex flex-col mx-auto w-full trak-wide bg-ground h-dvh">
      {/* ---- header: always visible, never scrolls ---- */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgb(var(--t-line))' }}>
        {/* TRAK-334: the trail, in place of TRAK-179's Back: the screens the coach came through (Squad, the player,
            Home); opened from a link, Home. */}
        <CoachTrail current={t('coachAssess:assessment')} />
        <h1 className="sr-only">{t('coachAssess:assessment')}</h1>
      </div>

      {/* ---- scrollable content ---- */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5 pt-4">
        <div className="arc pb-2">
          <Stepper label={t('coachAssess:assessmentSteps')} steps={steps} current={step} onStepSelect={setStep} jumpAhead={playerReady} />
        </div>

        {/* Shown on every step: a refused save (consent withdrawn mid-edit) says why where the coach is. */}
        {selectedPlayer && consentWait ? (
          <div role="status" className="p-3 rounded-xl border border-warning/[0.25] bg-warning/[0.06]">
            <p className="text-[13px] font-medium text-ink">{t(`coachAssess:waitTitle_${waitReason ?? 'unknown'}` as 'coachAssess:waitTitle_unknown')}</p>
            <p className="text-[12px] text-ink-2 leading-relaxed mt-1">
              {waitText(waitReason, selectedPlayer.player_name)}{' '}
              {t('coachAssess:formLocked')}
            </p>
          </div>
        ) : null}
        {stepId === 'player' && <>
        {/* ---- 2. player card (sq-item) ---- */}
        {selectedPlayer ? (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-line">
            <PlayerFace name={selectedPlayer.player_name} playerId={selectedPlayer.id} size="md" className="arc" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink truncate">
                {selectedPlayer.player_name}
              </p>
              <p className="text-[11px] text-ink-3 truncate">
                {selectedPlayer.position?.toUpperCase() ?? t('nav:player')}
                {selectedPlayer.club ? ` \u00B7 ${selectedPlayer.club}` : ''}
                {selectedPlayer.age_group ? ` ${selectedPlayer.age_group}` : ''}
                {selectedPlayer.squad_number ? ` \u00B7 #${selectedPlayer.squad_number}` : ''}
              </p>
            </div>
            {/* TRAK-425: a picked player shows once, here; Change brings the list back. */}
            <div className="arc shrink-0">
              <Button size="sm" variant="secondary" disabled={saving || choicesLoading} onClick={() => setPlayerId('')}>{t('coachAssess:changePlayerButton')}</Button>
            </div>
          </div>
        ) : null}


        {/* player selector dropdown: only until a player is picked (TRAK-425) */}
        {!selectedPlayer && <div className="arc">
          <Select label={t('nav:player')} placeholder={t('coachAssess:selectPlayer')} disabled={saving || choicesLoading} value={playerId} onValueChange={setPlayerId}
            options={players.filter(p => inSquad(p.age_group) || p.id === playerId).map(p => ({ value: p.id, label: p.player_name }))} />
        </div>}

        {/* ---- 3. no session to select (TRAK-500); an opened row says which one it is ---- */}
        <div className="space-y-1.5">
          {openState === 'missing' || openState === 'error' ? (
            <p role="alert" className="text-[12px] text-warning">
              {openState === 'missing'
                ? t('coachAssess:cantOpenMissing')
                : t('coachAssess:cantOpenError')}
            </p>
          ) : null}
          {existingId && formReady && openedSession ? (
            <p role="status" className="text-[11px] text-ink-2">
              {t('coachAssess:editingFor', { session: sessionLabel(openedSession) })}
            </p>
          ) : existingId && formReady && opened ? (
            <p role="status" className="text-[11px] text-ink-2">
              {t('coachAssess:editingFrom', { day: new Date(opened.createdAt).toLocaleDateString(currentLanguage() === 'en' ? 'en-GB' : currentLanguage(), { day: 'numeric', month: 'short' }) })}
            </p>
          ) : null}
        </div>

        {((playerId && !formReady) || choicesError) && (
          (choicesError || (loadState.scope === scope && loadState.status === 'error')) ? (
            <div role="alert" className="text-sm text-warning">
              {t('coachAssess:couldNotLoad')}
              <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="ml-2 underline">{t('common:retry')}</button>
            </div>
          ) : <LoadingSkeleton label={t('coachAssess:loadingAssessment')} rows={2} />
        )}
        </>}
        {/* J5: a player waiting for a parent cannot be opened. If consent is
            withdrawn mid-edit, the refused save sets consentWait: the form
            locks, and everything the coach entered stays in state. */}
        <fieldset disabled={!formReady || saving || consentWait} className="contents">
        {/* TRAK-559: the bands sit under the player once the player can be assessed. A player waiting for a parent shows
            none; consent withdrawn mid-edit keeps them on screen, locked by the fieldset, with what the coach set (J5). */}
        {stepId === 'player' && formReady && (!consentWait || started) && <>
        {/* ---- 5. sliders on a light card (TRAK-229); each fill takes its band's colour ---- */}
        <div className="rounded-2xl bg-surface border border-line p-[14px_16px] space-y-5 tablet:space-y-0 tablet:grid tablet:grid-cols-2 tablet:gap-x-10 tablet:gap-y-5">
          <SliderInput label={t('coachAssess:sliderWorkRate')} value={workRate}     onChange={setWorkRate} disabled={!formReady || saving || consentWait} />
          <SliderInput label={t('coachHome:attributeTactical')} value={tactical}     onChange={setTactical} disabled={!formReady || saving || consentWait} />
          <SliderInput label={t('coachHome:attributeAttitude')} value={attitude}     onChange={setAttitude} disabled={!formReady || saving || consentWait} />
          <SliderInput label={t('coachHome:attributeTechnical')} value={technical}    onChange={setTechnical} disabled={!formReady || saving || consentWait} />
          <SliderInput label={t('coachHome:attributePhysical')} value={physical}     onChange={setPhysical} disabled={!formReady || saving || consentWait} />
          <SliderInput label={t('coachAssess:sliderCoachability')} value={coachability} onChange={setCoachability} disabled={!formReady || saving || consentWait} />
        </div>

        {/* ---- 6. overall band card, in the band's light tint (TRAK-229) ---- */}
        <div
          className="flex flex-col items-center gap-2 py-5 rounded-2xl"
          style={{
            background: `linear-gradient(${overallCfg.bg}, ${overallCfg.bg}), rgb(var(--t-surface))`,
            border: `1px solid ${overallCfg.border}`,
            boxShadow: `0 0 24px ${overallCfg.bg}`,
          }}
        >
          <span className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-3" style={{ fontFamily: 'var(--t-font-mono)' }}>
            {t('coachAssess:overallBand')}
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
            {bandWord(overallCfg.word)}
          </span>
          <span className="text-[13px] text-ink-2 font-medium">
            {(Math.round(avg * 10) / 10).toFixed(1)}
          </span>
        </div>

        </>}
        {stepId === 'notes' && asksObjectives && <div className="arc">
          {finalCheckIn ? <section aria-labelledby="assess-objectives" className="grid gap-3 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
              <h3 id="assess-objectives" className="text-lg font-medium text-ink">{t('coachAssess:stepObjectives')}</h3>
              <ul className="m-0 grid list-none gap-2 p-0">{finalCheckIn.map(row => <li key={row.player_objective_id ?? row.added_title} className="flex justify-between gap-3 text-sm text-ink">
                <span className="min-w-0">{row.added_title ?? row.player_objectives?.title}</span>
                <span className="shrink-0 text-ink-3">{row.added_title ? t('coachAssess:objectiveAdded') : isProgress(row.status) ? progressLabel(row.status) : ''}</span>
              </li>)}</ul>
            </section>
            : playerObjectives.isError || savedCheckIn.isError ? <LoadError what={t('coachAssess:stepObjectives')} onRetry={() => { void playerObjectives.refetch(); void savedCheckIn.refetch() }} />
            : playerObjectives.isPending || (!!openedRowId && savedCheckIn.isPending) ? <LoadingSkeleton label={t('coachAssess:stepObjectives')} lines={2} />
            : <ObjectivesSection name={firstName} open={openObjectives} entry={checkIn} onChange={setCheckIn} />}
        </div>}

        {stepId === 'notes' && <>
        {/* ---- 7. message to the player (K9, J5) ----
            Two boxes rather than one, because the schema has two tables and the
            coach needs to see which words the player will read. Nothing copies
            the private note into here. Parents see the bands only, never this
            message (TRAK-63, 25 Sep), so the label names the player alone. */}
        {/* TRAK-532: no message to the player where the squad's plan is shared (one Save). */}
        {!oneSave && <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-message" className="text-[9px] font-medium tracking-[0.12em] uppercase text-ink-2" style={{ fontFamily: 'var(--t-font-mono)' }}>
                {t('coachAssess:messageTo', { name: firstName })}
              </label>
              <p className="text-[10px] text-ink-3 mt-1" style={{ fontFamily: 'var(--t-font)' }}>
                {t('coachAssess:onlyNameSees', { name: firstName })}
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
            placeholder={t('coachAssess:messageExample')}
            // Blue: words the player reads. The private note is yellow and the
            // same size, so the two never look interchangeable (TRAK-72 item 7).
            data-tone="message"
            className="w-full px-4 py-3 rounded-xl bg-raised border border-line-strong text-sm text-ink outline-none resize-none placeholder:text-ink-3 disabled:opacity-40"
          />
          <p role="status" className="text-[10px] text-ink-3" style={{ fontFamily: 'var(--t-font)' }}>
            {liveUnchanged
              ? t('coachAssess:statusPublished', { name: firstName })
              : sharedPublished
                ? t('coachAssess:statusEdited', { name: firstName })
                : message
                  ? t('coachAssess:statusNotSent', { name: firstName })
                  : t('coachAssess:optional')}
          </p>
        </div>}

        {/* ---- 8. private note ----
            The label used to read "AI will expand these into personalised
            feedback for the player". K9 made that false: the note is private
            and no family role can read it. */}
        <div className="space-y-1.5 pt-4">
          <div className="flex justify-between items-center">
            <div>
              <label htmlFor="assess-note" className="text-[9px] font-medium tracking-[0.12em] uppercase text-warning" style={{ fontFamily: 'var(--t-font-mono)' }}>
                {t('coachAssess:privateNote')} <span className="text-ink-3">{t('coachAssess:optionalDash')}</span>
              </label>
              <p className="text-[10px] text-ink-3 mt-1" style={{ fontFamily: 'var(--t-font)' }}>
                {t('coachAssess:onlyYouCanSee')}
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
            placeholder={t('coachAssess:noteExample')}
            data-tone="private"
            className="w-full px-4 py-3 rounded-xl bg-warning/[0.08] border border-warning/40 text-sm text-ink outline-none resize-none placeholder:text-ink-3 disabled:opacity-40"
          />
        </div>

        </>}
        {/* ---- 9. review and save (TRAK-182) ---- */}
        {stepId === 'review' && <>
          <dl className="rounded-2xl border border-line divide-y divide-line text-[13px]">
            {([
              [t('nav:player'), selectedPlayer?.player_name ?? ''],
              // TRAK-500: only an opened row saved with a session or Started/Sub shows them.
              [t('coachAssess:sessionFallback'), openedSession ? sessionLabel(openedSession) : null],
              [t('coachAssess:appearance'), appearance ? appearanceWord(appearance) : null],
              [t('coachAssess:overall'), `${bandWord(overallCfg.word)} · ${(Math.round(avg * 10) / 10).toFixed(1)}`],
              [t('coachAssess:stepRatings'), t('coachAssess:ratingsLine', { workRate, tactical, attitude, technical, physical, coachability })],
              [t('coachAssess:stepObjectives'), !asksObjectives || !(finalCheckIn || playerObjectives.isSuccess) ? null
                : <ul aria-label={t('coachAssess:stepObjectives')} className="m-0 grid list-none gap-1 p-0">
                  {(finalCheckIn
                    ? finalCheckIn.map(row => [row.added_title ?? row.player_objectives?.title ?? '', row.added_title ? t('coachAssess:objectiveAdded') : isProgress(row.status) ? progressLabel(row.status) : ''] as const)
                    : [...openObjectives.map(o => [o.title, checkIn.progress[o.id] ? progressLabel(checkIn.progress[o.id]) : null] as const),
                      ...checkIn.add.map(title => [title, t('coachAssess:objectiveAdded')] as const)]
                  ).map(([title, answer]) => <li key={title} className="flex justify-between gap-3">
                    <span className="min-w-0">{title}</span>
                    <span className={answer === null ? 'shrink-0 text-warning' : 'shrink-0 text-ink-3'}>{answer ?? t('coachAssess:objectiveNoAnswer')}</span>
                  </li>)}
                </ul>],
              [t('coachAssess:messageTo', { name: firstName }), oneSave ? null : message || t('coachSchedule:none')],
              [t('coachAssess:privateNote'), <>{note.trim() || t('coachSchedule:none')}<span className="block mt-1 text-[11px] text-ink-3">{t('coachSquad:onlyYou')}</span></>],
            ] as const).filter(([, value]) => value !== null).map(([term, value]) => (
              <div key={term} className="flex gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-ink-3">{term}</dt>
                <dd className="text-ink break-words min-w-0 flex-1">{value}</dd>
              </div>
            ))}
          </dl>
          {objectivesMissing && <p className="mt-3 text-sm text-warning">{t('coachAssess:answerEachObjective')}</p>}
        </>}
        </fieldset>
        {/* Outside the consent-locked fieldset: retracting what the family can
            already read is always allowed, even while the form is locked. It
            sits with the message, and on the first step when consent locks the
            rest of the steps away (TRAK-182). */}
        {(stepId === 'notes' || (stepId === 'player' && consentWait)) && sharedPublished && existingId ? (
          <button
            type="button"
            onClick={() => void handleUnpublish()}
            disabled={saving || !formReady}
            className="w-full py-2.5 rounded-xl text-[11px] font-semibold text-ink-2 border border-line disabled:opacity-30"
          >
            {t('coachAssess:unpublishMessage')}
          </button>
        ) : null}
      </div>

      {/* TRAK-425: on a phone this page has its own Back and Next bar and the glass tab bar steps aside (BARLESS), as on Add
          session: one bar at the bottom, not two stacked. It clears the home indicator's inset. */}
      <div className="arc flex gap-2 px-5 pb-3 pt-2 mb-[env(safe-area-inset-bottom)] shrink-0 border-t border-line">
        {step === steps.length - 1 ? <>
          {/* Review: the decision sits where the thumb is; Back shrinks to an icon. */}
          <Button size="lg" variant="secondary" aria-label={t('coachSchedule:backTo', { step: steps[step - 1].label })} onClick={() => setStep(step - 1)}><ChevronLeft size={18} aria-hidden="true" /></Button>
          {/* Save draft only for a message the player hasn't got: on a published
              one it would take it back (Kostas, #313). That stays Unpublish's job. */}
          {!oneSave && message && !sharedPublished ? <>
            <Button size="lg" variant="secondary" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait || !objectivesReady || !planKnown} onClick={() => void handleSave(true)}>{t('coachSchedule:saveDraft')}</Button>
            <Button size="lg" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait || !objectivesReady || !planKnown} onClick={() => void handleSave()}>{t('coachHome:publish')}</Button>
          </> : (
            <Button size="lg" className="flex-1" loading={saving}
              disabled={!playerId || !formReady || consentWait || !objectivesReady || !planKnown} onClick={() => void handleSave()}>
              {!oneSave && message && !liveUnchanged ? t('coachHome:publish') : t('common:save')}
            </Button>
          )}
        </> : <>
          {/* Named for its step: the header's Back leaves the screen (TRAK-179). */}
          {step > 0 && <Button size="lg" variant="secondary" className="flex-1" aria-label={t('coachSchedule:backTo', { step: steps[step - 1].label })}
            onClick={() => setStep(step - 1)}>{t('common:back')}</Button>}
          {/* The first step opens only once the player can be assessed: the form below it stays locked otherwise. */}
          <Button size="lg" className="flex-1" disabled={(stepId === 'player' && !playerReady) || (stepId === 'notes' && !objectivesReady)}
            onClick={() => setStep(step + 1)}>{t('coachSchedule:next')}</Button>
        </>}
      </div>

      {/* ---- 10. bottom nav ---- */}
      {/* TRAK-254: "+ Create" in the side menu on a laptop; no "+" here on a phone. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" activeTab="/coach/assess" onNavigate={p => navigate(p)} />
    </div>
  )
}
