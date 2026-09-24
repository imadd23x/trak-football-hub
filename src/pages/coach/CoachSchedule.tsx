import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Sparkles, Trash2, Eye, EyeOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { toInstant, localParts, normalizeInstant, calendarFields, calendarFieldsFromInstant, displayEventTime, localTodayISO } from '@/lib/event-time'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { trackEvent } from '@/lib/telemetry'

// ── Types ────────────────────────────────────────────────────────────────────

type EventType = 'match' | 'training' | 'tournament' | 'other'

type CalEvent = {
  id: string
  title: string
  type: EventType
  date: string        // YYYY-MM-DD
  time?: string       // HH:MM
  source: 'calendar' | 'session'
  published?: boolean
  opponent?: string
  venue?: string
  notes?: string
}

// ── Colours ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<EventType, string> = {
  match:      '#4ade80',
  training:   '#C8F25A',
  tournament: '#c084fc',
  other:      'rgba(255,255,255,0.45)',
}

const TYPE_LABEL: Record<EventType, string> = {
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

function formatEventTime(time?: string) {
  if (!time) return ''
  return ' · ' + time
}

function formatEventDay(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

// ── Add-event modal ──────────────────────────────────────────────────────────

type AddEventModal = {
  open: boolean
  date: string
  title: string
  type: EventType
  time: string
  opponent: string
  venue: string
}

const BLANK_MODAL: AddEventModal = {
  open: false, date: '', title: '', type: 'training', time: '', opponent: '', venue: '',
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CoachSchedule() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Calendar view state
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected,  setSelected]  = useState<string>(toDateStr(today))

  // Data
  const [calEvents, setCalEvents] = useState<any[]>([])
  const [sessions,  setSessions]  = useState<any[]>([])

  // Add-event modal
  const [modal, setModal] = useState<AddEventModal>(BLANK_MODAL)
  const [saving, setSaving] = useState(false)

  // AI import (collapsed by default)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [parsing,    setParsing]    = useState(false)
  const [drafts,     setDrafts]     = useState<any[]>([])

  const loadData = async () => {
    if (!user) return
    const [{ data: evData }, { data: sessData }] = await Promise.all([
      supabase.from('coach_calendar_events')
        .select('*').eq('coach_user_id', user.id).order('starts_at'),
      supabase.from('coach_sessions')
        .select('id, title, session_type, session_date, opponent, competition, venue, notes')
        .eq('coach_user_id', user.id).order('session_date'),
    ])
    setCalEvents(evData || [])
    setSessions(sessData || [])
  }

  useEffect(() => { loadData() }, [user])

  // Normalise both data sources into CalEvent[]
  const allEvents = useMemo<CalEvent[]>(() => {
    const ev: CalEvent[] = []
    for (const e of calEvents) {
      ev.push({
        id:        e.id,
        title:     e.title,
        type:      (e.event_type || 'other') as EventType,
        date:      displayEventTime(e).date,
        // undefined rather than null keeps the existing "no time set" rendering.
        time:      displayEventTime(e).time ?? undefined,
        source:    'calendar',
        published: e.published,
        opponent:  e.opponent,
        venue:     e.venue,
        notes:     e.notes,
      })
    }
    for (const s of sessions) {
      ev.push({
        id:       s.id,
        title:    s.title || (s.session_type === 'match' ? `vs ${s.opponent}` : 'Training'),
        type:     (s.session_type === 'match' ? 'match' : s.session_type === 'training' ? 'training' : 'other') as EventType,
        date:     s.session_date ?? '',
        source:   'session',
        opponent: s.opponent,
        venue:    s.venue,
        notes:    s.notes,
      })
    }
    return ev.filter(e => e.date)
  }, [calEvents, sessions])

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

  // Selected day events
  const selectedEvents = byDate[selected] ?? []

  // Open add-event modal for a date
  const openAdd = (date: string) => {
    setModal({ ...BLANK_MODAL, open: true, date })
  }

  const saveEvent = async () => {
    if (!user || !modal.title.trim()) return
    setSaving(true)
    // A naive string handed to timestamptz is read as UTC, so the coach's
    // 18:00 was stored four hours late in Dubai. Send a real instant.
    const starts_at = toInstant(modal.date, modal.time || null)
    if (!starts_at) {
      setSaving(false)
      toast.error("That date and time isn't valid — please check it")
      return
    }
    // Written alongside starts_at, not instead of it: old clients still read
    // the instant, new readers prefer the calendar day. start_time NULL is the
    // explicit "time not known" that an instant cannot express.
    const cal = calendarFields(modal.date, modal.time || null)

    const { error } = await supabase.from('coach_calendar_events').insert({
      coach_user_id: user.id,
      title:         modal.title.trim(),
      event_type:    modal.type,
      starts_at,
      ...(cal ?? {}),
      opponent:      modal.opponent.trim() || null,
      venue:         modal.venue.trim() || null,
      published:     false,
      source:        'manual',
    })
    setSaving(false)
    if (error) { toast.error('Could not save'); return }
    setModal(BLANK_MODAL)
    loadData()
    toast.success('Event added')
  }

  const togglePublish = async (ev: CalEvent) => {
    if (ev.source !== 'calendar') return
    const current = calEvents.find(e => e.id === ev.id)
    const { error } = await supabase.from('coach_calendar_events')
      .update({ published: !current?.published }).eq('id', ev.id)
    if (error) { toast.error('Could not update'); return }
    loadData()
    toast.success(!current?.published ? 'Published to squad' : 'Unpublished')
  }

  const deleteEvent = async (ev: CalEvent) => {
    if (ev.source !== 'calendar') return
    const { error } = await supabase.from('coach_calendar_events').delete().eq('id', ev.id)
    if (error) { toast.error('Could not delete'); return }
    loadData()
  }

  // AI import
  const parseImport = async () => {
    if (!importText.trim()) { toast.error('Paste some text first'); return }
    setParsing(true)
    try {
      const { data, error } = await supabase.functions.invoke('parse-schedule', {
        body: { text: importText, todayISO: localTodayISO() },
      })
      // On a non-2xx, supabase-js puts the body on the error's response rather
      // than in `data` (the same idiom AuthContext uses for send-parent-invite).
      // Without this a spent daily allowance surfaced as "Parse failed", which
      // tells the coach nothing and invites them to retry immediately — the one
      // thing that cannot work. Prefer the function's own sentence.
      let failure = data?.error as string | undefined
      if (error && !failure) {
        try { failure = (await (error as { context?: Response }).context?.json())?.error } catch { /* no body */ }
      }
      if (error || failure) throw new Error(failure || 'Parse failed')
      const list = data?.events || []
      trackEvent('schedule_parsed', {
        input_chars: importText.trim().length,
        events_found: list.length,
      })
      if (!list.length) toast.error('No events found. Try clearer dates/times.')
      else { setDrafts(list); toast.success(`Found ${list.length} event${list.length > 1 ? 's' : ''}`) }
    } catch (e: any) {
      toast.error(e.message || 'Could not read schedule')
    } finally {
      setParsing(false)
    }
  }

  const saveDraft = async (idx: number) => {
    if (!user) return
    const ev = drafts[idx]
    const startsAt = normalizeInstant(ev.starts_at)
    if (!startsAt) {
      toast.error(`"${ev.title}" has no usable date — set one before saving it`)
      return
    }
    // An unreadable end time was being written as NULL without a word, while
    // an unreadable start was reported. Same input, same parser, two different
    // outcomes — so an event silently lost the time it was due to finish.
    const endsAt = ev.ends_at ? normalizeInstant(ev.ends_at) : null
    if (ev.ends_at && !endsAt) {
      toast.error(`"${ev.title}" has an end time we couldn't read — check it before saving`)
      return
    }
    const { error } = await supabase.from('coach_calendar_events').insert({
      coach_user_id: user.id,
      title: ev.title, event_type: ev.event_type, starts_at: startsAt,
      // Imported rows need the calendar columns too. Without this every row
      // the parser creates lands with them NULL after the one-time backfill,
      // and keeps the untimed/filter ambiguity the columns exist to remove.
      ...(calendarFieldsFromInstant(startsAt, ev.time_known) ?? {}),
      ends_at: endsAt, venue: ev.venue || null,
      opponent: ev.opponent || null, notes: ev.notes || null,
      published: false, source: 'ai_text',
    })
    // A rejected insert used to remove the draft and report success, so the
    // coach believed a session was in the calendar that was never written.
    if (error) {
      toast.error(`Couldn't save "${ev.title}" — it's still here, try again`)
      return
    }
    setDrafts(d => d.filter((_, i) => i !== idx))
    loadData()
    toast.success('Event saved')
  }

  const saveAllDrafts = async () => {
    if (!user || !drafts.length) return
    // A draft the parser could not date is not silently dropped into the
    // calendar at the wrong moment — it is left behind and named.
    const rows = drafts
      .map(ev => ({
        ev,
        startsAt: normalizeInstant(ev.starts_at),
        // Treated exactly like a bad start: reported, not silently nulled.
        endsAt: ev.ends_at ? normalizeInstant(ev.ends_at) : null,
        endBroken: !!ev.ends_at && normalizeInstant(ev.ends_at) === null,
      }))
      .filter((r): r is { ev: typeof drafts[number]; startsAt: string; endsAt: string | null; endBroken: boolean } =>
        r.startsAt !== null && !r.endBroken)

    const undated = drafts.length - rows.length
    if (undated > 0) {
      toast.error(`${undated} event${undated === 1 ? '' : 's'} had a date or end time we couldn't read and ${undated === 1 ? 'was' : 'were'} not saved`)
    }
    if (!rows.length) return

    const { error } = await supabase.from('coach_calendar_events').insert(
      rows.map(({ ev, startsAt, endsAt }) => ({
        coach_user_id: user.id,
        title: ev.title, event_type: ev.event_type, starts_at: startsAt,
        ...(calendarFieldsFromInstant(startsAt, ev.time_known) ?? {}),
        ends_at: endsAt, venue: ev.venue || null,
        opponent: ev.opponent || null, notes: ev.notes || null,
        published: false, source: 'ai_text',
      }))
    )
    // A rejected insert used to clear every draft and report them all saved.
    // Nothing was written, so nothing is removed and nothing is claimed.
    if (error) {
      toast.error("Couldn't save those events — they're still here, try again")
      return
    }
    // Keep the ones that were not saved, so they are not lost silently, and
    // report the number actually written rather than the number attempted.
    setDrafts(drafts.filter(ev =>
      normalizeInstant(ev.starts_at) === null ||
      (!!ev.ends_at && normalizeInstant(ev.ends_at) === null)))
    if (!undated) setImportText('')
    loadData()
    toast.success(`Saved ${rows.length} event${rows.length === 1 ? '' : 's'}`)
  }

  return (
    <MobileShell>
      <div className="pt-3 pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-light text-white/88 tracking-tight"
            style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.02em' }}>
            Calendar
          </h1>
          <button
            onClick={() => openAdd(selected)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[#C8F25A]"
            aria-label="Add event">
            <Plus size={16} color="#000" strokeWidth={2.5} />
          </button>
        </div>

        {/* ── Month grid ───────────────────────────────────────────────────── */}
        <div className="rounded-[18px] border border-white/[0.07] overflow-hidden"
          style={{ background: '#101012' }}>

          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
            <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronLeft size={14} color="rgba(255,255,255,0.6)" />
            </button>
            <span className="text-[13px] font-medium text-white/88"
              style={{ fontFamily: "'DM Sans', sans-serif" }}>
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 px-1 pt-2 pb-1">
            {DAY_LABELS.map(l => (
              <div key={l} className="text-center text-[9px] font-medium tracking-[0.08em] uppercase"
                style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.25)' }}>
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
                      fontFamily: "'DM Sans', sans-serif",
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
                        style={{ background: TYPE_COLOR[ev.type] }} />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.05]">
            {Object.entries(TYPE_COLOR).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: color }} />
                <span className="text-[8px] uppercase tracking-[0.08em]"
                  style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.3)' }}>
                  {TYPE_LABEL[type as EventType]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Selected day ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-white/40"
              style={{ fontFamily: "'DM Mono', monospace" }}>
              {formatEventDay(selected)}
            </span>
            <button
              onClick={() => openAdd(selected)}
              className="text-[9px] tracking-[0.1em] uppercase text-[#C8F25A]"
              style={{ fontFamily: "'DM Mono', monospace" }}>
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
              {selectedEvents.map(ev => (
                <div key={ev.id}
                  className="rounded-[14px] px-4 py-3 flex items-start gap-3"
                  style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {/* Color bar */}
                  <div className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ background: TYPE_COLOR[ev.type], minHeight: 28 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate"
                      style={{ color: 'rgba(255,255,255,0.88)', fontFamily: "'DM Sans', sans-serif" }}>
                      {ev.title}
                    </p>
                    <p className="text-[9px] mt-0.5"
                      style={{ fontFamily: "'DM Mono', monospace", color: 'rgba(255,255,255,0.35)' }}>
                      {TYPE_LABEL[ev.type]}{formatEventTime(ev.time)}
                      {ev.opponent ? ` · vs ${ev.opponent}` : ''}
                      {ev.venue ? ` · ${ev.venue}` : ''}
                    </p>
                    {ev.source === 'session' && (
                      <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                        style={{ color: 'rgba(255,255,255,0.22)', fontFamily: "'DM Mono', monospace" }}>
                        Logged
                      </span>
                    )}
                    {ev.source === 'calendar' && (
                      <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                        style={{
                          color: ev.published ? '#C8F25A' : 'rgba(255,255,255,0.22)',
                          fontFamily: "'DM Mono', monospace",
                        }}>
                        {ev.published ? 'Published' : 'Private'}
                      </span>
                    )}
                  </div>
                  {/* Actions — only for calendar events */}
                  {ev.source === 'calendar' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => togglePublish(ev)} aria-label="Toggle publish">
                        {ev.published
                          ? <EyeOff size={14} color="rgba(255,255,255,0.4)" />
                          : <Eye size={14} color="#C8F25A" />}
                      </button>
                      <button onClick={() => deleteEvent(ev)} aria-label="Delete">
                        <Trash2 size={14} color="rgba(255,255,255,0.3)" />
                      </button>
                    </div>
                  )}
                  {/* Logged sessions — link to log another */}
                  {ev.source === 'session' && (
                    <button
                      onClick={() => navigate('/coach/sessions/list')}
                      className="text-[9px] uppercase tracking-[0.08em] flex-shrink-0"
                      style={{ color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Mono', monospace" }}>
                      View
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Import from text (collapsed) ──────────────────────────────────── */}
        <div className="rounded-[18px] border border-white/[0.07] overflow-hidden"
          style={{ background: '#101012' }}>
          <button
            onClick={() => setImportOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Sparkles size={13} color="rgba(255,255,255,0.45)" />
              <span className="text-[12px] text-white/60"
                style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Import from text or club website
              </span>
            </div>
            <ChevronRight size={14} color="rgba(255,255,255,0.3)"
              style={{ transform: importOpen ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }} />
          </button>

          {importOpen && (
            <div className="px-4 pb-4 border-t border-white/[0.05] pt-3 space-y-3">
              <p className="text-[11px] text-white/40"
                style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Paste your fixture list or training schedule — any format works.
              </p>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'e.g.\nTraining Tue 6pm at the academy\nMatch vs PAOK Sat 4pm'}
                rows={5}
                className="w-full rounded-[12px] p-3 text-[13px] outline-none"
                style={{ background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.88)', fontFamily: "'DM Sans', sans-serif" }}
              />
              <button
                onClick={parseImport}
                disabled={parsing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold ml-auto"
                style={{ background: parsing ? 'rgba(200,242,90,0.4)' : '#C8F25A', color: '#000' }}>
                <Sparkles size={11} />
                {parsing ? 'Reading…' : 'Read Schedule'}
              </button>

              {drafts.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <MetadataLabel text={`FOUND · ${drafts.length}`} />
                    <button onClick={saveAllDrafts}
                      className="text-[10px] uppercase tracking-[0.1em] text-[#C8F25A]"
                      style={{ fontFamily: "'DM Mono', monospace" }}>
                      Save all
                    </button>
                  </div>
                  {drafts.map((ev, i) => (
                    <div key={i}
                      className="rounded-[12px] p-3 flex items-start justify-between gap-2"
                      style={{ background: 'rgba(200,242,90,0.05)', border: '1px solid rgba(200,242,90,0.15)' }}>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-white/88 truncate">{ev.title}</p>
                        <p className="text-[10px] text-white/45 mt-0.5">
                          {ev.starts_at?.slice(0, 10)} · {TYPE_LABEL[ev.event_type as EventType] || ev.event_type}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => saveDraft(i)}
                          className="text-[10px] px-2.5 py-1 rounded-full font-semibold"
                          style={{ background: '#C8F25A', color: '#000' }}>
                          Save
                        </button>
                        <button onClick={() => setDrafts(d => d.filter((_, j) => j !== i))}>
                          <Trash2 size={13} color="rgba(255,255,255,0.35)" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Add-event modal ─────────────────────────────────────────────────── */}
      {modal.open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(BLANK_MODAL) }}>
          <div className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-4 overflow-y-auto"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '75vh', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-white/88"
                style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Add Event
              </span>
              <button onClick={() => setModal(BLANK_MODAL)}>
                <X size={18} color="rgba(255,255,255,0.5)" />
              </button>
            </div>

            {/* Type chips */}
            <div className="flex gap-2 flex-wrap">
              {(['training', 'match', 'tournament', 'other'] as EventType[]).map(t => (
                <button key={t}
                  onClick={() => setModal(m => ({ ...m, type: t }))}
                  className="px-3 py-1.5 rounded-full text-xs transition-colors"
                  style={{
                    background: modal.type === t ? `${TYPE_COLOR[t]}22` : 'rgba(255,255,255,0.05)',
                    color: modal.type === t ? TYPE_COLOR[t] : 'rgba(255,255,255,0.45)',
                    border: `1px solid ${modal.type === t ? TYPE_COLOR[t] + '55' : 'rgba(255,255,255,0.07)'}`,
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>

            {/* Title */}
            <input
              value={modal.title}
              onChange={e => setModal(m => ({ ...m, title: e.target.value }))}
              placeholder={modal.type === 'match' ? 'vs Opponent' : modal.type === 'training' ? 'e.g. Tactical Training' : 'Event title'}
              className="w-full bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[14px] text-white/88 placeholder-white/20 outline-none"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            />

            {/* Date + Time */}
            <div className="flex gap-2">
              <input type="date" value={modal.date}
                onChange={e => setModal(m => ({ ...m, date: e.target.value }))}
                className="flex-1 bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[13px] text-white/88 outline-none"
                style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'dark' }} />
              <input type="time" value={modal.time}
                onChange={e => setModal(m => ({ ...m, time: e.target.value }))}
                placeholder="Time"
                className="w-[100px] bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[13px] text-white/88 outline-none"
                style={{ fontFamily: "'DM Sans', sans-serif", colorScheme: 'dark' }} />
            </div>

            {/* Match extras */}
            {modal.type === 'match' && (
              <div className="flex gap-2">
                <input value={modal.opponent}
                  onChange={e => setModal(m => ({ ...m, opponent: e.target.value }))}
                  placeholder="Opponent"
                  className="flex-1 bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[13px] text-white/88 placeholder-white/20 outline-none"
                  style={{ fontFamily: "'DM Sans', sans-serif" }} />
                <input value={modal.venue}
                  onChange={e => setModal(m => ({ ...m, venue: e.target.value }))}
                  placeholder="Venue"
                  className="flex-1 bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[13px] text-white/88 placeholder-white/20 outline-none"
                  style={{ fontFamily: "'DM Sans', sans-serif" }} />
              </div>
            )}

            <button
              onClick={saveEvent}
              disabled={!modal.title.trim() || !modal.date || saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
              style={{
                background: modal.title.trim() && modal.date ? '#C8F25A' : 'rgba(255,255,255,0.06)',
                color: modal.title.trim() && modal.date ? '#000' : 'rgba(255,255,255,0.3)',
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Saving…' : 'Add to calendar'}
            </button>
          </div>
        </div>
      )}

      <NavBar role="coach" activeTab="/coach/schedule" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
