import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { useMyAnnouncements, type Announcement } from '@/lib/announcements'
import { useAnswerTask, useMyTasks, type MyTask } from '@/lib/tasks'
import { AlertsBell, type BellAlert } from '@/components/trak/AlertsBell'
import { LoadError } from '@/components/trak/LoadError'
import { assessmentAlertTitle, eventAlert } from '@/lib/parent-data'
import { noteEventSnapshots, noteFirstSeen, readFirstSeen, type PlayerEvent } from '@/lib/player-events'
import { newsAlert, useFamilyNews, type NewsItem } from '@/lib/games/news'
import { reportAlert, useFamilyReports, type FamilyReport } from '@/lib/player-report'
import { useTranslation } from '@/lib/i18n'

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

type BellProps = {
  userId: string
  events: PlayerEvent[]
  /** TRAK-436: his game plans shared or changed and the coach's reviews (useFamilyNews). */
  news?: NewsItem[]
  assessment?: PublishedAssessmentAlert | null
  assessmentLoadFailed?: boolean
  onRetry?: () => void
  /** TRAK-530: his latest sent report, in the new look in place of the assessment. */
  report?: FamilyReport
  /** TRAK-603: his squads' announcements, his My tasks (for their Got it), how to answer one, and Retry after a failed read. */
  announcements?: { list: Announcement[]; tasks: MyTask[]; gotIt: (taskId: string) => void; retry?: () => void }
}

/** Home's bell: reads his game plans and reviews itself, so their arrival re-renders the bell, not Home under it.
 *  TRAK-530: in the new look, his latest report in place of the assessment (no family screen opens one any more).
 *  TRAK-603: and his squads' announcements, with My tasks' read and answer, so the two never disagree. */
export function PlayerHomeBell({ look = false, ...props }: Omit<BellProps, 'news' | 'report' | 'announcements'> & { look?: boolean }) {
  const news = useFamilyNews(props.userId, true).all
  const reports = useFamilyReports(look ? props.userId : undefined, true)
  const read = useMyAnnouncements(props.userId)
  const tasks = useMyTasks().data
  const answer = useAnswerTask()
  const announcements = {
    list: read.data ?? [], tasks: tasks ?? [],
    gotIt: (taskId: string) => answer.mutate({ taskId, undo: false }, { onError: () => toast("That didn't save. Try again.") }),
    retry: read.isError ? () => void read.refetch() : undefined,
  }
  return look ? <PlayerAlertsBell {...props} assessment={null} assessmentLoadFailed={false} news={news} report={reports.data?.[0]} announcements={announcements} />
    : <PlayerAlertsBell {...props} news={news} announcements={announcements} />
}

export function PlayerAlertsBell({ userId, events, news = [], assessment, assessmentLoadFailed, onRetry, report, announcements }: BellProps) {
  const { t } = useTranslation()
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
  if (report) {
    const { path, month, ...alert } = reportAlert(report, userId, userId, 'player')
    alerts.push({ ...alert, description: t('coachSquad:sentReportName', { month }), action: { label: t('common:openReport'), onSelect: () => navigate(path) } })
  }
  for (const item of news) {
    const { path, action, ...alert } = newsAlert(item, 'player', '')
    alerts.push({ ...alert, tone: 'success', action: { label: action, onSelect: () => navigate(path, { state: { from: pathname } }) } })
  }
  // TRAK-603: the squad's announcements. Got it, where the coach asked for it, is the player's My tasks task, so it is
  // one answer in both places. They count as read once the bell has been opened and closed; that never answers.
  for (const item of announcements?.list ?? []) {
    const task = announcements!.tasks.find(t => t.source_type === 'announcement' && t.source_id === item.id)
    const asks = !!task && (!task.answered || task.outdated)
    alerts.push({
      id: `announcement-${item.id}`, title: 'From Coach', description: item.body, date: item.published_at, readOnClose: true,
      details: (task && !asks) || item.link ? <span className="flex flex-wrap items-center gap-3 text-sm">
        {task && !asks && <span className="flex items-center gap-1.5 font-medium text-ink"><Check size={16} aria-hidden="true" />Got it</span>}
        {item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline underline-offset-4">Open link</a>}
      </span> : undefined,
      action: task && asks ? { label: 'Got it', onSelect: () => announcements!.gotIt(task.task_id) } : undefined,
    })
  }
  alerts.sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))

  const failed = [
    assessmentLoadFailed && onRetry && <LoadError key="assessment" what="assessment alerts" onRetry={onRetry} />,
    announcements?.retry && <LoadError key="announcements" what="announcements" onRetry={announcements.retry} />,
  ].filter(Boolean)
  return (
    <AlertsBell storageKey={`trak:player-alerts-seen:${userId}`} notice={failed.length ? <>{failed}</> : undefined} alerts={alerts} />
  )
}
