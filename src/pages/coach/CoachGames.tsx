import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Scorer } from '@/lib/games/scorers'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { useCoachSquad } from '@/lib/coach-squad'
import { actionLink, type GameAction, type GameState, type PlanProgress, gameState, gameStatus, orderGames } from '@/lib/games/loop'
import { gameTitle, gameWhen, useGameEvaluations, useGamePlanChanges, useGamePlans, useGameShares, useGames, useScorers, type Game } from '@/components/coach/games/useGames'
import { seasonStart } from '@/lib/games/scorers'
import { matchResult } from '@/lib/games/results'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { PitchIcon } from '@/components/icons/PitchIcon'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Countdown } from '@/components/arc/countdown/countdown'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { MatchAction } from '@/components/coach/games/MatchAction'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { dateLocale, i18n, useTranslation } from '@/lib/i18n'
import { COMPETITION_WORD, MATCH_WORD } from '@/lib/games/match-words'
import { shown } from '@/lib/squad/trait-words'

/* TRAK-283 (Games 1/8): Games home. The next game with where it is in its loop and its one next action, the open
   drafts, and every match of the squad in view. Cards follow Home's Needs you pattern (Imad, 27 Oct). TRAK-320 (Imad,
   30 Oct): a published match moves to Previous matches, newest first, with its result, and opens on its evaluation.
   TRAK-321: the season's top scorers and assists for the squad in view, from those evaluations. TRAK-322 (Imad, 30 Oct):
   compact, and the screen used: on a laptop the match rows and the scorers sit side by side in TRAK-307's one column. */

/** Schedule's quick hand-over (TRAK-182 part 8): New event, on its first step, with Match picked. */
const ADD_MATCH = { quickEvent: { kind: 'match' } }
const details = (game: Game, time: string | null) => [
  time ? i18n.t('coachSquad:kickOffAt', { time }) : '',
  game.home_away === 'home' ? i18n.t('coachSchedule:home') : game.home_away === 'away' ? i18n.t('coachSchedule:away') : '',
  game.venue ?? '',
].filter(Boolean).join(' · ')

