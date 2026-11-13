import { useTranslation } from '@/lib/i18n'
import { optionWords } from '@/lib/games/match-words'
import { AGAINST, DID_JOB, EVALUATION_LIMITS, answerOf, summary, type Against, type Answer, type DidJob, type EvaluationForm } from '@/lib/games/evaluation'
import { CONTEXT, EXPECTATIONS, EXPECTATION_COLOR, playerPlan, type PlayerPlans } from '@/lib/games/lineup'
import { Badge } from '@/components/arc/badge/badge'
import { ExpandableCard } from '@/components/arc/expandable-card/expandable-card'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { LockedValue } from './LockedValue'

/* TRAK-288 (Games 6/8): the evaluation's Players step (TRAK-282). A card for each player who played: closed, how they
   did ("Did the job · Met") with the context and the expectation from the plan as it locked at kick-off; open, the
   two answers and a note only that player will read. Everyone starts at Yes · Met. TRAK-374 (Imad, 5 Nov): the step is
   Player evaluation; an open card shows the player's job from the plan first, to judge against; "Did the job?"; the
   note shows an example. */

const first = (name: string) => name.split(/\s+/)[0] || name

export function PlayersStep({ eventId, form, onFormChange, played, plans }: {
  eventId: string; form: EvaluationForm; onFormChange: (form: EvaluationForm) => void
  played: { id: string; name: string }[]; plans: PlayerPlans
}) {
  const { t } = useTranslation()
  const contexts = optionWords('context', CONTEXT)
  const expectations = optionWords('expectation', EXPECTATIONS)
  const set = (id: string, next: Partial<Answer>) =>
    onFormChange({ ...form, answers: { ...form.answers, [id]: { ...answerOf(form, id), ...next } } })
  return (
    <section aria-labelledby="evaluation-players" className="grid min-w-0 content-start gap-4">
      <div>
        <h2 id="evaluation-players" className="text-lg font-medium text-ink">{t('coachMatches:againstExpected')}</h2>
        {!played.length && <p className="mt-1 text-sm text-ink-3">{t('coachMatches:nobodyTicked')}</p>}
      </div>
      <ul className="grid gap-3">
        {played.map(player => {
          const answer = answerOf(form, player.id)
          const plan = playerPlan(plans, player.id)
          const name = first(player.name)
          return <li key={player.id}>
            <ExpandableCard title={player.name} description={summary(answer, !!plan.job.trim())} badges={<>
              {plan.context.map(value => <Badge key={value} size="sm" color="amber">{contexts.find(c => c.value === value)?.label ?? value}</Badge>)}
              <Badge size="sm" color={EXPECTATION_COLOR[plan.expectation]}>
                {t('coachMatches:expectedLabel', { level: expectations.find(e => e.value === plan.expectation)!.label })}</Badge>
            </>}>
              <div className="grid gap-3 p-3 tablet:grid-cols-2">
                <div className="tablet:col-span-2"><LockedValue label={t('coachMatches:job')} value={plan.job.trim() || t('coachMatches:noJob')} /></div>
                {/* TRAK-447: the plan gave this player no job, so there is nothing to have done: N/A, and nothing for them to read. */}
                {plan.job.trim()
                  ? <RadioGroup label={t('coachMatches:didTheJob')} name={`did-job-${eventId}-${player.id}`} options={optionWords('didJob', DID_JOB)} value={answer.didJob}
                    onValueChange={value => set(player.id, { didJob: value as DidJob })} />
                  : <LockedValue label={t('coachMatches:didTheJob')} value={t('coachMatches:notApplicable')} />}
                <RadioGroup label={t('coachMatches:againstExpectation')} name={`against-${eventId}-${player.id}`} options={optionWords('against', AGAINST)} value={answer.against}
                  onValueChange={value => set(player.id, { against: value as Against })} />
                <div className="tablet:col-span-2">
                  <Input label={t('coachMatches:noteToName', { name })} placeholder={t('coachMatches:noteExample')} value={answer.note}
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
