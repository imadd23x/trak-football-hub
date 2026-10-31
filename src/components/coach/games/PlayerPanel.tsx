import { lineName } from '@/lib/games/formations'
import {
  CONTEXT, EXPECTATIONS, PLAYER_LIMITS, place, playerPlan, setRole, takeOff,
  type Expectation, type PlayerPlan, type PlayerPlans,
} from '@/lib/games/lineup'
import type { Candidate } from './useGames'
import { Button } from '@/components/arc/button/button'
import { ChipGroup } from '@/components/arc/chip-group/chip-group'
import { Combobox } from '@/components/arc/combobox/combobox'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { Textarea } from '@/components/arc/textarea/textarea'
import { LockedValue } from './LockedValue'

/* TRAK-285 (Games 3/8): what the line-up's sheet holds (a bottom sheet on a phone, a panel beside the pitch on a
   tablet or laptop). An empty slot: who plays there, Confirmed first, then Not confirmed, then "Can't make it",
   which can't be picked. A player: one box only they see (TRAK-319, Imad 30 Oct), their job, or, left out, the coach's
   note; then context and the expectation (only the coach, until the evaluation is published). Off the pitch, bench or
   not selected sits here (Imad, 28 Oct). TRAK-287: locked at kick-off, the sheet only shows. */

export type Target = { kind: 'slot'; slot: number } | { kind: 'player'; id: string }

const ROLES = [{ value: 'bench', label: 'Bench' }, { value: 'not_selected', label: 'Not selected' }]
const rank = (player: Candidate) => player.absent ? 2 : player.confirmed ? 0 : 1
const firstName = (name: string) => name.split(/\s+/)[0] ?? name

export function PlayerPanel({ target, players, onPlayers, candidates, shape, onTarget, locked = false }: {
  target: Target
  players: PlayerPlans
  onPlayers: (players: PlayerPlans) => void
  candidates: Candidate[]
  shape: string
  onTarget: (target: Target) => void
  locked?: boolean
}) {
  if (target.kind === 'slot' && locked) return <p className="text-sm text-ink-2">Nobody was placed here before kick-off.</p>
  if (target.kind === 'slot') {
    const options = [...candidates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map(player => {
      const plan = playerPlan(players, player.id)
      const tags = [player.absent ? "can't make it" : player.confirmed ? '' : 'not confirmed', plan.role === 'starter' ? 'on the pitch' : '']
      return { value: player.id, label: [player.name, ...tags.filter(Boolean)].join(' · '), disabled: player.absent }
    })
    return <div className="grid gap-3">
      <Combobox label="Who plays here?" placeholder="Search the squad" options={options} value=""
        emptyMessage="Nobody in this match's squad by that name"
        onValueChange={id => { if (!id) return; onPlayers(place(players, id, target.slot)); onTarget({ kind: 'player', id }) }} />
      <p className="text-sm text-ink-3">Confirmed players first. Anyone whose family said they can't make it can't be picked.</p>
    </div>
  }

  const player = candidates.find(candidate => candidate.id === target.id)
  if (!player) return <p className="text-sm text-ink-2">This player is no longer in the match's squad.</p>
  const plan = playerPlan(players, player.id)
  const first = firstName(player.name)
  const set = (next: Partial<PlayerPlan>) => onPlayers({ ...players, [player.id]: { ...plan, ...next } })

  return <div className="grid gap-4">
    <p className="text-sm text-ink-2">{plan.role === 'starter' && plan.slot != null ? `${lineName(shape, plan.slot)}, slot ${plan.slot}` : plan.role === 'bench' ? 'Bench' : 'Not selected'}</p>
    {player.absent && <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">{first}'s family says {first} can't make it.</p>}
    {locked ? null : plan.role === 'starter'
      ? <span><Button variant="ghost" size="sm" onClick={() => onPlayers(takeOff(players, player.id))}>Take off the pitch</Button></span>
      : <RadioGroup label="Bench or not selected" name={`role-${player.id}`} options={ROLES} value={plan.role}
          onValueChange={role => onPlayers(setRole(players, player.id, role as 'bench' | 'not_selected'))} />}
    {plan.role === 'not_selected' ? <>
      <Textarea label={`Note to ${first} · only ${first} sees it`} rows={3} value={plan.note} maxLength={PLAYER_LIMITS.note} readOnly={locked}
        onChange={event => set({ note: event.target.value })} />
      <p className="text-sm text-ink-3">{first}'s family sees “Not in the squad this week”.</p>
    </> : <>
      <Textarea label={`Job · only ${first} sees it`} rows={3} value={plan.job} maxLength={PLAYER_LIMITS.job} readOnly={locked}
        onChange={event => set({ job: event.target.value })} />
      {locked ? <>
        <LockedValue label="Context · only you" value={CONTEXT.filter(tag => plan.context.includes(tag.value)).map(tag => tag.label).join(', ') || 'None'} />
        <LockedValue label="Expectation · only you" value={EXPECTATIONS.find(level => level.value === plan.expectation)?.label ?? 'Usual'} />
      </> : <>
        <div className="grid gap-2">
          <p className="text-sm font-medium text-ink">Context · only you</p>
          <ChipGroup label="Context" options={CONTEXT} value={plan.context} onValueChange={context => set({ context })} />
        </div>
        <RadioGroup label="Expectation · only you" name={`expectation-${player.id}`} options={EXPECTATIONS} value={plan.expectation}
          onValueChange={value => set({ expectation: value as Expectation })} />
      </>}
      <p className="text-sm text-ink-3">{first}'s family sees whether {first} starts or is on the bench, never the job. The expectation shows only with the published evaluation.</p>
    </>}
  </div>
}
