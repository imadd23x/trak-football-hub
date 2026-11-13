import { useTranslation } from '@/lib/i18n'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { planPath, searchSessions, sessionSummary, type PlannerState } from '@/lib/training/plans'
import { gameWhen } from '@/components/coach/games/useGames'
import { LoadError } from '@/components/trak'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { SearchField } from '@/components/arc/search-field/search-field'
import { useNotes, usePastSessions, type Training } from './useTraining'
import { yesFirst } from '@/lib/training/next'
import type { SavedPractice } from '@/lib/training/plans'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-297 (Training 4/5, spec TRAK-293): copying a past session opens the planner filled in; nothing saves until Save
   the plan. TRAK-339 (Training redo 1/5, spec TRAK-338, 2 Nov prototype): no more "How do you want to plan it?" (Kostas,
   29 Oct: Plan session goes straight to planning). Copying is "Use a past plan" on the Next training card, and "Use
   this plan" in Past trainings, which then asks which training to copy it into. */

const when = (training: Training) => {
  const { day, time } = gameWhen(training)
  return [day, time].filter(Boolean).join(' · ')
}

export type PlanToCopy = { title: string; day: string; practices: SavedPractice[] }

/** Opens the planner for `training`, filled in with a past plan. */
function useCopyInto() {
  const navigate = useNavigate()
  return (training: Training, plan: PlanToCopy) => navigate(planPath(training.id),
    { state: { copy: plan.practices, copiedFrom: `${plan.title}, ${plan.day}` } satisfies PlannerState })
}

/** Use a past plan, for `training`: every plan the coach has written, the ones they'd run again first, then newest first,
 *  searchable by name or drill. */
export function PastPlanSheet({ open, onOpenChange, training }: { open: boolean; onOpenChange: (open: boolean) => void; training: Training }) {
  const copyInto = useCopyInto()
  const { t } = useTranslation()
  const past = usePastSessions(open)
  const notes = useNotes(open)
  const [query, setQuery] = useState('')
  const others = (past.data ?? []).filter(session => session.id !== training.id)
  const again = (id: string) => notes.data?.get(id)?.again === 'yes'
  const shown = yesFirst(searchSessions(others, query), again)
  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} detents={[0.92]} title={t('coachTraining:usePastPlan')}
    description={t('coachTraining:forTraining', { title: training.title, when: when(training) })}>
    <div className="grid gap-4 pb-4">
      {past.error ? <LoadError what={t('coachTraining:pastPlansWhat')} onRetry={() => void past.refetch()} retrying={past.isFetching} />
        : past.isPending ? <LoadingSkeleton label={t('coachTraining:loadingPastPlans')} lines={2} rows={3} />
        : others.length === 0 ? <p className="text-[15px] text-ink-2">{t('coachTraining:noPastPlans')}</p>
        : <>
          <SearchField label={t('coachTraining:searchPastPlans')} placeholder={t('coachTraining:searchPlansPh')} value={query} onValueChange={setQuery} />
          {shown.length === 0 ? <p className="text-[15px] text-ink-2">No past plan matches “{query.trim()}”.</p>
            : <ul aria-label="Past plans" className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
              {shown.map(session => <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-ink break-words"><span className="font-medium">{session.title}</span>
                    <span className="text-sm text-ink-3"> · {gameWhen(session).day}</span></p>
                  <p className="text-[13px] text-ink-3 break-words">{sessionSummary(session.practices)}</p>
                  {again(session.id) && <span className="mt-1 inline-block"><Badge size="sm" tone="success">{t('coachTraining:runAgainBadge')}</Badge></span>}
                </div>
                <Button size="sm" variant="secondary" aria-label={t('coachTraining:useThisPlanNamed', { title: session.title, day: gameWhen(session).day })}
                  onClick={() => { onOpenChange(false); copyInto(training, { ...session, day: gameWhen(session).day }) }}>{t('coachTraining:useThisPlan')}</Button>
              </li>)}
            </ul>}
        </>}
      <div className="flex justify-end"><Button variant="ghost" onClick={() => onOpenChange(false)}>{t('coachSchedule:cancel')}</Button></div>
    </div>
  </BottomSheet>
}

/** Use this plan, from Past trainings: which training coming up to copy it into. */
export function CopyTargetSheet({ plan, trainings, onClose }: { plan: PlanToCopy | null; trainings: Training[]; onClose: () => void }) {
  const copyInto = useCopyInto()
  const { t } = useTranslation()
  return <BottomSheet className="arc" open={!!plan} onOpenChange={open => { if (!open) onClose() }}
    title={plan ? t('coachTraining:copyInto', { title: plan.title }) : t('coachTraining:copyIntoPlain')}
    description={t('coachTraining:plannerOpens')}>
    <div className="grid gap-4 pb-4">
      {trainings.length === 0 ? <p className="text-[15px] text-ink-2">{t('coachTraining:noTrainingAddFirst')}</p>
        : <ul aria-label="Trainings coming up" className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
          {trainings.map(training => <li key={training.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink break-words">{training.title}</p>
              <p className="text-[13px] text-ink-3">{when(training)}</p>
            </div>
            <Button size="sm" aria-label={t('coachTraining:copyHereNamed', { title: training.title, when: when(training) })}
              onClick={() => { if (plan) { onClose(); copyInto(training, plan) } }}>{t('coachTraining:copyHere')}</Button>
          </li>)}
        </ul>}
      <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>{t('coachSchedule:cancel')}</Button></div>
    </div>
  </BottomSheet>
}
