import { Link } from 'react-router-dom'
import { CalendarCheck } from 'lucide-react'
import { localTodayISO, phoneEventTime } from '@/lib/event-time'
import { trainingEnd } from '@/lib/training/sessions'
import { fromSaved, plannedMinutes, practiceLine } from '@/lib/training/plans'
import { loopState } from '@/lib/training/loop'
import { fullTime } from '@/lib/games/loop'
import { useNotes, usePastSessions, useRegisters, useTrainings, type Training } from '@/components/coach/training/useTraining'
import { gameTitle, gameWhen, useGamePlan, useGames, type Game } from '@/components/coach/games/useGames'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useTranslation } from '@/lib/i18n'

/* TRAK-304 (Kostas, 28 Oct): when the coach opens Trak on a training or match day, Home shows that day's plan, as a
   reminder of what the coach planned and how to run it. It takes Squad shape's place; the week stays. Today's trainings
   (Training's plan and loop) and matches (Games' plan), in time order; with nothing today, the next one coming up.
   Only where Training or Games is switched on; coach only. */

type Item = { kind: 'training'; event: Training } | { kind: 'match'; event: Game }

const linkClass = 'rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
const isToday = (event: { event_date: string | null; start_time: string | null; starts_at: string }) =>
  phoneEventTime(event).date === localTodayISO()

export function TodayPlan({ trainingOn, gamesOn, inView, squadOf = null }: {
  trainingOn: boolean
  gamesOn: boolean
  /** Whether an event's squad is in Home's view (its squad pills). */
  inView: (squad: string | null) => boolean
  /** An event's age group, when Home shows more than one (All, for a coach of two or more), as the week labels each
   *  event (Kostas, 29 Oct: which age group a plan is for). */
  squadOf?: ((squad: unknown) => string) | null
}) {
  const { t } = useTranslation()
  const trainings = useTrainings()
  const games = useGames(gamesOn)
  const failed = (trainingOn && trainings.isError) || (gamesOn && games.isError)
  const pending = (trainingOn && trainings.isPending) || (gamesOn && games.isPending)
  const now = Date.now()

  // In Home's view, soonest first. Today's stay all day, over or not: the card is a reminder of what was done too.
  // With nothing today, the next one not over yet.
  const items: Item[] = [
    ...(trainingOn ? trainings.data ?? [] : []).map(event => ({ kind: 'training' as const, event })),
    ...(gamesOn ? games.data ?? [] : []).map(event => ({ kind: 'match' as const, event })),
  ].filter(item => inView(item.event.squad)).sort((a, b) => Date.parse(a.event.starts_at) - Date.parse(b.event.starts_at))
  const today = items.filter(item => isToday(item.event))
  const ahead = (item: Item) => (item.kind === 'training' ? trainingEnd(item.event) : fullTime(item.event)) > now
  const next = today.length ? null : items.find(ahead) ?? null

  // min-w-0 and minmax(0, 1fr) all the way down: a name cut with "…" must not widen the card, or the page, to its length.
  return <section className="arc min-w-0 rounded-2xl border border-line bg-surface p-5" aria-labelledby="today-plan-title">
    <div className="grid gap-0.5">
      <h2 id="today-plan-title" className="text-lg font-medium text-ink">{t('coachHome:today')}</h2>
      {!today.length && !pending && !failed && <p className="text-sm text-ink-3">{t('coachHome:nothingToday')}</p>}
    </div>
    {failed ? <div className="mt-4"><LoadError what={t('coachHome:todayWhat')} onRetry={() => { void trainings.refetch(); void games.refetch() }} /></div>
      : pending ? <LoadingSkeleton label={t('coachHome:todayLoading')} lines={4} rows={2} className="mt-4 h-[180px] content-start overflow-hidden" />
      : today.length ? <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 divide-y divide-line">
        {today.map(item => <li key={item.event.id} className="pt-3 first:pt-0">
          {item.kind === 'training' ? <TodayTraining training={item.event} squadOf={squadOf} /> : <TodayMatch game={item.event} squadOf={squadOf} />}
        </li>)}
      </ul>
      : next ? <div className="mt-4 grid gap-2">
        <p className="text-[15px] text-ink-2">{t('coachHome:nextUp')}</p>
        <Link to={next.kind === 'training' ? `/coach/training/${next.event.id}` : `/coach/matches/${next.event.id}`}
          className="flex items-center gap-3 rounded-xl bg-raised px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <CalendarCheck aria-hidden size={20} className="flex-none text-brand" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium text-ink">{next.kind === 'training' ? next.event.title : gameTitle(next.event)}</span>
            <span className="block text-sm text-ink-3">{[squadOf?.(next.event.squad), when(next.event)].filter(Boolean).join(' · ')}</span>
          </span>
        </Link>
      </div>
      : <p className="mt-4 text-sm text-ink-2">{t('coachHome:nothingAhead')}</p>}
  </section>
}

