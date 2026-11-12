import { i18n, useTranslation } from '@/lib/i18n'
import { optionWords } from '@/lib/games/match-words'
import { lineWord } from '@/lib/position-words'
import { lineName } from '@/lib/games/formations'
import {
  CONTEXT, EXPECTATIONS, PLAYER_LIMITS, place, playerPlan, setContext, setRole, takeOff,
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
   not selected sits here (Imad, 28 Oct). TRAK-287: locked at kick-off, the sheet only shows. TRAK-371 (Imad, 5 Nov):
   "Move to bench" is a real button, and the job box shows an example. TRAK-372 (Imad, 5 Nov): locked, the job and the
   note are written, not boxes; nothing written says so. */

export type Target = { kind: 'slot'; slot: number } | { kind: 'player'; id: string }

/* TRAK-407: read when shown, so the words follow the language. */
const roleOptions = () => [{ value: 'bench', label: i18n.t('coachSquad:fmBench') }, { value: 'not_selected', label: i18n.t('coachMatches:notSelected') }, { value: 'not_attending', label: i18n.t('coachMatches:notAttending') }]
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
  const { t } = useTranslation()
  if (target.kind === 'slot' && locked) return <p className="text-sm text-ink-2">{t('coachMatches:nobodyPlaced')}</p>
  if (target.kind === 'slot') {
    const options = [...candidates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map(player => {
      const plan = playerPlan(players, player.id)
      const tags = [player.absent ? t('coachMatches:cantMakeItWord') : player.confirmed ? '' : t('coachMatches:tagNotConfirmed'), plan.role === 'starter' ? t('coachMatches:tagOnPitch') : '']
      return { value: player.id, label: [player.name, ...tags.filter(Boolean)].join(' · '), disabled: player.absent }
    })
    return <div className="grid gap-3">
      <Combobox label={t('coachMatches:whoPlaysHere')} placeholder={t('coachMatches:searchSquad')} options={options} value=""
        emptyMessage={t('coachMatches:nobodyByName')}
        onValueChange={id => { if (!id) return; onPlayers(place(players, id, target.slot)); onTarget({ kind: 'player', id }) }} />
      <p className="text-sm text-ink-3">{t('coachMatches:confirmedFirst')}</p>
    </div>
  }

  const player = candidates.find(candidate => candidate.id === target.id)
  if (!player) return <p className="text-sm text-ink-2">{t('coachMatches:noLongerInSquad')}</p>
  const plan = playerPlan(players, player.id)
  const first = firstName(player.name)
  const set = (next: Partial<PlayerPlan>) => onPlayers({ ...players, [player.id]: { ...plan, ...next } })

  return <div className="grid gap-4">
    <p className="text-sm text-ink-2">{plan.role === 'starter' && plan.slot != null ? t('coachMatches:slotTitle', { line: lineWord(lineName(shape, plan.slot)), slot: plan.slot }) : plan.role === 'bench' ? t('coachSquad:fmBench') : plan.role === 'not_attending' ? t('coachMatches:notAttending') : t('coachMatches:notSelected')}</p>
    {player.absent && <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">{t('coachMatches:familySaysCant', { name: first })}</p>}
    {locked ? null : plan.role === 'starter'
      ? <span><Button variant="secondary" size="sm" onClick={() => onPlayers(takeOff(players, player.id))}>{t('coachMatches:moveToBench')}</Button></span>
      : plan.role === 'not_attending' && player.absent
        ? <p className="text-sm text-ink-3">{t('coachMatches:staysNotAttending', { name: first })}</p>
        : <RadioGroup label={t('coachMatches:roleGroupLabel')} name={`role-${player.id}`} options={roleOptions()} value={plan.role}
            onValueChange={role => onPlayers(setRole(players, player.id, role as 'bench' | 'not_selected' | 'not_attending'))} />}
    {plan.role === 'not_attending' ? <p className="text-sm text-ink-3">{t('coachMatches:familySeesNotInSquad', { name: first })}</p>
    : plan.role === 'not_selected' ? <>
      {locked ? <LockedValue label={t('coachMatches:noteTo', { name: first })} value={plan.note.trim() || t('coachMatches:noNote')} />
        : <Textarea label={t('coachMatches:noteTo', { name: first })} rows={3} value={plan.note} maxLength={PLAYER_LIMITS.note}
            onChange={event => set({ note: event.target.value })} />}
      <p className="text-sm text-ink-3">{t('coachMatches:familySeesNotInSquad', { name: first })}</p>
    </> : <>
      {locked ? <LockedValue label={t('coachMatches:jobLabel', { name: first })} value={plan.job.trim() || t('coachMatches:noJob')} />
        : <Textarea label={t('coachMatches:jobLabel', { name: first })} rows={3} value={plan.job} maxLength={PLAYER_LIMITS.job}
            placeholder={t('coachMatches:jobExample')}
            onChange={event => set({ job: event.target.value })} />}
      {locked ? <>
        <LockedValue label={t('coachMatches:contextOnlyYou')} value={optionWords('context', CONTEXT).filter(tag => plan.context.includes(tag.value)).map(tag => tag.label).join(', ') || t('coachSchedule:none')} />
        <LockedValue label={t('coachMatches:expectationOnlyYou')} value={optionWords('expectation', EXPECTATIONS).find(level => level.value === plan.expectation)?.label ?? t('coachMatches:expectation_usual')} />
      </> : <>
        <div className="grid gap-2">
          <p className="text-sm font-medium text-ink">{t('coachMatches:contextOnlyYou')}</p>
          {/* TRAK-358: Out of position ticked or unticked here is the coach's, so moving the player leaves it be. */}
          <ChipGroup label={t('coachMatches:keyContext')} options={optionWords('context', CONTEXT)} value={plan.context}
            onValueChange={context => onPlayers({ ...players, [player.id]: setContext(plan, context) })} />
        </div>
        <RadioGroup label={t('coachMatches:expectationOnlyYou')} name={`expectation-${player.id}`} options={optionWords('expectation', EXPECTATIONS)} value={plan.expectation}
          onValueChange={value => set({ expectation: value as Expectation })} />
      </>}
      <p className="text-sm text-ink-3">{t('coachMatches:familySeesStarts', { name: first })}</p>
    </>}
  </div>
}
