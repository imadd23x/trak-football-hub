import { Lock, Plus } from 'lucide-react'
import { FORMATIONS } from '@/lib/games/formations'
import {
  LIMITS, MAX_GOALS, MAX_KEY_PLAYERS, STRENGTHS, emptyGoal, emptyKeyPlayer, numberProblem,
  type Goal, type KeyPlayer, type PlanForm, type Strength,
} from '@/lib/games/plan'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { Select } from '@/components/arc/select/select'
import { Textarea } from '@/components/arc/textarea/textarea'
import { LockedValue } from './LockedValue'

/* TRAK-284 (Games 2/8): plan step 1, opponent and goals (TRAK-282). The shirt number is a plain input with the
   number pad, not Arc's number-field: it's a code, and it can be blank (Imad, 28 Oct). TRAK-285: GamePlan saves
   both steps, and "their formation" follows the format. TRAK-287: locked at kick-off, the fields read only, the
   pickers become words, and nothing can be added or removed. */

const UNSURE = 'unsure'
const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'

/** `tried`: Save draft was pressed, so a bad shirt number shows its message. */
export function OpponentAndGoals({ eventId, opponent, form, onFormChange, tried, locked = false }: {
  eventId: string; opponent: string | null; form: PlanForm; onFormChange: (form: PlanForm) => void; tried: boolean; locked?: boolean
}) {
  const change = (next: Partial<PlanForm>) => onFormChange({ ...form, ...next })
  const setGoal = (index: number, next: Partial<Goal>) => change({ goals: form.goals.map((goal, i) => i === index ? { ...goal, ...next } : goal) })
  const setPlayer = (index: number, next: Partial<KeyPlayer>) =>
    change({ keyPlayers: form.keyPlayers.map((player, i) => i === index ? { ...player, ...next } : player) })
  // A shape saved before the format changed stays pickable until the coach picks another.
  const shapes = FORMATIONS[form.format]
  const formations = [{ value: UNSURE, label: 'Not sure yet' }, ...[...shapes, ...(form.theirFormation && !shapes.includes(form.theirFormation)
    ? [form.theirFormation] : [])].map(shape => ({ value: shape, label: shape }))]

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 laptop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] laptop:items-start">
        <div className="grid min-w-0 gap-4">
        <section aria-labelledby="plan-goals" className={card}>
          <div>
            <h2 id="plan-goals" className="text-lg font-medium text-ink">Your goals</h2>
            <p className="mt-1 text-sm text-ink-3">Up to three. Players see them once you share the plan.</p>
          </div>
          <ol className="grid gap-5">
            {form.goals.map((goal, index) => <li key={index}>
              <fieldset className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <legend className="sr-only">Goal {index + 1}</legend>
                <span aria-hidden="true" className="row-span-3 grid size-7 place-items-center rounded-full bg-ink text-sm font-medium text-surface">{index + 1}</span>
                <Input label="Goal" value={goal.title} maxLength={LIMITS.title} readOnly={locked} onChange={event => setGoal(index, { title: event.target.value })} />
                <Textarea label="What it looks like" rows={2} value={goal.looksLike} maxLength={LIMITS.looksLike} readOnly={locked}
                  onChange={event => setGoal(index, { looksLike: event.target.value })} />
                {form.goals.length > 1 && !locked && <span><Button variant="ghost" size="sm" aria-label={`Remove goal ${index + 1}`}
                  onClick={() => change({ goals: form.goals.filter((_, i) => i !== index) })}>Remove</Button></span>}
              </fieldset>
            </li>)}
          </ol>
          {form.goals.length < MAX_GOALS && !locked && <span><Button variant="ghost" size="sm" onClick={() => change({ goals: [...form.goals, emptyGoal()] })}>
            <Plus size={16} aria-hidden="true" />Add a goal</Button></span>}
        </section>

        <section aria-labelledby="plan-scouting" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="plan-scouting" className="text-lg font-medium text-ink">Scouting</h2>
            <Badge size="sm" icon={<Lock size={12} />}>Only you</Badge>
          </div>
          <Textarea label="What you know about them" rows={4} value={form.scouting} maxLength={LIMITS.scouting} readOnly={locked}
            onChange={event => change({ scouting: event.target.value })} />
        </section>
        </div>

        <div className="grid min-w-0 gap-4">
          <section aria-labelledby="plan-strength" className={card}>
            <div>
              <h2 id="plan-strength" className="text-lg font-medium text-ink">How strong are {opponent ?? 'they'}?</h2>
              <p className="mt-1 text-sm text-ink-3">Only you see this. It sits beside every player in the evaluation.</p>
            </div>
            {locked ? <LockedValue label="Strength" value={STRENGTHS.find(option => option.value === form.strength)?.label ?? 'Not set'} />
              : <RadioGroup label="Strength" name={`strength-${eventId}`} options={STRENGTHS} value={form.strength ?? ''}
                  onValueChange={value => change({ strength: value as Strength })} />}
          </section>

          <section aria-labelledby="plan-their-players" className={card}>
            <div>
              <h2 id="plan-their-players" className="text-lg font-medium text-ink">Their likely line-up</h2>
              <p className="mt-1 text-sm text-ink-3">Only you see this. Shirt numbers and positions, never names: they’re another club’s players.</p>
            </div>
            {locked ? <LockedValue label="Their formation" value={form.theirFormation ?? 'Not sure'} />
              : <Select label="Their formation" options={formations} value={form.theirFormation ?? UNSURE}
                  onValueChange={value => change({ theirFormation: value === UNSURE ? null : value })} />}
            {form.keyPlayers.length === 0 ? <p className="text-sm text-ink-2">No key players yet.</p> : <ul className="grid gap-5">
              {form.keyPlayers.map((player, index) => <li key={index}>
                <fieldset className="grid gap-3">
                  <legend className="sr-only">Key player {index + 1}</legend>
                  <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
                    <Input label="Number" inputMode="numeric" autoComplete="off" maxLength={2} value={player.number} readOnly={locked}
                      error={tried ? numberProblem(player.number) ?? undefined : undefined}
                      onChange={event => setPlayer(index, { number: event.target.value.replace(/\D/g, '').slice(0, 2) })} />
                    <Input label="Position" value={player.position} maxLength={LIMITS.position} readOnly={locked} onChange={event => setPlayer(index, { position: event.target.value })} />
                  </div>
                  <Textarea label="Note" rows={2} value={player.note} maxLength={LIMITS.note} readOnly={locked}
                    onChange={event => setPlayer(index, { note: event.target.value })} />
                  {!locked && <span><Button variant="ghost" size="sm" aria-label={`Remove key player ${index + 1}`}
                    onClick={() => change({ keyPlayers: form.keyPlayers.filter((_, i) => i !== index) })}>Remove</Button></span>}
                </fieldset>
              </li>)}
            </ul>}
            {form.keyPlayers.length < MAX_KEY_PLAYERS && !locked && <span><Button variant="ghost" size="sm"
              onClick={() => change({ keyPlayers: [...form.keyPlayers, emptyKeyPlayer()] })}><Plus size={16} aria-hidden="true" />Add a key player</Button></span>}
          </section>
        </div>
      </div>
    </div>
  )
}
