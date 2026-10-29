import { Lock } from 'lucide-react'
import { EVALUATION_LIMITS, hasPlayed, setPlayed, withScore, type EvaluationForm, type ScoredGoal } from '@/lib/games/evaluation'
import { Badge } from '@/components/arc/badge/badge'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { NumberField } from '@/components/arc/number-field/number-field'
import { Select } from '@/components/arc/select/select'
import { Textarea } from '@/components/arc/textarea/textarea'

/* TRAK-288 (Games 6/8): the evaluation's Result step (TRAK-282). The score; for each of our goals, who scored and who
   assisted, from the players who played; how they scored, only the coach's; and who played: the starters ticked until
   the coach unticks them, the bench ticked when they came on. No minutes (Imad, 29 Oct). */

const NONE = 'none'
const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
type Listed = { id: string; name: string }

export function ResultStep({ form, onFormChange, starters, bench }: {
  form: EvaluationForm; onFormChange: (form: EvaluationForm) => void; starters: Listed[]; bench: Listed[]
}) {
  const played = [...starters.filter(p => hasPlayed(form, p.id, true)), ...bench.filter(p => hasPlayed(form, p.id, false))]
  const setGoal = (index: number, next: Partial<ScoredGoal>) =>
    onFormChange({ ...form, goals: form.goals.map((goal, i) => i === index ? { ...goal, ...next } : goal) })
  const pick = (value: string) => value === NONE ? null : value
  const tick = (player: Listed, starter: boolean) => <Checkbox key={player.id} label={player.name}
    checked={hasPlayed(form, player.id, starter)} onCheckedChange={next => onFormChange(setPlayed(form, player.id, next === true))} />

  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:items-start">
      <div className="grid min-w-0 gap-4">
        <section aria-labelledby="evaluation-result" className={card}>
          <h2 id="evaluation-result" className="text-lg font-medium text-ink">Result</h2>
          <div className="flex flex-wrap items-end gap-4">
            <NumberField label="Our score" value={form.ourScore} min={0} max={EVALUATION_LIMITS.score}
              onValueChange={value => onFormChange(withScore(form, value))} />
            <NumberField label="Their score" value={form.theirScore} min={0} max={EVALUATION_LIMITS.score}
              onValueChange={value => onFormChange({ ...form, theirScore: value })} />
          </div>
          {form.goals.length > 0 && <ol className="grid gap-4">
            {form.goals.map((goal, index) => <li key={index}>
              {/* One above the other: side by side, half a laptop's width cut the names short. */}
              <fieldset className="grid gap-3">
                <legend className="mb-2 text-sm font-medium text-ink">Goal {index + 1}</legend>
                <Select label="Scored by" value={goal.scorer ?? NONE} onValueChange={value => setGoal(index, { scorer: pick(value), ...(value === goal.assist && { assist: null }) })}
                  options={[{ value: NONE, label: 'Not recorded' }, ...played.map(p => ({ value: p.id, label: p.name }))]} />
                <Select label="Assist" value={goal.assist ?? NONE} onValueChange={value => setGoal(index, { assist: pick(value) })}
                  options={[{ value: NONE, label: 'No assist' }, ...played.filter(p => p.id !== goal.scorer).map(p => ({ value: p.id, label: p.name }))]} />
              </fieldset>
            </li>)}
          </ol>}
        </section>

        <section aria-labelledby="evaluation-how" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="evaluation-how" className="text-lg font-medium text-ink">How they scored</h2>
            <Badge size="sm" icon={<Lock size={12} />}>Only you</Badge>
          </div>
          <Textarea label="How their goals came" rows={3} value={form.howTheyScored} maxLength={EVALUATION_LIMITS.howTheyScored}
            onChange={event => onFormChange({ ...form, howTheyScored: event.target.value })} />
        </section>
      </div>

      <section aria-labelledby="evaluation-played" className={card}>
        <div>
          <h2 id="evaluation-played" className="text-lg font-medium text-ink">Who played</h2>
          <p className="mt-1 text-sm text-ink-3">{starters.length ? 'Untick a starter who didn’t play, and tick who came on.' : 'Tick everyone who played.'}</p>
        </div>
        {starters.length + bench.length === 0 ? <p className="text-sm text-ink-2">Nobody in this squad can be recorded yet.</p> : <>
          {starters.length > 0 && <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">Started</legend>
            {starters.map(player => tick(player, true))}
          </fieldset>}
          {bench.length > 0 && <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">{starters.length ? 'Came on' : 'Played'}</legend>
            {bench.map(player => tick(player, false))}
          </fieldset>}
        </>}
      </section>
    </div>
  )
}
