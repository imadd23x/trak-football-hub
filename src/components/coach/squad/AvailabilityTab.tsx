import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Circle, TriangleAlert } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { localTodayISO, phoneEventTime, toInstant } from '@/lib/event-time'
import { splitAvailability, type AvailPlayer } from '@/lib/squad/availability'
import { quoted, weekdayDayMonth as dayLabel } from '@/lib/squad/format'
import type { Tables } from '@/integrations/supabase/types'
import { Card, Missing } from './parts'
import { SquadLoadError } from './SquadLoadError'
import type { SquadRoster } from './useSquadRoster'
import { absentKey, confirmedKey as confirmedKeyFor, loadConfirmed, loadReportedAbsent } from './availability-reads'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { isPosition } from '@/lib/positions'
import { POSITION_WORD } from '@/lib/position-words'
import { useTranslation } from '@/lib/i18n'

/* TRAK-250: Squad > Availability. Families confirm in the squad's WhatsApp group; the coach reads it
   and ticks each child Confirmed here. Everyone else is Not confirmed, and a guardian's "Can't make it"
   report is only a tag on the child, in whichever column. Coach-only: families never see any of it,
   and the reason behind a report is never read. Trak does not capture minutes played (Dimos, 22 Oct),
   so no child shows a share of minutes here. */

const UPCOMING = 10

type CalendarEvent = Pick<Tables<'coach_calendar_events'>,
  'id' | 'squad' | 'title' | 'event_type' | 'starts_at' | 'event_date' | 'start_time' | 'opponent' | 'venue' | 'home_away'>

/** This coach's next published, not-cancelled events from the start of today (confirming is allowed all day). */
async function loadEvents(coachId: string, since: string, squad: string | null): Promise<CalendarEvent[]> {
  let query = supabase.from('coach_calendar_events')
    .select('id, squad, title, event_type, starts_at, event_date, start_time, opponent, venue, home_away')
    .eq('coach_user_id', coachId).eq('published', true).neq('status', 'cancelled').gte('starts_at', since)
  if (squad) query = query.or(`squad.is.null,squad.eq.${quoted(squad)}`)
  const { data, error } = await query.order('starts_at', { ascending: true }).limit(UPCOMING)
  if (error) throw error
  return data ?? []
}


function Chip({ children, tone = 'raised' }: { children: ReactNode; tone?: 'raised' | 'brand' }) {
  return (
    <span className="inline-flex min-w-6 items-center justify-center rounded-full px-2.5 py-0.5 text-[12px] font-medium"
      style={tone === 'brand'
        ? { background: 'rgb(var(--t-brand) / 0.12)', color: 'rgb(var(--t-brand))' }
        : { background: 'rgb(var(--t-raised))', color: 'rgb(var(--t-ink))' }}>
      {children}
    </span>
  )
}

type Row = AvailPlayer & { absent: boolean }

/** Stable per child, so focus can follow the child into the other column. */
const childButtonId = (childId: string) => `availability-child-${childId}`

