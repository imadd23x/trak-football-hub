import { AGAINST, DID_JOB, EVALUATION_LIMITS, answerOf, summary, type Against, type Answer, type DidJob, type EvaluationForm } from '@/lib/games/evaluation'
import { CONTEXT, EXPECTATIONS, playerPlan, type PlayerPlans } from '@/lib/games/lineup'
import { Badge } from '@/components/arc/badge/badge'
import { ExpandableCard } from '@/components/arc/expandable-card/expandable-card'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'

/* TRAK-288 (Games 6/8): the evaluation's Players step (TRAK-282). A card for each player who played: closed, how they
   did ("Did the job · Met") with the context and the expectation from the plan as it locked at kick-off; open, the
   two answers and a note only that player will read. Everyone starts at Yes · Met. */

const first = (name: string) => name.split(/\s+/)[0] || name

export function PlayersStep({ eventId, form, onFormChange, played, plans }: {
  eventId: string; form: EvaluationForm; onFormChange: (form: EvaluationForm) => void
  played: { id: string; name: string }[]; plans: PlayerPlans
}) {
  const set = (id: string, next: Partial<Answer>) =>
    onFormChange({ ...form, answers: { ...form.answers, [id]: { ...answerOf(form, id), ...next } } })
  return (
    <section aria-labelledby="evaluation-players" className="grid min-w-0 content-start gap-4">
      <div>
        <h2 id="evaluation-players" className="text-lg font-medium text-ink">Against what you expected</h2>
        <p className="mt-1 text-sm text-ink-3">{played.length ? 'Everyone starts at “Did the job · Met”. Change only who stood out.' : 'Nobody is ticked as playing. Tick who played in Result first.'}</p>
      </div>
      <ul className="grid gap-3">
        {played.map(player => {
          const answer = answerOf(form, player.id)
          const plan = playerPlan(plans, player.id)
          const name = first(player.name)
          return <li key={player.id}>
            <ExpandableCard title={player.name} description={summary(answer)} badges={<>
              {plan.context.map(value => <Badge key={value} size="sm">{CONTEXT.find(c => c.value === value)?.label ?? value}</Badge>)}
              <Badge size="sm" tone={plan.expectation === 'usual' ? 'neutral' : 'info'}>
                {`Expected: ${EXPECTATIONS.find(e => e.value === plan.expectation)!.label}`}</Badge>
            </>}>
              <div className="grid gap-4 p-4 tablet:grid-cols-2">
                <RadioGroup label="Did the job" name={`did-job-${eventId}-${player.id}`} options={DID_JOB} value={answer.didJob}
                  onValueChange={value => set(player.id, { didJob: value as DidJob })} />
                <RadioGroup label="Against expectation" name={`against-${eventId}-${player.id}`} options={AGAINST} value={answer.against}
                  onValueChange={value => set(player.id, { against: value as Against })} />
                <div className="tablet:col-span-2">
                  <Input label={`Note to ${name} · only ${name}, not the family`} placeholder="Optional. One sentence." value={answer.note}
                    maxLength={EVALUATION_LIMITS.note} onChange={event => set(player.id, { note: event.target.value })} />
                </div>
              </div>
            </ExpandableCard>
          </li>
        })}
      </ul>
    </section>
  )
}
