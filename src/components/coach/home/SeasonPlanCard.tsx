import { useId, useState } from 'react'
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
import { instructionsWent, matchOutcome, matchResult } from '@/lib/games/results'
import {
  loadRemovedSeasonObjectives, loadSeasonObjectives, planLabel, removedSeasonObjectivesKey, seasonLeft, seasonObjectivesKey, seasonProgress, shortDate, useSeasonPlan,
  type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { measureObjectives } from '@/lib/season-objective-measure'
import { DonutChart } from '@/components/arc/donut-chart/donut-chart'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import styles from './season-plan-card.module.css'

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
// TRAK-550: each part of the open card in a light panel, under a small capitals title (the mockup's).
const panel = 'grid min-w-0 content-start gap-3 rounded-[14px] bg-raised p-4'
const panelTitle = 'text-[13px] font-medium uppercase tracking-[.06em] text-ink-2'
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
  const wide = useSideMenuScreen()
  const toPlan = () => { onOpen(); navigate('/coach/season-plan') }
  // TRAK-335: a skeleton while it loads, never "Loading…", and nothing shifts once it has.
  if (season.isPending) return <LoadingSkeleton label={`Loading the ${squad} season plan…`} lines={2} className={className} />
  if (season.error) {
    return <section aria-label={`${squad} season plan`} className={`${card} ${className ?? ''}`}>
      <LoadError what={`the ${squad} season plan`} onRetry={season.retry} />
    </section>
  }
  const plan = season.plan
  const years = plan?.starts_on && plan.ends_on ? `${plan.starts_on.slice(0, 4)}–${plan.ends_on.slice(2, 4)}` : null
  // TRAK-549 (Season plan card 1/5, Kostas's 21 Nov mockup): before it's shared, the card is one line with its next step
  // on it, Start or Continue, and nothing to fold. TRAK-433 (Tarek, 15 Nov): Start stays compact, never full width.
  if (!plan || !plan.shared_at) {
    return <section aria-label={`${squad} season plan`} className={`${card} relative overflow-hidden laptop:p-5 ${className ?? ''}`}>
      <PitchLines />
      <div className="relative flex items-center gap-4">
        {/* TRAK-573 (Kostas, 23 Nov): no calendar icon; "Not started" or "Not shared yet" says it. */}
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Title squad={squad} years={plan ? years : null} />
          <span><Badge tone={plan ? 'warning' : 'neutral'} size="md" dot pill>{plan ? 'Not shared yet' : 'Not started'}</Badge></span>
        </div>
        <Button size="sm" onClick={toPlan}>{plan ? 'Continue' : 'Start'}</Button>
      </div>
    </section>
  }
  const toggle = () => { remember(coachId, squad, !open); setOpen(!open) }
  const label = planLabel(plan)
  const left = seasonLeft(plan)
  const viewPlan = <Button variant="secondary" size="sm" onClick={toPlan}>View plan</Button>
  return (
    <section aria-label={`${squad} season plan`} className={`${card} laptop:p-5 ${className ?? ''}`}>
      {/* TRAK-549: the title and its state open and fold the card; View plan and the arrow sit at the top right. On a
          phone View plan waits at the bottom of the open card, as before. */}
      <div className="flex items-start gap-3">
        <button type="button" aria-expanded={open} aria-controls={`season-plan-body-${squad}`} onClick={toggle}
          className="grid min-h-11 min-w-0 flex-1 gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Title squad={squad} years={years} />
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-ink-2">
            <Badge tone={label.tone} size="md" dot pill>{label.text}</Badge>
            {left && <span>{left}</span>}
          </span>
        </button>
        <div className="flex flex-none items-center gap-2">
          {wide && viewPlan}
          <button type="button" aria-expanded={open} aria-controls={`season-plan-body-${squad}`} onClick={toggle}
            aria-label={`${open ? 'Fold' : 'Open'} the ${squad} season plan`}
            className="grid size-10 place-items-center rounded-xl text-ink-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {open ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <SeasonBar plan={plan} left={left} />
      {open && <div id={`season-plan-body-${squad}`} className={`grid gap-4 ${styles.body}`}>
        <SharedBody coachId={coachId} squad={squad} plan={plan} />
        {!wide && <div className="flex justify-end">{viewPlan}</div>}
      </div>}
    </section>
  )
}

