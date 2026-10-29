import { useEffect, useState, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Pencil, Send, Trash2, Ban, X, FileUp, ExternalLink, MapPin, ClipboardCheck, ClipboardList } from 'lucide-react'
import { ButtonGroup, type ButtonGroupItem } from '@/components/arc/button-group/button-group'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { EventSheet } from '@/components/trak/EventSheet'
import type { StripEvent } from '@/components/trak/WeekStrip'
import { EventSheetCoach } from '@/components/coach/EventSheetCoach'
import { LoggedAttendance } from '@/components/coach/LoggedAttendance'
import { toPlayerEvent } from '@/lib/player-events'
import { BackButton } from '@/pages/coach/library/parts'
import { isMapsUrl, joinVenue, splitVenue, venueParts } from '@/lib/venue-link'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { displayEventTime, localTodayISO, phoneClock, phoneEventTime } from '@/lib/event-time'
import { useCoachSquad } from '@/lib/coach-squad'
import { squadName } from '@/lib/coach-week'
import { askToEmailFamilies } from '@/lib/event-emails'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { useGameEvaluations } from '@/components/coach/games/useGames'
import { useFeature, useParked } from '@/components/trak/parked'
import {
  CANCELLED_COLOR, COMPETITIONS, DURATIONS, clashMessage, draftClashes, EVENT_COLOR, lockedMessage, STARTED_LOCKED, startedLocked, EVENT_KINDS, FAMILY_NOTE_MAX, NO_TIME_COLOR, WEEKDAYS, blankForm, blankRepeat, canDelete, cancelPatch, dateAsDay, dayAsDate, formatEventDay, formProblem, formToRow, newDraftFields,
  isCancelled, pastDateProblem, repeatProblem, rowToForm, savedVenues, seriesDates, seriesRows, thisAndFollowing, whatProblem,
  type Clash, type EventForm, type EventKind, type EventRow, type Repeat,
} from '@/lib/coach-events'
import { TRAINING_THEMES, catalogueLink, type TrainingTheme } from '@/lib/training-theme'
import { FixtureImport } from '@/components/coach/FixtureImport'
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

const TYPE_LABEL: Record<ShownType, string> = {
  match: 'Match', training: 'Training', tournament: 'Tournament', other: 'Other',
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function toDateStr(d: Date) {
  // Use LOCAL date parts — toISOString() converts to UTC, which shifts the
  // date back a day for users in timezones ahead of UTC (e.g. Europe), making
  // events land on the wrong calendar cell.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** A write that changed no row was refused (RLS filters, it doesn't error). */
function failed(error: unknown, data: unknown[] | null) {
  return !!error || !data?.length
}

const SAVE_FAILED = "Couldn't save the event. Check your connection and try again; your details are still here."


const inputClass = 'w-full bg-ground border border-line rounded-[12px] px-3 py-2.5 text-[14px] text-ink placeholder-ink-3 outline-none'
const font = { fontFamily: 'var(--t-font)' }
const mono = { fontFamily: 'var(--t-font-mono)' }

function Chip({ on, color = 'rgb(var(--t-brand))', onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="px-3 py-1.5 rounded-full text-xs transition-colors"
      style={{
        background: on ? `${withAlpha(color, 0.13)}` : 'rgb(var(--t-raised))',
        color: on ? color : 'rgb(var(--t-ink-3))',
        border: `1px solid ${on ? withAlpha(color, 0.33) : 'rgb(var(--t-line))'}`,
        ...font,
      }}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>{label}</span>
      {children}
    </label>
  )
}

/** A training's theme: the catalogue's seven libraries, and a link into it. */
function ThemeChoice({ theme, onChange }: { theme: TrainingTheme | ''; onChange: (theme: TrainingTheme) => void }) {
  const picked = TRAINING_THEMES.find(t => t.key === theme)
  return (
    <div className="space-y-2">
      <span id="training-theme" className="block text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>Theme</span>
      <div role="radiogroup" aria-labelledby="training-theme" className="grid grid-cols-2 gap-2">
        {TRAINING_THEMES.map(t => {
          const on = t.key === theme
          return (
            <label key={t.key} className="flex items-start gap-2 rounded-[12px] px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: on ? withAlpha(TYPE_COLOR.training, 0.1) : 'rgb(var(--t-ground))',
                border: `1px solid ${on ? withAlpha(TYPE_COLOR.training, 0.33) : 'rgb(var(--t-line))'}`,
                ...font,
              }}>
              <input type="radio" name="training-theme" value={t.key} checked={on} onChange={() => onChange(t.key)}
                className="mt-[2px] w-3.5 h-3.5 shrink-0" style={{ accentColor: TYPE_COLOR.training }} />
              <span className="min-w-0">
                <span className={`block text-[13px] leading-tight text-ink ${on ? 'font-medium' : ''}`}>{t.label}</span>
                <span className="block text-[11px] text-ink-3 mt-0.5 whitespace-nowrap">{t.sessions} sessions · {t.topics} {t.topics === 1 ? 'topic' : 'topics'}</span>
              </span>
            </label>
          )
        })}
      </div>
      {/* A new tab, so the event being set up stays as it is. */}
      <a href={catalogueLink(theme)} target="_blank" rel="noopener"
        className="inline-flex items-center gap-1.5 text-[12px] text-brand" style={font}>
        {picked ? `Find ${picked.label} sessions in the Trainings Catalogue` : 'Browse all sessions in the Trainings Catalogue'}
        <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  )
}

