import { Alert } from '@/components/arc/alert/alert'
import { DEFAULT_WATCH_RULE, effectiveRule, isWatchRule, rulesFor } from '@/lib/watch-first'
import type { SeasonPlan } from '@/lib/season-plan'
import { trainsIn, useSetWatchRule, useTrainingSquads } from './useWatching'

/* TRAK-355: when Trak brings a watched player back, picked once for the squad (the mockup's reminder). Trainings are
   offered only where the squad has them, on its schedule or in its register (Tarek, 6 Nov); a squad without them
   follows weeks. Whatever the coach picks, the reminder comes after 4 weeks at the latest. */

const chip = (on: boolean) =>
  `min-h-10 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink'}`

export function WatchRulePicker({ coachId, squad, plan, label = 'Remind me' }: {
  coachId: string
  squad: string
  plan: SeasonPlan | null
  label?: string
}) {
  const training = useTrainingSquads(coachId)
  const set = useSetWatchRule(coachId, squad)
  const hasTrainings = trainsIn(training.data, squad)
  const saved = isWatchRule(plan?.watch_rule) ? plan.watch_rule : DEFAULT_WATCH_RULE
  const current = set.isPending && set.variables ? set.variables.rule : effectiveRule(saved, hasTrainings)
  return <div role="group" aria-labelledby={`watch-rule-${squad}`} className="grid gap-2">
    <span id={`watch-rule-${squad}`} className="text-sm font-medium text-ink">{label}</span>
    <div className="flex flex-wrap gap-2">
      {rulesFor(hasTrainings).map(rule => <button key={rule.value} type="button" aria-pressed={current === rule.value} className={chip(current === rule.value)}
        disabled={set.isPending} onClick={() => set.mutate({ planId: plan?.id ?? null, rule: rule.value })}>{rule.label}</button>)}
    </div>
    <p className="text-sm text-ink-3">{hasTrainings ? "Trainings count each player's own, from your register. " : ''}Whatever you pick, Trak reminds you after 4 weeks at the latest.</p>
    {set.isError && <Alert tone="danger" title="Couldn't save the reminder. Check your connection and try again." />}
  </div>
}
