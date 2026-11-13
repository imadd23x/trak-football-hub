import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { localTodayISO } from '@/lib/event-time'
import { blankForm } from '@/lib/coach-events'
import { PAST_TRAININGS_PATH, useOldLogRetired } from './old-log'

/* TRAK-426: an old log page's route (old-log.ts says why they retire). */

/** An old log page's route: the page itself where it still has a job, otherwise where its job went. Nothing shows
 *  until the switches answer, so the old page never flashes up first. */
export function OldLog({ to, children }: { to: 'new-training' | 'past'; children: ReactNode }) {
  const { retired, known } = useOldLogRetired()
  if (!known) return null
  if (!retired) return <>{children}</>
  if (to === 'past') return <Navigate to={PAST_TRAININGS_PATH} replace />
  return <Navigate to="/coach/schedule" replace state={{ quickEvent: { ...blankForm(localTodayISO()), kind: 'training' } }} />
}
