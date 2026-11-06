import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { Progress } from '@/components/arc/progress/progress'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { positionsBoard } from '@/lib/positions'
import type { Tables } from '@/integrations/supabase/types'
import { PlayerObjectivesSheet } from './PlayerObjectivesSheet'
import { usePlayerObjectives } from './usePlayerObjectives'

/* TRAK-354 (Season plan 6/18, spec TRAK-348): step 3, Player objectives. Every placed, consented player, by line;
   a name opens their objectives, and Save · next goes on to the next player with none. The step saves with none.
   No position, no objectives: those players are named apart, with the way back to Positions. Players waiting for
   consent are counted, never listed, as in Positions. */

type Player = Tables<'squad_players'>
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function ObjectivesStep({ coachId, seasonObjectives, onBack, onPositions, onDone }: {
  coachId: string
  seasonObjectives: { id: string; title: string }[]
  onBack: () => void
  onPositions: () => void
  onDone: () => void
}) {
  const roster = useSquadRoster()
  const objectives = usePlayerObjectives(coachId)
  const [openId, setOpenId] = useState<string | null>(null)

  if (roster.error || objectives.error) return <LoadError what="your squad's objectives" onRetry={() => { roster.retry(); void objectives.refetch() }} />
  if (roster.isPending || objectives.isPending) return <LoadingSkeleton label="Loading your squad's objectives" lines={4} className="pt-2" />
  const board = positionsBoard(roster.players, roster.consentPending)
  const placed = board.lines.flatMap(line => line.players)
  const withSome = placed.filter(p => objectives.of(p.id).length > 0).length

  // Save · next: the next placed player after this one with no objective yet.
  const opened = placed.find(p => p.id === openId)
  const after = opened ? [...placed.slice(placed.indexOf(opened) + 1), ...placed.slice(0, placed.indexOf(opened))] : []
  const next = after.find(p => objectives.of(p.id).length === 0)

  const row = (player: Player) => {
    const held = objectives.of(player.id)
    return <li key={player.id}>
      <button type="button" onClick={() => setOpenId(player.id)} aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-lg py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <PlayerFace name={player.player_name} size="sm" />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-ink">{player.player_name}</span>
          <span className={`text-xs ${held.length ? 'text-ink-3' : 'text-warning'}`}>{held.length ? held.map(o => o.title).join(' · ') : 'No objective yet'}</span>
        </span>
      </button>
    </li>
  }

  return (
    <div className="arc grid gap-5">
      {opened && <PlayerObjectivesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
        seasonObjectives={seasonObjectives} open onOpenChange={open => { if (!open) setOpenId(null) }} quiet
        saveLabel={next ? `Save · next: ${next.player_name}` : 'Save · back to the list'} onSaved={() => setOpenId(next?.id ?? null)} />}

      <section aria-labelledby="objectives-progress" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <h2 id="objectives-progress" className="text-lg font-medium text-ink">Everyone's objectives</h2>
        <p id="objectives-count" className="text-sm text-ink-2">{withSome} of {plural(placed.length, 'player')} {withSome === 1 ? 'has' : 'have'} one or two</p>
        <Progress value={withSome} max={Math.max(placed.length, 1)} aria-labelledby="objectives-count" />
        {board.waiting > 0 && <p className="text-sm text-ink-3">{board.waiting === 1 ? '1 player is' : `${board.waiting} players are`} waiting for consent. They join this list once it's given.</p>}
        <p className="text-sm text-ink-3">Up to two each, from the six for their position or your own. You can skip anyone.</p>
      </section>

      {board.unplaced.length > 0 && <section aria-labelledby="objectives-unplaced" className="grid gap-2 rounded-2xl border border-line bg-surface p-5">
        <h3 id="objectives-unplaced" className="text-base font-medium text-ink">No position yet <span className="font-normal text-ink-3">· {board.unplaced.length}</span></h3>
        <p className="text-sm text-ink-3">Objectives come from the player's position. Give them one first.</p>
        <p className="text-sm text-ink-2">{board.unplaced.map(p => p.player_name).join(', ')}</p>
        <span className="justify-self-start"><Button variant="secondary" size="sm" onClick={onPositions}>Go to Positions</Button></span>
      </section>}

      <div className="grid items-start gap-5 laptop:grid-cols-2">
        {board.lines.filter(line => line.players.length > 0).map(line => (
          <section key={line.value} aria-labelledby={`objectives-${line.short}`} className="grid gap-1 rounded-2xl border border-line bg-surface p-5">
            <h3 id={`objectives-${line.short}`} className="text-base font-medium text-ink">{line.line} <span className="font-normal text-ink-3">· {line.players.length}</span></h3>
            <ul className="m-0 list-none divide-y divide-line p-0">{line.players.map(row)}</ul>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Positions</Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