export default function CoachGames() {
  const { user, profile } = useAuth()
  const { t } = useTranslation()
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
  const progress = (game: Game): PlanProgress => ({ drafted: plans.data?.has(game.id), shared: shares.data?.has(game.id), sharedAt: shares.data?.get(game.id),
    changes: changes.data?.get(game.id)?.length, evaluated: evaluations.data?.has(game.id), published: !!evaluations.data?.get(game.id)?.publishedAt })
  const stateOf = (game: Game) => gameStatus(game, now, progress(game))
  // TRAK-284: a plan draft stays open until it's shared (TRAK-286) or its match kicks off and locks it (TRAK-287).
  // TRAK-288: an evaluation draft stays open until it's published (TRAK-289).
  const drafts = [
    ...ordered.filter(game => plans.data?.has(game.id) && !shares.data?.has(game.id) && now < Date.parse(game.starts_at))
      .map(game => ({ game, what: t('coachHome:gamePlan'), saved: plans.data!.get(game.id)!, tab: 'plan' as const })),
    ...ordered.flatMap(game => {
      const evaluation = evaluations.data?.get(game.id)
      return evaluation && !evaluation.publishedAt ? [{ game, what: t('nav:evaluation'), saved: evaluation.savedAt, tab: 'evaluation' as const }] : []
    }),
  ]

  const published = (game: Game) => !!evaluations.data?.get(game.id)?.publishedAt
  const previous = ordered.filter(published)
  const scorers = useScorers(previous.filter(game => Date.parse(game.starts_at) >= seasonStart(now)).map(game => game.id))

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-5 pb-3">
          {/* TRAK-376 (Imad, 5 Nov): on a phone the avatar opens the side menu, where the squad picker is. */}
          <CoachMenuButton name={profile?.full_name || t('nav:coach')} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">{t('nav:matches')}</h1>
        </header>

        {games.error || plans.error || shares.error || evaluations.error
            ? <LoadError what={t('coachMatches:matchesWhat')} onRetry={() => { void games.refetch(); void plans.refetch(); void shares.refetch(); void evaluations.refetch() }}
                retrying={games.isFetching || plans.isFetching || shares.isFetching || evaluations.isFetching} />
          : games.isPending || plans.isPending || shares.isPending || evaluations.isPending ? <LoadingSkeleton label={t('coachSquad:fmMatchesLoading')} rows={3} className="pt-6" />
          : ordered.length === 0 ? (
            <div className="arc pt-6">
              <EmptyState icon={<PitchIcon size={24} strokeWidth={1.5} />} title={t('coachMatches:noMatchesYet')}
                description={t('coachMatches:noMatchesBody')}
                action={<Button onClick={() => navigate('/coach/schedule', { state: ADD_MATCH })}>{t('coachMatches:addMatch')}</Button>} />
            </div>
          ) : <>
            <div className="grid gap-4 laptop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {next ? <NextGame game={next} state={stateOf(next)} step={gameState(next, now, progress(next))} onKickOff={() => setNow(Date.now())} /> : (
                <section aria-labelledby="next-game" className="rounded-2xl border border-line bg-surface p-5">
                  <h2 id="next-game" className="text-lg font-medium text-ink">{t('coachMatches:nextMatch')}</h2>
                  <p className="mt-2 text-sm text-ink-2">{t('coachMatches:noMatchComing')}</p>
                  <Link to="/coach/schedule" state={ADD_MATCH}
                    className="mt-3 inline-block rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('coachMatches:addMatch')}</Link>
                </section>
              )}
              {/* TRAK-284: plan drafts. TRAK-288: evaluation drafts. */}
              <section aria-labelledby="open-drafts" className="arc rounded-2xl border border-line bg-surface p-5">
                <h2 id="open-drafts" className="text-lg font-medium text-ink">{t('coachMatches:openDrafts')}</h2>
                <p className="mt-1 text-sm text-ink-3">{t('coachMatches:draftsNote')}</p>
                {drafts.length === 0 ? <p className="mt-4 text-sm text-ink-2">{t('coachMatches:noDrafts')}</p> : <ul className="mt-3 divide-y divide-line">
                  {drafts.map(({ game, what, saved, tab }) => <li key={`${tab}:${game.id}`} className="flex items-center justify-between gap-3 py-3">
                    <span className="grid min-w-0">
                      <span className="truncate text-base font-medium text-ink">{gameTitle(game)}</span>
                      <span className="truncate text-sm text-ink-3">{t('coachMatches:savedAt', { what, when: format(new Date(saved), 'EEE d MMM, HH:mm', { locale: dateLocale() }) })}</span>
                    </span>
                    <Button variant="secondary" size="sm" aria-label={t(tab === 'plan' ? 'coachMatches:openPlanOf' : 'coachMatches:openEvaluationOf', { title: gameTitle(game) })}
                      onClick={() => open(game, { tab })}>{t('coachMatches:open')}</Button>
                  </li>)}
                </ul>}
              </section>
            </div>

            <div className={`mt-6 grid gap-6 ${previous.length ? 'laptop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] laptop:items-start' : ''}`}>
            <div className="grid min-w-0 gap-6">
            <div className="min-w-0">
              <h2 className="mb-2 text-lg font-medium text-ink">{t('coachMatches:yourMatches')}</h2>
              <div className="arc -mx-1">
                <ScrollArea orientation="horizontal" snap="x mandatory" fade={24} label={t('coachMatches:yourMatches')}>
                  <ul className="flex gap-3 px-1 pb-1">
                    {ordered.filter(game => !published(game)).map(game => {
                      const state = stateOf(game)
                      const { day, time } = gameWhen(game)
                      return <li key={game.id} className="w-[220px] flex-none" style={{ scrollSnapAlign: 'start' }}>
                        <Link to={`/coach/matches/${game.id}`}
                          className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <span className="grid min-w-0">
                            <span className="truncate text-base font-medium text-ink">{gameTitle(game)}</span>
                            <span className="truncate text-sm text-ink-3">{[day, time, everySquad ? game.squad : null].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="arc mt-auto"><Badge tone={state.tone} size="sm">{shown(MATCH_WORD, state.label)}</Badge></span>
                        </Link>
                      </li>
                    })}
                  </ul>
                </ScrollArea>
              </div>
            </div>
            {previous.length > 0 && <PreviousMatches games={previous} results={evaluations.data!} squads={everySquad} />}
            </div>
            {previous.length > 0 && <TopScorers scorers={scorers} />}
            </div>
          </>}
      </div>
    </div>
  )
}

/** The next match: its next action as a split button (TRAK-333) and the countdown to kick-off. A static panel, not a
 *  link. TRAK-333 (Imad, 2 Nov): no loop stepper; it served no purpose here. */
