import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useFeatureState } from '@/components/trak/parked'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { usePlayerObjectives } from '@/components/coach/season-plan/usePlayerObjectives'
import { useWatchList } from '@/components/coach/season-plan/useWatching'
import { loadSeasonObjectives, planState, seasonObjectivesKey, useSeasonPlan, type SeasonPlan } from '@/lib/season-plan'

/* TRAK-361 (Season plan 13/18, spec TRAK-348): the season plan's card under Needs you, where the academy's switch is
   on. Folded, one line: the state and what comes next ("Shared 3 Nov · 34 weeks left"). Open: the season objectives,
   each "No match yet" until TRAK-363 measures them; the player objectives in one folded row that lists every player,
   worst first; and View plan. Open or folded is kept on this device, per coach and per squad (Tarek, 3 Nov: the whole
   card folds). Under All, one folded row per squad, each opening that squad's card. Not started: TRAK-350's Start. */

const card = 'arc grid gap-3 rounded-2xl border border-line bg-surface p-4'
const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const storeKey = (coachId: string, squad: string) => `trak.season-plan-card.${coachId}.${squad}`
function remembered(coachId: string, squad: string) {
  try { return localStorage.getItem(storeKey(coachId, squad)) === 'open' } catch { return false }
}
function remember(coachId: string, squad: string, open: boolean) {
  try { localStorage.setItem(storeKey(coachId, squad), open ? 'open' : 'folded') } catch { /* storage unavailable: kept for this visit */ }
}

export function SeasonPlanCard({ coachId, squads, squad, everySquad, onPick, className }: {
  coachId: string
  /** The coach's squads, and the one in view: none under All. */
  squads: string[]
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
  if (!only) return <LoadingSkeleton label="Loading your season plan…" lines={2} className={className} />
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
  const watching = useWatchList(coachId, roster)
  if (objectives.error || roster.error || held.error) {
    return <LoadError what="how the season is going" onRetry={() => { void objectives.refetch(); roster.retry(); void held.refetch() }} />
  }
  if (objectives.isPending || roster.isPending || held.isPending) return <LoadingSkeleton label="Loading how the season is going…" lines={3} />

  const inSquad = roster.players.filter(p => p.age_group?.trim() === squad && !roster.consentPending.has(p.id))
  const watched = new Map(watching.list.map(w => [w.playerId, w]))
  // Worst first. The statuses (Not yet, Some progress, On track) arrive with the evaluation (TRAK-365); until then
  // everyone with objectives is Not rated yet.
  const groups = [
    { label: 'Not rated yet', players: inSquad.filter(p => held.of(p.id).length > 0) },
    { label: 'Watching', players: inSquad.filter(p => !held.of(p.id).length && watched.has(p.id)) },
    { label: 'No objective yet', players: inSquad.filter(p => !held.of(p.id).length && !watched.has(p.id)) },
  ].filter(group => group.players.length > 0)
  const working = groups.find(g => g.label === 'Not rated yet')?.players.length ?? 0
  const watchCount = groups.find(g => g.label === 'Watching')?.players.length ?? 0

  return <>
    <div className="grid gap-2">
      <h3 className="text-sm font-medium text-ink-2">Season objectives</h3>
      {(objectives.data ?? []).length === 0 ? <p className="text-sm text-ink-3">None picked.</p>
        : <ul className="m-0 grid list-none gap-1.5 p-0">{objectives.data!.map(o => (
          <li key={o.id} className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink">{o.title}</span>
            <span className="shrink-0 text-sm text-ink-3">No match yet</span>
          </li>))}
        </ul>}
    </div>
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
                <span className="truncate text-xs text-ink-3">{held.of(p.id).length ? held.of(p.id).map(o => o.title).join(' · ')
                  : watched.get(p.id)?.ready ? `${watched.get(p.id)!.why}: time to set them up` : watched.has(p.id) ? `Watching: ${watched.get(p.id)!.progress}` : 'Nothing set yet'}</span>
              </span>
            </li>))}
          </ul>
        </div>)}
      </div>}
    </div>
  </>
}