function Title({ squad, years }: { squad: string; years: string | null }) {
  return <span className="flex flex-wrap items-baseline gap-x-2">
    <span className="text-lg font-medium text-ink">{squad} season plan</span>
    {years && <span className="text-[15px] text-ink-3">{years}</span>}
  </span>
}

/** TRAK-549 (Kostas, 22 Nov: keep it): the season from its first day to its last, filled to today. The words say it
 *  for a screen reader; no bar without both dates. */
function SeasonBar({ plan, left }: { plan: SeasonPlan; left: string | null }) {
  const progress = seasonProgress(plan)
  if (progress == null || !plan.starts_on || !plan.ends_on) return null
  const [from, to] = [shortDate(`${plan.starts_on}T00:00:00`), shortDate(`${plan.ends_on}T00:00:00`)]
  const at = `${Math.round(progress * 1000) / 10}%`
  return <div role="img" aria-label={`Season from ${from} to ${to}${left ? `, ${left}` : ''}`} className="grid gap-1.5">
    <div className="relative h-1.5 rounded-full bg-raised">
      <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: at }} />
      <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-brand bg-surface" style={{ left: at }} />
    </div>
    <div aria-hidden="true" className="flex justify-between text-xs tabular-nums text-ink-3"><span>{from}</span><span>{to}</span></div>
  </div>
}

