import { useTranslation } from '@/lib/i18n'
import { optionWords } from '@/lib/games/match-words'
import { EVALUATION_LIMITS, PLAN_WORKED, hasPlayed, setPlayed, withScore, type EvaluationForm, type PlanWorked, type ScoredGoal } from '@/lib/games/evaluation'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { NumberField } from '@/components/arc/number-field/number-field'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { Select } from '@/components/arc/select/select'
import { Textarea } from '@/components/arc/textarea/textarea'
import { OnlyYou } from './OnlyYou'

/* TRAK-288 (Games 6/8): the evaluation's Result step (TRAK-282). The score; for each of our goals, who scored and who
   assisted, from the players who played; how they scored, only the coach's; and who played: the starters ticked until
   the coach unticks them, the bench ticked when they came on. No minutes (Imad, 29 Oct). TRAK-374 (Imad, 5 Nov): "Did
   the plan work?" for each instruction as it locked (the Team step's, gone); How they scored only once they scored,
   with the Scouting lock. */

const NONE = 'none'
const OWN = 'own'
const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
type Listed = { id: string; name: string }

export function ResultStep({ eventId, form, onFormChange, starters, bench, goals }: {
  eventId: string; form: EvaluationForm; onFormChange: (form: EvaluationForm) => void; starters: Listed[]; bench: Listed[]
  /** The plan's instructions in order, as they locked at kick-off. */
  goals: string[]
}) {
  const { t } = useTranslation()
  const played = [...starters.filter(p => hasPlayed(form, p.id, true)), ...bench.filter(p => hasPlayed(form, p.id, false))]
  const setGoal = (index: number, next: Partial<ScoredGoal>) =>
    onFormChange({ ...form, goals: form.goals.map((goal, i) => i === index ? { ...goal, ...next } : goal) })
  const pick = (value: string) => value === NONE ? null : value
  const answer = (index: number, value: PlanWorked) =>
    onFormChange({ ...form, planWorked: goals.map((_, i) => i === index ? value : form.planWorked[i] ?? null) })
  const tick = (player: Listed, starter: boolean) => <Checkbox key={player.id} label={player.name}
    checked={hasPlayed(form, player.id, starter)} onCheckedChange={next => onFormChange(setPlayed(form, player.id, next === true))} />

  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:items-start">
      <div className="grid min-w-0 gap-4">
        <section aria-labelledby="evaluation-result" className={card}>
          <h2 id="evaluation-result" className="text-lg font-medium text-ink">{t('coachMatches:evStepResult')}</h2>
          <div className="flex flex-wrap items-end gap-4">
            <NumberField label={t('coachSchedule:ourScore')} value={form.ourScore} min={0} max={EVALUATION_LIMITS.score}
              onValueChange={value => onFormChange(withScore(form, value))} />
            <NumberField label={t('coachSchedule:theirScore')} value={form.theirScore} min={0} max={EVALUATION_LIMITS.score}
              onValueChange={value => onFormChange({ ...form, theirScore: value })} />
          </div>
          {form.goals.length > 0 && <ol className="grid gap-4">
            {form.goals.map((goal, index) => <li key={index}>
              {/* One above the other: side by side, half a laptop's width cut the names short. */}
              <fieldset className="grid gap-3">
                <legend className="mb-2 text-sm font-medium text-ink">{t('coachMatches:goalN', { n: index + 1 })}</legend>
                {/* TRAK-447: an own goal credits nobody, so it has no scorer and no assist to pick. */}
                <Select label={t('coachMatches:scoredBy')} value={goal.own ? OWN : goal.scorer ?? NONE}
                  onValueChange={value => setGoal(index, value === OWN ? { scorer: null, assist: null, own: true }
                    : { scorer: pick(value), own: false, ...(value === goal.assist && { assist: null }) })}
                  options={[{ value: NONE, label: t('coachMatches:notRecorded') }, { value: OWN, label: t('coachMatches:ownGoal') }, ...played.map(p => ({ value: p.id, label: p.name }))]} />
                {!goal.own && <Select label={t('coachMatches:assist')} value={goal.assist ?? NONE} onValueChange={value => setGoal(index, { assist: pick(value) })}
                  options={[{ value: NONE, label: t('coachMatches:noAssist') }, ...played.filter(p => p.id !== goal.scorer).map(p => ({ value: p.id, label: p.name }))]} />}
              </fieldset>
            </li>)}
          </ol>}
        </section>

        {form.theirScore > 0 && <section aria-labelledby="evaluation-how" className={card}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="evaluation-how" className="text-lg font-medium text-ink">{t('coachMatches:howTheyScored')}</h2>
            <OnlyYou what={t('coachMatches:howTheyScoredWhat')} />
          </div>
          <Textarea label={t('coachMatches:howGoalsCame')} rows={3} value={form.howTheyScored} maxLength={EVALUATION_LIMITS.howTheyScored}
            onChange={event => onFormChange({ ...form, howTheyScored: event.target.value })} />
        </section>}

        {goals.length > 0 && <section aria-labelledby="evaluation-team" className={card}>
          <h2 id="evaluation-team" className="text-lg font-medium text-ink">{t('coachMatches:didPlanWork')}</h2>
          {goals.map((goal, index) => <RadioGroup key={index} label={goal} name={`plan-worked-${eventId}-${index}`} options={optionWords('planWorked', PLAN_WORKED)}
            value={form.planWorked[index] ?? ''} onValueChange={value => answer(index, value as PlanWorked)} />)}
        </section>}
      </div>

      <section aria-labelledby="evaluation-played" className={card}>
        <div>
          <h2 id="evaluation-played" className="text-lg font-medium text-ink">{t('coachMatches:whoPlayed')}</h2>
          <p className="mt-1 text-sm text-ink-3">{starters.length ? t('coachMatches:untickHint') : t('coachMatches:tickEveryone')}</p>
        </div>
        {starters.length + bench.length === 0 ? <p className="text-sm text-ink-2">{t('coachMatches:nobodyRecordable')}</p> : <>
          {starters.length > 0 && <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">{t('coachMatches:started')}</legend>
            {starters.map(player => tick(player, true))}
          </fieldset>}
          {bench.length > 0 && <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">{starters.length ? t('coachMatches:cameOn') : t('coachMatches:played')}</legend>
            {bench.map(player => tick(player, false))}
          </fieldset>}
        </>}
      </section>
    </div>
  )
}
