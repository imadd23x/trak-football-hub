import { useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { IconAlerts } from '@/components/icons/TrakIcons'
import { ParentAssessmentBands, ParentLoadError, ParentLoading } from '@/components/parent/ParentFamily'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useParentDevelopment, useParentMatches } from '@/hooks/useParentData'
import { formatParentDate, parentAlerts } from '@/lib/parent-data'
import { trackEvent } from '@/lib/telemetry'

/* TRAK-74 (decision 25 Sep): the parent's alerts are a bell on Home instead of
   a tab. It counts the selected child's matches and assessments recorded since
   the list was last opened on this device, and lists them: a match opens its
   detail, an assessment shows its bands (never the coach's message, TRAK-63).
   Awards stay out while they're parked (TRAK-31). */

const time = (date: string | null) => Date.parse(date ?? '') || 0

// Per device: the newest alert this parent has seen for this child. Storage
// can be missing (private mode); then every alert simply counts as new.
function readSeen(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0 } catch { return 0 }
}
function writeSeen(key: string, value: number) {
  try { localStorage.setItem(key, String(value)) } catch { /* storage unavailable */ }
}

export function ParentAlertsBell() {
  const navigate = useNavigate()
  const { parentId, selectedChild } = useParentChildren()
  const matches = useParentMatches()
  const development = useParentDevelopment()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [, seenChanged] = useReducer((n: number) => n + 1, 0)
  if (!parentId || !selectedChild) return null

  const key = `trak:parent-alerts-seen:${parentId}:${selectedChild.id}`
  const failed = matches.isError || development.isError
  const loading = matches.isPending || development.isPending
  const alerts = failed || loading ? [] : parentAlerts(matches.data ?? [], development.data, { awards: false })
  const seen = readSeen(key)
  const unread = alerts.filter(alert => time(alert.date) > seen).length

  const toggle = (next: boolean) => {
    setOpen(next)
    setExpanded(null)
    if (!next || !alerts.length) return
    writeSeen(key, Math.max(seen, ...alerts.map(alert => time(alert.date))))
    seenChanged()
    void trackEvent('alert_opened', { count: alerts.length })
  }

  return (
    <Sheet open={open} onOpenChange={toggle}>
      <button type="button" onClick={() => toggle(true)} aria-label={unread ? `Alerts, ${unread} new` : 'Alerts'}
        className="relative w-11 h-11 rounded-xl flex items-center justify-center border border-border bg-card text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <IconAlerts size={18} color="currentColor" />
        {unread > 0 && <span aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium flex items-center justify-center">
          {unread > 9 ? '9+' : unread}
        </span>}
      </button>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Alerts</SheetTitle>
          <SheetDescription>{selectedChild.name}'s latest matches and coach assessments.</SheetDescription>
        </SheetHeader>
        {failed ? <ParentLoadError message="Couldn't load alerts." onRetry={() => { void matches.refetch(); void development.refetch() }} />
          : loading ? <ParentLoading />
            : !alerts.length ? <div className="text-center py-10">
              <p className="text-sm text-foreground">No alerts yet</p>
              <p className="text-xs text-muted-foreground mt-1">Matches and assessments will appear here.</p>
            </div>
              : <ul className="divide-y divide-border mt-2">
                {alerts.map(alert => {
                  const assessment = alert.kind === 'assessment'
                    ? development.data?.assessments.find(item => item.id === alert.targetId) : undefined
                  const isOpen = expanded === alert.id
                  return <li key={alert.id} className="py-1">
                    <button type="button" aria-expanded={assessment ? isOpen : undefined}
                      onClick={() => assessment ? setExpanded(isOpen ? null : alert.id) : navigate(`/parent/match/${alert.targetId}`)}
                      className="w-full min-h-11 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg">
                      <p className="text-sm text-foreground">{alert.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{alert.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatParentDate(alert.date)}</p>
                    </button>
                    {assessment && isOpen && <section aria-label="Assessment bands" className="pb-4">
                      <ParentAssessmentBands assessment={assessment} />
                    </section>}
                  </li>
                })}
              </ul>}
      </SheetContent>
    </Sheet>
  )
}
