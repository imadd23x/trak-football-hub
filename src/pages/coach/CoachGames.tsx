import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { LOOP_STEPS, STATE, actionLink, gameState, orderGames, type GameAction } from '@/lib/games/loop'
import { gameTitle, gameWhen, useGameEvaluations, useGamePlanChanges, useGamePlans, useGameShares, useGames, type Game } from '@/components/coach/games/useGames'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { PitchIcon } from '@/components/icons/PitchIcon'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Countdown } from '@/components/arc/countdown/countdown'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { Stepper } from '@/components/arc/stepper/stepper'

/* TRAK-283 (Games 1/8): Games home. The next game with where it is in its loop and its one next action, the open
   drafts, and every match of the squad in view. Cards follow Home's Needs you pattern (Imad, 27 Oct). */

const STEPS = LOOP_STEPS.map(label => ({ id: label, label }))
/** Schedule's quick hand-over (TRAK-182 part 8): New event, on its first step, with Match picked. */
const ADD_MATCH = { quickEvent: { kind: 'match' } }
const details = (game: Game, time: string | null) => [
  time ? `Kick-off ${time}` : '',
  game.home_away === 'home' ? 'Home' : game.home_away === 'away' ? 'Away' : '',
  game.venue ?? '',
].filter(Boolean).join(' · ')

export default function CoachGames() {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const navigate = useNavigate()
  const games = useGames()
  const plans = useGamePlans()
  const shares = useGameShares()
  const evaluations = useGameEvaluations()
  // TRAK-305: All or one squad, as picked at the top of the frame.
  const { everySquad } = coachSquad
  // The countdown's end moves the next game on, so the clock is read again then.
  const [now, setNow] = useState(() => Date.now())
  const inView = (games.data ?? []).filter(game => everySquad || coachSquad.eventInSquad(game.squad))
  const { next, games: ordered } = orderGames(inView, now)
  // TRAK-286: edits since sharing, for shared matches still to kick off. A failed read shows them as shared.
  const changes = useGamePlanChanges(ordered.filter(game => shares.data?.has(game.id) && now < Date.parse(game.starts_at)).map(game => game.id))
  const open = (game: Game, action: Omit<GameAction, 'label'>) => navigate(actionLink(game.id, action))
  const stateOf = (game: Game) => STATE[gameState(game, now,
    { drafted: plans.data?.has(game.id), shared: shares.data?.has(game.id), changes: changes.data?.get(game.id)?.length, evaluated: evaluations.data?.has(game.id),
      published: !!evaluations.data?.get(game.id)?.publishedAt })]
  // TRAK-284: a plan draft stays open until it's shared (TRAK-286) or its match kicks off and locks it (TRAK-287).
  // TRAK-288: an evaluation draft stays open until it's published (TRAK-289).
  const drafts = [
    ...ordered.filter(game => plans.data?.has(game.id) && !shares.data?.has(game.id) && now < Date.parse(game.starts_at))
      .map(game => ({ game, what: 'Game plan', saved: plans.data!.get(game.id)!, tab: 'plan' as const })),
    ...ordered.flatMap(game => {
      const evaluation = evaluations.data?.get(game.id)
      return evaluation && !evaluation.publishedAt ? [{ game, what: 'Evaluation', saved: evaluation.savedAt, tab: 'evaluation' as const }] : []
    }),
  ]

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-6 pb-4">
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Games</h1>
        </header>

        {games.error || plans.error || shares.error || evaluations.error
            ? <LoadError what="your games" onRetry={() => { void games.refetch(); void plans.refetch(); void shares.refetch(); void evaluations.refetch() }}
                retrying={games.isFetching || plans.isFetching || shares.isFetching || evaluations.isFetching} />
          : games.isPending || plans.isPending || shares.isPending || evaluations.isPending ? <p role="status" className="pt-14 text-center text-[13px] text-ink-3">Loading your games…</p>
          : ordered.length === 0 ? (
            <div className="arc pt-6">
              <EmptyState icon={<PitchIcon size={24} strokeWidth={1.5} />} title="No matches yet"
                description="Add a match in Schedule. Its game plan and evaluation will live here."
                action={<Button onClick={() => navigate('/coach/schedule', { state: ADD_MATCH })}>Add a match</Button>} />
            </div>
          ) : <>
            <div className="grid gap-4 laptop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {next ? <NextGame game={next} state={stateOf(next)} onOpen={open} onKickOff={() => setNow(Date.now())} /> : (
                <section aria-labelledby="next-game" className="rounded-2xl border border-line bg-surface p-5">
                  <h2 id="next-game" className="text-lg font-medium text-ink">Next game</h2>
                  <p className="mt-2 text-sm text-ink-2">No match coming up.</p>
                  <Link to="/coach/schedule" state={ADD_MATCH}
                    className="mt-3 inline-block rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Add a match</Link>
                </section>
              )}
              {/* TRAK-284: plan drafts. TRAK-288: evaluation drafts. */}
              <section aria-labelledby="open-drafts" className="arc rounded-2xl border border-line bg-surface p-5">
                <h2 id="open-drafts" className="text-lg font-medium text-ink">Open drafts</h2>
                <p className="mt-1 text-sm text-ink-3">Only you see a draft. Each stays here until it’s shared or published.</p>
                {drafts.length === 0 ? <p className="mt-4 text-sm text-ink-2">No drafts open.</p> : <ul className="mt-3 divide-y divide-line">
                  {drafts.map(({ game, what, saved, tab }) => <li key={`${tab}:${game.id}`} className="flex items-center justify-between gap-3 py-3">
                    <span className="grid min-w-0">
                      <span className="truncate text-base font-medium text-ink">{gameTitle(game)}</span>
                      <span className="truncate text-sm text-ink-3">{what} · saved {format(new Date(saved), 'EEE d MMM, HH:mm')}</span>
                    </span>
                    <Button variant="secondary" size="sm" aria-label={`Open the ${tab === 'plan' ? 'plan' : 'evaluation'}, ${gameTitle(game)}`}
                      onClick={() => open(game, { tab })}>Open</Button>
                  </li>)}
                </ul>}
              </section>
            </div>

            <div className="mt-8">
              <h2 className="mb-2 text-lg font-medium text-ink">Your games</h2>
              <div className="arc -mx-1">
                <ScrollArea orientation="horizontal" snap="x mandatory" fade={24} label="Your games">
                  <ul className="flex gap-3 px-1 pb-1">
                    {ordered.map(game => {
                      const state = stateOf(game)
                      const { day, time } = gameWhen(game)
                      return <li key={game.id} className="w-[248px] flex-none" style={{ scrollSnapAlign: 'start' }}>
                        <Link to={`/coach/games/${game.id}`}
                          className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <span className="grid min-w-0">
                            <span className="truncate text-base font-medium text-ink">{gameTitle(game)}</span>
                            <span className="truncate text-sm text-ink-3">{[day, time, everySquad ? game.squad : null].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="arc mt-auto"><Badge tone={state.tone} size="sm">{state.label}</Badge></span>
                        </Link>
                      </li>
                    })}
                  </ul>
                </ScrollArea>
              </div>
            </div>
          </>}
      </div>
    </div>
  )
}