function NextGame({ game, state, step, onKickOff }: {
  game: Game; state: ReturnType<typeof gameStatus>; step: GameState; onKickOff: () => void
}) {
  const { t } = useTranslation()
  const { day, time, academy } = gameWhen(game)
  return (
    <section aria-labelledby="next-game" className="arc flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-game" className="text-lg font-medium text-ink">{t('coachMatches:nextMatch')}</h2>
        <Badge tone={state.tone}>{shown(MATCH_WORD, state.label)}</Badge>
      </div>
      <div className="grid min-w-0 gap-1">
        <p className="text-[22px] font-medium tracking-[-0.01em] text-ink break-words">{gameTitle(game)}</p>
        <p className="text-sm text-ink-2">{[day, details(game, time)].filter(Boolean).join(' · ')}</p>
        {academy && <p className="text-sm text-ink-3">{academy}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <MatchAction state={step} eventId={game.id} />
        <Countdown variant="compact" units={['days', 'hours', 'minutes']} target={game.starts_at}
          label={t('coachMatches:kickOffIn')} completeLabel={t('coachMatches:locked')} onComplete={onKickOff} className="ml-auto" />
      </div>
    </section>
  )
}

/** TRAK-320: matches whose evaluation is published, newest first: the result at a glance, and the evaluation a tap away. */
function PreviousMatches({ games, results, squads }: {
  games: Game[]; results: Map<string, { ourScore: number | null; theirScore: number | null }>; squads: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="min-w-0">
      <h2 className="mb-2 text-lg font-medium text-ink">{t('coachMatches:previousMatches')}</h2>
      <div className="arc -mx-1">
        <ScrollArea orientation="horizontal" snap="x mandatory" fade={24} label={t('coachMatches:previousMatches')}>
          <ul className="flex gap-3 px-1 pb-1">
            {games.map(game => {
              const { ourScore: our, theirScore: their } = results.get(game.id)!
              // TRAK-362: said the same way as on Home's Season plan card.
              const result = matchResult(our, their)
              const competition = game.competition && game.competition in COMPETITION_WORD ? t(COMPETITION_WORD[game.competition as keyof typeof COMPETITION_WORD]) : undefined
              return <li key={game.id} className="w-[200px] flex-none" style={{ scrollSnapAlign: 'start' }}>
                <Link to={`/coach/matches/${game.id}?tab=evaluation`}
                  className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span className="grid min-w-0">
                    <span className="truncate text-base font-medium text-ink">{gameTitle(game)}</span>
                    <span className="truncate text-sm text-ink-3">{[gameWhen(game).day, competition, squads ? game.squad : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="arc mt-auto"><Badge tone={result.tone} size="sm">{result.label}</Badge></span>
                </Link>
              </li>
            })}
          </ul>
        </ScrollArea>
      </div>
    </div>
  )
}

const SHOWN = 10

/** TRAK-321: who scored and assisted most this season, in the squad in view: goals, then assists. */
function TopScorers({ scorers }: { scorers: UseQueryResult<Scorer[]> }) {
  const [all, setAll] = useState(false)
  const { t } = useTranslation()
  const rows = scorers.data ?? []
  const cell = 'py-1.5 pl-2 text-right tabular-nums'
  return (
    <section aria-labelledby="top-scorers" className="arc min-w-0 rounded-2xl border border-line bg-surface p-5">
      <h2 id="top-scorers" className="text-lg font-medium text-ink">{t('coachMatches:topScorers')}</h2>
      <p className="mt-1 text-sm text-ink-3">{t('coachMatches:topScorersNote')}</p>
      {scorers.error ? <div className="mt-3"><LoadError what={t('coachMatches:scorersWhat')} onRetry={() => void scorers.refetch()} retrying={scorers.isFetching} /></div>
        : scorers.isPending ? <LoadingSkeleton label={t('coachMatches:loadingScorers')} lines={1} avatar rows={3} className="mt-3" />
        : rows.length === 0 ? <p className="mt-3 text-sm text-ink-2">{t('coachMatches:noGoalsYet')}</p>
        : <>
            <table className="mt-3 w-full table-fixed text-sm">
              <thead><tr className="border-b border-line text-ink-3">
                <th scope="col" className="py-2 text-left font-normal">{t('nav:player')}</th>
                <th scope="col" className="w-14 py-2 pl-2 text-right font-normal">{t('coachMatches:colGoals')}</th>
                <th scope="col" className="w-14 py-2 pl-2 text-right font-normal">{t('coachMatches:colAssists')}</th>
                <th scope="col" className="w-14 py-2 pl-2 text-right font-normal">{t('coachMatches:colPlayed')}</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {(all ? rows : rows.slice(0, SHOWN)).map((row, i) => <tr key={row.id}>
                  <th scope="row" className="truncate py-1.5 text-left font-normal text-ink" title={row.name}><span className="mr-2 inline-block w-5 text-ink-3 tabular-nums">{i + 1}</span>{row.name}</th>
                  <td className={`${cell} font-medium text-ink`}>{row.goals}</td>
                  <td className={`${cell} text-ink-2`}>{row.assists}</td>
                  <td className={`${cell} text-ink-3`}>{row.played}</td>
                </tr>)}
              </tbody>
            </table>
            {rows.length > SHOWN && <div className="mt-2"><Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
              {all ? t('coachMatches:showTop', { count: SHOWN }) : t('coachMatches:showAll', { count: rows.length })}</Button></div>}
          </>}
    </section>
  )
}