const when = (event: { event_date: string | null; start_time: string | null; starts_at: string }) => {
  const { day, time } = gameWhen(event)
  return [day, time].filter(Boolean).join(' · ')
}

/** Today's training as a quick snapshot (Kostas, 28 Oct): each practice and how long it runs. The week above already
    says the training's time, place and name, so the card doesn't (Kostas, 29 Oct: "keep it simple"; a session plan
    pasted as a name, 1,000 characters, had filled it). Kostas, 29 Oct: no Run it; the training's total time sits on the
    right, over the practices' minutes. With more than one age group on Home, "Training plan · U16". */
function TodayTraining({ training, squadOf }: { training: Training; squadOf: ((squad: unknown) => string) | null }) {
  const { t } = useTranslation()
  const sessions = usePastSessions()
  const registers = useRegisters()
  const notes = useNotes()
  const session = sessions.data?.find(s => s.id === training.id)
  const practices = fromSaved(session?.practices ?? [])
  const now = Date.now()
  const loop = loopState({
    planned: practices.length > 0, registered: !!registers.data?.has(training.id), noted: !!notes.data?.has(training.id),
    started: Date.parse(training.starts_at) <= now, over: trainingEnd(training) <= now,
  })
  const page = `/coach/training/${training.id}`
  return <article aria-label={t('coachHome:trainingNamed', { title: training.title })} className="grid grid-cols-[minmax(0,1fr)] gap-2">
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm font-medium text-brand">{[t('coachHome:trainingPlan'), squadOf?.(training.squad)].filter(Boolean).join(' · ')}</p>
      {sessions.data && (!practices.length ? <Link to={page} className={linkClass}>{t('coachHome:planThisSession')}</Link>
        : <span className="flex-none whitespace-nowrap text-sm font-medium tabular-nums text-brand">{loop.closed && t('coachHome:closedPrefix')}{t('coachHome:minutes', { count: plannedMinutes(practices) })}</span>)}
    </div>
    {sessions.isError ? <LoadError what={t('coachHome:planWhat')} onRetry={() => void sessions.refetch()} />
      : !sessions.data ? null
      : practices.length ? <ol aria-label={t('coachHome:todaysPractices')} className="grid gap-1">
        {practices.map((practice, i) => <li key={i} className="flex items-baseline gap-3 text-[15px]">
          <span className="min-w-0 flex-1 truncate text-ink">{practiceLine(practice)}</span>
          <span className="flex-none text-sm tabular-nums text-ink-3">{t('coachHome:minutes', { count: practice.minutes })}</span>
        </li>)}
      </ol>
      : <p className="text-sm text-ink-2">{t('coachHome:notPlanned')}</p>}
  </article>
}

/** Today's match as a quick snapshot: the formation and the goals. Its opponent is the week's to say, as a training's
    name is; its age group shows as a training's does. */
function TodayMatch({ game, squadOf }: { game: Game; squadOf: ((squad: unknown) => string) | null }) {
  const { t } = useTranslation()
  const plan = useGamePlan(game.id)
  const goals = Array.isArray(plan.data?.goals) ? (plan.data!.goals as { title?: string }[]).map(g => g.title?.trim()).filter(Boolean) : []
  return <article aria-label={t('coachHome:matchNamed', { title: gameTitle(game) })} className="grid grid-cols-[minmax(0,1fr)] gap-2">
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm font-medium text-brand">{[t('coachHome:gamePlan'), squadOf?.(game.squad)].filter(Boolean).join(' · ')}</p>
      <Link to={`/coach/matches/${game.id}?tab=plan`} className={linkClass}>{plan.data ? t('coachHome:openGamePlan') : t('coachHome:writeGamePlan')}</Link>
    </div>
    {plan.data && (plan.data.formation || goals.length > 0) ? <dl className="grid gap-1 text-[15px]">
      {plan.data.formation && <div className="flex gap-3"><dt className="w-20 flex-none text-sm text-ink-3">{t('coachHome:formation')}</dt><dd className="text-ink">{plan.data.formation}</dd></div>}
      {goals.length > 0 && <div className="flex gap-3"><dt className="w-20 flex-none text-sm text-ink-3">{t('coachHome:goals')}</dt>
        <dd className="min-w-0 text-ink"><ul className="grid gap-0.5">{goals.map(goal => <li key={goal}>{goal}</li>)}</ul></dd></div>}
    </dl>
      : plan.isSuccess && <p className="text-sm text-ink-2">{t('coachHome:noGamePlan')}</p>}
  </article>
}
