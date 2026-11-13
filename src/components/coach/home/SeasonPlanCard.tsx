import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { supabase } from '@/integrations/supabase/client'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useFeatureState } from '@/components/trak/parked'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { usePlayerObjectives } from '@/components/coach/season-plan/usePlayerObjectives'
import { useObjectiveProgress } from '@/components/coach/season-plan/useObjectiveProgress'
import { STATUS_ORDER, latestProgress, playerProgress, progressLabel } from '@/lib/objective-progress'
import { useWatchList } from '@/components/coach/season-plan/useWatching'
import { gameTitle, gameWhen, useGameEvaluations, useGames, type Game } from '@/components/coach/games/useGames'
import { instructionsWent, matchResult } from '@/lib/games/results'
import {
  loadRemovedSeasonObjectives, loadSeasonObjectives, planState, removedSeasonObjectivesKey, seasonObjectivesKey, useSeasonPlan, type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { measureObjectives } from '@/lib/season-objective-measure'
import { DonutChart } from '@/components/arc/donut-chart/donut-chart'

/* TRAK-361 (Season plan 13/18, spec TRAK-348): the season plan's card under Needs you, where the academy's switch is
   on. Folded, one line: the state and what comes next ("Shared 3 Nov · 34 weeks left"). Open: the season objectives,
   each "No match yet" until TRAK-363 measures them; the player objectives in one folded row that lists every player,
   worst first; and View plan. Open or folded is kept on this device, per coach and per squad (Tarek, 3 Nov: the whole
   card folds). Under All, one folded row per squad, each opening that squad's card. Not started: TRAK-350's Start.
   TRAK-362: inside the open card, the squad's published match results this season, newest first, from the reads
   Matches home's Previous matches makes, so the two never disagree. Each row starts folded and opens to how each
   instruction went; the latest three show, and Show all lists the rest. TRAK-363: each season objective is measured
   from those matches only (the share that Worked: Good, Watch, At risk), with Arc's donut; a result's instruction
   names the season objective it carried. */

const card = 'arc grid gap-3 rounded-2xl border border-line bg-surface p-4'
const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const storeKey = (coachId: string, squad: string) => `trak.season-plan-card.${coachId}.${squad}`
function remembered(coachId: string, squad: string) {
  try { return localStorage.getItem(storeKey(coachId, squad)) === 'open' } catch { return false }
}
function remember(coachId: string, squad: string, open: boolean) {
  try { localStorage.setItem(storeKey(coachId, squad), open ? 'open' : 'folded') } catch { /* storage unavailable: kept for this visit */ }
}

export function SeasonPlanCard({ coachId, squads, squadsReady, squadsFailed, onRetry, squad, everySquad, onPick, className }: {
  coachId: string
  /** The coach's squads, and the one in view: none under All. */
  squads: string[]
  /** TRAK-416: false until the squads are known, so no squads yet is not mistaken for still loading. */
  squadsReady: boolean
  squadsFailed: boolean
  onRetry: () => void
  squad: string | null
  everySquad: boolean
  /** Under All, opening a squad's plan picks that squad first. */
  onPick: (squad: string) => void
  className?: string
}) {
  const { on, known } = useFeatureState('season_plan')
  if (!known) return <LoadingSkeleton label="Loading your season plan…" lines={2} className={className} />
  if (!on) return null
  if (everySquad && squads.length >= 2) {
    return <section aria-label="Season plans" className={`grid gap-3 ${className ?? ''}`}>
      {squads.map(s => <SquadPlanCard key={s} coachId={coachId} squad={s} onOpen={() => onPick(s)} />)}
    </section>
  }
  const only = squad ?? squads[0] ?? null
  if (!only) {
    // A coach with no players has no squad to plan yet: nothing to show, not a skeleton that never ends.
    if (squadsFailed) return <section aria-label="Season plan" className={`${card} ${className ?? ''}`}><LoadError what="your season plan" onRetry={onRetry} /></section>
    return squadsReady ? null : <LoadingSkeleton label="Loading your season plan…" lines={2} className={className} />
  }
  return <SquadPlanCard coachId={coachId} squad={only} onOpen={() => undefined} className={className} />
}

function SquadPlanCard({ coachId, squad, onOpen, className }: { coachId: string; squad: string; onOpen: () => void; className?: string }) {
  const navigate = useNavigate()
  const season = useSeasonPlan(coachId, squad)
  const [open, setOpen] = useState(() => remembered(coachId, squad))
  const toPlan = () => { onOpen(); navigate('/coach/season-plan') }
  // TRAK-335: a skeleton while it loads, never "Loading…", and nothing shifts once it has.
  if (season.isPending) return <LoadingSkeleton label={`Loading the ${squad} season plan…`} lines={2} className={className} />
  if (season.error) {
    return <section aria-label={`${squad} season plan`} className={`${card} ${className ?? ''}`}>
      <LoadError what={`the ${squad} season plan`} onRetry={season.retry} />
    </section>
  }
  const plan = season.plan
  if (!plan) {
    return <section aria-labelledby={`season-plan-${squad}`} className={`${card} flex items-center gap-4 ${className ?? ''}`}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <h2 id={`season-plan-${squad}`} className="text-base font-medium text-ink">{squad} season plan</h2>
        <p className="truncate text-sm text-ink-3">Not started</p>
      </div>
      <Button size="sm" onClick={toPlan}>Start</Button>
    </section>
  }
  const years = plan.starts_on && plan.ends_on ? ` ${plan.starts_on.slice(0, 4)}–${plan.ends_on.slice(2, 4)}` : ''
  const toggle = () => { remember(coachId, squad, !open); setOpen(!open) }
  return (
    <section aria-label={`${squad} season plan`} className={`${card} ${className ?? ''}`}>
      <button type="button" aria-expanded={open} aria-controls={`season-plan-body-${squad}`} onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="grid min-w-0 gap-0.5">
          <span className="text-base font-medium text-ink">{squad} season plan{years}</span>
          <span className="truncate text-sm text-ink-3">{planState(plan)}</span>
        </span>
        {open ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
      </button>
      {open && <div id={`season-plan-body-${squad}`} className="grid gap-4">
        {plan.shared_at ? <SharedBody coachId={coachId} squad={squad} plan={plan} />
          : <p className="text-sm text-ink-2">Once you share the plan, how the season is going shows here.</p>}
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={toPlan}>{plan.shared_at ? 'View plan' : 'Continue'}</Button>
        </div>
      </div>}
    </section>
  )
}

function SharedBody({ coachId, squad, plan }: { coachId: string; squad: string; plan: SeasonPlan }) {
  const [playersOpen, setPlayersOpen] = useState(false)
  const objectives = useQuery({ queryKey: seasonObjectivesKey(coachId, plan.id), queryFn: () => loadSeasonObjectives(plan.id) })
  const roster = useSquadRoster({ everySquad: true })
  const held = usePlayerObjectives(coachId)
  const progress = useObjectiveProgress(coachId)
  const watching = useWatchList(coachId, roster)
  const matches = useSquadMatches(squad, plan)
  const matchPlans = useMatchPlans(coachId, matches.published.map(game => game.id))
  // Removed objectives too, so a past match's instruction still says which it carried.
  const removed = useQuery({ queryKey: removedSeasonObjectivesKey(coachId, plan.id), queryFn: () => loadRemovedSeasonObjectives(plan.id) })
  if (objectives.error || roster.error || held.error || progress.error || matches.error || matchPlans.error) {
    return <LoadError what="how the season is going" onRetry={() => { void objectives.refetch(); roster.retry(); void held.refetch(); void progress.refetch(); matches.retry(); void matchPlans.refetch() }} />
  }
  if (objectives.isPending || roster.isPending || held.isPending || progress.isPending || matches.isPending || (matches.published.length > 0 && matchPlans.isPending)) {
    return <LoadingSkeleton label="Loading how the season is going…" lines={3} />
  }
  const names = new Map([...(removed.data ?? []), ...(objectives.data ?? [])].map(o => [o.id, o.title]))

  const inSquad = roster.players.filter(p => p.age_group?.trim() === squad && !roster.consentPending.has(p.id))
  const watched = new Map(watching.list.map(w => [w.playerId, w]))
  // Worst first: Not yet, Some progress, On track (TRAK-365), by each player's worst open objective's latest status; a
  // player with objectives and no evaluation yet is Not rated yet.
  const latest = latestProgress(progress.data ?? [])
  const status = new Map(inSquad.filter(p => held.of(p.id).length > 0).map(p => [p.id, playerProgress(held.of(p.id).map(o => o.id), latest)]))
  const groups = [
    ...STATUS_ORDER.map(s => ({ label: progressLabel(s), players: inSquad.filter(p => status.get(p.id)?.status === s) })),
    { label: 'Watching', players: inSquad.filter(p => !held.of(p.id).length && watched.has(p.id)) },
    { label: 'No objective yet', players: inSquad.filter(p => !held.of(p.id).length && !watched.has(p.id)) },
  ].filter(group => group.players.length > 0)
  const working = status.size
  const watchCount = groups.find(g => g.label === 'Watching')?.players.length ?? 0

  return <>
    <SeasonObjectives objectives={objectives.data ?? []} matches={matches} plans={matchPlans.data} />
    {matches.on && <Results matches={matches} plans={matchPlans.data} names={names} />}
    <div className="grid gap-2 border-t border-line pt-3">
      <button type="button" aria-expanded={playersOpen} aria-controls={`season-plan-players-${squad}`} onClick={() => setPlayersOpen(!playersOpen)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className="grid gap-0.5">
          <span className="text-sm font-medium text-ink">Player objectives</span>
          <span className="text-sm text-ink-3">{players(working)} working on objectives{watchCount ? ` · ${watchCount} watching` : ''}</span>
        </span>
        {playersOpen ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
      </button>
      {playersOpen && <div id={`season-plan-players-${squad}`} className="grid gap-3">
        {groups.map(group => <div key={group.label} className="grid gap-1">
          <h4 className="text-sm font-medium text-ink-2">{group.label} <span className="font-normal text-ink-3">· {group.players.length}</span></h4>
          <ul className="m-0 list-none divide-y divide-line p-0">{group.players.map(p => (
            <li key={p.id} className="flex items-center gap-3 py-1.5">
              <PlayerFace name={p.player_name} size="sm" />
              <span className="grid min-w-0">
                <span className="truncate text-sm text-ink">{p.player_name}</span>
                <span className="truncate text-xs text-ink-3">{held.of(p.id).length ? [TREND[String(status.get(p.id)?.trend)], held.of(p.id).map(o => o.title).join(' · ')].filter(Boolean).join(' · ')
                  : watched.get(p.id)?.ready ? `${watched.get(p.id)!.why}: time to set them up` : watched.has(p.id) ? `Watching: ${watched.get(p.id)!.progress}` : 'Nothing set yet'}</span>
              </span>
            </li>))}
          </ul>
        </div>)}
      </div>}
    </div>
  </>
}

/** How a player's worst objective moved since the evaluation before. */
const TREND: Record<string, string> = { '1': 'Better', '-1': 'Slipped', '0': 'Same' }

const RESULTS_SHOWN = 3
const dayOf = (game: Game) => game.event_date ?? game.starts_at.slice(0, 10)
type Scores = { ourScore: number | null; theirScore: number | null }
type MatchPlan = { goals: unknown; planWorked: (string | null)[] | null }

/** TRAK-362: the squad's published matches this season, newest first, from the reads Matches home's Previous matches
 *  makes. Drafts, cancelled matches, other squads and last season never show. */
function useSquadMatches(squad: string, plan: SeasonPlan) {
  const games = useFeatureState('games')
  const matches = useGames(games.on)
  const evaluations = useGameEvaluations(games.on)
  const published = (matches.data ?? [])
    .filter(game => game.status !== 'cancelled' && (game.squad == null || game.squad === squad) && !!evaluations.data?.get(game.id)?.publishedAt
      && (!plan.starts_on || dayOf(game) >= plan.starts_on) && (!plan.ends_on || dayOf(game) <= plan.ends_on))
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  return {
    on: games.on, published, scores: (id: string): Scores => evaluations.data?.get(id) ?? { ourScore: null, theirScore: null },
    isPending: games.on && (matches.isPending || evaluations.isPending), error: matches.error ?? evaluations.error ?? null,
    retry: () => { void matches.refetch(); void evaluations.refetch() },
  }
}

/** TRAK-363: those matches' instructions and how each went, read once for the measure and the results. */
function useMatchPlans(coachId: string, ids: string[]) {
  return useQuery({
    queryKey: ['coach', coachId, 'match-instructions', ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, MatchPlan>> => {
      const [plans, evaluations] = await Promise.all([
        supabase.from('game_plans').select('event_id, goals').in('event_id', ids),
        supabase.from('game_evaluations').select('event_id, plan_worked').in('event_id', ids),
      ])
      if (plans.error) throw plans.error
      if (evaluations.error) throw evaluations.error
      const worked = new Map((evaluations.data ?? []).map(row => [row.event_id, row.plan_worked as (string | null)[] | null]))
      return new Map(ids.map(id => [id, { goals: (plans.data ?? []).find(row => row.event_id === id)?.goals ?? [], planWorked: worked.get(id) ?? null }]))
    },
  })
}

const VERDICT_TONE = { Good: 'success', Watch: 'warning', 'At risk': 'danger' } as const

/** TRAK-363: each season objective measured only from matches: a donut with a segment per objective (how often it
 *  Worked), and beside each its share and Good / Watch / At risk. Selecting one lists its matches. Two Didn'ts in a row
 *  need attention. */
function SeasonObjectives({ objectives, matches, plans }: {
  objectives: SeasonObjective[]; matches: ReturnType<typeof useSquadMatches>; plans: Map<string, MatchPlan> | undefined
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const measures = measureObjectives(objectives.map(o => o.id), matches.published.map(game => ({
    eventId: game.id, startsAt: game.starts_at, goals: plans?.get(game.id)?.goals, planWorked: plans?.get(game.id)?.planWorked ?? null,
  })))
  const measured = objectives.some(o => (measures.get(o.id)?.matches ?? 0) > 0)
  const stuck = objectives.filter(o => measures.get(o.id)?.stuck)
  const noneWorked = objectives.filter(o => measures.get(o.id)?.matches && measures.get(o.id)?.worked === 0)
  const chosen = objectives.find(o => o.id === selected)
  const chosenMatches = chosen ? matches.published.flatMap(game => instructionsWent(plans?.get(game.id)?.goals, plans?.get(game.id)?.planWorked)
    .filter(item => item.seasonObjectiveId === chosen.id).map(item => ({ game, went: item.went }))) : []

  return <div className="grid gap-3">
    <h3 className="text-sm font-medium text-ink-2">Season objectives</h3>
    {objectives.length === 0 ? <p className="text-sm text-ink-3">None picked.</p> : <>
      {measured && <DonutChart label="Times each season objective worked" totalLabel="Times it worked" legend={false}
        data={objectives.map(o => ({ key: o.id, label: o.title, value: measures.get(o.id)?.worked ?? 0 }))}
        activeKey={selected} onActiveChange={setSelected} size={168} thickness={20} emptyLabel="Nothing worked yet" />}
      {/* TRAK-382: a donut draws no slice for 0, so an objective that has matches but never worked is named here. */}
      {measured && noneWorked.length > 0 && <p className="text-center text-xs text-ink-3">Worked 0 times: {noneWorked.map(o => o.title).join(', ')}</p>}
      <ul className="m-0 grid list-none gap-1.5 p-0">{objectives.map(o => {
        const m = measures.get(o.id)
        return <li key={o.id}>
          <button type="button" aria-pressed={selected === o.id} disabled={!m?.matches} onClick={() => setSelected(selected === o.id ? null : o.id)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default">
            <span className="grid min-w-0">
              <span className="text-sm text-ink">{o.title}</span>
              <span className="text-xs text-ink-3">{m?.matches ? `Worked in ${m.worked} of ${m.matches} ${m.matches === 1 ? 'match' : 'matches'} · ${m.pct}%` : 'No match yet'}</span>
            </span>
            {m?.verdict && <Badge tone={VERDICT_TONE[m.verdict]} size="sm">{m.verdict}</Badge>}
          </button>
        </li>
      })}</ul>
      {chosen && <div className="grid gap-1 rounded-xl border border-line p-3">
        <h4 className="text-sm font-medium text-ink">{chosen.title}: match by match</h4>
        <ul className="m-0 grid list-none gap-1 p-0">{chosenMatches.map(({ game, went }, i) => (
          <li key={`${game.id}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink">{gameTitle(game)} <span className="text-ink-3">· {gameWhen(game).day}</span></span>
            <span className="shrink-0 text-ink-3">{went ?? '—'}</span>
          </li>))}
        </ul>
      </div>}
      {stuck.length > 0 && <div role="status" className="grid gap-1 rounded-xl border border-line bg-surface p-3">
        <h4 className="text-sm font-medium text-ink">Needs your attention</h4>
        {stuck.map(o => <p key={o.id} className="text-sm text-ink-2">{o.title}: didn’t work in the last two matches.</p>)}
      </div>}
    </>}
  </div>
}

function Results({ matches, plans, names }: {
  matches: ReturnType<typeof useSquadMatches>; plans: Map<string, MatchPlan> | undefined; names: Map<string, string>
}) {
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const shown = all ? matches.published : matches.published.slice(0, RESULTS_SHOWN)
  return <div className="grid gap-2 border-t border-line pt-3">
    <h3 className="text-sm font-medium text-ink-2">Results</h3>
    {matches.published.length === 0 ? <p className="text-sm text-ink-3">No published match yet this season.</p>
      : <ul className="m-0 list-none divide-y divide-line p-0">{shown.map(game => {
        const scores = matches.scores(game.id)
        return <ResultRow key={game.id} game={game} result={matchResult(scores.ourScore, scores.theirScore)} plan={plans?.get(game.id)} names={names}
          open={openId === game.id} onToggle={() => setOpenId(openId === game.id ? null : game.id)} />
      })}</ul>}
    {matches.published.length > RESULTS_SHOWN && <span className="justify-self-start">
      <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${matches.published.length}`}</Button>
    </span>}
  </div>
}

function ResultRow({ game, result, plan, names, open, onToggle }: {
  game: Game; result: ReturnType<typeof matchResult>; plan: MatchPlan | undefined; names: Map<string, string>; open: boolean; onToggle: () => void
}) {
  const went = plan ? instructionsWent(plan.goals, plan.planWorked) : null
  return <li>
    <button type="button" aria-expanded={open} aria-controls={`result-${game.id}`} onClick={onToggle}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm text-ink">{gameTitle(game)}</span>
        <span className="truncate text-xs text-ink-3">{gameWhen(game).day}</span>
      </span>
      <Badge tone={result.tone} size="sm">{result.label}</Badge>
      {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
    </button>
    {open && <div id={`result-${game.id}`} className="pb-2 pl-1">
      {!went ? <LoadingSkeleton label="Loading how the plan went…" lines={1} />
        : went.length === 0 ? <p className="text-sm text-ink-3">No instructions</p>
        : <ul className="m-0 grid list-none gap-1 p-0">{went.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="grid min-w-0">
              <span className="text-ink">{item.title}</span>
              {/* TRAK-363: the season objective this instruction carried. */}
              {item.seasonObjectiveId && <span className="text-xs text-ink-3">Season objective: {names.get(item.seasonObjectiveId) ?? 'removed since'}</span>}
            </span>
            <span className="shrink-0 text-ink-3">{item.went ?? '—'}</span>
          </li>))}
        </ul>}
    </div>}
  </li>
}
