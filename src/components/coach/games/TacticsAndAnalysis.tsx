import { useTranslation } from '@/lib/i18n'
import { optionWords } from '@/lib/games/match-words'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { loadSeasonObjectives, seasonObjectivesKey, useSeasonPlan } from '@/lib/season-plan'
import { Badge } from '@/components/arc/badge/badge'
import { LIMITS, MAX_GOALS, STRENGTHS, emptyGoal, type Goal, type PlanForm, type Strength } from '@/lib/games/plan'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import { Textarea } from '@/components/arc/textarea/textarea'
import { OnlyYou } from './OnlyYou'

/* TRAK-284 (Games 2/8): plan step 1 (TRAK-282). TRAK-287: locked at kick-off, the fields read only, the picker becomes
   words, and nothing can be added or removed. TRAK-328 (Imad, 2 Nov): the step is Tactics & analysis; the goals are
   Instructions, none shown until the coach adds one; their likely line-up is gone; how strong they are asks only its
   question, with his lock saying who sees it (Arc tooltip, which a tap opens too). TRAK-337 (Imad, 2 Nov): Scouting has
   the same lock. TRAK-371 (Imad, 5 Nov): example text in the boxes says what to write, in place of a helper line.
   TRAK-372 (Imad, 5 Nov): locked, what was written reads as written, with no boxes; nothing written says so.
   TRAK-363 (Season plan 15/18): where the season plan is on, the squad's season objectives are one-tap picks above Add
   instruction. A pick fills in the words and carries the objective, which stays whatever the words become, so Home
   can measure it from "Did the plan work?". A typed instruction carries none and doesn't count. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'

/** TRAK-363: the tag an instruction picked from the season plan wears. */
function ObjectiveTag({ goal, names }: { goal: Goal; names: Map<string, string> }) {
  const { t } = useTranslation()
  if (!goal.seasonObjectiveId) return null
  return <span className="arc"><Badge tone="info" size="sm">{names.get(goal.seasonObjectiveId) ? t('coachMatches:seasonObjectiveNamed', { name: names.get(goal.seasonObjectiveId) }) : t('coachMatches:seasonObjective')}</Badge></span>
}

/** The instructions as they locked: each numbered, its title over what it looks like. */
function Written({ goals, names }: { goals: Goal[]; names: Map<string, string> }) {
  const { t } = useTranslation()
  const written = goals.filter(goal => goal.title.trim() || goal.looksLike.trim())
  if (!written.length) return <p className="text-[15px] text-ink-2">{t('coachMatches:noInstructions')}</p>
  return <ol className="grid gap-4">
    {written.map((goal, index) => <li key={index} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1">
      <span aria-hidden="true" className="row-span-2 grid size-7 place-items-center rounded-full bg-ink text-sm font-medium text-surface">{index + 1}</span>
      {goal.title.trim() && <p className="self-center text-base font-medium text-ink">{goal.title}</p>}
      {goal.seasonObjectiveId && <span className="col-start-2"><ObjectiveTag goal={goal} names={names} /></span>}
      {goal.looksLike.trim() && <p className="col-start-2 whitespace-pre-line text-[15px] text-ink-2">{goal.looksLike}</p>}
    </li>)}
  </ol>
}

