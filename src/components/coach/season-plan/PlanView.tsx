import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { PositionAndRolesSheet } from '@/components/coach/squad/PositionAndRolesSheet'
import { isPosition, positionsBoard } from '@/lib/positions'
import {
  changesText, lastShared, loadRemovedSeasonObjectives, notSharedYet, removedSeasonObjectivesKey, seasonPlanKey, shareSeasonPlan, shortDate,
  type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import type { Tables } from '@/integrations/supabase/types'
import { isWatchRule, ruleText } from '@/lib/watch-first'
import { PlayerObjectivesSheet } from './PlayerObjectivesSheet'
import { usePlayerObjectives } from './usePlayerObjectives'
import { useWatchList, useWatchPlayers } from './useWatching'
import { WatchBadge } from './WatchFirst'
import { useSquadEvaluations } from './useEvaluation'
import { nextDateLine, rhythmOf, rhythmText } from '@/lib/evaluation'

/* TRAK-356 (Season plan 8/18, spec TRAK-348): View plan. Once shared, the set-up never comes back: the plan reads part
   by part, each with its Edit, one screen each (Tarek, 1 Nov). Edits save straight away and wait under "Not shared
   yet" until the coach shares the changes (Tarek, 6 Nov: a list of changes). Positions are edited in Squad (PLAN.md);
   a player's objectives in their sheet. A season objective or player objective removed after sharing stays in its
   history, with its dates. Player objectives fold, so the rest of the plan is a short scroll away (Tarek, 2 Nov).
   Watching (TRAK-355) lists who is watched first, with the squad's reminder and its Edit; Give objectives opens their
   sheet, or their position first. Home's Set up for a watched player lands here with their sheet open (?player=).
   TRAK-364: the Season card also says how often each player is evaluated, and when next, with its own Edit. */

type Player = Tables<'squad_players'>
const SHARE_FAILED = "Couldn't share the changes. Check your connection and try again."
const WATCH_FAILED = "Couldn't start watching. Check your connection and try again."
const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const card = 'grid gap-3 rounded-2xl border border-line bg-surface p-5'

export function PlanView({ coachId, squad, plan, seasonObjectives }: {
  coachId: string
  squad: string
  plan: SeasonPlan
  seasonObjectives: SeasonObjective[]
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const roster = useSquadRoster()
  const objectives = usePlayerObjectives(coachId)
  const watching = useWatchList(coachId, roster)
  const watch = useWatchPlayers(coachId)
  const removed = useQuery({ queryKey: removedSeasonObjectivesKey(coachId, plan.id), queryFn: () => loadRemovedSeasonObjectives(plan.id) })
  const evaluation = useSquadEvaluations(coachId, [squad])
  const [openId, setOpenId] = useState<string | null>(null)
  const [playersOpen, setPlayersOpen] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const share = useMutation({
    mutationFn: () => shareSeasonPlan(plan.id, false),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) })
      toast.success('Changes shared')
    },
    onError: (error: { code?: string; message?: string }) => setProblem(error.code === 'P0001' && error.message ? error.message : SHARE_FAILED),
  })

  // A link to one player (Home's Set up, TRAK-355) opens their sheet once the squad is in.
  const [params, setParams] = useSearchParams()
  const asked = useRef(params.get('player'))
  useEffect(() => {
    if (!asked.current || roster.isPending) return
    if (roster.players.some(p => p.id === asked.current)) {
      setOpenId(asked.current)
      setPlayersOpen(true)
    }
    asked.current = null
    setParams(current => { const next = new URLSearchParams(current); next.delete('player'); return next }, { replace: true })
  }, [roster.isPending, roster.players, setParams])

  if (roster.error || objectives.error || removed.error) {
    return <LoadError what="your season plan" onRetry={() => { roster.retry(); void objectives.refetch(); void removed.refetch() }} />
  }
  if (roster.isPending || objectives.isPending || removed.isPending) return <LoadingSkeleton label="Loading your season plan…" lines={4} className="pt-2" />

  const names = new Map(roster.players.map(p => [p.id, p.player_name]))
  const changes = notSharedYet(plan, id => names.get(id))
  const board = positionsBoard(roster.players, roster.consentPending)
  const placed = board.lines.flatMap(line => line.players)
  const withSome = placed.filter(p => objectives.of(p.id).length > 0).length
  const opened = roster.players.find(p => p.id === openId)
  const shared = lastShared(plan)
  const plain = seasonObjectives.map(o => ({ id: o.id, title: o.title }))
  const watchOf = new Map(watching.list.map(w => [w.playerId, w]))
  const watched = roster.players.filter(p => watchOf.has(p.id))
  const rule = watching.list[0]?.rule ?? (isWatchRule(plan.watch_rule) ? plan.watch_rule : 't2')
  // The sheets' Watch first, as in the set-up steps: watching (again) closes the sheet.
  const watchAction = (id: string) => ({ label: watchOf.has(id) ? 'Keep watching' as const : 'Watch first' as const, pending: watch.isPending,
    onWatch: () => watch.mutate([id], { onSuccess: () => setOpenId(null), onError: () => setProblem(WATCH_FAILED) }) })

  const edit = (label: string, onClick: () => void) => <Button variant="ghost" size="sm" aria-label={label} onClick={onClick}>Edit</Button>
  const row = (player: Player) => {
    const held = objectives.of(player.id)
    const gone = objectives.removedOf(player.id)
    return <li key={player.id}>
      <button type="button" onClick={() => setOpenId(player.id)} aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-lg py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <PlayerFace name={player.player_name} size="sm" />
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{player.player_name}</span>
            <WatchBadge watch={watchOf.get(player.id)} />
          </span>
          <span className="text-xs text-ink-3">{held.length ? held.map(o => o.title).join(' · ') : 'No objective yet'}</span>
          {gone.length > 0 && <span className="text-xs text-ink-3">Removed: {gone.map(o => `${o.title} (${shortDate(o.removed)})`).join(' · ')}</span>}
        </span>
        <span className="text-sm font-medium text-brand">Edit</span>
      </button>
    </li>
  }

  return (
    <div className="arc grid gap-5">
      {opened && (isPosition(opened.position)
        ? <PlayerObjectivesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
          seasonObjectives={plain} open onOpenChange={open => { if (!open) setOpenId(null) }} saveNeedsChange onSaved={() => setOpenId(null)}
          watch={objectives.of(opened.id).length ? undefined : watchAction(opened.id)} />
        : <PositionAndRolesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
          open onOpenChange={open => { if (!open) setOpenId(null) }} saveNeedsChange onSaved={() => setOpenId(null)} watch={watchAction(opened.id)} />)}

      {changes.length
        ? <Alert tone="warning" title={`Not shared yet: ${changesText(changes)}.`}>They wait here until you share the changes.</Alert>
        : <Alert tone="success" title={`Shared ${shared ? shortDate(shared) : ''}.`}>
          Edits wait here until you share them.
        </Alert>}

      <div className="grid items-start gap-5 laptop:grid-cols-2">
        <section aria-labelledby="plan-season" className={card}>
          <h2 id="plan-season" className="text-lg font-medium text-ink">Season</h2>
          <div className="flex items-center justify-between gap-3">
            <dl className="m-0 grid gap-0.5">
              <dt className="text-sm text-ink-3">Dates</dt>
              <dd className="m-0 text-sm text-ink">{plan.starts_on && plan.ends_on ? `${day(plan.starts_on)} – ${day(plan.ends_on)}` : 'No dates yet'}</dd>
            </dl>
            {edit('Edit the season’s dates', () => navigate('/coach/season-plan/edit/dates'))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <dl className="m-0 grid gap-0.5">
              <dt className="text-sm text-ink-3">Evaluation</dt>
              <dd className="m-0 text-sm text-ink">{(() => {
                const { every, day } = rhythmOf(plan)
                const mine = evaluation.list.find(e => e.squad === squad)
                const when = mine ? ` · ${nextDateLine(mine.due, evaluation.today)}` : ''
                return `${rhythmText(every, day).replace(/^e/, 'E')}${when}`
              })()}</dd>
            </dl>
            {edit('Edit how often you evaluate', () => navigate('/coach/season-plan/edit/evaluation'))}
          </div>
        </section>

        <section aria-labelledby="plan-objectives" className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="plan-objectives" className="text-lg font-medium text-ink">Season objectives</h2>
            {edit('Edit season objectives', () => navigate('/coach/season-plan/edit/objectives'))}
          </div>
          {seasonObjectives.length === 0 ? <p className="text-sm text-ink-3">None. You can add up to three.</p>
            : <ol className="m-0 grid list-none gap-3 p-0">{seasonObjectives.map(o => (
              <li key={o.id} className="grid gap-0.5">
                <span className="text-[17px] font-medium text-ink">{o.title}</span>
                {o.looks_like && <span className="text-sm text-ink-3">{o.looks_like}</span>}
              </li>))}
            </ol>}
          {(removed.data ?? []).length > 0 && <div className="grid gap-1 border-t border-line pt-3">
            <h3 className="text-sm font-medium text-ink-2">Removed</h3>
            <ul className="m-0 grid list-none gap-1 p-0">{removed.data!.map(o => (
              <li key={o.id} className="text-sm text-ink-3"><span className="text-ink-2">{o.title}</span> · added {shortDate(o.created_at)}, removed {shortDate(o.retired_at)}</li>))}
            </ul>
          </div>}
        </section>

        <section aria-labelledby="plan-positions" className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="plan-positions" className="text-lg font-medium text-ink">Positions</h2>
            {edit('Edit positions in Squad', () => navigate('/coach/squad'))}
          </div>
          <p className="text-sm text-ink-2">{board.placed} of {players(board.total)} placed.</p>
          {/* Home's "Place them" lands here once the plan is shared: each name opens their position. */}
          {board.unplaced.length > 0 && <div className="grid gap-1">
            <h3 className="text-sm font-medium text-ink-2">No position yet <span className="font-normal text-ink-3">· {board.unplaced.length}</span></h3>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{board.unplaced.map(p => (
              <li key={p.id}><Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setOpenId(p.id)}>{p.player_name}</Button></li>))}
            </ul>
          </div>}
        </section>

        <section aria-labelledby="plan-players" className={card}>
          <button type="button" aria-expanded={playersOpen} onClick={() => setPlayersOpen(!playersOpen)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <span className="grid gap-0.5">
              <span id="plan-players" className="text-lg font-medium text-ink">Player objectives</span>
              <span className="text-sm text-ink-3">{withSome} of {players(placed.length)} {withSome === 1 ? 'has' : 'have'} one or two</span>
            </span>
            {playersOpen ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
          </button>
          {playersOpen && board.lines.filter(line => line.players.length > 0).map(line => (
            <div key={line.value} className="grid gap-1">
              <h3 className="text-sm font-medium text-ink-2">{line.line} <span className="font-normal text-ink-3">· {line.players.length}</span></h3>
              <ul className="m-0 list-none divide-y divide-line p-0">{line.players.map(row)}</ul>
            </div>
          ))}
        </section>
      </div>

      {watched.length > 0 && <section aria-labelledby="plan-watching" className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="plan-watching" className="text-lg font-medium text-ink">Watching <span className="font-normal text-ink-3">· {watched.length}</span></h2>
          {edit('Edit the watching reminder', () => navigate('/coach/season-plan/edit/reminder'))}
        </div>
        <p className="text-sm text-ink-3">Reminder {ruleText(rule)}, 4 weeks at the latest.</p>
        <ul className="m-0 list-none divide-y divide-line p-0">{watched.map(player => {
          const w = watchOf.get(player.id)!
          return <li key={player.id} className="flex items-center gap-3 py-2">
            <PlayerFace name={player.player_name} size="sm" />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium text-ink">{player.player_name}</span>
              <span className="text-xs text-ink-3">{w.ready ? `${w.why}: time to set them up` : `Since ${shortDate(w.since)} · ${w.progress}`}</span>
            </span>
            <Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setOpenId(player.id)}>
              {isPosition(player.position) ? 'Give objectives' : 'Give a position'}
            </Button>
          </li>
        })}</ul>
      </section>}

      {problem && <Alert tone="danger" title={problem} />}
      {changes.length > 0 && <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-ink-3">{changes.length === 1 ? '1 change' : `${changes.length} changes`} not shared</span>
        <Button loading={share.isPending} onClick={() => { setProblem(null); share.mutate() }}>Share the changes</Button>
      </div>}
    </div>
  )
}
