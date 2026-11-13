import { useEffect, useState, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pencil, Send, Trash2, Ban, X, FileUp, ExternalLink, MapPin, ClipboardCheck, ClipboardList, CalendarDays } from 'lucide-react'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { ButtonGroup, type ButtonGroupItem } from '@/components/arc/button-group/button-group'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { EventSheet } from '@/components/trak/EventSheet'
import type { StripEvent } from '@/components/trak/WeekStrip'
import { EventSheetCoach } from '@/components/coach/EventSheetCoach'
import { LoggedAttendance } from '@/components/coach/LoggedAttendance'
import { toPlayerEvent } from '@/lib/player-events'
import { setCreateDay } from '@/lib/create-day'
import { isMapsUrl, joinVenue, splitVenue, venueParts } from '@/lib/venue-link'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { displayEventTime, localTodayISO, phoneClock, phoneEventTime } from '@/lib/event-time'
import { useCoachSquad } from '@/lib/coach-squad'
import { squadName } from '@/lib/coach-week'
import { askToEmailFamilies } from '@/lib/event-emails'
import { useAuth } from '@/contexts/AuthContext'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useGameEvaluations } from '@/components/coach/games/useGames'
import { useFeature, useParked } from '@/components/trak/parked'
import {
  CANCELLED_COLOR, COMPETITIONS, DURATIONS, clashMessage, draftClashes, EVENT_COLOR, lockedMessage, startedLocked, EVENT_KINDS, FAMILY_NOTE_MAX, NO_TIME_COLOR, WEEKDAYS, blankForm, blankRepeat, canDelete, cancelPatch, dateAsDay, dayAsDate, formatEventDay, formProblem, formToRow, newDraftFields,
  isCancelled, pastDateProblem, repeatProblem, rowToForm, savedVenues, seriesDates, seriesRows, thisAndFollowing, whatProblem,
  type Clash, type EventForm, type EventKind, type EventRow, type Repeat,
} from '@/lib/coach-events'
import { TRAINING_THEMES, catalogueLink, type TrainingTheme } from '@/lib/training-theme'
import { FixtureImport } from '@/components/coach/FixtureImport'
import { useOldLogRetired } from '@/components/coach/old-log'
import { DatePicker } from '@/components/arc/date-picker/date-picker'
import { Calendar } from '@/components/arc/calendar/calendar'
import { TimePicker } from '@/components/arc/time-picker/time-picker'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Button } from '@/components/arc/button/button'
import { FIXTURE_IMPORT_ENABLED, fixtureInsertRows, scheduleFixtureKeys } from '@/lib/fixture-import'
import type { Fixture } from '@/lib/fixtures-csv'
import { familyNoteProblem, shareableFromRow, squadLabelFrom, whatsAppShareText } from '@/lib/event-share'
import { ShareEventButton, ShareIcon } from '@/components/coach/ShareEventButton'
import { shareEventText } from '@/lib/share-event'
import { hasStarted, registerProblem } from '@/lib/event-register'
import { TakeRegister } from '@/components/coach/TakeRegister'
import { EventAbsences } from '@/components/coach/EventAbsences'
import { EventKitField } from '@/components/trak/kits/EventKitField'
import { EventSummary } from '@/components/coach/EventSummary'
import { describeEventKit } from '@/lib/kit-templates'
import { withAlpha } from '@/lib/with-alpha'
import { Chip, EventEditSheet, Field, ScopeChoice } from '@/components/coach/EventEditSheet'
import {
  KIND_LABEL, competitionProblem, failed, font, inSeries, inputClass, mono, pastProblem, type EditSheet, type Scope, NOTE_STEP,
} from '@/lib/event-edit'
import { useNotedTrainings } from '@/components/coach/training/useTraining'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { currentLanguage, i18n, useLanguage } from '@/lib/i18n'

/* TRAK-127 (J8.4): the coach creates, edits and cancels events. A save is a
   draft only the coach sees; Publish sends it to families (Imad, 9 Oct). Once
   published, an edit goes live on save. A cancel keeps the event on the
   schedule as Cancelled; only a draft nobody has seen can be deleted. The AI
   "Read Schedule" import is gone (G7): fixtures come in by CSV (J8.6).
   TRAK-128 (J8.5): a training repeats weekly until an end date, one row per
   date under one series_id. Editing, cancelling, publishing or deleting a
   week of a series asks: only this week, or this and following weeks.
   TRAK-138 (J8.15): once a training or "other" event has started, the coach
   takes its register here and it becomes the completed session; a match that
   has kicked off opens the J4 match log with its date and opponent. */

// ── Types ────────────────────────────────────────────────────────────────────

type ShownType = EventKind | 'tournament'

type CalEvent = {
  id: string
  title: string
  type: ShownType
  date: string        // YYYY-MM-DD
  time?: string       // HH:MM
  source: 'calendar' | 'session'
  row?: EventRow
  opponent?: string
  venue?: string
  /** Imad, 24 Oct: the squad it's for, named on the card when Schedule shows every squad. */
  squad?: string | null
}

// ── Colours ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<ShownType, string> = EVENT_COLOR
/** TRAK-255: the amber of "needs you" (a register to take, a match to log), as the calendar's corner. */
const NEEDS_YOU_COLOR = 'rgb(var(--t-attention))' // TRAK-270: a clear yellow, never text

const TYPE_LABEL: Record<ShownType, string> = { ...KIND_LABEL, tournament: 'Tournament' }
/** TRAK-407: each type's word in the language showing. */
const TYPE_WORD = { match: 'coachSchedule:kindMatch', training: 'coachSchedule:kindTraining', other: 'coachSchedule:kindOther', tournament: 'coachSchedule:kindTournament' } as const satisfies Record<ShownType, string>

// ── Calendar helpers ─────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  // Use LOCAL date parts — toISOString() converts to UTC, which shifts the
  // date back a day for users in timezones ahead of UTC (e.g. Europe), making
  // events land on the wrong calendar cell.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ── Component ────────────────────────────────────────────────────────────────

type Sheet =
  | { kind: 'closed' }
  | ({ kind: 'edit' } & EditSheet)
  | { kind: 'cancel'; row: EventRow; reason: string; scope: Scope; error: string | null }
  // TRAK-168: the event just cancelled, offered to the team group, and what was cancelled.
  | { kind: 'cancelled'; row: EventRow; note: string }
  | { kind: 'series'; action: 'publish' | 'delete'; row: EventRow; error: string | null }
  // TRAK-218: a series Publish the database refused; it stays until the coach closes it.
  | { kind: 'notPublished'; count: number; weeks: ClashingWeek[]; refusal: string }
  | { kind: 'import' }
  | { kind: 'register'; row: EventRow }

