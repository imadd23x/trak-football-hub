import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, MetadataLabel, NavBar } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useFeature } from '@/components/trak/parked'
import { matchRating } from '@/lib/match-rating'
import { trackEvent } from '@/lib/telemetry'
import { validateMatchInput, teamGoalsViolation, teamAssistsViolation, MATCH_LIMITS } from '@/lib/match-input-rules'
import { localTodayISO } from '@/lib/event-time'
import { dateAsDay, dayAsDate } from '@/lib/coach-events'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { TRAINING_FOCUS, trainingTypeFrom } from '@/lib/training-focus'
import { trainingNotes, trainingTitle } from '@/lib/session-form'
import { SessionChip as Chip } from '@/components/coach/SessionChip'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Button } from '@/components/arc/button/button'
import { useCoachSquad } from '@/lib/coach-squad'

type SquadPlayer = {
  id: string
  player_name: string
  linked_player_id: string | null
  position: string | null
  age_group: string | null
  age: number | null
}

type Competition = 'League' | 'Cup' | 'Friendly'
type Venue      = 'Home' | 'Away'
type CardType   = 'None' | 'Yellow' | 'Red'

// Per-player match detail (full session only)
type PlayerDetail = {
  played:  boolean
  role:    'starter' | 'sub'
  /* J4: "no invented defaults". null means the coach has not said. Position
     starts from the roster (a fact, not a guess) and can be changed per match. */
  position: string | null
  /* Exact counts. These were once `0 | 1 | 2` with 2 meaning "2+", so a
     hat-trick was stored as 2 and the only vocabulary the form had was the
     rating bucket. The bucket still exists — match-input-keys.ts — but it is
     now derived for the rating engine rather than being the thing recorded. */
  goals:   number
  assists: number
  card:    CardType
}

/* J4: no invented defaults for position or age group. Goals and assists start
   at 0 (Kostas, 21 Oct): an empty "—" between the − and + buttons read as
   "− − +", and 0 is what most children score. The coach sees the 0 on every
   played row before saving. */
const DEFAULT_DETAIL: PlayerDetail = {
  played: false, role: 'starter', position: null,
  goals: 0, assists: 0, card: 'None',
}

const MATCH_POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] as const

/* TRAK-182 (Imad's 7c): one step per screen, related fields together, then
   Review and the save. A logged session or match has no draft in the database,
   so Review ends in one Save. */
const LOG_STEPS = {
  match:    ['Match', 'Squad', 'Notes', 'Review'],
  training: ['Session', 'Attendance', 'Notes', 'Review'],
  other:    ['Event', 'Attendance', 'Notes', 'Review'],
} as const
const RESULT_WORD = { W: 'Won', D: 'Drew', L: 'Lost' } as const

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** The roster's age group ('U14'), else the legacy integer age. Never invented. */
function rosterAgeGroup(p: SquadPlayer): string | null {
  return p.age_group ?? (p.age != null ? String(p.age) : null)
}

/** What still has to be entered before this child's match can be saved.
 *  No log asks minutes (TRAK-198; pilot coach's item 13, Imad 18 Oct). */
function missingFacts(p: SquadPlayer, d: PlayerDetail): string[] {
  const missing: string[] = []
  if (!d.position) missing.push('position')
  if (!rosterAgeGroup(p)) missing.push('age group on the roster')
  return missing
}

