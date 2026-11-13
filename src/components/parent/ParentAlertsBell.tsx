import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertsBell } from '@/components/trak/AlertsBell'
import { ParentAssessmentBands, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentDevelopment, useParentEvents } from '@/hooks/useParentData'
import { firstName, parentAlerts } from '@/lib/parent-data'
import { newsAlert, useFamilyNews } from '@/lib/games/news'
import { noteEventSnapshots, noteFirstSeen, readFirstSeen } from '@/lib/player-events'
import { trackEvent } from '@/lib/telemetry'

/* TRAK-74 (decision 25 Sep): the parent's alerts are a bell on Home instead of
   a tab. It counts the selected child's matches, assessments and events
   (TRAK-134) recorded or changed since the bell last closed on this device,
   and lists them: a match or event opens its page, an assessment shows its
   bands (never the coach's message, TRAK-63). Awards stay out while they're
   parked (TRAK-31). TRAK-163: the panel is Arc's notification center. */

export function ParentAlertsBell() {
  const navigate = useNavigate()
  // Live run, 19 Oct (Tarek): the event page's Back returns where the bell was opened (Home).
  const { pathname } = useLocation()
  const { parentId, selectedChild } = useParentChildren()
  const development = useParentDevelopment()
  const events = useParentEvents()
  // TRAK-436: the child's game plans and the coach's reviews. They replace "Match logged": a match is now the coach's review.
  const news = useFamilyNews(selectedChild?.id, false)
  const firstSeenKey = parentId ? `trak:parent-alerts-events:${parentId}` : null
  useEffect(() => {
    if (!firstSeenKey || !parentId || !events.data) return
    noteFirstSeen(firstSeenKey, events.data)
    // TRAK-134: the version shown, so a later change can say what moved.
    noteEventSnapshots(parentId, events.data)
  }, [firstSeenKey, parentId, events.data])
  if (!parentId || !selectedChild || !firstSeenKey) return null

  const failed = development.isError || events.isError || news.isError
  const loading = development.isPending || events.isPending || news.isPending
  // Read before this render's events are recorded as first seen.
  const alerts = failed || loading ? [] : [...parentAlerts([], development.data,
    { awards: false, events: events.data ?? [], eventsFirstSeen: readFirstSeen(firstSeenKey) }),
  ...news.all.map(item => ({ ...newsAlert(item, 'parent', firstName(selectedChild)), kind: 'news' as const }))]
    .sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))

  return (
    <AlertsBell storageKey={`trak:parent-alerts-seen:${parentId}:${selectedChild.id}`}
      notice={failed ? <ParentLoadError message="Couldn't load alerts."
        onRetry={() => { void development.refetch(); void events.refetch(); void news.refetch() }} />
        : loading ? <ParentLoading /> : undefined}
      onOpen={() => { if (alerts.length) void trackEvent('alert_opened', { count: alerts.length }) }}
      alerts={alerts.map(alert => {
        if (alert.kind === 'news') {
          const { path, action, kind: _kind, ...rest } = alert
          return { ...rest, tone: 'success' as const, action: { label: action, onSelect: () => navigate(path, { state: { from: pathname } }) } }
        }
        const assessment = alert.kind === 'assessment'
          ? development.data?.assessments.find(item => item.id === alert.targetId) : undefined
        return {
          ...alert,
          tone: alert.cancelled ? 'warning' as const : undefined,
          details: assessment && <section aria-label="Assessment bands"><ParentAssessmentBands assessment={assessment} /></section>,
          action: alert.kind === 'match' || alert.kind === 'event' ? {
            label: alert.kind === 'event' ? 'Open event' : 'Open match',
            onSelect: () => navigate(`/parent/${alert.kind}/${alert.targetId}`, { state: { from: pathname } }),
          } : undefined,
        }
      })} />
  )
}