/** The meet-time list opens half an hour before the start: the usual gap. */
function halfHourBefore(time: string) {
  if (!time) return '17:00'
  const [h, m] = time.split(':').map(Number)
  const t = Math.max(0, h * 60 + m - 30)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Arc's tokens for a picker in this form; the picker takes className="arc-trak-field" for Trak's label (TRAK-157). */
function ArcField({ children }: { children: React.ReactNode }) {
  return <div className="arc" style={font}>{children}</div>
}

// ── Component ────────────────────────────────────────────────────────────────

type Scope = 'one' | 'following'

type Sheet =
  | { kind: 'closed' }
  | { kind: 'edit'; row: EventRow | null; form: EventForm; repeat: Repeat; scope: Scope; step: number; error: string | null }
  | { kind: 'cancel'; row: EventRow; reason: string; scope: Scope; error: string | null }
  // TRAK-168: the event just cancelled, offered to the team group, and what was cancelled.
  | { kind: 'cancelled'; row: EventRow; note: string }
  | { kind: 'series'; action: 'publish' | 'delete'; row: EventRow; error: string | null }
  // TRAK-218: a series Publish the database refused; it stays until the coach closes it.
  | { kind: 'notPublished'; count: number; weeks: ClashingWeek[]; refusal: string }
  | { kind: 'import' }
  | { kind: 'register'; row: EventRow }

/* TRAK-182 (Imad's 7c): the event form one step per screen, related fields
   together, then Review with Publish or Save draft. An edit opens on What,
   where each step can be reopened from the stepper. */
const EVENT_STEPS = [
  { id: 'what', label: 'What' },
  { id: 'when', label: 'When' },
  { id: 'families', label: 'For families' },
  { id: 'review', label: 'Review' },
]
const REVIEW = EVENT_STEPS.length - 1

/** TRAK-127: a past date on New event, or moved to on an edit. TRAK-288: where Games is on, a new match that has
 *  been played is saved to be evaluated instead (Imad, 28 Oct), so its date isn't a problem. */
function pastProblem(form: EventForm, editing: EventRow | null, games = false) {
  if (playedMatch(form, editing, games)) return null
  return pastDateProblem(form.date, localTodayISO(), editing ? rowToForm(editing).date : null)
}
const playedMatch = (form: EventForm, editing: EventRow | null, games: boolean) =>
  games && !editing && form.kind === 'match' && pastDateProblem(form.date, localTodayISO()) !== null

/** TRAK-288: where Games is on, New event asks a match's competition, so publishing its evaluation can read it. */
const competitionProblem = (form: EventForm, editing: EventRow | null, games: boolean) =>
  games && !editing && form.kind === 'match' && !form.competition ? 'Pick the competition' : null

/** What stops Next on a step: only what that step can fix. */
function stepProblem(step: number, form: EventForm, repeat: Repeat, editing: EventRow | null, games: boolean) {
  if (step === 0) return whatProblem(form) ?? competitionProblem(form, editing, games)
  if (step === 1) return formProblem(form) ?? pastProblem(form, editing, games) ?? (editing ? null : repeatProblem(form, repeat))
  return null
}

/** How many events Review's save makes: a new weekly series is several. */
function seriesCount(sheet: { row: EventRow | null; form: EventForm; repeat: Repeat }) {
  const { row, form, repeat } = sheet
  return !row && repeat.on && form.kind !== 'match' && !repeatProblem(form, repeat)
    ? seriesDates(form.date, repeat.until, repeat.days).length : 1
}

/** TRAK-218: the weeks of a refused series that clash, earliest first. */
type ClashingWeek = { date: string; clash: Clash }
function clashingWeeks(ids: string[], rows: EventRow[]): ClashingWeek[] {
  const clashes = draftClashes(rows)
  return rows.filter(r => ids.includes(r.id) && clashes.has(r.id))
    .sort((a, b) => a.event_date!.localeCompare(b.event_date!))
    .map(r => ({ date: r.event_date!, clash: clashes.get(r.id)! }))
}
const overlapLine = ({ date, clash }: ClashingWeek) => `${formatEventDay(date)} overlaps ${clash.title}, ${clash.start}–${clash.end}.`
/** What to fix: the week's time, or the event it clashes with. */
function fixLine(weeks: ClashingWeek[]) {
  const titles = [...new Set(weeks.map(w => w.clash.title))]
  return `Change ${weeks.length > 1 ? 'those weeks’ times' : 'that week’s time'}, or cancel ${titles.length === 1 ? titles[0] : 'what they overlap'}`
}

const inSeries = (row: EventRow | null): row is EventRow & { series_id: string; event_date: string } =>
  !!row?.series_id && !!row.event_date

function ScopeChoice({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label="Which weeks">
      <Chip on={scope === 'one'} onClick={() => onChange('one')}>Only this week</Chip>
      <Chip on={scope === 'following'} onClick={() => onChange('following')}>This and following weeks</Chip>
    </div>
  )
}

export default function CoachSchedule() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  const games = useFeature('games')
  // TRAK-289: a published evaluation is final, so its match opens the review, never the match log's editor.
  const evaluations = useGameEvaluations(games)
  const navigate = useNavigate()
  // TRAK-275: a card's actions carry words only where the side menu shows (a laptop).
  const wide = useSideMenuScreen()
  const { user } = useAuth()
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

  // Data
  const [calEvents, setCalEvents] = useState<EventRow[]>([])
  // Every squad's events: the overlap rule is per coach, not per squad (TRAK-218).
  const [coachEvents, setCoachEvents] = useState<EventRow[]>([])
  const [sessions,  setSessions]  = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
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
    }
    if (!sess.error) setSessions((sess.data || []).filter(s => inView(s.squad)))
    return events
  }

  useEffect(() => { loadData() }, [user, coachSquad.squad, everySquad])

  // TRAK-139 (J8.16): the squad for the WhatsApp message title ("U15 Match"),
  // and its children's names, so coach-typed text naming one stays out.
  // Optional: a failed read leaves "Squad" and no reason, and never blocks
  // the calendar.
  const [squad, setSquad] = useState<{ label: string, childNames: string[] | null }>({ label: 'Squad', childNames: null })
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
  // TRAK-161: tell the coach as they type when families won't see the note.
  const noteProblem = sheet.kind === 'edit' ? familyNoteProblem(sheet.form.familyNote, squad.childNames) : null
  // TRAK-127: said as soon as a past day is picked, with the two logs.
  const datePassed = sheet.kind === 'edit' ? pastProblem(sheet.form, sheet.row, games) : null
  const played = sheet.kind === 'edit' && playedMatch(sheet.form, sheet.row, games)
  const logInstead = (to: 'match' | 'training') => {
    if (sheet.kind !== 'edit') return
    const { date, opponent, homeAway } = sheet.form
    setSheet({ kind: 'closed' })
    if (to === 'match') navigate('/coach/sessions/quick', { state: { fromEvent: { date, opponent: opponent.trim() || null, homeAway: homeAway || null } } })
    else navigate('/coach/sessions/add', { state: { logDate: date } })
  }

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
        title:    s.title || (s.session_type === 'match' ? 'Match' : 'Training'),
        type:     (s.session_type === 'match' ? 'match' : s.session_type === 'training' ? 'training' : 'other') as ShownType,
        date:     s.session_date ?? '',
        source:   'session',
        squad:    s.squad ?? null,
        venue:    s.venue,
      })
    }
    return ev.filter(e => e.date)
  }, [calEvents, sessions])

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
  const needsYou = useMemo(() => {
    const days = new Set<string>()
    for (const e of allEvents) {
      const r = e.row
      if (!r || !r.published || isCancelled(r) || registerSession.has(r.id) || !hasStarted(r)) continue
      if (r.event_type === 'match' || !registerProblem(r)) days.add(e.date)
    }
    return days
  }, [allEvents, registerSession])

  const openNew = (date: string) =>
    setSheet({ kind: 'edit', row: null, form: { ...blankForm(date), squad: coachSquad.squad }, repeat: blankRepeat(date), scope: 'one', step: 0, error: null })
  // TRAK-182 (live run 3): an edit opens on the first step, filled in, not on Review.
  const openEdit = (row: EventRow) =>
    setSheet({ kind: 'edit', row, form: rowToForm(row), repeat: blankRepeat(''), scope: 'one', step: 0, error: null })
  const setForm = (patch: Partial<EventForm>) =>
    setSheet(s => {
      if (s.kind !== 'edit') return s
      // Until the coach turns repeat on, its weekday follows the first date.
      // A match never repeats: picking Match switches the repeat off, so a
      // hidden repeat can't save a series of identical matches.
      const repeat = patch.kind === 'match' ? { ...s.repeat, on: false }
        : patch.date && !s.repeat.on ? blankRepeat(patch.date) : s.repeat
      return { ...s, form: { ...s.form, ...patch }, repeat, error: null }
    })
  // TRAK-255: the venue is stored as before (the name, then the map link), but the form keeps them
  // in two boxes. The link box keeps what's typed until it is a Maps link; only a Maps link is saved.
  const [mapLinkText, setMapLinkText] = useState<string | null>(null)
  const editKey = sheet.kind === 'edit' ? sheet.row?.id ?? 'new' : null
  useEffect(() => { setMapLinkText(null) }, [editKey])
  const venueNow = () => (sheet.kind === 'edit' ? splitVenue(sheet.form.venue) : { name: '', link: '' })
  const setVenueName = (typed: string) => {
    // A link pasted into the name box moves to the link box.
    const pasted = splitVenue(typed)
    if (pasted.link) { setMapLinkText(null); setForm({ venue: joinVenue(pasted.name, pasted.link) }); return }
    let link = venueNow().link
    // A saved venue brings the map link it was last used with.
    if (!link && !mapLinkText) link = venues.find(v => v.name.toLowerCase() === typed.trim().toLowerCase())?.link ?? ''
    setForm({ venue: joinVenue(typed, link) })
  }
  const setVenueLink = (typed: string) => {
    setMapLinkText(typed)
    setForm({ venue: joinVenue(venueNow().name, isMapsUrl(typed) ? typed.trim() : '') })
  }
  const setRepeat = (patch: Partial<Repeat>) =>
    setSheet(s => s.kind === 'edit' ? { ...s, repeat: { ...s.repeat, ...patch }, error: null } : s)
  const toggleDay = (day: number) =>
    setSheet(s => {
      if (s.kind !== 'edit') return s
      const days = s.repeat.days.includes(day) ? s.repeat.days.filter(d => d !== day) : [...s.repeat.days, day].sort()
      return { ...s, repeat: { ...s.repeat, days }, error: null }
    })

  /** `evaluate`: a match already played (TRAK-288), published and opened on its evaluation. */
  const saveEvent = async (publishNow = false, evaluate = false) => {
    if (parked) return comingSoon()
    if (!user || sheet.kind !== 'edit') return
    const { row: editing, form, repeat, scope } = sheet
    const problem = formProblem(form) ?? competitionProblem(form, editing, games) ?? pastProblem(form, editing, games)
      ?? (editing ? null : repeatProblem(form, repeat))
    if (problem) { setSheet({ ...sheet, error: problem }); return }

    // This and following weeks: each week keeps its own date and takes the rest.
    if (editing && scope === 'following' && inSeries(editing)) {
      if (form.date !== rowToForm(editing).date) {
        setSheet({ ...sheet, error: 'To move the day, change only this week.' })
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
        const clash = results.map(r => clashMessage(r.error) ?? lockedMessage(r.error)).find(Boolean)
        setSheet({ ...sheet, error: `Saved ${saved} of ${targets.length} weeks. ${clash ?? 'Check your connection and save again.'}` })
        return
      }
      setSheet({ kind: 'closed' })
      if (publishNow) return publishSaved(targets.filter(t => !t.published && t.status === 'scheduled').map(t => t.id))
      toast.success(`Saved ${saved} weeks.${targets.some(t => t.published) ? ' Families see the change.' : ''}`)
      return
    }

    if (!editing && !coachSquad.ready) { setSheet({ ...sheet, error: coachSquad.retry() }); return }
    setSaving(true)
    const fresh = newDraftFields(user.id, form.squad === undefined ? coachSquad.squad : form.squad)
    const series = !editing && repeat.on && form.kind !== 'match'
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
    if (failed(error, data) || (!editing && data!.length !== rows.length)) { setSheet({ ...sheet, error: clashMessage(error) ?? lockedMessage(error) ?? SAVE_FAILED }); return }
    setSheet({ kind: 'closed' })
    setSelected(form.date)
    if (publishNow && !editing?.published) return publishSaved(editing ? [editing.id] : data!.map(r => r.id), form.kind, evaluate)
    loadData()
    if (editing?.published) askToEmailFamilies()
    toast.success(editing
      ? editing.published ? 'Saved. Families see the change.' : 'Draft saved'
      : series ? `Saved ${rows.length} events as drafts. Tap Publish when they’re ready.`
        : 'Saved as a draft. Tap Publish when it’s ready.')
  }

  /** TRAK-283: with Games on, a match just published offers its next step, which opens its game page. */
  const publishedToast = (text: string, matchId?: string) => toast.success(text, games && matchId
    ? { duration: 10_000, action: { label: 'Write the game plan', onClick: () => navigate(`/coach/games/${matchId}?tab=plan`) } }
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
      toast.error(`Saved as ${ids.length > 1 ? 'drafts' : 'a draft'}, not published. ${clashMessage(error) ?? 'Tap Publish on the event to try again.'}`)
      return
    }
    askToEmailFamilies() // TRAK-135: publishing emails families too; never for one that has started
    // TRAK-288: a game with an empty plan, straight to its evaluation.
    if (evaluate) return navigate(`/coach/games/${ids[0]}?tab=evaluation`)
    publishedToast(ids.length > 1 ? `Published ${ids.length} events to the squad` : 'Published to the squad', ids.length === 1 && kind === 'match' ? ids[0] : undefined)
  }

  const toStep = (step: number) => setSheet(s => s.kind === 'edit' ? { ...s, step, error: null } : s)
  const nextStep = () => {
    if (sheet.kind !== 'edit') return
    const problem = stepProblem(sheet.step, sheet.form, sheet.repeat, sheet.row, games)
    if (problem) setSheet({ ...sheet, error: problem })
    else toStep(sheet.step + 1)
  }

  const publish = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'publish', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events')
      .update({ published: true }).eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(clashMessage(error) ?? `Couldn't publish "${row.title}". Try again.`); return }
    askToEmailFamilies() // TRAK-135
    loadData()
    publishedToast('Published to the squad', row.event_type === 'match' ? row.id : undefined)
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
    if ((action === 'edit' || action === 'cancel') && startedLocked(row)) toast.error(STARTED_LOCKED)
    else if (action === 'edit') openEdit(row)
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
      setSheet({ ...sheet, error: lockedMessage(error) ?? "Couldn't cancel the event. Check your connection and try again." })
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
      setSheet({ ...sheet, error: `Cancelled ${data!.length} published events, but couldn't remove the unpublished drafts after them. Delete them from the schedule.` })
      return
    }
    const removed = removedDrafts?.length ?? 0
    const note = (data!.length > 1
      ? `${data!.length} events cancelled. They stay on the schedule as Cancelled.`
      : 'Event cancelled. It stays on the schedule as Cancelled.')
      + (removed ? ` ${removed} unpublished draft${removed > 1 ? 's' : ''} removed.` : '')
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
        ? `None of the ${drafts.length} drafts went out: ${weeks.map(overlapLine).join(' ')} ${fixLine(weeks)}, then publish again.`
        : clashMessage(error) ?? `Couldn't ${action} "${row.title}". Check your connection and try again.` })
      return
    }
    setSheet({ kind: 'closed' })
    if (action === 'publish') askToEmailFamilies() // TRAK-135: the series is one email per person
    loadData()
    const n = data!.length
    toast.success(action === 'publish'
      ? n > 1 ? `Published ${n} events to the squad` : 'Published to the squad'
      : n > 1 ? `Deleted ${n} drafts` : 'Draft deleted')
  }

  const deleteDraft = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (!canDelete(row)) return
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'delete', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events').delete().eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(`Couldn't delete "${row.title}". Try again.`); return }
    if (sheet.kind === 'edit' && sheet.row?.id === row.id) setSheet({ kind: 'closed' })
    loadData()
    toast.success('Draft deleted')
  }

  // TRAK-129 (J8.6): one insert for the whole file, so it saves whole or not
  // at all. FixtureImport keeps every row and says so if this throws.
  const importFixtures = async (fixtures: Fixture[]) => {
    if (!user) throw new Error('Not signed in')
    if (!coachSquad.ready) throw new Error(coachSquad.retry())
    const rows = fixtureInsertRows(fixtures, user.id).map(row => ({ ...row, squad: coachSquad.squad }))
    const { data, error } = await supabase.from('coach_calendar_events').insert(rows).select('id')
    if (error || (data?.length ?? 0) !== rows.length) throw new Error("Couldn't save the fixtures")
    toast.success(`Added ${rows.length} ${rows.length === 1 ? 'fixture' : 'fixtures'} as drafts. Publish each when it's ready.`)
    await loadData()
  }

  return (
    <MobileShell width="wide">
      <div className="pt-3 pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* TRAK-272: a phone has no Schedule tab, so a Back (where the coach came from, else Home). A laptop has the sidebar. */}
            <div className="laptop:hidden"><BackButton fallback="/coach/home" label="Back" /></div>
            <h1 className="text-[22px] font-light text-ink tracking-tight"
              style={{ ...font, letterSpacing: '-0.02em' }}>
              Schedule
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* TRAK-162: the CSV import is parked; no coach is offered it. */}
            {FIXTURE_IMPORT_ENABLED && <button
              onClick={() => (parked ? comingSoon() : setSheet({ kind: 'import' }))}
              className="flex items-center justify-center w-8 h-8 rounded-full"
              style={{ background: 'rgb(var(--t-raised))' }}
              aria-label="Import fixtures">
              <FileUp size={15} color="rgb(var(--t-ink))" />
            </button>}
            {/* TRAK-270 (Tarek, 23 Oct): the one add button. It opens New event on the chosen day. */}
            <button
              onClick={() => openNew(selected)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-brand"
              aria-label="Add event">
              <Plus size={16} color="rgb(var(--t-on-brand))" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {loadFailed && <LoadError what="your schedule" onRetry={retry} retrying={retrying} />}

        {/* TRAK-252: on a coach's laptop the month and the chosen day stand side by side. */}
        <div className="space-y-4 laptop:grid laptop:grid-cols-2 laptop:gap-6 laptop:items-start laptop:space-y-0">
        {/* ── Month (Arc calendar, TRAK-182) ───────────────────────────────── */}
        <div className="arc rounded-[18px] border border-line overflow-hidden" style={{ background: 'rgb(var(--t-surface))' }}>
          {/* TRAK-271: room between the last row of days and the legend's line. */}
          <div className="flex justify-center px-2 pt-2 pb-4">
            {/* TRAK-252 (option A): on a laptop the same Arc calendar fills its column. */}
            <Calendar locale="en-GB" showToday className="laptop:!w-full"
              value={new Date(`${selected}T12:00:00`)} onChange={date => setSelected(toDateStr(date))}
              month={new Date(viewYear, viewMonth, 1)}
              onMonthChange={month => { setViewYear(month.getFullYear()); setViewMonth(month.getMonth()) }}
              marks={date => (byDate[toDateStr(date)] ?? []).map(ev => ev.row && isCancelled(ev.row) ? { color: CANCELLED_COLOR, hollow: true } : TYPE_COLOR[ev.type])}
              attention={date => needsYou.has(toDateStr(date))} />
          </div>

          {/* Legend. TRAK-255: Cancelled (the hollow ring the month draws) and Needs you (the amber corner). */}
          <div role="group" aria-label="Colour key" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-line">
            {EVENT_KINDS.map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-[7px] h-[7px] rounded-full" style={{ background: TYPE_COLOR[type] }} />
                <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>
                  {TYPE_LABEL[type]}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-[8px] h-[8px] rounded-full box-border" style={{ border: `1.5px solid ${CANCELLED_COLOR}` }} />
              <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>Cancelled</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Coach Home's corner (TRAK-270), as the month draws it. */}
              <div className="w-[8px] h-[8px]" style={{ filter: 'drop-shadow(0 0 .6px rgb(var(--t-warning)))' }}>
                <div className="w-full h-full" style={{ background: NEEDS_YOU_COLOR, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
              </div>
              <span className="text-[10px] uppercase tracking-[0.08em]" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>Needs you</span>
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

          {selectedEvents.length === 0 ? (
            <div className="rounded-[14px] border border-line px-4 py-5 text-center"
              style={{ background: 'rgb(var(--t-surface))' }}>
              <p className="text-[12px] text-ink-3">Nothing planned. Tap + to schedule an event.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const row = ev.row
                const cancelled = !!row && isCancelled(row)
                // TRAK-255: the state in words and colour; a draft is a dashed card only the coach sees.
                const state = !row ? null
                  // TRAK-271: the word is the danger red; the event colour is too light for text, so it is the chip's edge.
                  : cancelled ? { text: 'Cancelled', color: undefined, edge: CANCELLED_COLOR, fill: 'transparent' }
                  : !row.published ? { text: 'Draft · only you see this', color: 'rgb(var(--t-ink-3))', fill: 'transparent' }
                  : startedLocked(row) ? { text: 'Started · details fixed', color: 'rgb(var(--t-ink-2))', fill: 'rgb(var(--t-raised))' }
                  : { text: 'Published', color: 'rgb(var(--t-brand))', fill: 'transparent' }
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
                if (!row) {
                  items.push({ id: 'edit', label: `Edit ${ev.title}`, content: 'Edit', icon: <Pencil />, onSelect: () => navigate(`/coach/sessions/${ev.id}`) })
                } else {
                  if (!row.published && !cancelled) items.push({ id: 'publish', label: `Publish ${row.title}`, content: 'Publish', icon: <Send />, onSelect: () => publish(row) })
                  if (!registerProblem(row)) items.push({ id: 'register', label: `${sessionId ? 'Edit register' : 'Take register'} for ${row.title}`,
                    content: sessionId ? 'Edit register' : 'Take register', icon: <ClipboardCheck />, onSelect: guarded(() => setSheet({ kind: 'register', row })) })
                  if (row.event_type === 'match' && row.published && !cancelled && started) items.push(games && evaluations.data?.get(row.id)?.publishedAt
                    ? { id: 'match', label: `View review of ${row.title}`, content: 'View review', icon: <ClipboardList />, onSelect: () => navigate(`/coach/games/${row.id}?tab=evaluation`) }
                    : sessionId
                    ? { id: 'match', label: `Edit match for ${row.title}`, content: 'Edit match', icon: <Pencil />, onSelect: () => navigate(`/coach/sessions/${sessionId}`) }
                    // TRAK-288: where Games is on, the match's evaluation replaces the match log.
                    : games ? { id: 'match', label: `Evaluate ${row.title}`, content: 'Evaluate', icon: <ClipboardList />, onSelect: () => navigate(`/coach/games/${row.id}?tab=evaluation`) }
                    : { id: 'match', label: `Log match for ${row.title}`, content: 'Log match', icon: <ClipboardList />, onSelect: guarded(() => navigate('/coach/sessions/quick', {
                        state: { fromEvent: { eventId: row.id, date: row.event_date, opponent: row.opponent, homeAway: row.home_away, squad: row.squad ?? null } },
                      })) })
                  // TRAK-139, TRAK-168: the phone's share sheet (Viber or WhatsApp; WhatsApp's link without one). Trak sends nothing.
                  if (shareText) items.push({ id: 'share', label: `Share ${row.title}`, content: 'Share', icon: <ShareIcon size={16} tight />, onSelect: guarded(() => shareEventText(shareText)) })
                  // TRAK-230: once started, what families were told is fixed.
                  if (!cancelled && !startedLocked(row)) items.push({ id: 'edit', label: `Edit ${row.title}`, content: 'Edit', icon: <Pencil />, onSelect: () => openEdit(row) })
                  if (!cancelled && canDelete(row)) items.push({ id: 'delete', label: `Delete ${row.title}`, content: 'Delete',
                    icon: <Trash2 color="rgb(var(--t-danger))" />, onSelect: () => void deleteDraft(row) })
                  else if (!cancelled && !startedLocked(row)) items.push({ id: 'cancel', label: `Cancel ${row.title}`, content: 'Cancel',
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
                                <Link to={`/coach/sessions/${sheetEvent.sessionId}`}
                                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-raised text-[14px] font-medium text-ink focus-visible:ring-2 focus-visible:ring-primary">
                                  Open session
                                </Link>
                                {user && <LoggedAttendance sessionId={sheetEvent.sessionId} coachId={user.id} />}
                              </>
                            : user && <EventSheetCoach event={sheetEvent} coachId={user.id} onChanged={() => void loadData()} />}
                        </EventSheet>
                      ) : titleText}
                      <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>
                        {/* TRAK-159: a scheduled event says its time, or that it has none. */}
                        {ev.time
                          ? <><span className="text-[11px] font-medium" style={{ color: 'rgb(var(--t-ink))' }}>{ev.time}</span>{' · '}</>
                          : row && <><span className="text-[10px] font-medium" style={{ color: NO_TIME_COLOR }}>No time set</span>{' · '}</>}
                        {/* TRAK-271: the type's colour is a dot; the word stays dark. */}<span className="inline-flex items-center gap-1 font-medium text-ink-2"><span aria-hidden="true" className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: TYPE_COLOR[ev.type] }} />{TYPE_LABEL[ev.type]}</span>{everySquad ? ` · ${squadName(ev.squad)}` : ''}{row?.series_id ? ' · Weekly' : ''}
                        {row?.meet_time ? ` · meet ${phoneClock(row, row.meet_time)}` : ''}
                        {row?.home_away ? ` · ${row.home_away === 'home' ? 'Home' : 'Away'}` : ''}
                        {place?.text ? ` · ${place.text}` : ''}
                      </p>
                      {row?.kit && (
                        <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgb(var(--t-ink-3))' }}>Kit: {row.kit}</p>
                      )}
                      {/* TRAK-255 (TRAK-225's link): the venue opens in Maps from the coach's day too. */}
                      {place && (
                        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer"
                          className="mt-1 flex w-fit items-center gap-1 min-h-8 text-[12px] font-medium text-brand underline" style={font}>
                          <MapPin size={13} aria-hidden="true" />Open in Maps
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
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium text-ink-2 bg-raised" style={font}>Logged</span>
                        )}
                        {row && row.event_type === 'match' && sessionId && (
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium text-ink-2 bg-raised" style={font}>Match logged</span>
                        )}
                        {/* TRAK-270: the yellow of needs you; its word stays dark for contrast. */}
                        {waiting && (
                          <span className="block w-fit rounded-full px-2 py-[1px] text-[11px] font-medium"
                            style={{ ...font, color: 'rgb(var(--t-warning))', background: 'rgb(var(--t-attention) / 0.22)', border: `1.5px solid ${NEEDS_YOU_COLOR}` }}>Needs you</span>
                        )}
                      </div>
                      {row && !cancelled && clashes.has(row.id) && (() => {
                        const c = clashes.get(row.id)!
                        return <p className="text-[11px] mt-0.5 text-warning" style={font}>
                          {`Clashes with ${c.title}, ${c.start}–${c.end}. Change the time to publish it.`}
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
                        <ButtonGroup label={`Actions for ${ev.title}`} items={groupItems} variant="outline" size="md" />
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

      {/* ── Event sheet: new or edit, one step per screen (TRAK-182) ──────── */}
      {sheet.kind === 'edit' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={sheet.row ? 'Edit event' : 'New event'}
            className="w-full max-w-sheet rounded-t-[24px] px-5 pt-5 space-y-3 overflow-y-auto"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', maxHeight: '85vh', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-ink" style={font}>
                {sheet.row ? 'Edit event' : 'New event'}
              </span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} color="rgb(var(--t-ink-2))" />
              </button>
            </div>

            <div className="arc">
              <Stepper label="Event steps" steps={EVENT_STEPS} current={sheet.step} onStepSelect={toStep} />
            </div>

            {sheet.step === 0 && <>
              {/* An edit opens here, so a weekly series asks first which weeks change:
                  "This and following" keeps each week's own date (the When step). */}
              {inSeries(sheet.row) && (
                <ScopeChoice scope={sheet.scope}
                  onChange={scope => setSheet(s => s.kind === 'edit' ? { ...s, scope, error: null } : s)} />
              )}
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Event type">
                {EVENT_KINDS.map(t => (
                  <Chip key={t} on={sheet.form.kind === t} color={TYPE_COLOR[t]} onClick={() => setForm({ kind: t })}>
                    {TYPE_LABEL[t]}
                  </Chip>
                ))}
              </div>

              {/* Imad, 24 Oct: which squad a new event is for, never silently the last pill tapped. A saved event keeps
                  its squad: moving a published one would change which families have it. */}
              {!sheet.row && coachSquad.squads.length >= 2 && (
                <div className="flex gap-2 flex-wrap" role="group" aria-label="Squad">
                  {[...coachSquad.squads, null].map(squad => (
                    <Chip key={squad ?? 'all'} on={(sheet.form.squad === undefined ? coachSquad.squad : sheet.form.squad) === squad} onClick={() => setForm({ squad })}>
                      {squadName(squad)}
                    </Chip>
                  ))}
                </div>
              )}

              {sheet.form.kind === 'training' && (
                <ThemeChoice theme={sheet.form.theme} onChange={theme => setForm({ theme })} />
              )}

              {sheet.form.kind === 'match' && (
                <>
                  <Field label="Opponent">
                    <input value={sheet.form.opponent} onChange={e => setForm({ opponent: e.target.value })}
                      placeholder="e.g. Al Wasl U15" className={inputClass} style={font} />
                  </Field>
                  <div className="flex gap-2" role="group" aria-label="Home or away">
                    <Chip on={sheet.form.homeAway === 'home'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'home' ? '' : 'home' })}>Home</Chip>
                    <Chip on={sheet.form.homeAway === 'away'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'away' ? '' : 'away' })}>Away</Chip>
                  </div>
                  {/* TRAK-288: asked here, so publishing the evaluation reads it from the match (Imad, 28 Oct). */}
                  {games && <div className="flex gap-2 flex-wrap" role="group" aria-label="Competition">
                    {COMPETITIONS.map(c => <Chip key={c.value} on={sheet.form.competition === c.value} onClick={() => setForm({ competition: c.value })}>{c.label}</Chip>)}
                  </div>}
                </>
              )}

              <Field label={sheet.form.kind === 'other' ? 'What is it' : 'Title (optional)'}>
                <input value={sheet.form.title} onChange={e => setForm({ title: e.target.value })}
                  placeholder={sheet.form.kind === 'match' ? `vs ${sheet.form.opponent || 'Opponent'}` : sheet.form.kind === 'training' ? 'Training' : 'e.g. Team photo'}
                  className={inputClass} style={font} />
              </Field>

              {/* TRAK-255: a venue is a name everyone reads; its map link has a box of its own. */}
              <Field label="Venue">
                <input value={splitVenue(sheet.form.venue).name} onChange={e => setVenueName(e.target.value)}
                  list="saved-venues" placeholder="Pick a saved venue or type its name" className={inputClass} style={font} />
                <datalist id="saved-venues">
                  {venues.map(v => <option key={v.name} value={v.name} />)}
                </datalist>
              </Field>
              <div className="space-y-1">
                <Field label="Map link (optional)">
                  <input value={mapLinkText ?? splitVenue(sheet.form.venue).link} onChange={e => setVenueLink(e.target.value)}
                    inputMode="url" placeholder="Paste a Google Maps or Apple Maps link" className={inputClass} style={font} />
                </Field>
                {mapLinkText && !isMapsUrl(mapLinkText) && (
                  <p className="text-[11px] text-warning" style={font}>That isn't a Google Maps or Apple Maps link, so it won't be saved.</p>
                )}
              </div>
            </>}

            {sheet.step === 1 && <>
              {/* TRAK-157: Arc's date and time pickers (founders, 12 Oct). A start
                  time is picked whole from the list; there is no "no time". */}
              <ArcField>
                <DatePicker label={sheet.repeat.on ? 'First date' : 'Date'} className="arc-trak-field"
                  value={dayAsDate(sheet.form.date)} onChange={date => { if (date) setForm({ date: dateAsDay(date) }) }}
                  disabled={sheet.scope === 'following'} clearable={false} placeholder="Pick a date"
                  format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
              </ArcField>
              <ArcField>
                <TimePicker label={sheet.form.kind === 'match' ? 'Kickoff' : 'Start'} className="arc-trak-field"
                  value={sheet.form.time} onChange={time => setForm({ time })}
                  minuteStep={5} format="12h" placeholder="Pick a start time" emptyAt="17:00" />
              </ArcField>

              {sheet.scope === 'following' && (
                <p className="text-[11px] text-ink-3" style={font}>Each week keeps its own date; everything else changes.</p>
              )}

              {/* Optional: empty means meet at the start time. */}
              <ArcField>
                <TimePicker label="Meet time (if earlier)" className="arc-trak-field"
                  value={sheet.form.meetTime} onChange={meetTime => setForm({ meetTime })}
                  minuteStep={5} format="12h" placeholder="Same as the start" emptyAt={halfHourBefore(sheet.form.time)}
                  disabled={!sheet.form.time} />
                {sheet.form.meetTime && (
                  <button type="button" onClick={() => setForm({ meetTime: '' })}
                    className="mt-1 text-[12px] text-ink-2" style={font}>
                    No separate meet time
                  </button>
                )}
              </ArcField>

              <div className="space-y-1">
                <span className="text-[9px] tracking-[0.1em] uppercase text-ink-3" style={mono}>Length</span>
                <div className="flex gap-2 flex-wrap" role="group" aria-label="Length">
                  {DURATIONS.map(d => (
                    <Chip key={d} on={sheet.form.duration === d} onClick={() => setForm({ duration: d })}>{d} min</Chip>
                  ))}
                </div>
              </div>

              {!sheet.row && sheet.form.kind !== 'match' && (
                <div className="space-y-2">
                  <Chip on={sheet.repeat.on} onClick={() => setRepeat({ on: !sheet.repeat.on })}>Repeats weekly</Chip>
                  {sheet.repeat.on && (
                    <>
                      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Repeat on">
                        {WEEKDAYS.map((label, day) => (
                          <Chip key={label} on={sheet.repeat.days.includes(day)} onClick={() => toggleDay(day)}>{label}</Chip>
                        ))}
                      </div>
                      <ArcField>
                        <DatePicker label="Ends on" className="arc-trak-field"
                          value={dayAsDate(sheet.repeat.until)} onChange={date => { if (date) setRepeat({ until: dateAsDay(date) }) }}
                          clearable={false} placeholder="Pick the last date"
                          format={{ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }} locale="en-GB" />
                      </ArcField>
                      {!repeatProblem(sheet.form, sheet.repeat) && (
                        <p className="text-[11px] text-ink-2" style={font}>
                          {seriesDates(sheet.form.date, sheet.repeat.until, sheet.repeat.days).length} events, last one {formatEventDay(sheet.repeat.until)}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>}

            {/* Keep the kit editor mounted between steps so unsaved colors survive Back. */}
            <div hidden={sheet.step !== 2}>
              {user && coachSquad.ready && <EventKitField
                key={`${user.id}:${sheet.row ? sheet.row.squad ?? '' : coachSquad.squad ?? ''}`}
                coachId={user.id} squad={sheet.row ? sheet.row.squad ?? null : coachSquad.squad}
                value={sheet.form.kitSnapshot ?? null}
                onChange={kitSnapshot => setForm({ kitSnapshot, kit: kitSnapshot ? describeEventKit(kitSnapshot) : '' })} />}
            </div>
            {sheet.step === 2 && <>
              {/* TRAK-161: kit and a family note on every kind of event. */}
              {!sheet.form.kitSnapshot && <Field label="Kit">
                <input value={sheet.form.kit} onChange={e => setForm({ kit: e.target.value })}
                  placeholder={sheet.form.kind === 'match' ? 'e.g. Red shirts, black shorts' : 'e.g. Green bibs, shin guards'} className={inputClass} style={font} />
              </Field>}

              <div className="space-y-1">
                <Field label="Note for families">
                  <input value={sheet.form.familyNote} onChange={e => setForm({ familyNote: e.target.value })}
                    maxLength={FAMILY_NOTE_MAX} aria-describedby={noteProblem ? "family-note-hint family-note-problem" : "family-note-hint"}
                    placeholder="e.g. Bring extra water, it's a hot day" className={inputClass} style={font} />
                </Field>
                <p id="family-note-hint" className="text-[11px] text-ink-3" style={font}>
                  Players and parents see this. A note with a player's name or a link isn't shown to them.
                </p>
                {noteProblem && (
                  <p id="family-note-problem" role="status" className="text-[11px] text-warning" style={font}>
                    Families won't see this note: {noteProblem === 'link' ? 'it has a link' : 'it names a player'}.
                  </p>
                )}
              </div>
            </>}

            {sheet.step === REVIEW && <>
              {inSeries(sheet.row) && (
                <p className="text-[12px] text-ink-2" style={font}>
                  {sheet.scope === 'following' ? 'Saves this week and the following weeks.' : 'Saves only this week.'}
                </p>
              )}
              <EventSummary form={sheet.form} repeat={sheet.row ? null : sheet.repeat} noteProblem={noteProblem}
                squad={coachSquad.squads.length >= 2 ? squadName(sheet.row ? sheet.row.squad : sheet.form.squad === undefined ? coachSquad.squad : sheet.form.squad) : undefined} />
            </>}

            {datePassed && (sheet.step === 1 || sheet.step === REVIEW) && (
              <div role="alert" className="rounded-[12px] p-3 space-y-2 border border-danger/30 bg-danger/[0.06]">
                <p className="text-[12px] text-danger" style={font}>{datePassed}</p>
                <div className="flex gap-2">
                  {/* TRAK-288: where Games is on, a played match is a New event Match, evaluated on its game page. */}
                  {!games && <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('match')}>Log match</Button>}
                  <Button size="md" variant="secondary" className="flex-1" onClick={() => logInstead('training')}>Log training</Button>
                </div>
              </div>
            )}

            {sheet.error && sheet.error !== datePassed && (
              <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>
            )}

            {sheet.step === REVIEW && sheet.row?.published && (
              <p className="text-[11px] text-ink-3" style={font}>Families see the change as soon as you save.</p>
            )}

            {/* The decision sits where the thumb is, as on the assessment. */}
            <div className="arc sticky bottom-0 -mx-5 px-5 pt-3 pb-5 flex gap-2 bg-raised border-t border-line">
              {sheet.step === REVIEW ? <>
                <Button size="lg" variant="secondary" aria-label={`Back to ${EVENT_STEPS[REVIEW - 1].label}`} onClick={() => toStep(REVIEW - 1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                </Button>
                {sheet.row?.published ? (
                  <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => void saveEvent()}>Save changes</Button>
                ) : played ? (
                  <Button size="lg" className="flex-1" loading={saving} onClick={() => void saveEvent(true, true)}>Save and evaluate</Button>
                ) : <>
                  <Button size="lg" variant="secondary" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => void saveEvent()}>
                    {seriesCount(sheet) > 1 ? `Save ${seriesCount(sheet)} drafts` : 'Save draft'}
                  </Button>
                  <Button size="lg" className="flex-1" loading={saving} disabled={!!datePassed} onClick={() => void saveEvent(true)}>
                    {seriesCount(sheet) > 1 ? `Publish ${seriesCount(sheet)}` : 'Publish'}
                  </Button>
                </>}
              </> : <>
                {sheet.step > 0 && (
                  <Button size="lg" variant="secondary" className="flex-1" aria-label={`Back to ${EVENT_STEPS[sheet.step - 1].label}`}
                    onClick={() => toStep(sheet.step - 1)}>Back</Button>
                )}
                <Button size="lg" className="flex-1" onClick={nextStep}>Next</Button>
              </>}
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel sheet ──────────────────────────────────────────────────── */}
      {sheet.kind === 'cancel' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Cancel event"
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>Cancel {sheet.row.title}?</span>
            <p className="text-[12px] text-ink-2" style={font}>
              It stays on everyone's schedule, marked Cancelled.
            </p>
            {inSeries(sheet.row) && (
              <ScopeChoice scope={sheet.scope}
                onChange={scope => setSheet(s => s.kind === 'cancel' ? { ...s, scope, error: null } : s)} />
            )}
            <Field label="Reason (optional)">
              <input value={sheet.reason}
                onChange={e => setSheet(s => s.kind === 'cancel' ? { ...s, reason: e.target.value, error: null } : s)}
                placeholder="e.g. Pitch waterlogged" className={inputClass} style={font} />
            </Field>
            {sheet.error && <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>}
            <button onClick={confirmCancel} disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium"
              style={{ background: 'rgb(var(--t-danger))', color: 'rgb(var(--t-on-brand))', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Cancelling…' : 'Cancel event'}
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              Keep event
            </button>
          </div>
        </div>
      )}

      {/* ── Cancelled: tell the team group (TRAK-168) ─────────────────────── */}
      {sheet.kind === 'cancelled' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Event cancelled"
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>Event cancelled</span>
            <p className="text-[12px] text-ink-2" style={font}>
              {sheet.note} Let the team group know.
            </p>
            {/* Nothing is sent until the coach picks a chat (the phone's share sheet, or WhatsApp's link). */}
            <ShareEventButton text={whatsAppShareText(shareableFromRow(sheet.row, sheet.row.squad ?? squad.label), { childNames: squad.childNames })}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium flex items-center justify-center gap-2 bg-brand text-on-brand">
              <ShareIcon size={18} />Share
            </ShareEventButton>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Import sheet (TRAK-129, J8.6) ─────────────────────────────────── */}
      {sheet.kind === 'import' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Import fixtures"
            className="w-full max-w-sheet max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-ink" style={font}>Import fixtures</span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} className="text-ink-2" />
              </button>
            </div>
            <p className="text-[12px] text-ink-2" style={font}>
              Fixtures arrive as drafts. Families see each one once you publish it.
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
          <div role="dialog" aria-label="Take register"
            className="w-full max-w-sheet max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[16px] font-medium text-ink" style={font}>
                {`Register: ${sheet.row.title}, ${formatEventDay(displayEventTime(sheet.row).date)}`}
              </span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} className="text-ink-2" />
              </button>
            </div>
            <p className="text-[12px] text-ink-2" style={font}>
              Tap anyone who didn't come. Saving makes this the completed session; saving again updates it.
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
          <div role="dialog" aria-label={sheet.action === 'publish' ? 'Publish event' : 'Delete draft'}
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>
              {sheet.action === 'publish' ? 'Publish' : 'Delete'} {sheet.row.title}, {formatEventDay(sheet.row.event_date!)}
            </span>
            <p className="text-[12px] text-ink-2" style={font}>
              {sheet.action === 'publish'
                ? 'This week is part of a weekly series. Families see what you publish.'
                : 'This week is part of a weekly series. Only drafts are deleted; published weeks stay.'}
            </p>
            {sheet.error && <p role="alert" className="text-[12px] text-danger" style={font}>{sheet.error}</p>}
            <button onClick={() => seriesAction('one')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))', color: sheet.action === 'publish' ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink))' }}>
              Only this week
            </button>
            <button onClick={() => seriesAction('following')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? 'rgb(var(--t-brand))' : 'rgb(var(--t-raised))', color: sheet.action === 'publish' ? 'rgb(var(--t-on-brand))' : 'rgb(var(--t-ink))' }}>
              This and following weeks
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              Not now
            </button>
          </div>
        </div>
      )}

      {/* ── Not published: a refused series, until the coach closes it (TRAK-218) ── */}
      {sheet.kind === 'notPublished' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgb(var(--t-scrim) / 0.75)' }}>
          <div role="dialog" aria-label="Not published"
            className="w-full max-w-sheet rounded-t-[24px] p-5 space-y-3"
            style={{ background: 'rgb(var(--t-raised))', border: '1px solid rgb(var(--t-line))', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-ink block" style={font}>Not published</span>
            <p className="text-[12px] text-ink-2" style={font}>
              None of the {sheet.count} events went out. They’re saved as drafts only you can see.
            </p>
            {sheet.weeks.length ? <>
              <ul role="alert" className="space-y-1">
                {sheet.weeks.map(w => <li key={w.date} className="text-[12px] text-danger" style={font}>{overlapLine(w)}</li>)}
              </ul>
              <p className="text-[12px] text-ink-2" style={font}>
                {fixLine(sheet.weeks)}. Then tap Publish on the first week and choose This and following weeks.
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
                Show {formatEventDay(sheet.weeks[0].date)}
              </button>
            )}
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-ink-2" style={font}>
              Close
            </button>
          </div>
        </div>
      )}

      <QuickAdd onSaved={loadData} />
      <NavBar role="coach" activeTab="/coach/schedule" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