/** Faint pitch lines behind a card that isn't shared yet, on a laptop only (the mockup's). */
function PitchLines() {
  return <svg aria-hidden="true" viewBox="0 0 260 160" fill="none" stroke="currentColor" strokeWidth="2"
    className="pointer-events-none absolute -right-8 top-1/2 hidden h-40 w-[260px] -translate-y-1/2 text-line laptop:block">
    <rect x="2" y="2" width="300" height="156" rx="4" /><line x1="130" y1="2" x2="130" y2="158" /><circle cx="130" cy="80" r="34" />
    <circle cx="130" cy="80" r="3" fill="currentColor" /><rect x="2" y="40" width="40" height="80" /><rect x="2" y="60" width="14" height="40" />
  </svg>
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

  return <div className={styles.panels}>
    <SeasonObjectives objectives={objectives.data ?? []} matches={matches} plans={matchPlans.data} wide={!matches.on} />
    {matches.on && <Results matches={matches} plans={matchPlans.data} names={names} />}
    {/* TRAK-553 (5/5): the squad at a glance, one bar split by group with a legend; Show players opens the names, one
        column per group. Under the title, how many are working on objectives (and watched). */}
    <section aria-labelledby={`season-plan-players-title-${squad}`} className={`${panel} ${styles.wide}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h3 id={`season-plan-players-title-${squad}`} className={panelTitle}>Player objectives</h3>
          <span className="text-sm text-ink-2">{players(working)} working on objectives{watchCount ? ` · ${watchCount} watching` : ''}</span>
        </div>
        {groups.length > 0 && <button type="button" aria-expanded={playersOpen} aria-controls={`season-plan-players-${squad}`} onClick={() => setPlayersOpen(!playersOpen)}
          className="inline-flex min-h-9 flex-none items-center gap-1.5 rounded-[10px] px-2.5 text-sm text-ink-2 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {playersOpen ? 'Hide players' : 'Show players'}
          {playersOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>}
      </div>
      {groups.length > 0 && <>
        <div role="img" aria-label={`${groups.map(g => `${g.label} ${g.players.length}`).join(', ')} of ${players(inSquad.length)}`}
          className="flex h-3 gap-[3px] overflow-hidden rounded-full">
          {groups.map(g => <span key={g.label} className="h-full" style={{ flex: g.players.length, background: groupColour(g.label) }} />)}
        </div>
        <ul aria-hidden="true" className="m-0 flex list-none flex-wrap gap-x-[18px] gap-y-2 p-0 text-sm text-ink-2">
          {groups.map(g => <li key={g.label} className="inline-flex items-center gap-[7px]">
            <i className="inline-block size-2.5 rounded-[3px]" style={{ background: groupColour(g.label) }} />{g.label} <b className="font-medium tabular-nums text-ink">{g.players.length}</b>
          </li>)}
        </ul>
      </>}
      {playersOpen && <div id={`season-plan-players-${squad}`} className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {groups.map(group => <div key={group.label} className="grid content-start gap-2 rounded-[10px] bg-surface p-3">
          <h4 className="flex items-center gap-2 text-sm font-medium text-ink">
            <i aria-hidden="true" className="inline-block size-2.5 rounded-[3px]" style={{ background: groupColour(group.label) }} />
            {group.label} <span className="font-normal text-ink-3">· {group.players.length}</span>
          </h4>
          <ul className="m-0 grid list-none gap-2 p-0">{group.players.map(p => (
            <li key={p.id} className="flex items-center gap-2.5">
              <PlayerFace name={p.player_name} playerId={p.id} size="sm" />
              <span className="grid min-w-0">
                <span className="truncate text-sm text-ink">{p.player_name}</span>
                <span className="truncate text-xs text-ink-3">{held.of(p.id).length ? [TREND[String(status.get(p.id)?.trend)], held.of(p.id).map(o => o.title).join(' · ')].filter(Boolean).join(' · ')
                  : watched.get(p.id)?.ready ? `${watched.get(p.id)!.why}: time to set them up` : watched.has(p.id) ? `Watching: ${watched.get(p.id)!.progress}` : 'Nothing set yet'}</span>
              </span>
            </li>))}
          </ul>
        </div>)}
      </div>}
    </section>
  </div>
}

/** TRAK-553 (Kostas, 21 Nov: muted): each group's colour in the bar, the legend and its column, from the role tokens:
 *  soft red, amber and green for how players are doing, quieter shades for the rest. */
const tint = (token: string, share: number) => `color-mix(in oklab, rgb(var(${token})) ${share}%, rgb(var(--t-surface)))`
const GROUP_COLOUR: Record<string, string> = {
  'Not yet': tint('--t-danger', 45), 'Some progress': tint('--t-warning', 50), 'On track': tint('--t-success', 50),
  'Not rated yet': tint('--t-ink-3', 45), Watching: tint('--t-info', 35), 'No objective yet': tint('--t-ink-3', 20),
}
const groupColour = (label: string) => GROUP_COLOUR[label] ?? tint('--t-ink-3', 20)

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
/** TRAK-551 (Kostas, 21 Nov: calmer): the donut in shades of Trak green, one per season objective (a plan has at most
 *  three), and the same colour as a square beside each objective, so the two can be matched. */
const OBJECTIVE_GREENS = ['rgb(var(--t-success))', 'color-mix(in oklab, rgb(var(--t-success)) 55%, rgb(var(--t-surface)))',
  'color-mix(in oklab, rgb(var(--t-brand)) 28%, rgb(var(--t-surface)))']
const greenOf = (index: number) => OBJECTIVE_GREENS[index % OBJECTIVE_GREENS.length]

/** TRAK-363: each season objective measured only from matches: a donut with a segment per objective (how often it
 *  Worked), and beside each its share and Good / Watch / At risk. Selecting one lists its matches. Two Didn'ts in a row
 *  need attention. TRAK-551: the donut smaller, beside its list (above it on a narrow panel); each row a white tile. */
function SeasonObjectives({ objectives, matches, plans, wide }: {
  objectives: SeasonObjective[]; matches: ReturnType<typeof useSquadMatches>; plans: Map<string, MatchPlan> | undefined
  /** Without Matches there are no Results beside it, so it takes the whole row. */
  wide: boolean
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

  // TRAK-550: each panel is a section named by its title, so a screen reader can jump between them.
  const titleId = useId()
  const rows = <ul className="m-0 grid list-none gap-1.5 p-0">{objectives.map((o, i) => {
    const m = measures.get(o.id)
    return <li key={o.id}>
      <button type="button" aria-pressed={selected === o.id} disabled={!m?.matches} onClick={() => setSelected(selected === o.id ? null : o.id)}
        className={`grid min-h-11 w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border bg-surface px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default ${selected === o.id ? 'border-ink-3' : 'border-transparent enabled:hover:border-line-strong'}`}>
        <span aria-hidden="true" className="size-3 rounded-[4px]" style={{ background: greenOf(i) }} />
        <span className="grid min-w-0">
          <span className="text-[15px] text-ink">{o.title}</span>
          <span className="text-[13px] tabular-nums text-ink-3">{m?.matches ? `Worked in ${m.worked} of ${m.matches} ${m.matches === 1 ? 'match' : 'matches'} · ${m.pct}%` : 'No match yet'}</span>
        </span>
        {m?.verdict ? <Badge tone={VERDICT_TONE[m.verdict]} size="sm" pill>{m.verdict}</Badge> : <span />}
      </button>
    </li>
  })}</ul>

  return <section aria-labelledby={titleId} className={`${panel} ${styles.objectives} ${wide ? styles.wide : ''}`}>
    <div className="flex min-h-8 items-center"><h3 id={titleId} className={panelTitle}>Season objectives</h3></div>
    {objectives.length === 0 ? <p className="text-sm text-ink-3">None selected.</p> : <>
      {measured ? <div className={styles.measure}>
        {/* Arc's donut takes its box's width, so the box is the donut's size and the donut fills it (centred, either would
            shrink to nothing). Kostas, 23 Nov: the middle says "Worked" with the number under it ("Times worked" touched
            the ring). */}
        <div className="grid w-[148px] gap-1">
          <DonutChart label="Times each season objective worked" totalLabel="Worked" legend={false}
            data={objectives.map((o, i) => ({ key: o.id, label: o.title, value: measures.get(o.id)?.worked ?? 0, color: greenOf(i) }))}
            activeKey={selected} onActiveChange={setSelected} size={148} thickness={14} emptyLabel="Nothing worked yet" />
          {/* TRAK-382: a donut draws no slice for 0, so an objective that has matches but never worked is named here. */}
          {noneWorked.length > 0 && <p className="max-w-[148px] text-center text-xs text-ink-3">Worked 0 times: {noneWorked.map(o => o.title).join(', ')}</p>}
        </div>
        {rows}
      </div> : rows}
      {chosen && <div className="grid gap-1.5 rounded-[10px] bg-surface p-3">
        <h4 className="text-sm font-medium text-ink">{chosen.title}: match by match</h4>
        <ul className="m-0 grid list-none gap-1 p-0">{chosenMatches.map(({ game, went }, i) => (
          <li key={`${game.id}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink">{gameTitle(game)} <span className="text-ink-3">· {gameWhen(game).day}</span></span>
            <span className="shrink-0 text-ink-3">{went ?? '—'}</span>
          </li>))}
        </ul>
      </div>}
      {/* TRAK-551: a white tile with the yellow of everything waiting on the coach down its left edge. */}
      {stuck.length > 0 && <div role="status" className="grid grid-cols-[4px_minmax(0,1fr)] gap-3 rounded-[10px] bg-surface p-3">
        <span aria-hidden="true" className="rounded" style={{ background: 'rgb(var(--t-attention))' }} />
        <div className="grid gap-0.5">
          <h4 className="text-sm font-medium text-ink">Needs your attention</h4>
          {stuck.map(o => <p key={o.id} className="text-sm text-ink-2">{o.title}: didn’t work in the last two matches.</p>)}
        </div>
      </div>}
    </>}
  </section>
}

