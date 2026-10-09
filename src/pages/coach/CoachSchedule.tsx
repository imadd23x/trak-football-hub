import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Pencil, Send, Trash2, Ban, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { displayEventTime } from '@/lib/event-time'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { useParked } from '@/components/trak/parked'
import {
  DURATIONS, EVENT_KINDS, blankForm, canDelete, cancelPatch, formProblem, formToRow,
  isCancelled, rowToForm, savedVenues, type EventForm, type EventKind, type EventRow,
} from '@/lib/coach-events'

/* TRAK-127 (J8.4): the coach creates, edits and cancels events. A save is a
   draft only the coach sees; Publish sends it to families (Imad, 9 Oct). Once
   published, an edit goes live on save. A cancel keeps the event on the
   schedule as Cancelled; only a draft nobody has seen can be deleted. The AI
   "Read Schedule" import is gone (G7): fixtures come in by CSV (J8.6). */

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
}

// ── Colours ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<ShownType, string> = {
  match:      '#4ade80',
  training:   '#C8F25A',
  tournament: '#c084fc',
  other:      'rgba(255,255,255,0.45)',
}

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

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const startDow = (first.getDay() + 6) % 7   // Mon = 0
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  // Pad to full row
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}

function formatEventDay(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

/** A write that changed no row was refused (RLS filters, it doesn't error). */
function failed(error: unknown, data: unknown[] | null) {
  return !!error || !data?.length
}

const SAVE_FAILED = "Couldn't save the event. Check your connection and try again; your details are still here."

const inputClass = 'w-full bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[14px] text-white/88 placeholder-white/20 outline-none'
const font = { fontFamily: "'DM Sans', sans-serif" }
const mono = { fontFamily: "'DM Mono', monospace" }

function Chip({ on, color = '#C8F25A', onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="px-3 py-1.5 rounded-full text-xs transition-colors"
      style={{
        background: on ? `${color}22` : 'rgba(255,255,255,0.05)',
        color: on ? color : 'rgba(255,255,255,0.45)',
        border: `1px solid ${on ? color + '55' : 'rgba(255,255,255,0.07)'}`,
        ...font,
      }}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] tracking-[0.1em] uppercase text-white/40" style={mono}>{label}</span>
      {children}
    </label>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

type Sheet =
  | { kind: 'closed' }
  | { kind: 'edit'; id: string | null; form: EventForm; published: boolean; error: string | null }
  | { kind: 'cancel'; row: EventRow; reason: string; error: string | null }

export default function CoachSchedule() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Calendar view state
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected,  setSelected]  = useState<string>(toDateStr(today))

  // Data
  const [calEvents, setCalEvents] = useState<EventRow[]>([])
  const [sessions,  setSessions]  = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const [sheet, setSheet] = useState<Sheet>({ kind: 'closed' })
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    if (!user) return
    const [ev, sess] = await Promise.all([
      supabase.from('coach_calendar_events')
        .select('*').eq('coach_user_id', user.id).order('starts_at'),
      supabase.from('coach_sessions')
        .select('id, title, session_type, session_date, opponent, competition, venue, notes')
        .eq('coach_user_id', user.id).order('session_date'),
    ])
    // A failed read is not an empty calendar (the J4 standard).
    setLoadFailed(!!ev.error || !!sess.error)
    if (!ev.error) setCalEvents((ev.data as EventRow[]) || [])
    if (!sess.error) setSessions(sess.data || [])
  }

  useEffect(() => { loadData() }, [user])

  const retry = async () => { setRetrying(true); await loadData(); setRetrying(false) }

  // Normalise both data sources into CalEvent[]
  const allEvents = useMemo<CalEvent[]>(() => {
    const ev: CalEvent[] = []
    for (const e of calEvents) {
      const shown = displayEventTime(e)
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
      })
    }
    for (const s of sessions) {
      ev.push({
        id:       s.id,
        title:    s.title || (s.session_type === 'match' ? `vs ${s.opponent}` : 'Training'),
        type:     (s.session_type === 'match' ? 'match' : s.session_type === 'training' ? 'training' : 'other') as ShownType,
        date:     s.session_date ?? '',
        source:   'session',
        opponent: s.opponent,
        venue:    s.venue,
      })
    }
    return ev.filter(e => e.date)
  }, [calEvents, sessions])

  const venues = useMemo(() => savedVenues(calEvents), [calEvents])

  // Index events by date string for fast lookup
  const byDate = useMemo<Record<string, CalEvent[]>>(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [allEvents])

  // Month navigation
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const cells   = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const todayStr = toDateStr(today)

  const selectedEvents = byDate[selected] ?? []

  const openNew = (date: string) =>
    setSheet({ kind: 'edit', id: null, form: blankForm(date), published: false, error: null })
  const openEdit = (row: EventRow) =>
    setSheet({ kind: 'edit', id: row.id, form: rowToForm(row), published: row.published, error: null })
  const setForm = (patch: Partial<EventForm>) =>
    setSheet(s => s.kind === 'edit' ? { ...s, form: { ...s.form, ...patch }, error: null } : s)

  const saveEvent = async () => {
    if (parked) return comingSoon()
    if (!user || sheet.kind !== 'edit') return
    const problem = formProblem(sheet.form)
    if (problem) { setSheet({ ...sheet, error: problem }); return }
    setSaving(true)
    const row = formToRow(sheet.form)
    // New events start as drafts; an edit leaves published alone, so a
    // published event's change goes live on save.
    const { data, error } = sheet.id
      ? await supabase.from('coach_calendar_events').update(row).eq('id', sheet.id).select('id')
      : await supabase.from('coach_calendar_events')
          .insert({ ...row, coach_user_id: user.id, published: false, source: 'manual' }).select('id')
    setSaving(false)
    // Errors keep what was typed and say what failed (the J4 standard).
    if (failed(error, data)) { setSheet({ ...sheet, error: SAVE_FAILED }); return }
    setSheet({ kind: 'closed' })
    setSelected(sheet.form.date)
    loadData()
    toast.success(sheet.id
      ? sheet.published ? 'Saved. Families see the change.' : 'Draft saved'
      : 'Saved as a draft. Tap Publish when it’s ready.')
  }

  const publish = async (row: EventRow) => {
    if (parked) return comingSoon()
    const { data, error } = await supabase.from('coach_calendar_events')
      .update({ published: true }).eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(`Couldn't publish "${row.title}". Try again.`); return }
    loadData()
    toast.success('Published to the squad')
  }

  const confirmCancel = async () => {
    if (parked) return comingSoon()
    if (sheet.kind !== 'cancel') return
    setSaving(true)
    const { data, error } = await supabase.from('coach_calendar_events')
      .update(cancelPatch(sheet.reason)).eq('id', sheet.row.id).select('id')
    setSaving(false)
    if (failed(error, data)) {
      setSheet({ ...sheet, error: "Couldn't cancel the event. Check your connection and try again." })
      return
    }
    setSheet({ kind: 'closed' })
    loadData()
    toast.success('Event cancelled. It stays on the schedule as Cancelled.')
  }

  const deleteDraft = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (!canDelete(row)) return
    const { data, error } = await supabase.from('coach_calendar_events').delete().eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(`Couldn't delete "${row.title}". Try again.`); return }
    if (sheet.kind === 'edit' && sheet.id === row.id) setSheet({ kind: 'closed' })
    loadData()
    toast.success('Draft deleted')
  }

  return (
    <MobileShell>
      <div className="pt-3 pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-light text-white/88 tracking-tight"
            style={{ ...font, letterSpacing: '-0.02em' }}>
            Calendar
          </h1>
          <button
            onClick={() => openNew(selected)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[#C8F25A]"
            aria-label="Add event">
            <Plus size={16} color="#000" strokeWidth={2.5} />
          </button>
        </div>

        {loadFailed && <LoadError what="your calendar" onRetry={retry} retrying={retrying} />}

        {/* ── Month grid ───────────────────────────────────────────────────── */}
        <div className="rounded-[18px] border border-white/[0.07] overflow-hidden"
          style={{ background: '#101012' }}>

          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
            <button onClick={prevMonth} aria-label="Previous month" className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronLeft size={14} color="rgba(255,255,255,0.6)" />
            </button>
            <span className="text-[13px] font-medium text-white/88" style={font}>
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button onClick={nextMonth} aria-label="Next month" className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 px-1 pt-2 pb-1">
            {DAY_LABELS.map(l => (
              <div key={l} className="text-center text-[9px] font-medium tracking-[0.08em] uppercase"
                style={{ ...mono, color: 'rgba(255,255,255,0.25)' }}>
                {l}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 px-1 pb-3 gap-y-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />

              const dateStr  = toDateStr(date)
              const isToday  = dateStr === todayStr
              const isSel    = dateStr === selected
              const dayEvs   = byDate[dateStr] ?? []
              const isPast   = date < today && !isToday
              const dots     = dayEvs.slice(0, 3)

              return (
                <button key={i}
                  onClick={() => setSelected(dateStr)}
                  className="flex flex-col items-center py-1.5 rounded-[10px] transition-colors"
                  style={{
                    background: isSel ? 'rgba(200,242,90,0.14)' : 'transparent',
                    border: isToday ? '1px solid rgba(200,242,90,0.4)' : '1px solid transparent',
                  }}>
                  <span className="text-[12px] leading-none"
                    style={{
                      ...font,
                      color: isSel ? '#C8F25A'
                        : isToday ? '#C8F25A'
                        : isPast  ? 'rgba(255,255,255,0.3)'
                        : 'rgba(255,255,255,0.78)',
                      fontWeight: isToday || isSel ? 600 : 400,
                    }}>
                    {date.getDate()}
                  </span>
                  {/* Event dots */}
                  <div className="flex items-center gap-[3px] mt-1.5 h-[5px]">
                    {dots.map((ev, di) => (
                      <div key={di} className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                        style={{ background: ev.row && isCancelled(ev.row) ? 'rgba(255,255,255,0.15)' : TYPE_COLOR[ev.type] }} />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.05]">
            {EVENT_KINDS.map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: TYPE_COLOR[type] }} />
                <span className="text-[8px] uppercase tracking-[0.08em]"
                  style={{ ...mono, color: 'rgba(255,255,255,0.3)' }}>
                  {TYPE_LABEL[type]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Selected day ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-white/40" style={mono}>
              {formatEventDay(selected)}
            </span>
            <button
              onClick={() => openNew(selected)}
              className="text-[9px] tracking-[0.1em] uppercase text-[#C8F25A]"
              style={mono}>
              + Add
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <div className="rounded-[14px] border border-white/[0.05] px-4 py-5 text-center"
              style={{ background: '#101012' }}>
              <p className="text-[12px] text-white/30">Nothing planned. Tap + Add to schedule an event.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const row = ev.row
                const cancelled = !!row && isCancelled(row)
                return (
                  <div key={ev.id}
                    className="rounded-[14px] px-4 py-3 flex items-start gap-3"
                    style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)', opacity: cancelled ? 0.7 : 1 }}>
                    <div className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: cancelled ? 'rgba(255,255,255,0.15)' : TYPE_COLOR[ev.type], minHeight: 28 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate"
                        style={{ color: 'rgba(255,255,255,0.88)', ...font, textDecoration: cancelled ? 'line-through' : undefined }}>
                        {ev.title}
                      </p>
                      <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgba(255,255,255,0.35)' }}>
                        {TYPE_LABEL[ev.type]}{ev.time ? ` · ${ev.time}` : ''}
                        {row?.meet_time ? ` · meet ${row.meet_time.slice(0, 5)}` : ''}
                        {row?.home_away ? ` · ${row.home_away === 'home' ? 'Home' : 'Away'}` : ''}
                        {ev.venue ? ` · ${ev.venue}` : ''}
                      </p>
                      {row?.kit && (
                        <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgba(255,255,255,0.35)' }}>Kit: {row.kit}</p>
                      )}
                      {ev.source === 'session' && (
                        <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                          style={{ color: 'rgba(255,255,255,0.22)', ...mono }}>
                          Logged
                        </span>
                      )}
                      {row && (
                        <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                          style={{ color: cancelled ? '#f87171' : row.published ? '#C8F25A' : 'rgba(255,255,255,0.35)', ...mono }}>
                          {cancelled ? 'Cancelled' : row.published ? 'Published' : 'Draft · only you see this'}
                        </span>
                      )}
                      {cancelled && row?.cancel_reason && (
                        <p className="text-[11px] mt-0.5 text-white/45" style={font}>{row.cancel_reason}</p>
                      )}
                    </div>
                    {row && !cancelled && (
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button onClick={() => openEdit(row)} aria-label={`Edit ${row.title}`}>
                          <Pencil size={14} color="rgba(255,255,255,0.5)" />
                        </button>
                        {!row.published && (
                          <button onClick={() => publish(row)} aria-label={`Publish ${row.title}`}>
                            <Send size={14} color="#C8F25A" />
                          </button>
                        )}
                        {canDelete(row) ? (
                          <button onClick={() => deleteDraft(row)} aria-label={`Delete ${row.title}`}>
                            <Trash2 size={14} color="rgba(255,255,255,0.3)" />
                          </button>
                        ) : (
                          <button onClick={() => setSheet({ kind: 'cancel', row, reason: '', error: null })}
                            aria-label={`Cancel ${row.title}`}>
                            <Ban size={14} color="rgba(248,113,113,0.8)" />
                          </button>
                        )}
                      </div>
                    )}
                    {ev.source === 'session' && (
                      <button
                        onClick={() => navigate('/coach/sessions/list')}
                        className="text-[9px] uppercase tracking-[0.08em] flex-shrink-0"
                        style={{ color: 'rgba(255,255,255,0.3)', ...mono }}>
                        View
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Event sheet: new or edit ──────────────────────────────────────── */}
      {sheet.kind === 'edit' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={sheet.id ? 'Edit event' : 'New event'}
            className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-3 overflow-y-auto"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '85vh', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-white/88" style={font}>
                {sheet.id ? 'Edit event' : 'New event'}
              </span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} color="rgba(255,255,255,0.5)" />
              </button>
            </div>

            <div className="flex gap-2 flex-wrap" role="group" aria-label="Event type">
              {EVENT_KINDS.map(t => (
                <Chip key={t} on={sheet.form.kind === t} color={TYPE_COLOR[t]} onClick={() => setForm({ kind: t })}>
                  {TYPE_LABEL[t]}
                </Chip>
              ))}
            </div>

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
              </>
            )}

            <Field label={sheet.form.kind === 'other' ? 'What is it' : 'Title (optional)'}>
              <input value={sheet.form.title} onChange={e => setForm({ title: e.target.value })}
                placeholder={sheet.form.kind === 'match' ? `vs ${sheet.form.opponent || 'Opponent'}` : sheet.form.kind === 'training' ? 'Training' : 'e.g. Team photo'}
                className={inputClass} style={font} />
            </Field>

            <div className="flex gap-2">
              <div className="flex-1">
                <Field label="Date">
                  <input type="date" value={sheet.form.date} onChange={e => setForm({ date: e.target.value })}
                    className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
                </Field>
              </div>
              <div className="w-[120px]">
                <Field label={sheet.form.kind === 'match' ? 'Kickoff' : 'Start'}>
                  <input type="time" value={sheet.form.time} onChange={e => setForm({ time: e.target.value })}
                    className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
                </Field>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[9px] tracking-[0.1em] uppercase text-white/40" style={mono}>Length</span>
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Length">
                {DURATIONS.map(d => (
                  <Chip key={d} on={sheet.form.duration === d} onClick={() => setForm({ duration: d })}>{d} min</Chip>
                ))}
              </div>
            </div>

            <Field label="Venue">
              <input value={sheet.form.venue} onChange={e => setForm({ venue: e.target.value })}
                list="saved-venues" placeholder="Pick a saved venue or type a new one" className={inputClass} style={font} />
              <datalist id="saved-venues">
                {venues.map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>

            <Field label="Meet time (if earlier)">
              <input type="time" value={sheet.form.meetTime} onChange={e => setForm({ meetTime: e.target.value })}
                className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
            </Field>

            {sheet.form.kind === 'match' && (
              <Field label="Kit">
                <input value={sheet.form.kit} onChange={e => setForm({ kit: e.target.value })}
                  placeholder="e.g. Red shirts, black shorts" className={inputClass} style={font} />
              </Field>
            )}

            {sheet.error && (
              <p role="alert" className="text-[12px] text-[#f87171]" style={font}>{sheet.error}</p>
            )}

            <button
              onClick={saveEvent}
              disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
              style={{ background: '#C8F25A', color: '#000', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : sheet.published ? 'Save changes' : 'Save draft'}
            </button>
            {sheet.published && (
              <p className="text-[11px] text-white/40 text-center" style={font}>Families see the change as soon as you save.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Cancel sheet ──────────────────────────────────────────────────── */}
      {sheet.kind === 'cancel' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Cancel event"
            className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-3"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-white/88 block" style={font}>Cancel {sheet.row.title}?</span>
            <p className="text-[12px] text-white/50" style={font}>
              It stays on everyone's schedule, marked Cancelled.
            </p>
            <Field label="Reason (optional)">
              <input value={sheet.reason}
                onChange={e => setSheet(s => s.kind === 'cancel' ? { ...s, reason: e.target.value, error: null } : s)}
                placeholder="e.g. Pitch waterlogged" className={inputClass} style={font} />
            </Field>
            {sheet.error && <p role="alert" className="text-[12px] text-[#f87171]" style={font}>{sheet.error}</p>}
            <button onClick={confirmCancel} disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium"
              style={{ background: '#f87171', color: '#000', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Cancelling…' : 'Cancel event'}
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-white/60" style={font}>
              Keep event
            </button>
          </div>
        </div>
      )}

      <NavBar role="coach" activeTab="/coach/schedule" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
