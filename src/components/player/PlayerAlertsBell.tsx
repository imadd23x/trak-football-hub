import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertsBell, type BellAlert } from '@/components/trak/AlertsBell'
import { LoadError } from '@/components/trak/LoadError'
import { assessmentAlertTitle, eventAlert } from '@/lib/parent-data'
import { noteEventSnapshots, noteFirstSeen, readFirstSeen, type PlayerEvent } from '@/lib/player-events'

/* TRAK-163 (Imad, 12 Oct): players get the parent's bell for their squad's
   events: new, changed (with the new time) and cancelled, counted since the
   bell last closed on this device. The events are the ones Home already
   loaded, so the bell can't disagree with the screen under it. TRAK-171 adds
   the current assessment only after its saved message is confirmed published. */
export interface PublishedAssessmentAlert {
  id: string
  userId: string
  publishedAt: string
  /** TRAK-202: the coach who wrote it, for "New assessment from Coach <name>". */
  coachName?: string
  /** False for an evaluation published without a note. */
  hasMessage?: boolean
}

export function PlayerAlertsBell({ userId, events, assessment, assessmentLoadFailed, onRetry }: {
  userId: string
  events: PlayerEvent[]
  assessment?: PublishedAssessmentAlert | null
  assessmentLoadFailed?: boolean
  onRetry?: () => void
}) {
  const navigate = useNavigate()
  // Live run, 19 Oct (Tarek): the event page's Back returns where the bell was opened (Home).
  const { pathname } = useLocation()
  const firstSeenKey = `trak:player-alerts-events:${userId}`
  // TRAK-134: the version shown too, so a later change can say what moved.
  useEffect(() => { noteFirstSeen(firstSeenKey, events); noteEventSnapshots(userId, events) }, [firstSeenKey, userId, events])
  // Read before this render's events are recorded as first seen.
  const firstSeen = readFirstSeen(firstSeenKey)
  const alerts: BellAlert[] = events.map(event => {
    const alert = eventAlert(event, firstSeen)
    return { ...alert, tone: alert.cancelled ? 'warning' : undefined,
      action: { label: 'Open event', onSelect: () => navigate(`/player/event/${alert.targetId}`, { state: { from: pathname } }) } }
  })
  if (!assessmentLoadFailed && assessment?.userId === userId) alerts.push({
    id: `assessment-${assessment.id}`, title: assessmentAlertTitle(assessment.coachName),
    // TRAK-226: the title already says who and what; this line says what's in it.
    description: assessment.hasMessage === false ? 'Your ratings to read.' : 'Your ratings and a message to read.', date: assessment.publishedAt,
    action: { label: 'Open assessment', onSelect: () => navigate(`/player/feedback/${assessment.id}`) },
  })
  alerts.sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))

  return (
    <AlertsBell storageKey={`trak:player-alerts-seen:${userId}`}
      notice={assessmentLoadFailed && onRetry ? <LoadError what="assessment alerts" onRetry={onRetry} /> : undefined}
      alerts={alerts} />
  )
}
