import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentDevelopment, useParentMatches } from '@/hooks/useParentData'
import { formatParentDate, parentAlerts } from '@/lib/parent-data'
import { trackEvent } from '@/lib/telemetry'

export default function ParentAlerts() {
  const navigate = useNavigate()
  const location = useLocation()
  const { selectedChild } = useParentChildren()
  const matches = useParentMatches()
  const development = useParentDevelopment()
  const hasError = matches.isError || development.isError
  const loading = matches.isPending || development.isPending
  const alerts = parentAlerts(matches.data ?? [], development.data)
  const childId = selectedChild?.id
  const count = alerts.length
  useEffect(() => {
    if (childId && !loading && !hasError) void trackEvent('alert_opened', { count })
  }, [childId, loading, hasError, count])

  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        <h1 className="text-xl text-foreground mb-5">Alerts</h1>
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
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