function ChildRow({ child, pressed, busy, onToggle }: {
  child: Row
  pressed: boolean
  busy: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <li>
      {/* aria-disabled, not disabled, while a toggle is pending: a disabled button would drop keyboard focus. */}
      <button type="button" id={childButtonId(child.id)} aria-pressed={pressed} aria-disabled={busy || undefined}
        onClick={() => { if (!busy) onToggle() }}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-raised aria-disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-medium text-ink">
          {child.shirt ?? <Missing what={t('coachSquad:noShirt')} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{child.name}</span>
          <span className="block truncate text-[11px] text-ink-3">{isPosition(child.position) ? t(POSITION_WORD[child.position]) : child.position ?? t('coachSquad:positionNotSet')}</span>
          {child.absent && (
            <span className="mt-1 inline-block rounded-[8px] px-2 py-0.5 text-[11px] font-medium text-ink"
              style={{ background: 'rgb(var(--t-warning) / 0.18)' }}>{t('coachSquad:reportedCantMakeIt')}</span>
          )}
        </span>
        {pressed
          ? <Check aria-hidden size={18} strokeWidth={2.25} className="shrink-0 text-brand" />
          : <Circle aria-hidden size={18} strokeWidth={1.5} className="shrink-0 text-ink-3" />}
      </button>
    </li>
  )
}

function Column({ slug, title, note, rows, pressed, busy, onToggle }: {
  /** The column's id, the same in every language. */
  slug: string
  title: string
  note: string
  rows: Row[]
  pressed: boolean
  busy: boolean
  onToggle: (child: Row) => void
}) {
  const { t } = useTranslation()
  const id = `availability-${slug}`
  return (
    <section aria-labelledby={id} className="min-w-0 overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h3 id={id} className="text-[15px] font-medium text-ink">{title}</h3>
        <Chip>{rows.length}</Chip>
      </div>
      <p className="px-4 pt-1 text-[12px] text-ink-3">{note}</p>
      {rows.length === 0 ? <p className="px-4 py-5 text-[13px] text-ink-3">{t('coachSquad:noOneHere')}</p> : (
        <ul className="py-2">
          {rows.map(row => (
            <ChildRow key={row.id} child={row} pressed={pressed} busy={busy} onToggle={() => onToggle(row)} />
          ))}
        </ul>
      )}
    </section>
  )
}

export function AvailabilityTab({ roster }: { roster: SquadRoster }) {
  const { user } = useAuth()
  const userId = user?.id
  const { t } = useTranslation()
  const client = useQueryClient()
  const { players, consentPending, squad } = roster
  const [pick, setPick] = useState<string | null>(null)
  // The last toggle that landed: announced politely, and focus follows the child to its new column.
  const [moved, setMoved] = useState<{ childId: string; text: string } | null>(null)

  const since = toInstant(localTodayISO()) ?? new Date().toISOString()
  const events = useQuery({
    queryKey: ['coach', userId, 'squad-availability', 'events', squad ?? 'all', since],
    queryFn: () => loadEvents(userId!, since, squad),
    enabled: !!userId,
  })
  const upcoming = useMemo(
    () => (events.data ?? []).filter(e => e.squad == null || squad == null || e.squad === squad),
    [events.data, squad],
  )
  const at = Math.max(0, upcoming.findIndex(e => e.id === pick))
  const event = upcoming[at]
  const eventId = event?.id

  const confirmedKey = confirmedKeyFor(userId, eventId)
  const confirmedQuery = useQuery({ queryKey: confirmedKey, queryFn: () => loadConfirmed(eventId!), enabled: !!userId && !!eventId })
  const absentQuery = useQuery({
    queryKey: absentKey(userId, eventId),
    queryFn: () => loadReportedAbsent(eventId!),
    enabled: !!userId && !!eventId,
  })

  const toggle = useMutation({
    mutationFn: async ({ eventId: ev, childId, confirm }: { eventId: string; childId: string; name: string; confirm: boolean }) => {
      const args = { p_event_id: ev, p_squad_player_id: childId }
      const { error } = confirm
        ? await supabase.rpc('confirm_event_attendance', args)
        : await supabase.rpc('unconfirm_event_attendance', args)
      if (error) throw error
    },
    // The row only moves once the confirmations have been read again; a refusal leaves it where it was.
    onSuccess: async (_data, vars) => {
      await client.invalidateQueries({ queryKey: confirmedKeyFor(userId, vars.eventId) })
      setMoved({ childId: vars.childId, text: t(vars.confirm ? 'coachSquad:movedConfirmed' : 'coachSquad:movedNotConfirmed', { name: vars.name }) })
    },
  })
  useEffect(() => {
    if (moved) document.getElementById(childButtonId(moved.childId))?.focus()
  }, [moved])

  // TRAK-266: with every squad in view, an event for one squad lists that squad's players only.
  const eventSquad = event?.squad ?? null
  const avail = useMemo<AvailPlayer[]>(
    () => players.filter(p => eventSquad == null || p.age_group?.trim() === eventSquad)
      .map(p => ({ id: p.id, name: p.player_name, shirt: p.shirt_number, position: p.position })),
    [players, eventSquad],
  )
  const confirmedIds = useMemo(() => new Set(confirmedQuery.data ?? []), [confirmedQuery.data])
  const absentIds = useMemo(() => new Set(absentQuery.data ?? []), [absentQuery.data])
  const split = useMemo(
    () => splitAvailability(avail, consentPending, confirmedIds, absentIds),
    [avail, consentPending, confirmedIds, absentIds],
  )

  const isMatch = event?.event_type === 'match'

  if (events.error) return <SquadLoadError onRetry={() => { void events.refetch() }} title={t('coachSquad:couldntLoadUpcoming')} />
  if (events.isPending) return <LoadingSkeleton label={t('coachSquad:loadingUpcoming')} lines={2} rows={3} className="pt-6" />
  if (!event) {
    return (
      <div className="pt-2">
        <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink">{t('coachSquad:tabAvailability')}</h2>
        <div className="mt-5 rounded-[14px] border border-line bg-surface p-5">
          <p className="text-[15px] font-medium text-ink-2">{t('coachSquad:noUpcoming')}</p>
          <p className="mt-1 text-[12px] text-ink-3">{t('coachSquad:publishToSee')}</p>
          <Link to="/coach/schedule"
            className="mt-4 inline-flex min-h-11 items-center rounded-[10px] border border-line-strong px-4 text-[13px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('coachSquad:openSchedule')}
          </Link>
        </div>
      </div>
    )
  }

  const { date, time } = phoneEventTime(event)
  const what = isMatch ? (event.opponent ? t('coachSchedule:vsOpponent', { opponent: event.opponent }) : event.title) : event.title
  const heading = [dayLabel(date), what].filter(Boolean).join(' · ')
  const details = [
    time ? t(isMatch ? 'coachSquad:kickOffAt' : 'coachSquad:startsAt', { time }) : '',
    event.home_away === 'home' ? t('coachSchedule:home') : event.home_away === 'away' ? t('coachSchedule:away') : '',
    event.venue ?? '',
  ].filter(Boolean).join(' · ')

  const step = (by: number) => { toggle.reset(); setMoved(null); setPick(upcoming[at + by].id) }
  const readError = confirmedQuery.error ?? absentQuery.error
  const retry = () => { void confirmedQuery.refetch(); void absentQuery.refetch() }
  const toggleChild = (child: Row) => {
    if (toggle.isPending) return
    toggle.mutate({ eventId: event.id, childId: child.id, name: child.name, confirm: !confirmedIds.has(child.id) })
  }
  const stepButton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-line-strong text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Chip tone="brand">{isMatch ? t('coachSchedule:kindMatch') : event.event_type === 'training' ? t('coachSchedule:kindTraining') : t('coachSquad:chipEvent')}</Chip>
          <h2 className="text-[20px] font-medium tracking-[-0.01em] text-ink">{heading}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-3">{t('coachSquad:ofCount', { at: at + 1, total: upcoming.length })}</span>
          <button type="button" aria-label={t('coachSquad:previousEvent')} disabled={at === 0} onClick={() => step(-1)} className={stepButton}>
            <ChevronLeft aria-hidden size={18} />
          </button>
          <button type="button" aria-label={t('coachSquad:nextEvent')} disabled={at >= upcoming.length - 1} onClick={() => step(1)} className={stepButton}>
            <ChevronRight aria-hidden size={18} />
          </button>
        </div>
      </div>
      {details && <p className="mt-1.5 font-mono text-[12px] text-ink-3">{details}</p>}
      <p role="status" aria-live="polite" className="sr-only">{moved?.text ?? ''}</p>

      {toggle.error && (
        <p role="alert" className="mt-3.5 rounded-[12px] px-4 py-3 text-[13px] text-ink"
          style={{ background: 'rgb(var(--t-danger) / 0.1)', border: '1px solid rgb(var(--t-danger) / 0.35)' }}>
          {toggle.error.message || t('coachSquad:couldntUpdateConfirmation')}
        </p>
      )}

      {readError ? <SquadLoadError onRetry={retry} title={t('coachSquad:couldntLoadConfirmations')} />
        : confirmedQuery.isPending || absentQuery.isPending
          ? <LoadingSkeleton label={t('coachSquad:loadingConfirmations')} lines={1} avatar rows={4} className="pt-6" />
          : (
            <div className="mt-4 flex flex-col gap-4 laptop:flex-row laptop:items-start">
              <div className="min-w-0 flex-1">
                <div className="grid gap-3.5 tablet:grid-cols-2">
                  <Column slug="confirmed" title={t('coachSquad:confirmed')} note={t('coachSquad:confirmedNote')}
                    rows={split.confirmed} pressed busy={toggle.isPending} onToggle={toggleChild} />
                  <Column slug="not-confirmed" title={t('coachSquad:notConfirmed')} note={t('coachSquad:notConfirmedNote')}
                    rows={split.notConfirmed} pressed={false} busy={toggle.isPending} onToggle={toggleChild} />
                </div>
                {split.notEligible.length > 0 && (
                  <div className="mt-3.5 rounded-[12px] px-4 py-3 text-[13px] text-ink"
                    style={{ background: 'rgb(var(--t-warning) / 0.12)', border: '1px solid rgb(var(--t-warning) / 0.35)' }}>
                    <b className="font-medium">{t('coachSquad:notEligibleLabel')}</b>{' '}
                    {split.notEligible.map(p => p.name).join(', ')}{t('coachSquad:notEligibleWhy', { count: split.notEligible.length })}
                  </div>
                )}
              </div>

              <aside className="flex w-full flex-col gap-3.5 laptop:w-[300px] laptop:shrink-0">
                <Card title={t('coachSquad:squadForEvent')} muted>
                  <p className="text-[18px] font-medium text-ink">{t('coachSquad:confirmedSummary', { confirmed: split.confirmed.length, notConfirmed: split.notConfirmed.length })}</p>
                  {split.goalkeepers.length > 0 ? (
                    <p className="mt-2 text-[13px] text-ink">{t('coachSquad:goalkeepersLine', { names: split.goalkeepers.map(g => g.name).join(', ') })}</p>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      <TriangleAlert aria-hidden size={15} className="shrink-0 text-warning" />{t('coachSquad:noGoalkeeper')}
                    </p>
                  )}
                </Card>
                <p className="rounded-[12px] border border-line bg-raised px-4 py-3 text-[13px] text-ink-2">
                  {t('coachSquad:whatsappNote')}
                </p>
              </aside>
            </div>
          )}
    </div>
  )
}
