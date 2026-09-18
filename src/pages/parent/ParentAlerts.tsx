import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentDevelopment, useParentMatchActivity } from '@/hooks/useParentData'
import { compareParentActivity, formatParentAward, formatParentDate, PARENT_ACTIVITY_LIMIT } from '@/lib/parent-data'
import { scoreToBand } from '@/lib/rating-engine'
import { trackEvent } from '@/lib/telemetry'

interface ParentAlert {
  id: string
  title: string
  description: string
  date: string | null
}

export default function ParentAlerts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { selectedChild } = useParentChildren()
  const matches = useParentMatchActivity()
  const development = useParentDevelopment()
  const hasError = matches.isError || development.isError
  const loading = matches.isPending || development.isPending
  const alerts: ParentAlert[] = [
    // This query is ordered by recorded time, independent of history browsing.
    ...(matches.data ?? []).map(match => ({
      id: `match-${match.id}`, title: 'Match logged', date: match.created_at,
      description: `vs ${match.opponent || match.competition || 'Unknown'}${match.team_score != null && match.opponent_score != null ? ` · ${match.team_score}–${match.opponent_score}` : ''}`,
    })),
    ...(development.data?.assessments ?? []).map(assessment => ({
      id: `assessment-${assessment.id}`, title: 'New coach assessment', date: assessment.created_at,
      description: `by ${(assessment.coach_user_id && development.data?.coachNames[assessment.coach_user_id]) || 'Coach'} · ${assessment.coach_rating == null ? 'Not assessed' : scoreToBand(assessment.coach_rating)}`,
    })),
    ...(development.data?.awards ?? []).map(award => ({
      id: `award-${award.id}`, title: formatParentAward(award.award_type), date: award.created_at,
      description: [award.awarded_for, `by ${(award.coach_user_id && development.data?.coachNames[award.coach_user_id]) || 'Coach'}`].filter(Boolean).join(' · '),
    })),
  ].sort(compareParentActivity).slice(0, PARENT_ACTIVITY_LIMIT)
  const childId = selectedChild?.id
  const count = alerts.length
  useEffect(() => {
    if (childId && !loading && !hasError) void trackEvent('alert_opened', { count })
  }, [childId, loading, hasError, count])

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        <h1 className="text-xl text-foreground mb-5">Alerts</h1>
        <p className="text-sm text-muted-foreground mb-4">Latest 20 updates · newest recorded first</p>
        <ParentChildSelector />
        <ParentFamilyContent>
          {hasError ? <ParentLoadError message="Couldn't load alerts." onRetry={() => { void matches.refetch(); void development.refetch() }} />
            : loading ? <ParentLoading />
              : alerts.length === 0 ? <div className="text-center py-12">
                <p className="text-sm text-foreground">No alerts yet</p>
                <p className="text-xs text-muted-foreground mt-1">Match updates, assessments and recognition will appear here.</p>
              </div> : <div className="divide-y divide-border">
                {alerts.map(alert => <div key={alert.id} className="py-4">
                  <p className="text-sm text-foreground">{alert.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatParentDate(alert.date)}</p>
                </div>)}
              </div>}
        </ParentFamilyContent>
        <button onClick={() => navigate('/parent/matches')} className="mt-3 min-h-11 px-4 rounded-lg border border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
          View match history
        </button>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