/** The next match: its loop, the one next action and the countdown to kick-off. A static panel, not a link. */
function NextGame({ game, state, onOpen, onKickOff }: {
  game: Game; state: (typeof STATE)[keyof typeof STATE]; onOpen: (game: Game, action: Omit<GameAction, 'label'>) => void; onKickOff: () => void
}) {
  const { day, time, academy } = gameWhen(game)
  return (
    <section aria-labelledby="next-game" className="arc flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-game" className="text-lg font-medium text-ink">Next game</h2>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <div className="grid min-w-0 gap-1">
        <p className="text-[22px] font-medium tracking-[-0.01em] text-ink break-words">{gameTitle(game)}</p>
        <p className="text-sm text-ink-2">{[day, details(game, time)].filter(Boolean).join(' · ')}</p>
        {academy && <p className="text-sm text-ink-3">{academy}</p>}
      </div>
      <Stepper steps={STEPS} current={state.step} label="Where this game is" />
      <div className="flex flex-wrap items-center gap-3">
        {state.action && <Button size="lg" onClick={() => onOpen(game, state.action!)}>{state.action.label}</Button>}
        {state.step > 0 && <Link to={`/coach/games/${game.id}?tab=logistics`}
          className="text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">Logistics</Link>}
        <Countdown variant="compact" units={['days', 'hours', 'minutes']} target={game.starts_at}
          label="Kick-off in" completeLabel="Locked" onComplete={onKickOff} className="ml-auto" />
      </div>
    </section>
  )
}