function Results({ matches, plans, names }: {
  matches: ReturnType<typeof useSquadMatches>; plans: Map<string, MatchPlan> | undefined; names: Map<string, string>
}) {
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const shown = all ? matches.published : matches.published.slice(0, RESULTS_SHOWN)
  const titleId = useId()
  return <section aria-labelledby={titleId} className={`${panel} gap-2`}>
    {/* TRAK-550: Show all sits at the panel's top right. */}
    <div className="flex min-h-8 items-center justify-between gap-3">
      <h3 id={titleId} className={panelTitle}>Results</h3>
      {matches.published.length > RESULTS_SHOWN && <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${matches.published.length}`}</Button>}
    </div>
    {matches.published.length === 0 ? <p className="text-sm text-ink-3">No published match yet this season.</p>
      : <ul className="m-0 grid list-none gap-1.5 p-0">{shown.map(game => {
        const scores = matches.scores(game.id)
        return <ResultRow key={game.id} game={game} result={matchResult(scores.ourScore, scores.theirScore)}
          outcome={matchOutcome(scores.ourScore, scores.theirScore)} plan={plans?.get(game.id)} names={names}
          open={openId === game.id} onToggle={() => setOpenId(openId === game.id ? null : game.id)} />
      })}</ul>}
  </section>
}

/** TRAK-552 (4/5): how each instruction went, in its colour: Worked green, Partly amber, Didn't red. */
const WENT_COLOUR: Record<string, string> = { Worked: 'text-success', Partly: 'text-warning', 'Didn’t': 'text-danger' }
const OUTCOME_COLOUR = { success: 'text-success', neutral: 'text-ink-3', danger: 'text-danger' } as const

/** TRAK-362: one published match, folded; opened, how each instruction went. TRAK-552: a white tile that leads with the
 *  score, the word under it in green, grey or red. Its name still says the result as Matches home says it. */
function ResultRow({ game, result, outcome, plan, names, open, onToggle }: {
  game: Game; result: ReturnType<typeof matchResult>; outcome: ReturnType<typeof matchOutcome>; plan: MatchPlan | undefined
  names: Map<string, string>; open: boolean; onToggle: () => void
}) {
  const went = plan ? instructionsWent(plan.goals, plan.planWorked) : null
  const { day } = gameWhen(game)
  return <li className="overflow-hidden rounded-[10px] bg-surface">
    <button type="button" aria-expanded={open} aria-controls={`result-${game.id}`} onClick={onToggle}
      aria-label={`${gameTitle(game)}, ${day}, ${result.label}`}
      className="grid min-h-11 w-full grid-cols-[64px_minmax(0,1fr)_20px] items-center gap-3 py-2 pl-2 pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
      <span aria-hidden="true" className="grid justify-items-center rounded-lg bg-ink/[0.06] py-1.5 tabular-nums">
        {outcome.score && <span className="text-lg font-semibold leading-tight text-ink">{outcome.score}</span>}
        <span className={`text-[11px] font-medium uppercase tracking-[.05em] ${OUTCOME_COLOUR[outcome.tone]}`}>{outcome.word}</span>
      </span>
      <span aria-hidden="true" className="grid min-w-0">
        <span className="truncate text-[15px] text-ink">{gameTitle(game)}</span>
        <span className="truncate text-[13px] text-ink-3">{day}</span>
      </span>
      {open ? <ChevronUp size={18} aria-hidden="true" className="text-ink-3" /> : <ChevronDown size={18} aria-hidden="true" className="text-ink-3" />}
    </button>
    {open && <div id={`result-${game.id}`} className="px-3 pb-3 laptop:pl-[84px]">
      {!went ? <LoadingSkeleton label="Loading how the plan went…" lines={1} />
        : went.length === 0 ? <p className="text-sm text-ink-3">No instructions</p>
        : <ul className="m-0 grid list-none gap-2 p-0">{went.map((item, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm">
            <span className="grid min-w-0">
              <span className="text-ink">{item.title}</span>
              {/* TRAK-363: the season objective this instruction carried. */}
              {item.seasonObjectiveId && <span className="text-xs text-ink-3">Season objective: {names.get(item.seasonObjectiveId) ?? 'removed since'}</span>}
            </span>
            <span className={`shrink-0 font-medium ${item.went ? WENT_COLOUR[item.went] ?? 'text-ink-3' : 'text-ink-3'}`}>{item.went ?? '—'}</span>
          </li>))}
        </ul>}
    </div>}
  </li>
}