export default function CoachAddSession() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // TRAK-288: where Games is on, a match is evaluated on its game page, never logged here.
  const games = useFeature('games')
  // TRAK-182 part 8: the quick-add hands over a played match (opponent,
  // venue, score, date) and the log opens on Squad.
  const [quick] = useState(() => (location.state as { quickMatch?: {
    opponent: string; venue: 'Home' | 'Away'; scoreUs: string; scoreThem: string; date: string
  } } | null)?.quickMatch ?? null)
  // Read once, then cleared: a reload or Back must not reopen it prefilled (Tarek, #319).
  useEffect(() => {
    if (quick) navigate(location.pathname, { replace: true, state: null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  // Common
  /* Reached via /coach/sessions/quick? That entry point is the match one, so
     open on Match — otherwise the redirect would cost the coach the extra tap
     the quick log used to save. */
  const [type,  setType]  = useState<'training' | 'match' | 'other'>(
    () => (quick || window.location.pathname.endsWith('/sessions/quick') ? 'match' : 'training'),
  )
  /* TRAK-198 (16 Oct live-run call): grassroots coaches don't know minutes, so
     the match log asks goals, assists and cards only, and saves minutes as NULL,
     "not recorded". Since 18 Oct (pilot coach's item 13, Imad) that is every
     log, the full one included. */
  const stillNeeded = missingFacts
  const [title, setTitle] = useState('')
  // TRAK-127: New event's "log it instead" hands over the past day it was given.
  const [date,  setDate]  = useState(() => quick?.date
    ?? (location.state as { logDate?: string } | null)?.logDate ?? localTodayISO())
  const [notes, setNotes] = useState('')
  const [step,  setStep]  = useState(quick ? 1 : 0)

  // Training-specific
  const [trainingFocus,     setTrainingFocus]     = useState<Set<string>>(new Set())
  const [trainingIntensity, setTrainingIntensity] = useState('')
  const [trainingDuration,  setTrainingDuration]  = useState(60)

  // Pre-fill from Coach Assistant "Log this session" button
  useEffect(() => {
    const plan = (location.state as any)?.fromAssistant
    if (!plan) return
    setType('training')
    if (plan.focus?.length)  setTrainingFocus(new Set(plan.focus))
    if (plan.duration)       setTrainingDuration(plan.duration)
    if (plan.notes)          setNotes(plan.notes)
  }, [])

  // Match-only header
  const [opponent,    setOpponent]    = useState(quick?.opponent ?? '')
  const [scoreUs,     setScoreUs]     = useState(quick?.scoreUs ?? '')
  const [scoreThem,   setScoreThem]   = useState(quick?.scoreThem ?? '')
  const [competition, setCompetition] = useState<Competition>('League')
  const [venue,       setVenue]       = useState<Venue>(quick?.venue ?? 'Home')

  // TRAK-138 (J8.15): "Log match" on a schedule event that has kicked off
  // opens here with its date, opponent and home or away. The saved session
  // carries the event's id, so the event and its log are one item (16 Oct).
  const [fromEvent] = useState(() => (location.state as { fromEvent?: {
    eventId?: string | null, date?: string | null, opponent?: string | null, homeAway?: string | null, squad?: string | null
  } } | null)?.fromEvent ?? null)
  const eventId = fromEvent?.eventId ?? null
  // An event with no opponent recorded still lets the coach type one.
  const eventOpponent = eventId ? (fromEvent?.opponent?.trim() || null) : null
  // TRAK-176: a log of an event is for the event's squad; otherwise the squad
  // picked on Home. Null is the whole roster (a coach with one squad).
  const coachSquad = useCoachSquad(user?.id)
  const sessionSquad = eventId ? (fromEvent?.squad ?? null) : coachSquad.squad
  const squadKnown = !!eventId || coachSquad.ready
  useEffect(() => {
    if (!fromEvent) return
    setType('match')
    if (fromEvent.date) setDate(fromEvent.date)
    if (fromEvent.opponent) setOpponent(fromEvent.opponent)
    if (fromEvent.homeAway) setVenue(fromEvent.homeAway === 'away' ? 'Away' : 'Home')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  // Who the family said can't make it (J8.14). Null until read; a failed read
  // pre-marks nobody for the match, rather than guess who came.
  const [absent, setAbsent] = useState<Set<string> | null>(eventId ? null : new Set())
  const [absencesFailed, setAbsencesFailed] = useState(false)
  useEffect(() => {
    if (!eventId) return
    let stale = false
    supabase.from('event_absences').select('squad_player_id').eq('event_id', eventId)
      .then(({ data, error }) => {
        if (stale) return
        setAbsencesFailed(!!error)
        setAbsent(new Set((data ?? []).map(row => row.squad_player_id as string)))
      })
    return () => { stale = true }
  }, [eventId])

  // Squad
  const [squad,       setSquad]       = useState<SquadPlayer[]>([])
  const [notReady,    setNotReady]    = useState<string[]>([])
  const [rosterFailed,  setRosterFailed]  = useState(false)
  const [rosterAttempt, setRosterAttempt] = useState(0)
  const [details,     setDetails]     = useState<Record<string, PlayerDetail>>({})
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set())

  // Training/other — simple attendance
  const [attended,    setAttended]    = useState<Set<string>>(new Set())

  const [saving, setSaving] = useState(false)

  // Retry state (K5). A partial save used to be reported as a complete one, so
  // these exist to make a second press finish the job rather than duplicate it:
  // the session row is inserted once, attendance once, and each player's match
  // is logged once. Without them, "try again" would create a second session and
  // re-log every player who already succeeded.
  //
  // Known limit, stated rather than hidden: if the coach edits the score or
  // opponent between a partial save and the retry, the already-written session
  // row keeps the original values. The retry is meant for a transient failure
  // pressed again immediately. Re-writing the session on retry would be the
  // fuller fix; duplicating it would be worse than either.
  const [savedSessionId,   setSavedSessionId]   = useState<string | null>(null)
  const [attendanceSaved,  setAttendanceSaved]  = useState(false)
  const [loggedPlayerIds,  setLoggedPlayerIds]  = useState<Set<string>>(new Set())

  // The roster reloads whenever the session refreshes. Until a reload confirms
  // who is ready, Save waits (Tarek's #126 review).
  const [rosterLoading, setRosterLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    // A failed squads read is a failed roster (Retry asks again), never the whole roster.
    if (!eventId && coachSquad.failed) { setRosterFailed(true); setSquad([]); setNotReady([]); setRosterLoading(false); return }
    // Until the squad is known, the roster waits, and so does Save.
    if (!squadKnown) return
    // A later load supersedes this one; its late answers must not overwrite it.
    let superseded = false
    setRosterLoading(true)
    supabase
      .from('squad_players')
      .select('id, player_name, linked_player_id, position, age_group, age')
      .eq('coach_user_id', user.id)
      .order('player_name')
      .then(async ({ data, error }) => {
        if (superseded) return
        // A failed load is not an empty squad: say so, offer a retry, and offer
        // no players from an earlier load. Drafts stay for when a retry works.
        setRosterFailed(!!error)
        if (error) { setSquad([]); setNotReady([]); setRosterLoading(false); return }
        const players = (data ?? []).filter(p => sessionSquad == null || p.age_group?.trim() === sessionSquad)
        // J4 + G1: the database refuses any record about a child whose consent
        // is not confirmed, and one refused row fails the whole attendance
        // insert. Offer confirmed players only; name the rest. Same check as
        // the assess screen; a failed check counts as not confirmed.
        const required = await Promise.all(players.map(p =>
          supabase.rpc('coach_squad_player_consent_required' as never, { p_squad_player_id: p.id } as never)
            .then(({ data: r, error }) => (error || typeof r !== 'boolean' ? null : r))))
        if (superseded) return
        const ready = players.filter((_, i) => required[i] === false)
        const readyIds = new Set(ready.map(p => p.id))
        setNotReady(players.flatMap((p, i) => required[i] === false ? []
          : [`${p.player_name} (${required[i] ? 'waiting for a parent' : "consent couldn't be checked"})`]))
        setSquad(ready)
        // Keep what the coach entered for players still ready; drop the rest.
        setDetails(prev => Object.fromEntries(ready.map(p =>
          [p.id, prev[p.id] ?? { ...DEFAULT_DETAIL, position: p.position }])))
        setAttended(prev => new Set([...prev].filter(id => readyIds.has(id))))
        setRosterLoading(false)
      })
    return () => { superseded = true }
  }, [user, rosterAttempt, squadKnown, sessionSquad, eventId, coachSquad.failed])

  // TRAK-138: a register, not a pick list (Imad, 16 Oct). Once the first
  // roster is in, everyone ready counts as there and the coach taps who
  // wasn't. A match logged from its event marks them played, minus the
  // family's "Can't make it"; their facts are still typed (J4: no defaults).
  const [prefilled, setPrefilled] = useState(false)
  useEffect(() => {
    if (prefilled || rosterLoading || rosterFailed || absent === null) return
    setPrefilled(true)
    const there = squad.filter(p => !absent.has(p.id))
    setAttended(new Set(there.map(p => p.id)))
    if (eventId && !absencesFailed) {
      setDetails(prev => ({ ...prev, ...Object.fromEntries(there.map(p => [p.id, { ...prev[p.id], played: true }])) }))
    }
  }, [prefilled, rosterLoading, rosterFailed, absent, squad, eventId, absencesFailed])

  // A squad still loading is not an empty one (TRAK-72). Coaches don't add
  // players: the academy roster decides the squad (#164).
  const rosterEmpty = squad.length === 0 && notReady.length === 0 && !rosterFailed
  const rosterEmptyText = rosterLoading
    ? 'Loading your squad…'
    : 'No squad yet. Players appear here once your academy adds them.'

  // Under each player list: why nobody is offered, or who is left out and why.
  const rosterNote = rosterFailed ? (
    <p role="alert" className="text-[12px] text-ink-2 px-4 py-3" style={{ fontFamily: 'var(--t-font)' }}>
      Couldn't load your squad.{' '}
      <button type="button" onClick={() => { if (coachSquad.failed) coachSquad.retry(); setRosterAttempt(n => n + 1) }} className="underline text-brand">Retry</button>
    </p>
  ) : notReady.length > 0 && (
    <p className="text-[11px] text-ink-3 px-4 py-3" style={{ fontFamily: 'var(--t-font)' }}>
      Not recorded until a parent approves: {notReady.join(', ')}
    </p>
  )

  const isMatch = type === 'match'

  const result =
    scoreUs === '' || scoreThem === '' ? null
    : Number(scoreUs) > Number(scoreThem) ? 'W'
    : Number(scoreUs) < Number(scoreThem) ? 'L' : 'D'

  // ── detail helpers ───────────────────────────────────────────────────────────
  const setDetail = (id: string, patch: Partial<PlayerDetail>) =>
    setDetails(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const togglePlayed = (id: string) => {
    const wasPlayed = details[id]?.played
    setDetail(id, { played: !wasPlayed })
    if (!wasPlayed) {
      // Auto-expand when toggled on
      setExpanded(prev => { const n = new Set(prev); n.add(id); return n })
    } else {
      setExpanded(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const toggleExpanded = (id: string) =>
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) { n.delete(id) } else { n.add(id) }
      return n
    })

  /* TRAK-222: marks everyone as played and changes nothing else. It used to
     reset every row, so goals, assists and cards already entered were lost. */
  const setAllPlayed = () =>
    setDetails(prev => Object.fromEntries(squad.map(p =>
      [p.id, { ...(prev[p.id] ?? { ...DEFAULT_DETAIL, position: p.position }), played: true }])))

  const clearAll = () => {
    const none: Record<string, PlayerDetail> = {}
    squad.forEach(p => { none[p.id] = { ...DEFAULT_DETAIL, position: p.position } })
    setDetails(none)
    setExpanded(new Set())
  }

  const playedCount = Object.values(details).filter(d => d.played).length
  // Attendance goes out only for players in the latest confirmed roster.
  const present = squad.filter(p => attended.has(p.id))

  // ── validation ───────────────────────────────────────────────────────────────
  /* Only players marked as having played are checked, so a coach is never
     blocked by a bench row they did not open. A played row must be complete
     (J4: no invented defaults) before its numbers are checked for sense. */
  const incompleteRecords = !isMatch ? [] : squad
    .filter(p => details[p.id]?.played)
    .filter(p => stillNeeded(p, details[p.id]).length > 0)
  const impossibleRecords = !isMatch ? [] : squad
    .filter(p => details[p.id]?.played && stillNeeded(p, details[p.id]).length === 0)
    .filter(p => validateMatchInput({
      minutes: null,
      goals:   details[p.id].goals,
      assists: details[p.id].assists,
      teamScore: scoreUs === '' ? undefined : Number(scoreUs),
    }).length > 0)

  const teamGoalsError = !isMatch ? null : teamGoalsViolation(
    squad.filter(p => details[p.id]?.played).map(p => details[p.id].goals),
    scoreUs === '' ? undefined : Number(scoreUs),
  )
  const teamAssistsError = !isMatch ? null : teamAssistsViolation(
    squad.filter(p => details[p.id]?.played).map(p => details[p.id].assists),
    scoreUs === '' ? undefined : Number(scoreUs),
  )

  // J4 records what happened; planning ahead is the parked calendar (TRAK-67, TRAK-25).
  const futureDate = date > localTodayISO()

  // A failed roster is not an empty one: saving now would drop the players
  // the coach took (Tarek's #126 re-review).
  const canSave = !saving && !rosterLoading && !rosterFailed && !futureDate && incompleteRecords.length === 0 && impossibleRecords.length === 0 && !teamGoalsError && !teamAssistsError && (
    isMatch    ? opponent.trim().length > 0 && scoreUs !== '' && scoreThem !== ''
    : type === 'training' ? trainingFocus.size > 0
    : title.trim().length > 0
  )

  // ── steps (TRAK-182) ─────────────────────────────────────────────────────────
  const labels = LOG_STEPS[type]
  const steps = labels.map(label => ({ id: label.toLowerCase(), label }))
  const review = labels.length - 1
  const stepName = labels[step]
  // What the first step still needs, said under Next rather than left to guess.
  const firstStepMissing = isMatch
    ? (!opponent.trim() || scoreUs === '' || scoreThem === '' ? 'Add the opponent and the score.' : null)
    : type === 'training' ? (trainingFocus.size === 0 ? 'Pick a session focus.' : null)
    : (!title.trim() ? 'Add a title.' : null)
  const rosterReady = !rosterLoading && !rosterFailed
  // Each step's share of canSave: Next stays shut until that part is right.
  const stepBlocked = step === 0 ? !!firstStepMissing || futureDate
    : stepName === 'Squad' ? !rosterReady || incompleteRecords.length > 0 || impossibleRecords.length > 0 || !!teamGoalsError || !!teamAssistsError
    : stepName === 'Attendance' ? !rosterReady
    : false
  const shownDate = new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const firstNames = (players: SquadPlayer[]) => players.map(p => p.player_name.split(' ')[0]).join(', ')
  const played = squad.filter(p => details[p.id]?.played)
  const summary: [string, string][] = isMatch ? [
    ['Opponent', opponent.trim()],
    ['Score', result ? `${RESULT_WORD[result]} ${scoreUs}–${scoreThem}` : ''],
    ['Competition', competition],
    ['Venue', venue],
    ['Date', shownDate],
    ['Played', played.length ? `${played.length} · ${firstNames(played)}` : 'Nobody marked as played'],
    ['Notes', notes.trim() || 'None'],
  ] : type === 'training' ? [
    ['Focus', [...trainingFocus].join(', ')],
    ['Theme', title.trim() || 'None'],
    ['Date', shownDate],
    ['Length', `${trainingDuration} min`],
    ['Intensity', trainingIntensity || 'Not set'],
    ['Attended', `${present.length} of ${squad.length}`],
    ['Notes', notes.trim() || 'None'],
  ] : [
    ['Title', title.trim()],
    ['Date', shownDate],
    ['Attended', `${present.length} of ${squad.length}`],
    ['Notes', notes.trim() || 'None'],
  ]

  // ── save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user || !canSave) return
    setSaving(true)

    const sessionTitle = isMatch
      ? `vs ${opponent.trim()}`
      : type === 'training'
        ? trainingTitle(trainingFocus, title)
        : title.trim()

    const playedPlayers = squad.filter(p => details[p.id]?.played)
    // matches rows — only for linked players, deduplicated by linked_player_id
    // (guards against duplicate squad entries writing two match rows for the same player)
    const seenIds = new Set<string>()
    const linkedPlayers = playedPlayers.filter(p => {
      if (!p.linked_player_id) return false
      if (seenIds.has(p.linked_player_id)) return false
      seenIds.add(p.linked_player_id)
      return true
    })

    // TRAK-153: a match already saved with another score, or whose saved goals
    // (or assists, TRAK-167) plus these would pass the team's score, is refused by the database player
    // by player (TRAK-149), but only after the session and attendance below are
    // in, and a coach can't delete those. Ask first, and save nothing if the
    // answer is a clash or no answer came.
    if (isMatch) {
      // Only the rows this save will write count: a player already written on
      // an earlier attempt is in the saved goals and assists already.
      const toWrite = linkedPlayers.filter(p => !loggedPlayerIds.has(p.linked_player_id!))
      const newGoals = toWrite.reduce((sum, p) => sum + details[p.id].goals, 0)
      const newAssists = toWrite.reduce((sum, p) => sum + details[p.id].assists, 0)
      const { data: clash, error: clashErr } = await supabase.rpc('coach_match_score_clash', {
        p_match_date: date,
        p_opponent: opponent.trim(),
        p_team_score: Number(scoreUs) || 0,
        p_opponent_score: Number(scoreThem) || 0,
        p_goals: newGoals,
        p_assists: newAssists,
      })
      if (clashErr) {
        console.error('Match score check failed:', clashErr)
        toast.error("Couldn't check this match against the ones already saved. Nothing was saved; check your connection and save again.", { duration: 12000 })
        setSaving(false)
        return
      }
      const saved = clash?.[0]
      if (saved) {
        const sameScore = saved.team_score === (Number(scoreUs) || 0) && saved.opponent_score === (Number(scoreThem) || 0)
        const tooMany = (count: number, added: number, noun: string) =>
          `${sessionTitle} already has ${count} ${noun}${count === 1 ? '' : 's'} saved; with these it would be ${count + added}, but the team scored ${saved.team_score}. Nothing was saved.`
        toast.error(!sameScore
          ? `${sessionTitle} is already saved as ${saved.team_score}-${saved.opponent_score}; every player in it needs the same score. Nothing was saved.`
          : saved.saved_goals + newGoals > saved.team_score
            ? tooMany(saved.saved_goals, newGoals, 'goal')
            : tooMany(saved.saved_assists, newAssists, 'assist'),
          { duration: 12000 })
        setSaving(false)
        return
      }
    }

    // On a retry the session already exists; inserting again would give the
    // coach two identical sessions for one match.
    let sessionId = savedSessionId
    if (!sessionId) {
      const { data: session, error } = await supabase
      .from('coach_sessions')
      .insert({
        coach_user_id: user.id,
        title:         sessionTitle,
        session_type:  type,
        // The focus on its own, for the family's training history (TRAK-75).
        // Only the fixed labels; the coach's theme stays in the title.
        training_type: type === 'training' ? trainingTypeFrom(trainingFocus) : null,
        session_date:  date,
        squad:         sessionSquad,
        // TRAK-138: the event this log completes. One session per event is a
        // unique index, so a second log of it is refused below.
        ...(eventId && { event_id: eventId }),
        notes: type === 'training'
          ? trainingNotes(trainingDuration, trainingIntensity, notes)
          : notes || null,
        // coach_sessions has no `opponent` column — sending one made PostgREST
        // reject the whole insert, so every match save failed with "Could not
        // save session". The opponent already lives in the title ("vs X") and
        // on each player's match row.
        ...(isMatch && {
          competition,
          venue,
          notes: `${scoreUs}-${scoreThem}${notes ? ' · ' + notes : ''}`,
        }),
      })
      .select()
      .single()

      if (error?.code === '23505' && eventId) {
        toast.error('This match is already logged from its event. Nothing was saved; open it from Schedule to see it.', { duration: 12000 })
        setSaving(false)
        return
      }
      if (error || !session) {
        console.error('Session save failed:', error)
        toast.error(error?.message ? `Could not save: ${error.message}` : 'Could not save session')
        setSaving(false)
        return
      }
      sessionId = session.id
      setSavedSessionId(sessionId)
    }

    // Collected rather than thrown, so one player's rejection does not abandon
    // the rest. Reported by name at the end — silently dropping them is the bug.
    const failures: string[] = []
    // Refused by a database rule; pressing save again can't change the answer.
    const refusals: string[] = []

    if (isMatch) {
      // session_attendance
      if (playedPlayers.length > 0 && !attendanceSaved) {
        const { error: attErr } = await supabase.from('session_attendance').insert(
          playedPlayers.map(p => ({
            session_id:      sessionId,
            squad_player_id: p.id,
            status:          'present',
          }))
        )
        if (attErr) {
          console.error('Attendance save failed:', attErr)
          failures.push('attendance')
        } else {
          setAttendanceSaved(true)
        }
      }

      const nowLogged = new Set(loggedPlayerIds)
      for (const p of linkedPlayers) {
        // Already written on an earlier attempt — logging again would give the
        // child two match rows for one match.
        if (nowLogged.has(p.linked_player_id!)) continue
        const d = details[p.id]
        // canSave guarantees every played row is complete; these never fall back.
        const position = d.position as string
        const minutes = null
        const goals = d.goals
        const assists = d.assists
        const computed_rating = matchRating({
          position, competition, venue, opponent,
          scoreUs: Number(scoreUs) || 0, scoreThem: Number(scoreThem) || 0,
          card: d.card, goals, assists,
        })

        // The error was discarded here. A rejection — a departed coach, a
        // roster row in another academy, a lost connection — left the child
        // with no match row while the coach was told the match had saved.
        // K1/K2/F5 added legitimate reasons for this RPC to refuse, so the
        // silence got more dangerous, not less.
        const { error: rpcErr } = await supabase.rpc('log_match_for_player', {
          p_user_id:         p.linked_player_id!,
          p_opponent:        opponent.trim(),
          p_team_score:      Number(scoreUs)   || 0,
          p_opponent_score:  Number(scoreThem) || 0,
          p_competition:     competition,
          p_venue:           venue,
          p_position:        position,
          p_age_group:       rosterAgeGroup(p) as string,
          p_minutes_played:  minutes,
          // The real numbers. The rating key is a band; the record is not.
          p_goals:           goals,
          p_assists:         assists,
          p_card_received:   d.card,
          // Null, not 'Average'. These are the player's own account of the
          // match and this is a coach logging it — nobody asked the child how
          // they felt or how they rated themselves, so the record must not say
          // they answered. Both columns are nullable; the previous values were
          // invented for no reason.
          //
          // Score-neutral, deliberately: computeMatchScore only moves on
          // self_rating 'excellent'/'good'/'poor' and body_condition
          // 'fresh'/'tired'/'knock'. 'Average' and 'good' matched nothing and
          // contributed 0, so no existing or future rating changes. The engine
          // call above still passes its neutral values and is untouched.
          //
          // Cast because the generated types declare both as `string`: a
          // Postgres function parameter carries no nullability, so the
          // generator cannot know. The database accepts null and both columns
          // are nullable. Cast narrowly rather than `as any` on the call, so
          // the other fourteen arguments stay type-checked.
          p_body_condition:  null as unknown as string,
          p_self_rating:     null as unknown as string,
          p_computed_rating: computed_rating,
          p_match_date:      date,
          p_session_id:      sessionId,
        })

        if (rpcErr) {
          console.error(`Match log failed for ${p.player_name}:`, rpcErr)
          // TRAK-151: a rule refusal (P0001, or 42501 consent) carries a
          // sentence for the coach, and saving again gets the same answer, so
          // show it. The database names the child by id; the coach knows a name.
          if (rpcErr.code === 'P0001' || rpcErr.code === '42501') {
            refusals.push(`${p.player_name}: ${rpcErr.message.replace(UUID, p.player_name)}`)
          } else {
            failures.push(p.player_name)
          }
        } else {
          nowLogged.add(p.linked_player_id!)
        }
      }
      setLoggedPlayerIds(nowLogged)

      trackEvent('match_logged', {
        actor: 'coach',
        source: 'add_session',
        players: present.length,
        match_date: date,
        competition,
        venue,
      })
    } else {
      // Training / Other — simple attendance
      if (present.length > 0 && !attendanceSaved) {
        const { error: attErr } = await supabase.from('session_attendance').insert(
          present.map(({ id: squad_player_id }) => ({
            session_id: sessionId,
            squad_player_id,
            status: 'present',
          }))
        )
        if (attErr) {
          console.error('Attendance save failed:', attErr)
          failures.push('attendance')
        } else {
          setAttendanceSaved(true)
        }
      }
    }

    // Only claim success for what actually saved. The session row is in either
    // way, so the coach stays on this screen with their input intact and can
    // press save again; the guards above make that finish the job rather than
    // duplicate it.
    if (failures.length > 0 || refusals.length > 0) {
      const parts = [`Saved, but ${failures.length + refusals.length} of these did not record:`]
      if (refusals.length > 0) parts.push(`${refusals.join('; ')}.`)
      if (failures.length > 0) {
        parts.push(`${failures.join(', ')}. Press save again to retry just those — nothing will be duplicated.`)
      }
      toast.error(parts.join(' '), { duration: 12000 })
      setSaving(false)
      return
    }

    toast.success(isMatch ? 'Match saved' : 'Session saved')
    setSaving(false)
    navigate('/coach/sessions/list')
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <MobileShell width="read">
      {/* TRAK-288: an old link or Back that would open the match log goes to the match's evaluation, or to Games. */}
      {games && type === 'match' && <Navigate replace to={eventId ? `/coach/games/${eventId}?tab=evaluation` : '/coach/games'} />}
      {/* Topbar */}
      <div className="flex items-center justify-between pt-3 pb-2 border-b border-line">
        <button onClick={() => navigate(-1)} aria-label="Back"
          className="w-[34px] h-[34px] bg-raised border border-line rounded-[10px] flex items-center justify-center">
          <ChevronLeft size={14} className="text-ink" />
        </button>
        <span className="text-[16px] font-medium text-ink"
          style={{ fontFamily: 'var(--t-font)' }}>
          Full Session
        </span>
        <div className="w-[34px]" />
      </div>

      <div className="pt-5 pb-32 space-y-5">

        <div className="arc">
          <Stepper label="Log steps" steps={steps} current={step} onStepSelect={setStep} />
        </div>

        {/* Session type */}
        {step === 0 && <div className="rounded-[18px] p-4 border border-line bg-surface">
          <MetadataLabel text="TYPE" />
          <div className="flex gap-2 mt-3">
            {(games ? ['training', 'other'] as const : ['training', 'match', 'other'] as const).map(t => (
              <Chip key={t} active={type === t} onClick={() => setType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </div>}

        {/* ── MATCH TYPE ─────────────────────────────────────────────────────── */}
        {isMatch ? (
          <>
            {step === 0 && <>
            {/* Match header */}
            <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="OPPONENT" />
              {/* TRAK-235: a log of a planned match is that match, so its opponent
                  comes from the event; changing it belongs on the event. */}
              <input value={opponent} onChange={e => { if (!eventOpponent) setOpponent(e.target.value) }}
                aria-label="Opponent" readOnly={!!eventOpponent}
                placeholder="Opponent name"
                className="w-full bg-transparent text-[20px] text-ink placeholder-ink-3 outline-none mt-2"
                style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }} />
              {eventOpponent && <p className="mt-1 text-[12px] text-ink-3">From the planned match. To change it, edit the event.</p>}

              <div className="grid grid-cols-3 items-center gap-3 mt-5">
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>US</span>
                  <input inputMode="numeric" value={scoreUs}
                    onChange={e => setScoreUs(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="0"
                    className="w-full bg-ground border border-line rounded-[12px] py-3 text-center text-[28px] text-ink placeholder-ink-3 outline-none"
                    style={{ fontFamily: 'var(--t-font)' }} />
                </div>
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>RESULT</span>
                  <div className="w-full py-3 rounded-[12px] text-center text-[28px]"
                    style={{
                      fontFamily: 'var(--t-font)',
                      color: result === 'W' ? 'rgb(var(--t-brand))' : result === 'L' ? 'rgb(var(--t-ink-3))' : 'rgb(var(--t-ink-2))',
                    }}>
                    {result || '–'}
                  </div>
                </div>
                <div className="text-center">
                  <span className="block text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3 mb-2"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>THEM</span>
                  <input inputMode="numeric" value={scoreThem}
                    onChange={e => setScoreThem(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="0"
                    className="w-full bg-ground border border-line rounded-[12px] py-3 text-center text-[28px] text-ink placeholder-ink-3 outline-none"
                    style={{ fontFamily: 'var(--t-font)' }} />
                </div>
              </div>
            </div>

            {/* Competition + venue */}
            <div className="rounded-[18px] p-4 border border-line bg-surface space-y-4">
              <div>
                <MetadataLabel text="COMPETITION" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(['League', 'Cup', 'Friendly'] as const).map(c => (
                    <Chip key={c} active={competition === c} onClick={() => setCompetition(c)}>{c}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <MetadataLabel text="VENUE" />
                <div className="flex gap-2 mt-2">
                  {(['Home', 'Away'] as const).map(v => (
                    <Chip key={v} active={venue === v} onClick={() => setVenue(v)}>{v}</Chip>
                  ))}
                </div>
              </div>
            </div>

            {/* Date: the same Arc picker as Log training (TRAK-157, Imad 17 Oct: one picker everywhere). */}
            <div className="arc" style={{ fontFamily: 'var(--t-font)' }}>
              <DatePicker label="Session date" className="arc-trak-field" value={dayAsDate(date)} clearable={false}
                maxDate={dayAsDate(localTodayISO())} onChange={d => { if (d) setDate(dateAsDay(d)) }} placeholder="Pick a date"
                format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
            </div>

            </>}

            {/* ── Per-player section ─────────────────────────────────────────── */}
            {step === 1 && <div className="rounded-[18px] border border-line bg-surface overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  SQUAD · {playedCount} played
                </span>
                <div className="flex gap-3">
                  {/* TRAK-222: the log records no minutes, so the label doesn't promise 90. */}
                  <button onClick={setAllPlayed}
                    className="text-[10px] tracking-[0.12em] uppercase text-brand"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>
                    ALL PLAYED
                  </button>
                  <button onClick={clearAll}
                    className="text-[10px] tracking-[0.12em] uppercase text-ink-3"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>
                    CLEAR
                  </button>
                </div>
              </div>

              {rosterEmpty ? (
                <p role="status" className="px-4 pb-4 text-[12px] text-ink-3">
                  {rosterEmptyText}
                </p>
              ) : (
                <div className="divide-y divide-line">
                  {squad.map(p => {
                    const d = details[p.id] ?? DEFAULT_DETAIL
                    const isExpanded = expanded.has(p.id)

                    return (
                      <div key={p.id}>
                        {/* Player row header */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Played toggle */}
                          <button
                            onClick={() => togglePlayed(p.id)}
                            className="flex-shrink-0 w-[22px] h-[22px] rounded-full border transition-all"
                            style={{
                              background: d.played ? 'rgb(var(--t-brand))' : 'transparent',
                              borderColor: d.played ? 'rgb(var(--t-brand))' : 'rgb(var(--t-line-strong))',
                            }}
                            aria-label={d.played ? 'Remove' : 'Mark played'}
                          >
                            {d.played && (
                              <span style={{ display: 'block', textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'rgb(var(--t-on-brand))', lineHeight: '22px' }}>✓</span>
                            )}
                          </button>

                          {/* Name + position */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] truncate"
                              style={{ color: d.played ? 'rgb(var(--t-ink))' : 'rgb(var(--t-ink-3))', fontFamily: 'var(--t-font)' }}>
                              {p.player_name}
                            </p>
                          </div>

                          {/* Position + mins badge (when played) */}
                          {d.played && (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {d.position && (
                                <span className="text-[8px] tracking-[0.08em] uppercase text-ink-3 px-1.5 py-0.5 rounded-full"
                                  style={{ background: 'rgb(var(--t-raised))', fontFamily: 'var(--t-font-mono)' }}>
                                  {d.position}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Expand toggle (only when played) */}
                          {d.played && (
                            <button onClick={() => toggleExpanded(p.id)}
                              aria-label={`Details for ${p.player_name}`} aria-expanded={isExpanded}
                              className="flex-shrink-0 w-6 h-6 flex items-center justify-center"
                              style={{ color: 'rgb(var(--t-ink-3))' }}>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                        </div>

                        {/* Expanded detail */}
                        {d.played && isExpanded && (
                          <div className="px-4 pb-4 space-y-3"
                            style={{ background: 'rgb(var(--t-raised))' }}>

                            {/* Role (minutes are no longer asked: TRAK-198, item 13) */}
                            <div className="flex items-center gap-4">
                              {/* Role */}
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] tracking-[0.1em] uppercase text-ink-3 mr-0.5"
                                  style={{ fontFamily: 'var(--t-font-mono)' }}>ROLE</span>
                                {(['starter', 'sub'] as const).map(r => (
                                  <button key={r} onClick={() => setDetail(p.id, { role: r })}
                                    className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                    style={{
                                      background: d.role === r ? 'rgb(var(--t-brand) / 0.12)' : 'rgb(var(--t-raised))',
                                      color: d.role === r ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))',
                                      border: `1px solid ${d.role === r ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
                                      fontFamily: 'var(--t-font)',
                                    }}>
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                  </button>
                                ))}
                              </div>

                            </div>

                            {/* Position for this match. Starts from the roster; required. */}
                            <div className="flex items-center gap-2">
                              <span className="text-[8px] tracking-[0.1em] uppercase text-ink-3 w-[44px] flex-shrink-0"
                                style={{ fontFamily: 'var(--t-font-mono)' }}>POS</span>
                              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Position for ${p.player_name}`}>
                                {MATCH_POSITIONS.map(pos => (
                                  <button key={pos} type="button" aria-pressed={d.position === pos}
                                    onClick={() => setDetail(p.id, { position: pos })}
                                    className="px-2 py-1 rounded-full text-[10px] transition-colors"
                                    style={{
                                      background: d.position === pos ? 'rgb(var(--t-brand) / 0.12)' : 'rgb(var(--t-raised))',
                                      color: d.position === pos ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink-3))',
                                      border: `1px solid ${d.position === pos ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
                                      fontFamily: 'var(--t-font)',
                                    }}>
                                    {pos}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Goals and assists — steppers, not a 0/1/2+ picker.
                                The old control could not express a hat-trick: it
                                offered three buttons and stored "2+" as 2. */}
                            {([
                              { label: 'GOALS',   key: 'goals'   as const, value: d.goals,   max: MATCH_LIMITS.goalsMax },
                              { label: 'ASSISTS', key: 'assists' as const, value: d.assists, max: MATCH_LIMITS.assistsMax },
                            ]).map(({ label, key, value, max }) => (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-[8px] tracking-[0.1em] uppercase text-ink-3 w-[44px] flex-shrink-0"
                                  style={{ fontFamily: 'var(--t-font-mono)' }}>{label}</span>
                                <button
                                  aria-label={`One fewer ${key} for ${p.player_name}`}
                                  onClick={() => setDetail(p.id, { [key]: Math.max(0, value - 1) })}
                                  className="w-6 h-6 rounded-full bg-raised flex items-center justify-center text-ink-2 text-sm">−</button>
                                <span className="w-8 text-center text-[13px] text-ink"
                                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                                  {value}
                                </span>
                                <button
                                  aria-label={`One more ${key} for ${p.player_name}`}
                                  onClick={() => setDetail(p.id, { [key]: Math.min(max, value + 1) })}
                                  className="w-6 h-6 rounded-full bg-raised flex items-center justify-center text-ink-2 text-sm">+</button>
                              </div>
                            ))}

                            {/* Why a save will be refused, before the coach taps it.
                                The same rules run in the database, so this cannot
                                be the only place they are applied — but a coach
                                should not have to learn them from a rejection. */}
                            {(() => {
                              const missing = stillNeeded(p, d)
                              if (missing.length > 0) {
                                return (
                                  <p role="status" className="text-[10px] leading-snug text-warning pl-[52px]"
                                    style={{ fontFamily: 'var(--t-font)' }}>
                                    Still needed: {missing.join(', ')}.
                                  </p>
                                )
                              }
                              const problems = validateMatchInput({
                                minutes: null, goals: d.goals, assists: d.assists,
                                teamScore: scoreUs === '' ? undefined : Number(scoreUs),
                              })
                              if (problems.length === 0) return null
                              return (
                                <p role="alert" className="text-[10px] leading-snug text-danger pl-[52px]"
                                  style={{ fontFamily: 'var(--t-font)' }}>
                                  {problems[0].message}
                                </p>
                              )
                            })()}

                            {/* Card */}
                            <div className="flex items-center gap-2">
                              <span className="text-[8px] tracking-[0.1em] uppercase text-ink-3 w-[44px] flex-shrink-0"
                                style={{ fontFamily: 'var(--t-font-mono)' }}>CARD</span>
                              <div className="flex gap-1.5">
                                {(['None', 'Yellow', 'Red'] as const).map(c => (
                                  <button key={c} onClick={() => setDetail(p.id, { card: c })}
                                    className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                    style={{
                                      background: d.card === c
                                        ? c === 'Yellow' ? 'rgb(var(--t-warning) / 0.14)'
                                        : c === 'Red'    ? 'rgb(var(--t-danger) / 0.14)'
                                        : 'rgb(var(--t-brand) / 0.12)'
                                        : 'rgb(var(--t-raised))',
                                      color: d.card === c
                                        ? c === 'Yellow' ? 'rgb(var(--t-warning))'
                                        : c === 'Red'    ? 'rgb(var(--t-danger))'
                                        : 'rgb(var(--t-brand))'
                                        : 'rgb(var(--t-ink-3))',
                                      border: `1px solid ${d.card === c
                                        ? c === 'Yellow' ? 'rgb(var(--t-warning) / 0.3)'
                                        : c === 'Red'    ? 'rgb(var(--t-danger) / 0.3)'
                                        : 'rgb(var(--t-brand) / 0.3)'
                                        : 'rgb(var(--t-line))'}`,
                                      fontFamily: 'var(--t-font)',
                                    }}>
                                    {c}
                                  </button>
                                ))}
                              </div>
                            </div>

                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {rosterNote}
            </div>}

            {/* Match notes */}
            {step === 2 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="MATCH NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="How did the match go? Key moments, things to work on…"
                className="w-full bg-transparent text-[14px] text-ink placeholder-ink-3 outline-none resize-none mt-2"
                style={{ fontFamily: 'var(--t-font)' }} />
            </div>}
          </>
        ) : type === 'training' ? (
          /* ── TRAINING ──────────────────────────────────────────────────────── */
          <>
            {/* Session focus — required */}
            {step === 0 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="SESSION FOCUS" />
              <div className="grid grid-cols-2 gap-2 mt-3">
                {TRAINING_FOCUS.map(({ key, sub }) => {
                  const on = trainingFocus.has(key)
                  return (
                    <button key={key}
                      onClick={() => setTrainingFocus(prev => {
                        const n = new Set(prev)
                        if (n.has(key)) { n.delete(key) } else { n.add(key) }
                        return n
                      })}
                      className="text-left px-3 py-2.5 rounded-[12px] transition-colors"
                      style={{
                        background: on ? 'rgb(var(--t-brand) / 0.10)' : 'rgb(var(--t-raised))',
                        border: `1px solid ${on ? 'rgb(var(--t-brand) / 0.35)' : 'rgb(var(--t-line))'}`,
                      }}>
                      <p className="text-[13px] font-medium"
                        style={{ color: on ? 'rgb(var(--t-brand))' : 'rgb(var(--t-ink))', fontFamily: 'var(--t-font)' }}>
                        {key}
                      </p>
                      <p className="text-[9px] mt-0.5"
                        style={{ color: 'rgb(var(--t-ink-3))', fontFamily: 'var(--t-font-mono)', letterSpacing: '0.04em' }}>
                        {sub}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>}

            {/* Duration + Intensity on one card, on the Notes step (TRAK-182, live run 3: four steps, as a match) */}
            {step === 2 && <div className="rounded-[18px] p-4 border border-line bg-surface space-y-4">
              <div>
                <MetadataLabel text="DURATION" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[45, 60, 75, 90].map(d => (
                    <Chip key={d} active={trainingDuration === d} onClick={() => setTrainingDuration(d)}>
                      {d} min
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <MetadataLabel text="INTENSITY" />
                <div className="flex gap-2 mt-2">
                  {['Light', 'Medium', 'High'].map(lvl => (
                    <button key={lvl}
                      onClick={() => setTrainingIntensity(prev => prev === lvl ? '' : lvl)}
                      className="px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors"
                      style={{
                        background: trainingIntensity === lvl
                          ? lvl === 'High'   ? 'rgb(var(--t-danger) / 0.12)'
                          : lvl === 'Medium' ? 'rgb(var(--t-warning) / 0.12)'
                          : 'rgb(var(--t-info) / 0.12)'
                          : 'rgb(var(--t-raised))',
                        color: trainingIntensity === lvl
                          ? lvl === 'High'   ? 'rgb(var(--t-danger))'
                          : lvl === 'Medium' ? 'rgb(var(--t-warning))'
                          : 'rgb(var(--t-info))'
                          : 'rgb(var(--t-ink-3))',
                        border: `1px solid ${trainingIntensity === lvl
                          ? lvl === 'High'   ? 'rgb(var(--t-danger) / 0.3)'
                          : lvl === 'Medium' ? 'rgb(var(--t-warning) / 0.3)'
                          : 'rgb(var(--t-info) / 0.3)'
                          : 'rgb(var(--t-line))'}`,
                        fontFamily: 'var(--t-font)',
                      }}>
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
            </div>}

            {/* Optional theme / title */}
            {step === 0 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="THEME (OPTIONAL)" />
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Pressing triggers, Crossing & finishing…"
                className="w-full bg-transparent text-[15px] text-ink placeholder-ink-3 outline-none mt-2"
                style={{ fontFamily: 'var(--t-font)' }} />
            </div>}

            {/* Date: Arc's picker, as the event form (TRAK-157, 16 Oct: the native box was too big). Days after today can't be picked. */}
            {step === 0 && <div className="arc" style={{ fontFamily: 'var(--t-font)' }}>
              <DatePicker label="Session date" className="arc-trak-field" value={dayAsDate(date)} clearable={false}
                maxDate={dayAsDate(localTodayISO())} onChange={d => { if (d) setDate(dateAsDay(d)) }} placeholder="Pick a date"
                format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
            </div>}

            {/* Attendance */}
            {step === 1 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  ATTENDED · {present.length}/{squad.length}
                </span>
                <div className="flex gap-3">
                  <button onClick={() => setAttended(new Set(squad.map(p => p.id)))}
                    className="text-[10px] tracking-[0.12em] uppercase text-brand"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>ALL</button>
                  <button onClick={() => setAttended(new Set())}
                    className="text-[10px] tracking-[0.12em] uppercase text-ink-3"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>NONE</button>
                </div>
              </div>
              {rosterEmpty ? (
                <p role="status" className="text-[12px] text-ink-3 py-2">{rosterEmptyText}</p>
              ) : (
                <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2">
                  {squad.map(p => {
                    const on = attended.has(p.id)
                    return (
                      <button key={p.id}
                        onClick={() => setAttended(prev => { const n = new Set(prev); if (n.has(p.id)) { n.delete(p.id) } else { n.add(p.id) } return n })}
                        className="text-left px-3 py-2.5 rounded-[10px] transition-colors"
                        style={{
                          background: on ? 'rgb(var(--t-brand) / 0.08)' : 'rgb(var(--t-raised))',
                          border: `1px solid ${on ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
                          color: on ? 'rgb(var(--t-ink))' : 'rgb(var(--t-ink-2))',
                          fontFamily: 'var(--t-font)', fontSize: 13,
                        }}>
                        {p.player_name}
                      </button>
                    )
                  })}
                </div>
              )}
              {rosterNote}
            </div>}

            {/* Notes */}
            {step === 2 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="SESSION NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="What went well? What needs more work next session?"
                className="w-full bg-transparent text-[14px] text-ink placeholder-ink-3 outline-none resize-none mt-2"
                style={{ fontFamily: 'var(--t-font)' }} />
            </div>}
          </>
        ) : (
          /* ── OTHER ─────────────────────────────────────────────────────────── */
          <>
            {step === 0 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="TITLE" />
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Gym, Video Analysis, Team Talk…"
                className="w-full bg-transparent text-[16px] text-ink placeholder-ink-3 outline-none mt-2"
                style={{ fontFamily: 'var(--t-font)' }} />
            </div>}

            {/* Date: the same Arc picker as Log training (TRAK-157). */}
            {step === 0 && <div className="arc" style={{ fontFamily: 'var(--t-font)' }}>
              <DatePicker label="Session date" className="arc-trak-field" value={dayAsDate(date)} clearable={false}
                maxDate={dayAsDate(localTodayISO())} onChange={d => { if (d) setDate(dateAsDay(d)) }} placeholder="Pick a date"
                format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
            </div>}

            {step === 1 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-medium tracking-[0.14em] uppercase text-ink-3"
                  style={{ fontFamily: 'var(--t-font-mono)' }}>
                  ATTENDED · {present.length}/{squad.length}
                </span>
                <div className="flex gap-3">
                  <button onClick={() => setAttended(new Set(squad.map(p => p.id)))}
                    className="text-[10px] tracking-[0.12em] uppercase text-brand"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>ALL</button>
                  <button onClick={() => setAttended(new Set())}
                    className="text-[10px] tracking-[0.12em] uppercase text-ink-3"
                    style={{ fontFamily: 'var(--t-font-mono)' }}>NONE</button>
                </div>
              </div>
              {rosterEmpty ? (
                <p role="status" className="text-[12px] text-ink-3 py-2">{rosterEmptyText}</p>
              ) : (
                <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2">
                  {squad.map(p => {
                    const on = attended.has(p.id)
                    return (
                      <button key={p.id}
                        onClick={() => setAttended(prev => { const n = new Set(prev); if (n.has(p.id)) { n.delete(p.id) } else { n.add(p.id) } return n })}
                        className="text-left px-3 py-2.5 rounded-[10px] transition-colors"
                        style={{
                          background: on ? 'rgb(var(--t-brand) / 0.08)' : 'rgb(var(--t-raised))',
                          border: `1px solid ${on ? 'rgb(var(--t-brand) / 0.3)' : 'rgb(var(--t-line))'}`,
                          color: on ? 'rgb(var(--t-ink))' : 'rgb(var(--t-ink-2))',
                          fontFamily: 'var(--t-font)', fontSize: 13,
                        }}>
                        {p.player_name}
                      </button>
                    )
                  })}
                </div>
              )}
              {rosterNote}
            </div>}

            {step === 2 && <div className="rounded-[18px] p-4 border border-line bg-surface">
              <MetadataLabel text="NOTES" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Optional…"
                className="w-full bg-transparent text-[14px] text-ink placeholder-ink-3 outline-none resize-none mt-2"
                style={{ fontFamily: 'var(--t-font)' }} />
            </div>}
          </>
        )}

        {/* Review: everything the save writes, before it is written. */}
        {step === review && (
          <dl className="rounded-[18px] border border-line bg-surface divide-y divide-line text-[13px]"
            style={{ fontFamily: 'var(--t-font)' }}>
            {summary.map(([term, value]) => (
              <div key={term} className="flex gap-3 px-4 py-3">
                <dt className="w-24 shrink-0 text-ink-3">{term}</dt>
                <dd className="flex-1 min-w-0 text-ink break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {/* Why Save is off when the roster is the reason, with its Retry, here
            too: it used to show only on the step that lists the players (Tarek, #317). */}
        {step === review && (rosterFailed || rosterLoading) && (
          <div className="rounded-[18px] border border-line bg-surface">
            {rosterFailed ? rosterNote : (
              <p role="status" className="text-[12px] text-ink-2 px-4 py-3" style={{ fontFamily: 'var(--t-font)' }}>Loading your squad…</p>
            )}
          </div>
        )}
      </div>

      {/* Sticky save */}
      <div className="trak-page-bar fixed bottom-0 -translate-x-1/2 w-full px-5 pb-5 pt-3"
        style={{ background: 'linear-gradient(180deg,rgb(var(--t-ground) / 0) 0%,rgb(var(--t-ground)) 35%)' }}>
        {(step === 0 || step === review) && futureDate && (
          <p role="alert" className="text-[11px] text-center text-warning mb-2"
            style={{ fontFamily: 'var(--t-font)' }}>
            A session can't be dated in the future. Log it once it has happened.
          </p>
        )}
        {(stepName === 'Squad' || step === review) && teamGoalsError && (
          <p role="alert" className="text-[11px] text-center text-warning mb-2"
            style={{ fontFamily: 'var(--t-font)' }}>
            {teamGoalsError}
          </p>
        )}
        {(stepName === 'Squad' || step === review) && teamAssistsError && (
          <p role="alert" className="text-[11px] text-center text-warning mb-2"
            style={{ fontFamily: 'var(--t-font)' }}>
            {teamAssistsError}
          </p>
        )}
        {(stepName === 'Squad' || step === review) && incompleteRecords.length > 0 && (
          <p role="status" className="text-[11px] text-center text-warning mb-2"
            style={{ fontFamily: 'var(--t-font)' }}>
            {incompleteRecords.length === 1
              ? `${incompleteRecords[0].player_name} still needs ${stillNeeded(incompleteRecords[0], details[incompleteRecords[0].id]).join(', ')}.`
              : `${incompleteRecords.length} players still need their match details.`}
          </p>
        )}
        {step === 0 && firstStepMissing && (
          <p role="status" className="text-[11px] text-center text-ink-3 mb-2" style={{ fontFamily: 'var(--t-font)' }}>
            {firstStepMissing}
          </p>
        )}
        <div className="arc flex gap-2">
          {step === review ? <>
            {/* Review: the save sits where the thumb is; Back shrinks to an icon. */}
            <Button size="lg" variant="secondary" aria-label={`Back to ${labels[review - 1]}`} onClick={() => setStep(review - 1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
            <Button size="lg" className="flex-1" loading={saving} disabled={!canSave} onClick={() => void handleSave()}>
              {isMatch ? 'Save match' : 'Save session'}
            </Button>
          </> : <>
            {/* Named for its step: the header's button leaves the screen. */}
            {step > 0 && (
              <Button size="lg" variant="secondary" className="flex-1" aria-label={`Back to ${labels[step - 1]}`}
                onClick={() => setStep(step - 1)}>Back</Button>
            )}
            <Button size="lg" className="flex-1" disabled={stepBlocked} onClick={() => setStep(step + 1)}>Next</Button>
          </>}
        </div>
      </div>
      {/* TRAK-254: on a laptop this page keeps the side menu and "+ Create"; a phone shows neither here. */}
      <QuickAdd sideMenuOnly />
      <NavBar role="coach" sideMenuOnly activeTab="/coach/home" onNavigate={navigate} />
    </MobileShell>
  )
}
