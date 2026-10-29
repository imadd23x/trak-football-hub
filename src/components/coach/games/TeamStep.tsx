import { PLAN_WORKED, type EvaluationForm, type PlanWorked } from '@/lib/games/evaluation'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'

/* TRAK-288 (Games 6/8): the evaluation's Team step (TRAK-282). "Did the plan work?" for each of the plan's goals, as
   they locked at kick-off. A plan with no goals says so, and the coach moves on. */

export function TeamStep({ eventId, form, onFormChange, goals }: {
  eventId: string; form: EvaluationForm; onFormChange: (form: EvaluationForm) => void
  /** The plan's goals in order, as they locked at kick-off. */
  goals: string[]
}) {
  const answer = (index: number, value: PlanWorked) =>
    onFormChange({ ...form, planWorked: goals.map((_, i) => i === index ? value : form.planWorked[i] ?? null) })
  return (
    <section aria-labelledby="evaluation-team" className="grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5 tablet:max-w-[640px]">
      <div>
        <h2 id="evaluation-team" className="text-lg font-medium text-ink">Did the plan work?</h2>
        <p className="mt-1 text-sm text-ink-3">{goals.length ? 'One answer for each of your goals.' : 'Your plan had no goals, so there’s nothing to check here.'}</p>
      </div>
      {goals.map((goal, index) => <RadioGroup key={index} label={goal} name={`plan-worked-${eventId}-${index}`} options={PLAN_WORKED}
        value={form.planWorked[index] ?? ''} onValueChange={value => answer(index, value as PlanWorked)} />)}
    </section>
  )
}
