import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { Progress } from '@/components/arc/progress/progress'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { positionsBoard } from '@/lib/positions'
import type { Tables } from '@/integrations/supabase/types'
import type { SeasonPlan } from '@/lib/season-plan'
import { ruleText } from '@/lib/watch-first'
import { WatchBadge } from './WatchFirst'
import { WatchRulePicker } from './WatchRulePicker'
import { useWatchList, useWatchPlayers } from './useWatching'
import { PlayerObjectivesSheet } from './PlayerObjectivesSheet'
import { usePlayerObjectives } from './usePlayerObjectives'

/* TRAK-354 (Season plan 6/18, spec TRAK-348): step 3, Player objectives. Every placed, consented player, by line;
   a name opens their objectives, and Save · next goes on to the next player with none. The step saves with none.
   No position, no objectives: those players are named apart, with the way back to Positions. Players waiting for
   consent are counted, never listed, as in Positions. TRAK-355: players whose reminder is due come first, Ready to
   set up; players still being watched wait apart, with the squad's reminder, and Save · next passes over them; Watch
   first sits on each player's sheet; Home's card opens a due player here (?player=). */

type Player = Tables<'squad_players'>
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ObjectivesStep({ coachId, squad, plan, seasonObjectives, onBack, onPositions, onNext }: {
  coachId: string
  squad: string
  plan: SeasonPlan | null
  seasonObjectives: { id: string; title: string }[]
  onBack: () => void
  onPositions: () => void
  /** TRAK-356: on to Share. */
  onNext: () => void
}) {
  const roster = useSquadRoster()
  const objectives = usePlayerObjectives(coachId)
  const [openId, setOpenId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const watching = useWatchList(coachId, roster)
  const watchOf = new Map(watching.list.map(w => [w.playerId, w]))
  const watch = useWatchPlayers(coachId)
  // Home's card for a due player opens their sheet here, once.
  const [params, setParams] = useSearchParams()
  const asked = useRef(params.get('player'))
  useEffect(() => {
    if (!asked.current || roster.isPending) return
    if (roster.players.some(p => p.id === asked.current)) setOpenId(asked.current)
    asked.current = null
    setParams(current => { const next = new URLSearchParams(current); next.delete('player'); return next }, { replace: true })
  }, [roster.isPending, roster.players, setParams])

  if (roster.error || objectives.error) return <LoadError what="your squad's objectives" onRetry={() => { roster.retry(); void objectives.refetch() }} />
  if (roster.isPending || objectives.isPending) return <LoadingSkeleton label="Loading your squad's objectives" lines={4} className="pt-2" />
  const board = positionsBoard(roster.players, roster.consentPending)
  const placed = board.lines.flatMap(line => line.players)
  const withSome = placed.filter(p => objectives.of(p.id).length > 0).length

  // Watched players: those due come first, ready to set up; the rest wait apart until their reminder.
  const ready = placed.filter(p => watchOf.get(p.id)?.ready)
  const parked = placed.filter(p => watchOf.has(p.id) && !watchOf.get(p.id)!.ready)
  const elsewhere = new Set([...ready, ...parked].map(p => p.id))

  // Save · next: the next placed player after this one with no objective yet, passing over those still watched.
  const order = [...ready, ...placed.filter(p => !elsewhere.has(p.id)), ...parked]
  const opened = order.find(p => p.id === openId)
  const after = opened ? [...order.slice(order.indexOf(opened) + 1), ...order.slice(0, order.indexOf(opened))] : []
  const next = after.find(p => objectives.of(p.id).length === 0 && !parked.includes(p))
  const openedWatch = opened ? watchOf.get(opened.id) : undefined

  const row = (player: Player) => {
    const held = objectives.of(player.id)
    return <li key={player.id}>
      <button type="button" onClick={() => setOpenId(player.id)} aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-lg py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <PlayerFace name={player.player_name} size="sm" />
        <span className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{player.player_name}</span>
            <WatchBadge watch={watchOf.get(player.id)} />
          </span>
          <span className={`text-xs ${held.length || watchOf.has(player.id) ? 'text-ink-3' : 'text-warning'}`}>{held.length ? held.map(o => o.title).join(' · ')
            : watchOf.get(player.id)?.ready ? `${watchOf.get(player.id)!.why}: time to set them up`
            : watchOf.has(player.id) ? `Watching: ${watchOf.get(player.id)!.progress}` : 'No objective yet'}</span>
        </span>
      </button>
    </li>
  }

  return (
    <div className="arc grid gap-5">
      {opened && <PlayerObjectivesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
        seasonObjectives={seasonObjectives} open onOpenChange={open => { if (!open) setOpenId(null) }} quiet
        saveLabel={next ? `Save · next: ${next.player_name}` : 'Save · back to the list'} onSaved={() => setOpenId(next?.id ?? null)}
        watch={{ label: openedWatch ? 'Keep watching' : 'Watch first', pending: watch.isPending, onWatch: () => watch.mutate([opened.id], {
          onSuccess: () => setOpenId(next?.id ?? null), onError: () => setProblem("Couldn't start watching. Check your connection and try again."),
        }) }} />}

      <section aria-labelledby="objectives-progress" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 id="objectives-progress" className="text-lg font-medium text-ink">Everyone's objectives</h2>
        <p id="objectives-count" className="text-sm text-ink-2">{withSome} of {plural(placed.length, 'player')} {withSome === 1 ? 'has' : 'have'} one or two</p>
        <Progress value={withSome} max={Math.max(placed.length, 1)} aria-labelledby="objectives-count" />
        {board.waiting > 0 && <p className="text-sm text-ink-3">{board.waiting === 1 ? '1 player is' : `${board.waiting} players are`} waiting for consent. They join this list once it's given.</p>}
        <p className="text-sm text-ink-3">Up to two each, from the six for their position or your own. You can skip anyone.</p>
      </section>

      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}

      {ready.length > 0 && <section aria-labelledby="objectives-ready" className="grid gap-1 rounded-2xl border border-line bg-surface p-5">
        <h3 id="objectives-ready" className="text-base font-medium text-ink">Ready to set up <span className="font-normal text-ink-3">· {ready.length}</span></h3>
        <ul className="m-0 list-none divide-y divide-line p-0">{ready.map(row)}</ul>
      </section>}

      {board.unplaced.length > 0 && <section aria-labelledby="objectives-unplaced" className="grid gap-2 rounded-2xl border border-line bg-surface p-5">
        <h3 id="objectives-unplaced" className="text-base font-medium text-ink">No position yet <span className="font-normal text-ink-3">· {board.unplaced.length}</span></h3>
        <p className="text-sm text-ink-3">Objectives come from the player's position. Give them one first.</p>
        <p className="text-sm text-ink-2">{board.unplaced.map(p => p.player_name).join(', ')}</p>
        <span className="justify-self-start"><Button variant="secondary" size="sm" onClick={onPositions}>Go to Positions</Button></span>
      </section>}

      <div className="grid items-start gap-5 laptop:grid-cols-2">
        {board.lines.map(line => ({ ...line, players: line.players.filter(p => !elsewhere.has(p.id)) })).filter(line => line.players.length > 0).map(line => (
          <section key={line.value} aria-labelledby={`objectives-${line.short}`} className="grid gap-1 rounded-2xl border border-line bg-surface p-5">
            <h3 id={`objectives-${line.short}`} className="text-base font-medium text-ink">{line.line} <span className="font-normal text-ink-3">· {line.players.length}</span></h3>
            <ul className="m-0 list-none divide-y divide-line p-0">{line.players.map(row)}</ul>
          </section>
        ))}
      </div>

      {(parked.length > 0 || ready.length > 0) && <section aria-labelledby="objectives-watching" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <div className="grid gap-1">
          <h3 id="objectives-watching" className="text-base font-medium text-ink">Watching <span className="font-normal text-ink-3">· {parked.length}</span></h3>
          <p className="text-sm text-ink-3">{parked.length ? `Trak reminds you ${ruleText(watchOf.get(parked[0].id)!.rule)}, or after 4 weeks at the latest. Nothing goes out while you watch.` : 'Nobody is waiting on a reminder.'}</p>
        </div>
        {parked.length > 0 && <ul className="m-0 list-none divide-y divide-line p-0">{parked.map(row)}</ul>}
        <WatchRulePicker coachId={coachId} squad={squad} plan={plan} />
      </section>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Positions</Button>
        <Button onClick={onNext}>Next: Share</Button>
      </div>
    </div>
  )
}
