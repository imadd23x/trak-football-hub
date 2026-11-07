import { useId } from 'react'
import { EVAL_EVERY, WEEKDAYS, type EvalEvery } from '@/lib/evaluation'

/* TRAK-364 (Season plan 16/18): "Evaluate each player", the season's rhythm: every 2 weeks, every month or every 6
   weeks, and the day (the last one of the month for every month). The line under it says the first or next date, or
   why there's none. The set-up's step 1 and View plan's Edit both use it. */

const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`

export function EvaluationRhythm({ every, day, onChange, line }: {
  every: EvalEvery
  day: number
  onChange: (next: { every: EvalEvery; day: number }) => void
  /** The first or next date, as the screen works it out. */
  line: string
}) {
  const id = useId()
  return (
    <div className="grid gap-3">
      <div role="group" aria-labelledby={`${id}-every`} className="grid gap-2">
        <span id={`${id}-every`} className="text-sm font-medium text-ink">Evaluate each player</span>
        <div className="flex flex-wrap gap-2">
          {EVAL_EVERY.map(option => <button key={option.value} type="button" aria-pressed={every === option.value} className={chip(every === option.value)}
            onClick={() => onChange({ every: option.value, day })}>{option.label}</button>)}
        </div>
      </div>
      <div role="group" aria-labelledby={`${id}-day`} className="grid gap-2">
        <span id={`${id}-day`} className="text-sm font-medium text-ink">{every === 'month' ? 'On the last' : 'On a'}</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((name, index) => <button key={name} type="button" aria-pressed={day === index} aria-label={name} className={chip(day === index)}
            onClick={() => onChange({ every, day: index })}>{name.slice(0, 3)}</button>)}
        </div>
      </div>
      <p className="text-sm text-ink-3">{line}</p>
    </div>
  )
}