export function TacticsAndAnalysis({ eventId, opponent, squad = null, form, onFormChange, locked = false }: {
  eventId: string; opponent: string | null; squad?: string | null; form: PlanForm; onFormChange: (form: PlanForm) => void; locked?: boolean
}) {
  const { user } = useAuth()
  const { t } = useTranslation()
  const strengths = optionWords('strength', STRENGTHS)
  // TRAK-363: the match's squad's season objectives, where the season plan is on.
  const season = useSeasonPlan(user?.id, squad)
  const seasonObjectives = useQuery({
    queryKey: seasonObjectivesKey(user?.id, season.plan?.id),
    queryFn: () => loadSeasonObjectives(season.plan!.id),
    enabled: !!season.plan,
  })
  const names = new Map((seasonObjectives.data ?? []).map(o => [o.id, o.title]))
  const picks = (seasonObjectives.data ?? []).filter(o => !form.goals.some(goal => goal.seasonObjectiveId === o.id))
  const change = (next: Partial<PlanForm>) => onFormChange({ ...form, ...next })
  const setGoal = (index: number, next: Partial<Goal>) => change({ goals: form.goals.map((goal, i) => i === index ? { ...goal, ...next } : goal) })
  const strong = opponent ? t('coachMatches:howStrong', { opponent }) : t('coachMatches:howStrongThey')

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 laptop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] laptop:items-start">
        <div className="grid min-w-0 gap-4">
        <section aria-labelledby="plan-goals" className={card}>
          <h2 id="plan-goals" className="text-lg font-medium text-ink">{t('coachMatches:instructions')}</h2>
          {locked ? <Written goals={form.goals} names={names} /> : form.goals.length > 0 && <ol className="grid gap-5">
            {form.goals.map((goal, index) => <li key={index}>
              <fieldset className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <legend className="sr-only">{t('coachMatches:instructionN', { n: index + 1 })}</legend>
                <span aria-hidden="true" className="row-span-3 grid size-7 place-items-center rounded-full bg-ink text-sm font-medium text-surface">{index + 1}</span>
                <Input label={t('coachMatches:instruction')} value={goal.title} maxLength={LIMITS.title}
                  placeholder={t('coachMatches:instructionExample')} onChange={event => setGoal(index, { title: event.target.value })} />
                <Textarea label={t('coachMatches:looksLike')} rows={2} value={goal.looksLike} maxLength={LIMITS.looksLike}
                  placeholder={t('coachMatches:looksLikeExample')}
                  onChange={event => setGoal(index, { looksLike: event.target.value })} />
                {goal.seasonObjectiveId && <span className="col-start-2"><ObjectiveTag goal={goal} names={names} /></span>}
                <span className="col-start-2"><Button variant="ghost" size="sm" aria-label={t('coachMatches:removeInstruction', { n: index + 1 })}
                  onClick={() => change({ goals: form.goals.filter((_, i) => i !== index) })}>{t('coachMatches:remove')}</Button></span>
              </fieldset>
            </li>)}
          </ol>}
          {form.goals.length < MAX_GOALS && !locked && picks.length > 0 && <div className="grid gap-2">
            <h3 className="text-sm font-medium text-ink-2">{t('coachMatches:fromSeasonPlan')}</h3>
            <div className="flex flex-wrap gap-2">{picks.map(o => (
              <Button key={o.id} variant="secondary" size="sm" title={o.looks_like || undefined}
                onClick={() => change({ goals: [...form.goals, { title: o.title, looksLike: o.looks_like, seasonObjectiveId: o.id }] })}>
                <Plus size={16} aria-hidden="true" />{o.title}
              </Button>))}
            </div>
          </div>}
          {form.goals.length < MAX_GOALS && !locked && <span><Button variant="ghost" size="sm" onClick={() => change({ goals: [...form.goals, emptyGoal()] })}>
            <Plus size={16} aria-hidden="true" />{t('coachMatches:addInstruction')}</Button></span>}
        </section>

        <section aria-labelledby="plan-scouting" className={card}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="plan-scouting" className="text-lg font-medium text-ink">{t('coachMatches:scouting')}</h2>
            <OnlyYou what={t('coachMatches:scoutingWhat')} />
          </div>
          {locked ? <p className="whitespace-pre-line text-[15px] text-ink">{form.scouting.trim() || t('coachMatches:noScouting')}</p>
            : <Textarea label={t('coachMatches:knowAboutThem')} rows={4} value={form.scouting} maxLength={LIMITS.scouting}
                placeholder={t('coachMatches:scoutingExample')}
                onChange={event => change({ scouting: event.target.value })} />}
        </section>
        </div>

        <section aria-labelledby="plan-strength" className={card}>
          <div className="flex items-start justify-between gap-3">
            <h2 id="plan-strength" className="text-lg font-medium text-ink">{strong}</h2>
            <OnlyYou what={t('coachMatches:strengthWhat')} />
          </div>
          {locked ? <p className="text-sm text-ink">{strengths.find(option => option.value === form.strength)?.label ?? t('coachSchedule:notSet')}</p>
            : <RadioGroup label={strong} hideLabel name={`strength-${eventId}`} options={strengths} value={form.strength ?? ''}
                onValueChange={value => change({ strength: value as Strength })} />}
        </section>
      </div>
    </div>
  )
}