/** TRAK-218: the weeks of a refused series that clash, earliest first. */
type ClashingWeek = { date: string; clash: Clash }
function clashingWeeks(ids: string[], rows: EventRow[]): ClashingWeek[] {
  const clashes = draftClashes(rows)
  return rows.filter(r => ids.includes(r.id) && clashes.has(r.id))
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!))
    .map(r => ({ date: r.event_date!, clash: clashes.get(r.id)! }))
}
const overlapLine = ({ date, clash }: ClashingWeek) => i18n.t('coachSchedule:overlapLine', { day: formatEventDay(date), title: clash.title, start: clash.start, end: clash.end })
/** What to fix: the week's time, or the event it clashes with. */
function fixLine(weeks: ClashingWeek[]) {
  const titles = [...new Set(weeks.map(w => w.clash.title))]
  return i18n.t(weeks.length > 1 ? 'coachSchedule:fixMany' : 'coachSchedule:fixOne', { what: titles.length === 1 ? titles[0] : i18n.t('coachSchedule:whatTheyOverlap') })
}

export default function CoachSchedule() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  // TRAK-407: the words, in the language showing.
  const { t } = useLanguage()
  /** The database's refusals, said in the language showing where Trak knows them. */
  const locked = (error: unknown) => lockedMessage(error) && t('coachSchedule:startedLocked')
  const games = useFeature('games')
  const trainingOn = useFeature('training')
  const { retired: oldLogRetired } = useOldLogRetired()
  // TRAK-289: a published evaluation is final, so its match opens the review, never the match log's editor.
  const evaluations = useGameEvaluations(games)
  const navigate = useNavigate()
  // TRAK-275: a card's actions carry words only where the side menu shows (a laptop).
  const wide = useSideMenuScreen()
  const { user, profile } = useAuth()
  // TRAK-176: the squad picked; its events and the whole-roster ones show, and new ones are saved for it.
  const coachSquad = useCoachSquad(user?.id)
  // TRAK-305: All or one squad, as picked at the top of the frame (Imad, 24 Oct: never another squad's events hidden
  // without saying so). A new event's squad is chosen in its form.
  const { everySquad } = coachSquad
  const inView = (squad: string | null | undefined) => everySquad || coachSquad.eventInSquad(squad)

  // Calendar view state
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected,  setSelected]  = useState<string>(toDateStr(today))
  useEffect(() => { setCreateDay(selected); return () => setCreateDay(null) }, [selected])

  // Data
  const [calEvents, setCalEvents] = useState<EventRow[]>([])
  // Every squad's events: the overlap rule is per coach, not per squad (TRAK-218).
  const [coachEvents, setCoachEvents] = useState<EventRow[]>([])
  const [sessions,  setSessions]  = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  // TRAK-335: until the first read answers, the day shows a skeleton, not "Nothing planned".
  const [loaded, setLoaded] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const [sheet, setSheet] = useState<Sheet>({ kind: 'closed' })
  const [saving, setSaving] = useState(false)

  /** Reads the calendar; returns the coach's events, or null when the read failed. */
  const loadData = async (): Promise<EventRow[] | null> => {
    if (!user) return null
    const [ev, sess] = await Promise.all([
      supabase.from('coach_calendar_events')
        .select('*').eq('coach_user_id', user.id).order('starts_at'),
      supabase.from('coach_sessions')
        // coach_sessions has no opponent column; naming one failed the whole read.
        .select('id, title, session_type, session_date, competition, venue, notes, event_id, squad')
        .eq('coach_user_id', user.id).order('session_date'),
    ])
    // A failed read is not an empty calendar (the J4 standard).
    setLoadFailed(!!ev.error || !!sess.error)
    const events = ev.error ? null : (ev.data as EventRow[]) || []
    if (events) {
      setCoachEvents(events)
      setCalEvents(events.filter(e => inView(e.squad)))
      setLoaded(true)
    }
    if (!sess.error) setSessions((sess.data || []).filter(s => inView(s.squad)))
    return events
  }

  useEffect(() => { loadData() }, [user, coachSquad.squad, everySquad])

  // TRAK-139 (J8.16): the squad for the WhatsApp message title ("U15 Match"),
  // and its children's names, so coach-typed text naming one stays out.
  // Optional: a failed read leaves "Squad" and no reason, and never blocks
  // the calendar.
  const [squad, setSquad] = useState<{ label: string, childNames: string[] | null }>({ label: t('nav:squad'), childNames: null })
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase.from('squad_players').select('age_group, player_name, status').eq('coach_user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled || error) return
        const rows = (data ?? []) as { age_group: string | null, player_name: string | null, status: string | null }[]
        setSquad({ label: squadLabelFrom(rows), childNames: rows.map(r => r.player_name ?? '').filter(Boolean) })
      })
    return () => { cancelled = true }
  }, [user])
  const retry = async () => { setRetrying(true); await loadData(); setRetrying(false) }

  // Normalise both data sources into CalEvent[]
  const allEvents = useMemo<CalEvent[]>(() => {
    const ev: CalEvent[] = []
    for (const e of calEvents) {
      // Imad, 23 Oct: shown on this phone's clock; the form and saves keep the academy's.
      const shown = phoneEventTime(e)
      ev.push({
        id:       e.id,
        title:    e.title,
        type:     (e.event_type in TYPE_LABEL ? e.event_type : 'other') as ShownType,
        date:     shown.date,
        // undefined rather than null keeps the existing "no time set" rendering.
        time:     shown.time ?? undefined,
        source:   'calendar',
        row:      e,
        opponent: e.opponent ?? undefined,
        venue:    e.venue ?? undefined,
        squad:    e.squad ?? null,
      })
    }
    for (const s of sessions) {
      // A register's session is shown on its event, not as a second entry.
      if (s.event_id && calEvents.some(e => e.id === s.event_id)) continue
      ev.push({
        id:       s.id,
        title:    s.title || (s.session_type === 'match' ? t('coachSchedule:kindMatch') : t('coachSchedule:kindTraining')),
        type:     (s.session_type === 'match' ? 'match' : s.session_type === 'training' ? 'training' : 'other') as ShownType,
        date:     s.session_date ?? '',
        source:   'session',
        squad:    s.squad ?? null,
        venue:    s.venue,
      })
    }
    return ev.filter(e => e.date)
  }, [calEvents, sessions, t])

  // TRAK-138: the completed session each event's register made, by event.
  const registerSession = useMemo(() => new Map<string, string>(
    sessions.filter(s => s.event_id).map(s => [s.event_id as string, s.id as string])), [sessions])

  const venues = useMemo(() => savedVenues(calEvents), [calEvents])
  // TRAK-218: each draft that would be refused says so, before Publish is tapped.
  const clashes = useMemo(() => draftClashes(coachEvents), [coachEvents])
  // TRAK-129 (J8.6): fixtures already on the schedule are skipped on import.
  const fixtureKeys = useMemo(() => scheduleFixtureKeys(calEvents), [calEvents])

  // Index events by date string for fast lookup
  const byDate = useMemo<Record<string, CalEvent[]>>(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [allEvents])


  const selectedEvents = byDate[selected] ?? []

  // TRAK-272: each card's sheet trigger (its title), so a tap anywhere on the card opens it.
  const cardTriggers = useRef(new Map<string, HTMLButtonElement>())

  // TRAK-255: a day waits for the coach while an event that has started has no register (training,
  // other) or no match log (match): the same rules as its Take register and Log match buttons.
  const noted = useNotedTrainings()
  const needsYou = useMemo(() => {
    const days = new Set<string>()
    for (const e of allEvents) {
      const r = e.row
      if (!r || !r.published || isCancelled(r) || registerSession.has(r.id) || !hasStarted(r) || noted.has(r.id)) continue
      if (r.event_type === 'match' || !registerProblem(r)) days.add(e.date)
    }
    return days
  }, [allEvents, registerSession, noted])

  // TRAK-182 (live run 3): an edit opens on the first step, filled in, not on Review.
  const openEdit = (row: EventRow, step = 0) =>
    setSheet({ kind: 'edit', row, form: rowToForm(row), repeat: blankRepeat(''), scope: 'one', step, error: null })
  /** `evaluate`: a match already played (TRAK-288), published and opened on its evaluation. */
  const saveEvent = async (publishNow = false, evaluate = false) => {
    if (parked) return comingSoon()
    if (!user || sheet.kind !== 'edit') return
    const { row: editing, form, repeat, scope } = sheet
    const problem = formProblem(form) ?? competitionProblem(form, editing, games) ?? pastProblem(form, editing, games, trainingOn)
      ?? (editing || evaluate ? null : repeatProblem(form, repeat))
    if (problem) { setSheet({ ...sheet, error: problem }); return }

    // This and following weeks: each week keeps its own date and takes the rest.
    if (editing && scope === 'following' && inSeries(editing)) {
      if (form.date !== rowToForm(editing).date) {
        setSheet({ ...sheet, error: t('coachSchedule:moveDayOnlyThisWeek') })
        return
      }
      const targets = thisAndFollowing(calEvents, editing)
      setSaving(true)
      const results = await Promise.all(targets.map(t =>
        supabase.from('coach_calendar_events')
          .update(formToRow({ ...form, date: displayEventTime(t).date })).eq('id', t.id).select('id')))
      setSaving(false)
      loadData()
      // Even a partial save may have changed a published week (TRAK-135).
      if (targets.some(t => t.published)) askToEmailFamilies()
      const saved = results.filter(r => !failed(r.error, r.data)).length
      if (saved < targets.length) {
        // Saving again rewrites every week the same way, so it is safe to retry;
        // a week refused for a clash needs the time changed first.
        const clash = results.map(r => clashMessage(r.error) ?? locked(r.error)).find(Boolean)
        setSheet({ ...sheet, error: t('coachSchedule:savedSomeWeeks', { saved, total: targets.length, why: clash || t('coachSchedule:checkAndSave') }) })
        return
      }
      setSheet({ kind: 'closed' })
      if (publishNow) return publishSaved(targets.filter(t => !t.published && t.status === 'scheduled').map(t => t.id))
      toast.success(t('coachSchedule:savedWeeks', { count: saved }) + (targets.some(week => week.published) ? t('coachSchedule:familiesSeeSuffix') : ''))
      return
    }

    if (!editing && !coachSquad.ready) { setSheet({ ...sheet, error: coachSquad.retry() }); return }
    setSaving(true)
    const fresh = newDraftFields(user.id, form.squad === undefined ? coachSquad.squad : form.squad)
    // `evaluate`: a match or training already held is one event, never a series (TRAK-426).
    const series = !editing && repeat.on && form.kind !== 'match' && !evaluate
    const rows = series
      ? seriesRows(form, repeat, crypto.randomUUID()).map(r => ({ ...r, ...fresh }))
      : [{ ...formToRow(form), ...fresh }]
    // New events start as drafts; an edit leaves published alone, so a
    // published event's change goes live on save.
    const { data, error } = editing
      ? await supabase.from('coach_calendar_events').update(formToRow(form)).eq('id', editing.id).select('id')
      : await supabase.from('coach_calendar_events').insert(rows).select('id')
    setSaving(false)
    // Errors keep what was typed and say what failed (the J4 standard). A
    // series is one insert, so it saves whole or not at all.
    if (failed(error, data) || (!editing && data!.length !== rows.length)) { setSheet({ ...sheet, error: clashMessage(error) ?? (locked(error) || t('coachSchedule:saveFailed')) }); return }
    setSheet({ kind: 'closed' })
    setSelected(form.date)
    if (publishNow && !editing?.published) return publishSaved(editing ? [editing.id] : data!.map(r => r.id), form.kind, evaluate)
    loadData()
    if (editing?.published) askToEmailFamilies()
    toast.success(editing
      ? editing.published ? t('coachSchedule:savedFamiliesSee') : t('coachSchedule:draftSaved')
      : series ? t('coachSchedule:savedSeriesDrafts', { count: rows.length })
        : t('coachSchedule:savedDraft'))
  }

  /** TRAK-283: with Games on, a match just published offers its next step, which opens its game page. */
  const publishedToast = (text: string, matchId?: string) => toast.success(text, games && matchId
    ? { duration: 10_000, action: { label: t('coachHome:writeGamePlan'), onClick: () => navigate(`/coach/matches/${matchId}?tab=plan`) } }
    : undefined)

  /** Review's Publish: what was just saved goes out, as the list's Publish does.
      The save stands either way; a refused publish (a clash, TRAK-158) leaves
      drafts, published later from the list. */
  const publishSaved = async (ids: string[], kind?: EventKind, evaluate = false) => {
    const { data, error } = await supabase.from('coach_calendar_events').update({ published: true }).in('id', ids).select('id')
    const rows = await loadData()
    // TRAK-218: one update, so a refusal publishes none of the series. Say
    // which week clashes in a box that stays, not a toast that goes.
    const refusal = clashMessage(error)
    if (ids.length > 1 && refusal) {
      setSheet({ kind: 'notPublished', count: ids.length, weeks: clashingWeeks(ids, rows ?? []), refusal })
      return
    }
    if (failed(error, data)) {
      toast.error(t('coachSchedule:savedNotPublished', { count: ids.length, why: clashMessage(error) ?? t('coachSchedule:tapPublishAgain') }))
      return
    }
    askToEmailFamilies() // TRAK-135: publishing emails families too; never for one that has started
    // TRAK-288: a game with an empty plan, straight to its evaluation. TRAK-426: a training already held, straight to
    // its register (Who's here) on its own page.
    if (evaluate) return navigate(kind === 'training' ? `/coach/training/${ids[0]}/here` : `/coach/matches/${ids[0]}?tab=evaluation`)
    publishedToast(ids.length > 1 ? t('coachSchedule:publishedMany', { count: ids.length }) : t('coachHome:publishedToSquad'), ids.length === 1 && kind === 'match' ? ids[0] : undefined)
  }

  const publish = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'publish', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events')
      .update({ published: true }).eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(clashMessage(error) ?? t('coachSchedule:couldntPublish', { title: row.title })); return }
    askToEmailFamilies() // TRAK-135
    loadData()
    publishedToast(t('coachHome:publishedToSquad'), row.event_type === 'match' ? row.id : undefined)
  }

  // TRAK-182 part 8: the quick-add's "More details" opens a new event here
  // with what the coach typed, on its first step.
  const location = useLocation()
  useEffect(() => {
    const quick = (location.state as { quickEvent?: Partial<EventForm> } | null)?.quickEvent
    if (!quick) return
    const date = quick.date || toDateStr(new Date())
    setSelected(date)
    setSheet({ kind: 'edit', row: null, form: { ...blankForm(date), squad: coachSquad.squad, ...quick }, repeat: blankRepeat(date), scope: 'one', step: 0, error: null })
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps -- on arrival, and on a new hand-over while here

  // TRAK-182: the event sheet on Home sends Edit (?edit=<id>), Cancel
  // (?cancel=<id>) and a weekly series' Publish (?publish=<id>, which asks
  // this week or following) here, to Schedule's own sheets. TRAK-232: the
  // coach's bell sends ?event=<id>, which only opens that event's day.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const action = (['edit', 'publish', 'cancel', 'register', 'event'] as const).find(a => params.has(a))
    const row = action ? calEvents.find(r => r.id === params.get(action)) : undefined
    if (!row) return
    setParams({}, { replace: true })
    if (row.event_date) {
      const [y, m] = row.event_date.split('-').map(Number)
      setViewYear(y); setViewMonth(m - 1); setSelected(row.event_date)
    }
    // TRAK-230: a started event isn't edited or cancelled, whatever the link says.
    if ((action === 'edit' || action === 'cancel') && startedLocked(row)) toast.error(t('coachSchedule:startedLocked'))
    // TRAK-367: Training's message line opens the form at the note (?step=).
    else if (action === 'edit') openEdit(row, params.get('step') === String(NOTE_STEP) ? NOTE_STEP : 0)
    else if (action === 'cancel') setSheet({ kind: 'cancel', row, reason: '', scope: 'one', error: null })
    // The quick-add's Take register (TRAK-182 part 8): only when it can open.
    else if (action === 'register') { if (!registerProblem(row)) setSheet({ kind: 'register', row }) }
    else if (action === 'publish') void publish(row)
  }, [calEvents, params]) // eslint-disable-line react-hooks/exhaustive-deps -- once the rows load, and on a new link while here

  const confirmCancel = async () => {
    if (parked) return comingSoon()
    if (sheet.kind !== 'cancel') return
    const { row, scope } = sheet
    setSaving(true)
    const following = scope === 'following' && inSeries(row)
    const update = supabase.from('coach_calendar_events').update(cancelPatch(sheet.reason))
    // This and following: cancel only what families have seen. A draft week
    // cancelled would be stuck on the schedule (only drafts can be deleted),
    // so the drafts in the range are deleted instead.
    const { data, error } = following
      ? await update.eq('series_id', row.series_id).gte('event_date', row.event_date)
          .eq('status', 'scheduled').eq('published', true).select('id')
      : await update.eq('id', row.id).select('id')
    if (failed(error, data)) {
      setSaving(false)
      setSheet({ ...sheet, error: locked(error) || t('coachSchedule:couldntCancel') })
      return
    }
    // Zero drafts is normal here, so only an error counts as a failure.
    const { data: removedDrafts, error: draftError } = following
      ? await supabase.from('coach_calendar_events').delete().eq('series_id', row.series_id)
          .gte('event_date', row.event_date).eq('published', false).eq('status', 'scheduled').select('id')
      : { data: null, error: null }
    setSaving(false)
    loadData()
    // A cancelled published event emails its families (TRAK-135); "this and
    // following" may reach published weeks after a draft one.
    if (row.published || following) askToEmailFamilies()
    if (draftError) {
      setSheet({ ...sheet, error: t('coachSchedule:cancelledButDrafts', { count: data!.length }) })
      return
    }
    const removed = removedDrafts?.length ?? 0
    const note = (data!.length > 1
      ? t('coachSchedule:cancelledMany', { count: data!.length })
      : t('coachSchedule:cancelledOne'))
      + (removed ? t('coachSchedule:draftsRemoved', { count: removed }) : '')
    // TRAK-168 (Imad, 17 and 18 Oct): after cancelling, the coach tells the team
    // group, so the cancelled published event is offered straight to share.
    // "This and following" shares this week's event only; later weeks get no message.
    if (row.published) {
      setSheet({ kind: 'cancelled', row: { ...row, ...cancelPatch(sheet.reason) }, note })
      return
    }
    setSheet({ kind: 'closed' })
    toast.success(note)
  }

  /** Publish or delete a week of a series: only this week, or this and following. */
  const seriesAction = async (scope: Scope) => {
    if (parked) return comingSoon()
    if (sheet.kind !== 'series' || !inSeries(sheet.row)) return
    const { action, row } = sheet
    const table = supabase.from('coach_calendar_events')
    const query = action === 'publish' ? table.update({ published: true }) : table.delete()
    // Only drafts still scheduled: a published week is never deleted, and a
    // cancelled one stays as it is.
    const { data, error } = scope === 'one'
      ? await query.eq('id', row.id).select('id')
      : await query.eq('series_id', row.series_id).gte('event_date', row.event_date)
          .eq('published', false).eq('status', 'scheduled').select('id')
    if (failed(error, data)) {
      // TRAK-218: a refused "this and following" publishes none; name the week that clashes.
      const drafts = coachEvents.filter(r => r.series_id === row.series_id && r.event_date! >= row.event_date
        && !r.published && r.status === 'scheduled')
      const weeks = scope === 'following' && clashMessage(error) ? clashingWeeks(drafts.map(r => r.id), coachEvents) : []
      setSheet({ ...sheet, error: weeks.length
        ? t('coachSchedule:noneDraftsWentOut', { count: drafts.length, weeks: weeks.map(overlapLine).join(' '), fix: fixLine(weeks) + t('coachSchedule:thenPublishAgain') })
        : clashMessage(error) ?? t(action === 'publish' ? 'coachSchedule:couldntPublishCheck' : 'coachSchedule:couldntDeleteCheck', { title: row.title }) })
      return
    }
    setSheet({ kind: 'closed' })
    if (action === 'publish') askToEmailFamilies() // TRAK-135: the series is one email per person
    loadData()
    const n = data!.length
    toast.success(action === 'publish'
      ? n > 1 ? t('coachSchedule:publishedMany', { count: n }) : t('coachHome:publishedToSquad')
      : n > 1 ? t('coachSchedule:deletedMany', { count: n }) : t('coachSchedule:draftDeleted'))
  }

  const deleteDraft = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (!canDelete(row)) return
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'delete', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events').delete().eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(t('coachSchedule:couldntDelete', { title: row.title })); return }
    if (sheet.kind === 'edit' && sheet.row?.id === row.id) setSheet({ kind: 'closed' })
    loadData()
    toast.success(t('coachSchedule:draftDeleted'))
  }

  // TRAK-129 (J8.6): one insert for the whole file, so it saves whole or not
  // at all. FixtureImport keeps every row and says so if this throws.
  const importFixtures = async (fixtures: Fixture[]) => {
    if (!user) throw new Error(t('coachSchedule:notSignedIn'))
    if (!coachSquad.ready) throw new Error(coachSquad.retry())
    const rows = fixtureInsertRows(fixtures, user.id).map(row => ({ ...row, squad: coachSquad.squad }))
    const { data, error } = await supabase.from('coach_calendar_events').insert(rows).select('id')
    if (error || (data?.length ?? 0) !== rows.length) throw new Error(t('coachSchedule:couldntSaveFixtures'))
    toast.success(t('coachSchedule:addedFixtures', { count: rows.length }))
    await loadData()
  }

  return (
    <MobileShell width="wide">
      <div className="pt-3 pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* TRAK-376 (Imad, 5 Nov): on a phone the avatar opens the side menu, where the squad picker is. */}
            <CoachMenuButton name={profile?.full_name || t('nav:coach')} />
            {/* TRAK-424: no Back beside the avatar, as on every other main page; Schedule opens from Home's calendar icon. */}
            <h1 className="text-[22px] font-light text-ink tracking-tight"
              style={{ ...font, letterSpacing: '-0.02em' }}>
              {t('nav:events')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* TRAK-162: the CSV import is parked; no coach is offered it. */}
            {FIXTURE_IMPORT_ENABLED && <button
              onClick={() => (parked ? comingSoon() : setSheet({ kind: 'import' }))}
              className="flex items-center justify-center w-8 h-8 rounded-full"
              style={{ background: 'rgb(var(--t-raised))' }}
              aria-label={t('coachSchedule:importFixtures')}>
              <FileUp size={15} color="rgb(var(--t-ink))" />
            </button>}
            {/* TRAK-424: no "+" of its own; the frame's "+" adds an event, on the day picked here (create-day.ts). */}
          </div>
        </div>

        {loadFailed && <LoadError what={t('coachSchedule:scheduleWhat')} onRetry={retry} retrying={retrying} />}

        {/* TRAK-252: on a coach's laptop the month and the chosen day stand side by side. */}
        <div className="space-y-4 laptop:grid laptop:grid-cols-2 laptop:gap-6 laptop:items-start laptop:space-y-0">
        {/* ── Month (Arc calendar, TRAK-182) ───────────────────────────────── */}
        <div className="arc rounded-[18px] border border-line overflow-hidden" style={{ background: 'rgb(var(--t-surface))' }}>
          {/* TRAK-271: room between the last row of days and the legend's line. */}
          <div className="flex justify-center px-2 pt-2 pb-4">
            {/* TRAK-252 (option A): on a laptop the same Arc calendar fills its column. */}
            <Calendar locale={currentLanguage() === 'en' ? 'en-GB' : currentLanguage()} showToday className="laptop:!w-full"
              value={new Date(`${selected}T12:00:00`)} onChange={date => setSelected(toDateStr(date))}
              month={new Date(viewYear, viewMonth, 1)}
              onMonthChange={month => { setViewYear(month.getFullYear()); setViewMonth(month.getMonth()) }}
              marks={date => (byDate[toDateStr(date)] ?? []).map(ev => ev.row && isCancelled(ev.row) ? { color: CANCELLED_COLOR, hollow: true } : TYPE_COLOR[ev.type])}
              attention={date => needsYou.has(toDateStr(date))} />
          </div>

          {/* Legend. TRAK-255: Cancelled (the hollow ring the month draws) and Needs you (the amber corner). */}
          <div role="group" aria-label={t('coachSchedule:colourKey')} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-line">
            {EVENT_KINDS.map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-[7px] h-[7px] rounded-full" style={{ background: TYPE_COLOR[type] }} />
                <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>
                  {t(TYPE_WORD[type])}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-[8px] h-[8px] rounded-full box-border" style={{ border: `1.5px solid ${CANCELLED_COLOR}` }} />
              <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>{t('coachHome:noteCancelled')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Coach Home's corner (TRAK-270), as the month draws it. */}
              <div className="w-[8px] h-[8px]" style={{ filter: 'drop-shadow(0 0 .6px rgb(var(--t-warning)))' }}>
                <div className="w-full h-full" style={{ background: NEEDS_YOU_COLOR, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
              </div>
              <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>{t('coachHome:needsYouTitle')}</span>
            </div>
          </div>
        </div>

        {/* ── Selected day ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-ink-3" style={mono}>
              {formatEventDay(selected)}
            </span>

          </div>

          {!loaded && !loadFailed ? <LoadingSkeleton label={t('coachSchedule:scheduleLoading')} lines={2} rows={2} />
          : selectedEvents.length === 0 ? (
            // TRAK-432: Arc's empty state; the frame's "+" is the button, named as this screen shows it.
            <div className="arc">
              <EmptyState icon={<CalendarDays size={24} strokeWidth={1.5} />} title={t('coachSchedule:nothingPlanned')}
                description={t(wide ? 'coachSchedule:addWithCreate' : 'coachSchedule:addWithPlus')} />
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const row = ev.row
                const cancelled = !!row && isCancelled(row)
                // TRAK-255: the state in words and colour; a draft is a dashed card only the coach sees.
                const state = !row ? null
                  // TRAK-271: the word is the danger red; the event colour is too light for text, so it is the chip's edge.
                  : cancelled ? { text: t('coachHome:noteCancelled'), color: undefined, edge: CANCELLED_COLOR, fill: 'transparent' }
                  : !row.published ? { text: t('coachSchedule:draftOnlyYou'), color: 'rgb(var(--t-ink-3))', fill: 'transparent' }
                  : startedLocked(row) ? { text: t('coachSchedule:startedFixed'), color: 'rgb(var(--t-ink-2))', fill: 'rgb(var(--t-raised))' }
                  : { text: t('coachHome:notePublished'), color: 'rgb(var(--t-brand))', fill: 'transparent' }
                const place = ev.venue ? venueParts(ev.venue) : null
                const sessionId = row ? registerSession.get(row.id) : undefined
                const started = !!row && hasStarted(row)
                // Waiting for the coach: the same rule as the month's corner (needsYou).
                const waiting = !!row && row.published && !cancelled && started && !sessionId && (row.event_type === 'match' || !registerProblem(row))
                const shareText = row?.published ? whatsAppShareText(shareableFromRow(row, row.squad ?? squad.label), { childNames: squad.childNames }) : null
                const guarded = (fn: () => void) => () => (parked ? comingSoon() : fn())
                // TRAK-272, TRAK-275 (Tarek, 23 Oct): the event's actions as one Arc Button group at the card's top
                // right, the next step first and Cancel or Delete last. A phone shows the icons only; a laptop adds
                // the words. Each keeps its full name ("Publish Shooting") as its accessible name and tooltip.
                const items: ButtonGroupItem[] = []
                // TRAK-426: where the old log has retired, an old log (no event behind it) is read, no longer edited.
                if (!row) {
                  if (!oldLogRetired) items.push({ id: 'edit', label: t('coachSchedule:editNamed', { title: ev.title }), content: t('coachSchedule:edit'), icon: <Pencil />, onSelect: () => navigate(`/coach/sessions/${ev.id}`) })
                } else {
                  if (!row.published && !cancelled) items.push({ id: 'publish', label: t('coachSchedule:publishNamed', { title: row.title }), content: t('coachHome:publish'), icon: <Send />, onSelect: () => publish(row) })
                  if (!registerProblem(row)) items.push({ id: 'register', label: t('coachSchedule:registerFor', { action: sessionId ? t('coachSchedule:editRegister') : t('coachHome:takeRegister'), title: row.title }),
                    content: sessionId ? t('coachSchedule:editRegister') : t('coachHome:takeRegister'), icon: <ClipboardCheck />, onSelect: guarded(() => setSheet({ kind: 'register', row })) })
                  if (row.event_type === 'match' && row.published && !cancelled && started) items.push(games && evaluations.data?.get(row.id)?.publishedAt
                    ? { id: 'match', label: t('coachSchedule:viewReviewOf', { title: row.title }), content: t('coachHome:viewReview'), icon: <ClipboardList />, onSelect: () => navigate(`/coach/matches/${row.id}?tab=evaluation`) }
                    : sessionId && !oldLogRetired
                    ? { id: 'match', label: t('coachSchedule:editMatchFor', { title: row.title }), content: t('coachSchedule:editMatch'), icon: <Pencil />, onSelect: () => navigate(`/coach/sessions/${sessionId}`) }
                    // TRAK-288: where Games is on, the match's evaluation replaces the match log.
                    : games ? { id: 'match', label: t('coachSchedule:evaluateNamed', { title: row.title }), content: t('coachHome:evaluate'), icon: <ClipboardList />, onSelect: () => navigate(`/coach/matches/${row.id}?tab=evaluation`) }
                    : { id: 'match', label: t('coachSchedule:logMatchFor', { title: row.title }), content: t('coachSchedule:logMatch'), icon: <ClipboardList />, onSelect: guarded(() => navigate('/coach/sessions/quick', {
                        state: { fromEvent: { eventId: row.id, date: row.event_date, opponent: row.opponent, homeAway: row.home_away, squad: row.squad ?? null } },
                      })) })
                  // TRAK-139, TRAK-168: the phone's share sheet (Viber or WhatsApp; WhatsApp's link without one). Trak sends nothing.
                  if (shareText) items.push({ id: 'share', label: t('coachSchedule:shareNamed', { title: row.title }), content: t('coachSchedule:share'), icon: <ShareIcon size={16} tight />, onSelect: guarded(() => shareEventText(shareText)) })
                  // TRAK-230: once started, what families were told is fixed.
                  if (!cancelled && !startedLocked(row)) items.push({ id: 'edit', label: t('coachSchedule:editNamed', { title: row.title }), content: t('coachSchedule:edit'), icon: <Pencil />, onSelect: () => openEdit(row) })
                  if (!cancelled && canDelete(row)) items.push({ id: 'delete', label: t('coachSchedule:deleteNamed', { title: row.title }), content: t('coachSchedule:delete'),
                    icon: <Trash2 color="rgb(var(--t-danger))" />, onSelect: () => void deleteDraft(row) })
                  else if (!cancelled && !startedLocked(row)) items.push({ id: 'cancel', label: t('coachSchedule:cancelNamed', { title: row.title }), content: t('coachSchedule:cancel'),
                    icon: <Ban color="rgb(var(--t-danger))" />, onSelect: () => setSheet({ kind: 'cancel', row, reason: '', scope: 'one', error: null }) })
                }
                // TRAK-275: icons alone on a phone (content would show the word, so it goes too).
                const groupItems = items.map(item => (wide ? item : { ...item, iconOnly: true, content: undefined }))
                // TRAK-272: the card opens the same event sheet as coach Home's week (CoachWeekStrip).
                const sheetSource = row ?? { id: `session:${ev.id}`, published: true, title: ev.title, event_date: ev.date, event_type: ev.type, ...(ev.venue && { venue: ev.venue }) }
                const base = toPlayerEvent(sheetSource as unknown as Record<string, unknown>)
                const sheetEvent: StripEvent | null = base && { ...base, draft: !!row && !row.published, sessionId: row ? undefined : ev.id }
                const titleText = (
                  <p className="text-[14px] font-medium truncate"
                    style={{ color: 'rgb(var(--t-ink))', ...font, textDecoration: cancelled ? 'line-through' : undefined }}>
                    {ev.title}
                  </p>
                )
                return (
                  <div key={ev.id}
                    onClick={event => {
                      // The card opens its sheet; its own buttons and links do what they say.
                      if ((event.target as HTMLElement).closest('button, a, [role="menuitem"], [role="group"]')) return
                      cardTriggers.current.get(ev.id)?.click()
                    }}
                    className="rounded-[14px] px-4 py-3 flex items-start gap-3 cursor-pointer"
                    style={{ background: 'rgb(var(--t-surface))', border: row && !row.published && !cancelled ? '1.5px dashed rgb(var(--t-line-strong))' : '1px solid rgb(var(--t-line))' }}>
                    <div className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: cancelled ? CANCELLED_COLOR : TYPE_COLOR[ev.type], minHeight: 28 }} />
                    <div className="flex-1 min-w-0">
                      {sheetEvent ? (
                        <EventSheet event={sheetEvent} role="coach" trigger={
                          <button type="button" ref={node => { if (node) cardTriggers.current.set(ev.id, node); else cardTriggers.current.delete(ev.id) }}
                            className="block max-w-full text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            {titleText}
                          </button>}>
                          {/* A logged session's sheet says so, shows who came and opens its record, as on coach Home. */}
                          {sheetEvent.sessionId
                            ? <>
                                {/* TRAK-426: where the old log has retired, a training opens on its own page; anything
                                    else shows who came, below, and no longer opens the old editor. */}
                                {(!oldLogRetired || row?.event_type === 'training') && <Link
                                  to={oldLogRetired ? `/coach/training/${row!.id}` : `/coach/sessions/${sheetEvent.sessionId}`}
                                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-raised text-[14px] font-medium text-ink focus-visible:ring-2 focus-visible:ring-primary">
                                  {oldLogRetired ? t('coachSchedule:openTraining') : t('coachSchedule:openSession')}
                                </Link>}
                                {user && <LoggedAttendance sessionId={sheetEvent.sessionId} coachId={user.id} />}
                              </>
                            : user && <EventSheetCoach event={sheetEvent} coachId={user.id} onChanged={() => void loadData()} />}
                        </EventSheet>
                      ) : titleText}
                      <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>
                        {/* TRAK-159: a scheduled event says its time, or that it has none. */}
                        {ev.time
                          ? <><span className="text-[11px] font-medium" style={{ color: 'rgb(var(--t-ink))' }}>{ev.time}</span>{' · '}</>
                          : row && <><span className="text-[10px] font-medium" style={{ color: NO_TIME_COLOR }}>{t('coachSchedule:noTimeSet')}</span>{' · '}</>}
                        {/* TRAK-271: the type's colour is a dot; the word stays dark. */}<span className="inline-flex items-center gap-1 font-medium text-ink-2"><span aria-hidden="true" className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: TYPE_COLOR[ev.type] }} />{t(TYPE_WORD[ev.type])}</span>{everySquad ? ` · ${squadName(ev.squad)}` : ''}{row?.series_id ? t('coachSchedule:weeklySuffix') : ''}
                        {row?.meet_time ? t('coachSchedule:meetSuffix', { time: phoneClock(row, row.meet_time) }) : ''}
                        {row?.home_away ? ` · ${row.home_away === 'home' ? t('coachSchedule:home') : t('coachSchedule:away')}` : ''}
                        {place?.text ? ` · ${place.text}` : ''}
                      </p>
                      {row?.kit && (
                        <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>{t('coachSchedule:kitLine', { kit: row.kit })}</p>
                      )}
                      {/* TRAK-255 (TRAK-225's link): the venue opens in Maps from the coach's day too. */}
                      {place && (
                        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer"
                          className="mt-1 flex w-fit items-center gap-1 min-h-8 text-[12px] font-medium text-brand underline" style={font}>
                          <MapPin size={13} aria-hidden="true" />{t('coachSchedule:openInMaps')}
                        </a>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {state && (
                          <span className={`block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium ${cancelled ? 'text-danger' : ''}`}
                            style={{ color: state.color, background: state.fill, border: `1px ${row && !row.published && !cancelled ? 'dashed' : 'solid'} ${'edge' in state ? state.edge : state.color}`, ...font }}>
                            {state.text}
                          </span>
                        )}
                        {!row && (
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium text-ink-2 bg-raised" style={font}>{t('coachHome:logged')}</span>
                        )}
                        {row && row.event_type === 'match' && sessionId && (
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium text-ink-2 bg-raised" style={font}>{t('coachSchedule:matchLogged')}</span>
                        )}
                        {/* TRAK-270: the yellow of needs you; its word stays dark for contrast. */}
                        {waiting && (
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium"
                            style={{ ...font, color: 'rgb(var(--t-warning))', background: 'rgb(var(--t-attention) / 0.22)', border: `1.5px solid ${NEEDS_YOU_COLOR}` }}>{t('coachHome:needsYouTitle')}</span>
                        )}
                      </div>
                      {row && !cancelled && clashes.has(row.id) && (() => {
                        const c = clashes.get(row.id)!
                        return <p className="text-[11px] mt-0.5 text-warning" style={font}>
                          {t('coachSchedule:clashLine', { title: c.title, start: c.start, end: c.end })}
                        </p>
                      })()}
                      {row?.published && !cancelled && user && <EventAbsences coachId={user.id} eventId={row.id} />}
                      {cancelled && row?.cancel_reason && (
                        <p className="text-[11px] mt-0.5 text-ink-3" style={font}>{row.cancel_reason}</p>
                      )}
                    </div>
                    {/* TRAK-275: outline always; a draft or a waiting register is never a black block. */}
                    {items.length > 0 && (
                      <div className="arc flex-shrink-0">
                        <ButtonGroup label={t('coachSchedule:actionsFor', { title: ev.title })} items={groupItems} variant="outline" size="md" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Event sheet: new or edit, one step per screen (TRAK-182); a match page pulls up the same one (TRAK-331) ── */}
      {sheet.kind === 'edit' && <EventEditSheet key={sheet.row?.id ?? 'new'} sheet={sheet}
        onChange={update => setSheet(s => s.kind === 'edit' ? { ...update(s), kind: 'edit' } : s)}
        onClose={() => setSheet({ kind: 'closed' })} onSave={(publishNow, evaluate) => void saveEvent(publishNow, evaluate)}
        saving={saving} venues={venues} childNames={squad.childNames} />}

      {/* ── Cancel sheet ──────────────────────────────────────────────────── */}
      {sheet.kind === 'cancel' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={t('coachSchedule:cancelEvent')}
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>{t('coachSchedule:cancelTitle', { title: sheet.row.title })}</span>
            <p className="text-[12px] text-ink-2" style={font}>
              {t('coachSchedule:staysCancelled')}
            </p>
            {inSeries(sheet.row) && (
              <ScopeChoice scope={sheet.scope}
                onChange={scope => setSheet(s => s.kind === 'cancel' ? { ...s, scope, error: null } : s)} />
            )}
            <Field label={t('coachSchedule:reasonOptional')}>
              <input value={sheet.reason}
                onChange={e => setSheet(s => s.kind === 'cancel' ? { ...s, reason: e.target.value, error: null } : s)}
                placeholder={t('coachSchedule:reasonExample')} className={inputClass} style={font} />
            </Field>
            {sheet.error && <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>}
            <button onClick={confirmCancel} disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgb(var(--t-danger))', color: 'rgb(var(--t-on-brand))', opacity: saving ? 0.6 : 1 }}>
              {saving ? t('coachSchedule:cancelling') : t('coachSchedule:cancelEvent')}
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              {t('coachSchedule:keepEvent')}
            </button>
          </div>
        </div>
      )}

      {/* ── Cancelled: tell the team group (TRAK-168) ─────────────────────── */}
      {sheet.kind === 'cancelled' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={t('coachSchedule:eventCancelled')}
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>{t('coachSchedule:eventCancelled')}</span>
            <p className="text-[12px] text-ink-2" style={font}>
              {t('coachSchedule:letGroupKnow', { note: sheet.note })}
            </p>
            {/* Nothing is sent until the coach picks a chat (the phone's share sheet, or WhatsApp's link). */}
            <ShareEventButton text={whatsAppShareText(shareableFromRow(sheet.row, sheet.row.squad ?? squad.label), { childNames: squad.childNames })}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium flex items-center justify-center gap-2 bg-brand text-on-brand">
              <ShareIcon size={18} />{t('coachSchedule:share')}
            </ShareEventButton>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              {t('coachSchedule:done')}
            </button>
          </div>
        </div>
      )}

      {/* ── Import sheet (TRAK-129, J8.6) ─────────────────────────────────── */}
      {sheet.kind === 'import' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={t('coachSchedule:importFixtures')}
            className="w-full max-w-sheet max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-ink" style={font}>{t('coachSchedule:importFixtures')}</span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label={t('coachSchedule:close')}>
                <X size={18} className="text-ink-2" />
              </button>
            </div>
            <p className="text-[12px] text-ink-2" style={font}>
              {t('coachSchedule:fixturesArrive')}
            </p>
            <FixtureImport existingKeys={fixtureKeys} onConfirm={importFixtures} />
          </div>
        </div>
      )}

      {/* ── Register sheet (TRAK-138, J8.15) ──────────────────────────────── */}
      {sheet.kind === 'register' && user && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={t('coachHome:takeRegister')}
            className="w-full max-w-sheet max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[16px] font-medium text-ink" style={font}>
                {t('coachSchedule:registerTitle', { title: sheet.row.title, day: formatEventDay(displayEventTime(sheet.row).date) })}
              </span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label={t('coachSchedule:close')}>
                <X size={18} className="text-ink-2" />
              </button>
            </div>
            <p className="text-[12px] text-ink-2" style={font}>
              {t('coachSchedule:registerHelp')}
            </p>
            <TakeRegister eventId={sheet.row.id} coachId={user.id} sessionId={registerSession.get(sheet.row.id) ?? null} squad={sheet.row.squad ?? null}
              onSaved={() => { setSheet({ kind: 'closed' }); loadData() }} />
          </div>
        </div>
      )}

      {/* ── Series sheet: publish or delete which weeks ───────────────────── */}
      {sheet.kind === 'series' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={sheet.action === 'publish' ? t('coachSchedule:publishEvent') : t('coachSchedule:deleteDraft')}
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>
              {t(sheet.action === 'publish' ? 'coachSchedule:publishTitle' : 'coachSchedule:deleteTitle', { title: sheet.row.title, day: formatEventDay(sheet.row.event_date!) })}
            </span>
            <p className="text-[12px] text-ink-2" style={font}>
              {sheet.action === 'publish'
                ? t('coachSchedule:seriesPublishHelp')
                : t('coachSchedule:seriesDeleteHelp')}
            </p>
            {sheet.error && <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>}
            <button onClick={() => seriesAction('one')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))', color: sheet.action === 'publish' ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink))' }}>
              {t('coachSchedule:onlyThisWeek')}
            </button>
            <button onClick={() => seriesAction('following')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))', color: sheet.action === 'publish' ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink))' }}>
              {t('coachSchedule:thisAndFollowing')}
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              {t('coachSchedule:notNow')}
            </button>
          </div>
        </div>
      )}

      {/* ── Not published: a refused series, until the coach closes it (TRAK-218) ── */}
      {sheet.kind === 'notPublished' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}>
          <div role="dialog" aria-label={t('coachSchedule:notPublished')}
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>{t('coachSchedule:notPublished')}</span>
            <p className="text-[12px] text-ink-2" style={font}>
              {t('coachSchedule:noneEventsWentOut', { count: sheet.count })}
            </p>
            {sheet.weeks.length ? <>
              <ul role="alert" className="space-y-1">
                {sheet.weeks.map(w => <li key={w.date} className="text-[12px] text-danger" style={font}>{overlapLine(w)}</li>)}
              </ul>
              <p className="text-[12px] text-ink-2" style={font}>
                {fixLine(sheet.weeks)}{t('coachSchedule:thenTapPublish')}
              </p>
            </> : <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.refusal}</p>}
            {sheet.weeks[0] && (
              <button onClick={() => {
                const date = sheet.weeks[0].date
                const [y, m] = date.split('-').map(Number)
                setViewYear(y); setViewMonth(m - 1); setSelected(date)
                setSheet({ kind: 'closed' })
              }}
                className="w-full py-3 rounded-[12px] text-[14px] font-medium"
                style={{ background: 'rgb(var(--t-brand))', color: 'rgb(var(--t-on-brand))' }}>
                {t('coachSchedule:showDay', { day: formatEventDay(sheet.weeks[0].date) })}
              </button>
            )}
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              {t('coachSchedule:close')}
            </button>
          </div>
        </div>
      )}

      <QuickAdd onSaved={loadData} />
      <NavBar role="coach" activeTab="/coach/schedule" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
