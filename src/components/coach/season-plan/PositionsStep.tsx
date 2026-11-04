import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { Progress } from '@/components/arc/progress/progress'
import { RadioCards } from '@/components/arc/radio-cards/radio-cards'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { POSITIONS, positionsBoard, type Position } from '@/lib/positions'
import { loadSeasonPlan, seasonPlanKey, type PositionsKnown, type SeasonPlan } from '@/lib/season-plan'
import type { Tables } from '@/integrations/supabase/types'

/* TRAK-352 (Season plan 4/18, spec TRAK-348): step 2, Positions. One question first, then every consented player
   with four big buttons. A tap saves at once through set_player_position(), so nothing waits to be saved. Players
   still waiting for consent aren't listed, only counted. Placed players group by line. The coach can skip it, and
   Not yet saves with nobody placed (TRAK-355 brings the reminder). Can also play and roles come with TRAK-353. */

type Player = Tables<'squad_players'>

const ANSWERS: { value: PositionsKnown; label: string; description: string }[] = [
  { value: 'yes', label: 'Yes', description: 'Place everyone now.' },
  { value: 'some', label: 'Some of them', description: 'Place who you know. The rest wait until you do.' },
  { value: 'not_yet', label: 'Not yet', description: 'Nobody is placed. Come back to it any time.' },
]
const PLACE_FAILED = (name: string) => `Couldn't save ${name}'s position. Check your connection and tap again.`
const ANSWER_FAILED = "Couldn't save your answer. Check your connection and try again."
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function PositionsStep({ coachId, squad, plan, onBack, onDone }: {
  coachId: string
  squad: string
  plan: SeasonPlan | null
  onBack: () => void
  onDone: () => void
}) {
  const client = useQueryClient()
  const roster = useSquadRoster()
  const answer = (plan?.positions_known ?? null) as PositionsKnown | null
  const [asking, setAsking] = useState(false)
  const [choice, setChoice] = useState<PositionsKnown | null>(answer)
  const [problem, setProblem] = useState<string | null>(null)

  const saveAnswer = useMutation({
    mutationFn: async (next: PositionsKnown) => {
      if (plan) {
        const { error } = await supabase.from('season_plans').update({ positions_known: next }).eq('id', plan.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('season_plans').insert({ squad, positions_known: next })
        if (error) throw error
      }
      return loadSeasonPlan(coachId, squad)
    },
    onSuccess: saved => { client.setQueryData(seasonPlanKey(coachId, squad), saved); setAsking(false); setProblem(null) },
    onError: () => setProblem(ANSWER_FAILED),
  })

  // The roster everyone shares (Home, Squad): a tap shows at once and puts it back if the save fails.
  const playersKey = ['coach', coachId, 'squad-roster', 'players']
  const setPosition = (id: string, position: string | null) =>
    client.setQueryData<Player[]>(playersKey, rows => rows?.map(row => (row.id === id ? { ...row, position } : row)))
  const place = useMutation({
    mutationFn: async ({ player, position }: { player: Player; position: Position }) => {
      const { error } = await supabase.rpc('set_player_position', { p_squad_player_id: player.id, p_position: position })
      if (error) throw error
    },
    onMutate: ({ player, position }) => { setProblem(null); setPosition(player.id, position); return { before: player.position } },
    onError: (_error, { player }, context) => { setPosition(player.id, context?.before ?? null); setProblem(PLACE_FAILED(player.player_name)) },
  })

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button variant="ghost" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Season and objectives</Button>
      <Button variant={answer ? 'primary' : 'secondary'} onClick={onDone}>{answer ? 'Done' : 'Skip for now'}</Button>
    </div>
  )

  if (roster.error) return <LoadError what="your squad" onRetry={roster.retry} />
  if (roster.isPending) return <LoadingSkeleton label="Loading your squad" lines={4} className="pt-2" />
  const board = positionsBoard(roster.players, roster.consentPending)
  const waitingLine = board.waiting > 0 && (
    <p className="text-sm text-ink-3">{board.waiting === 1 ? '1 player is' : `${board.waiting} players are`} waiting for consent. They join this list once it's given.</p>
  )

  if (!answer || asking) {
    return (
      <div className="arc grid gap-5">
        <section aria-labelledby="positions-question" className="grid gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="grid gap-1">
            <h2 id="positions-question" className="text-lg font-medium text-ink">Do you know where they play yet?</h2>
            <p className="text-sm text-ink-2">{plural(board.total, 'player')} in {squad}. You can change your answer any time.</p>
          </div>
          <RadioCards aria-labelledby="positions-question" options={ANSWERS} value={choice} onValueChange={value => setChoice(value as PositionsKnown)}
            layout="grid" minColumnWidth={200} />
          {waitingLine}
          <span className="flex flex-wrap gap-3">
            <Button disabled={!choice} loading={saveAnswer.isPending} onClick={() => choice && saveAnswer.mutate(choice)}>Continue</Button>
            {asking && <Button variant="ghost" onClick={() => { setAsking(false); setChoice(answer) }}>Cancel</Button>}
          </span>
        </section>
        {problem && <Alert tone="danger" title={problem} />}
        {footer}
      </div>
    )
  }

  const change = <Button variant="ghost" size="sm" onClick={() => { setChoice(answer); setAsking(true) }}>Change your answer</Button>
  if (answer === 'not_yet') {
    return (
      <div className="arc grid gap-5">
        <section aria-labelledby="positions-later" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
          <h2 id="positions-later" className="text-lg font-medium text-ink">You'll place them later</h2>
          <p className="text-sm text-ink-2">Nobody is placed. A player needs a position before they get objectives.</p>
          <span className="flex flex-wrap gap-3">
            <Button variant="secondary" loading={saveAnswer.isPending} onClick={() => saveAnswer.mutate('some')}>Place some now</Button>
            {change}
          </span>
        </section>
        {problem && <Alert tone="danger" title={problem} />}
        {footer}
      </div>
    )
  }

  const row = (player: Player) => (
    <li key={player.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <PlayerFace name={player.player_name} size="sm" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium text-ink">{player.player_name}</span>
        {player.shirt_number != null && <span className="text-xs text-ink-3">#{player.shirt_number}</span>}
      </span>
      <span role="group" aria-label={`${player.player_name}'s position`} className="flex gap-2">
        {POSITIONS.map(position => (
          <Button key={position.value} size="sm" variant={player.position === position.value ? 'primary' : 'secondary'}
            aria-pressed={player.position === position.value} aria-label={position.value} title={position.value}
            className="min-w-[52px]" onClick={() => place.mutate({ player, position: position.value })}>
            {position.short}
          </Button>
        ))}
      </span>
    </li>
  )

  return (
    <div className="arc grid gap-5">
      <section aria-labelledby="positions-progress" className="grid gap-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="positions-progress" className="text-lg font-medium text-ink">{board.placed} of {board.total} placed</h2>
          {change}
        </div>
        <Progress value={board.placed} max={Math.max(board.total, 1)} label={`${board.placed} of ${board.total} players placed`} />
        {waitingLine}
      </section>
      {problem && <Alert tone="danger" title={problem} />}

      <section aria-labelledby="positions-unplaced" className="grid gap-2 rounded-2xl border border-line bg-surface p-5">
        <h3 id="positions-unplaced" className="text-base font-medium text-ink">No position yet <span className="font-normal text-ink-3">· {board.unplaced.length}</span></h3>
        {board.unplaced.length === 0
          ? <p className="text-sm text-ink-2">Everyone is placed.</p>
          : <>
            <p className="text-sm text-ink-3">A player needs a position before they get objectives.</p>
            <ul className="divide-y divide-line">{board.unplaced.map(row)}</ul>
          </>}
      </section>

      <div className="grid items-start gap-5 laptop:grid-cols-2">
        {board.lines.map(line => (
          <section key={line.value} aria-labelledby={`positions-${line.short}`} className="grid gap-2 rounded-2xl border border-line bg-surface p-5">
            <h3 id={`positions-${line.short}`} className="text-base font-medium text-ink">{line.line} <span className="font-normal text-ink-3">· {line.players.length}</span></h3>
            {line.players.length === 0 ? <p className="text-sm text-ink-3">None yet.</p> : <ul className="divide-y divide-line">{line.players.map(row)}</ul>}
          </section>
        ))}
      </div>
      {footer}
    </div>
  )
}
