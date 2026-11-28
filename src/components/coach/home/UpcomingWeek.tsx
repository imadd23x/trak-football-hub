import { gameTitle } from '@/components/coach/games/useGames'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { EVENT_COLOR } from '@/lib/coach-events'
import { squadName } from '@/lib/coach-week'
import { phoneEventTime } from '@/lib/event-time'
import { evalDay } from '@/lib/evaluation'
import { useTranslation } from '@/lib/i18n'
import { TodoAction } from './TodoList'
import type { UpcomingEvent, UpcomingOther } from './useHomeTodos'
import { EventTodoSlot } from '@/components/coach/EventTodo'
import { NEXT_STEP_SIZE } from '@/components/coach/next-step'

/* TRAK-611 (New Home 5/8, spec TRAK-606): Upcoming, in the week strip's place on Home (Schedule keeps the strip). Every
   training and match from tomorrow to 7 days ahead, in two cards, each with its next missing step, as its to-do's
   button: Plan for a training; Share logistics, Write plan, Share plan for a match. "✓ Ready" when nothing is missing;
   "In To-do" when its step is in today's list. Today's events are in To-do. TRAK-625: a third card, Other, from today. */

export function UpcomingWeek({ week, others = null, inTodo, coachId, showSquad, onChanged, matchesOn, trainingOn }: {
  /** null while loading. */
  week: UpcomingEvent[] | null
  /** TRAK-625: the coach's "Other" events from today that can still go into the To-do; null while loading. */
  others?: UpcomingOther[] | null
  /** The keys of today's to-dos. */
  inTodo: Set<string>
  coachId: string
  showSquad: boolean
  onChanged: () => void
  /** Where Matches is off there is no Matches card. */
  matchesOn: boolean
  /** Where Training is off a training has no plan, so it's never "Ready" either: its row shows no step. */
  trainingOn: boolean
}) {
  const { t } = useTranslation()
  const card = (kind: 'training' | 'match') => {
    const rows = (week ?? []).filter(({ row }) => row.event_type === kind)
    const name = kind === 'training' ? t('coachHome:upcomingTrainings') : t('coachHome:upcomingMatches')
    return <section aria-label={name} className="arc min-w-0 rounded-2xl border border-line bg-surface p-4 laptop:p-5">
      <h3 className="mb-2 flex items-center gap-2 text-[15px] font-medium text-ink">
        <i aria-hidden className="inline-block h-4 w-[3px] rounded-sm" style={{ background: EVENT_COLOR[kind] }} />{name}
      </h3>
      {!week ? <LoadingSkeleton label={t('coachHome:upcomingLoading')} lines={2} />
        : !rows.length ? <p className="text-sm text-ink-3">{t('coachHome:upcomingNone')}</p>
        : <ul className="grid">
          {rows.map(({ row, step }) => {
            const { date, time } = phoneEventTime(row)
            return <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/60 py-2.5 first:border-t-0">
              <span className="grid min-w-0">
                <span className="truncate text-sm font-medium text-ink">{kind === 'match' ? gameTitle(row) : row.title}</span>
                <span className="text-[13px] tabular-nums text-ink-3">{[showSquad ? squadName(row.squad) : null, date ? evalDay(date) : null, time].filter(Boolean).join(' · ')}</span>
              </span>
              {step && inTodo.has(step.todo.key)
                ? <span className="rounded-full bg-raised px-2.5 py-1 text-[13px] font-medium text-ink-2">{t('coachHome:upcomingInTodo')}</span>
                : step ? <TodoAction item={step} coachId={coachId} onChanged={onChanged} />
                : kind === 'training' && !trainingOn ? null
                : <span className="rounded-full bg-success/10 px-2.5 py-1 text-[13px] font-medium text-success">{t('coachHome:upcomingReady')}</span>}
            </li>
          })}
        </ul>}
    </section>
  }
  // TRAK-625 (Other events → To-do 5/6; Makis's gentle reminder): the coach's "Other" events, from today, each with Add to
  // To-do or In To-do. Nothing is added for the coach. On a laptop it runs under both cards (Kostas, 28 Nov: symmetry).
  const otherCard = <section aria-label={t('coachHome:upcomingOther')} className="arc min-w-0 rounded-2xl border border-line bg-surface p-4 laptop:col-span-2 laptop:p-5">
    <h3 className="mb-2 flex items-center gap-2 text-[15px] font-medium text-ink">
      <i aria-hidden className="inline-block h-4 w-[3px] rounded-sm" style={{ background: EVENT_COLOR.other }} />{t('coachHome:upcomingOther')}
      <span className="font-normal text-ink-3">· {t('coachHome:upcomingOtherSub')}</span>
    </h3>
    {!others ? <LoadingSkeleton label={t('coachHome:upcomingLoading')} lines={2} />
      : !others.length ? <p className="text-sm text-ink-3">{t('coachHome:upcomingNone')}</p>
      : <ul className="grid">
        {others.map(({ row, today }) => {
          const { date, time } = phoneEventTime(row)
          return <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/60 py-2.5 first:border-t-0">
            <span className="grid min-w-0">
              <span className="truncate text-sm font-medium text-ink">{row.title}</span>
              <span className="text-[13px] tabular-nums text-ink-3">{[showSquad ? squadName(row.squad) : null,
                today ? t('coachHome:eventTodoToday') : date ? evalDay(date) : null, time].filter(Boolean).join(' · ')}</span>
            </span>
            <EventTodoSlot row={row} coachId={coachId} variant="primary" size={NEXT_STEP_SIZE} />
          </li>
        })}
      </ul>}
  </section>
  return <section aria-labelledby="upcoming-title" className="grid gap-3">
    <h2 id="upcoming-title" className="text-lg font-medium text-ink">{t('coachHome:upcomingTitle')} <span className="font-normal text-ink-3">· {t('coachHome:upcomingSub')}</span></h2>
    <div className="grid gap-3 laptop:grid-cols-2">
      {card('training')}
      {matchesOn && card('match')}
      {otherCard}
    </div>
  </section>
}
