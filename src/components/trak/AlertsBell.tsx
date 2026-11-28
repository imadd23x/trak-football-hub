import { useReducer, type ReactNode } from 'react'
import { NotificationCenter, type NotificationItem } from '@/components/arc/notification-center/notification-center'
import { alertKey, dismissAlert, isAlertRead, readBellState, relativeLabel, setAlertRead } from '@/lib/alert-read-state'

export interface BellAlert {
  id: string
  title: string
  description: string
  /** When it was recorded or last changed. */
  date: string | null
  tone?: NotificationItem['tone']
  details?: ReactNode
  action?: NotificationItem['action']
  /** TRAK-530: already read elsewhere on this device (a report opened from Home). */
  read?: boolean
  /** TRAK-603: read once the bell has been opened and closed (an announcement); other alerts wait to be marked read. */
  readOnClose?: boolean
}

/**
 * TRAK-163: the bell at the top right of parent and player Home: Arc's
 * notification center, working as Arc designed it (Imad, 12 Oct). The badge
 * counts unread alerts; an alert is read once marked read (or "Mark all
 * read"), and a dismissed one is gone. Both are remembered on this device.
 * Alerts read under the old bell (TRAK-74's seen time) stay read.
 * `storageKey` null means the person isn't known yet: no bell.
 */
export function AlertsBell({ alerts, storageKey, notice, onOpen }: {
  alerts: BellAlert[]
  storageKey: string | null
  /** Loading or a failed read; the list is then empty, not "All clear". */
  notice?: ReactNode
  onOpen?: () => void
}) {
  const [, stored] = useReducer((n: number) => n + 1, 0)
  if (!storageKey) return null
  const state = readBellState(storageKey)
  const shown = alerts.filter(alert => !state.dismissed.has(alertKey(alert)))
  const byId = new Map(shown.map(alert => [alert.id, alert]))
  const items: NotificationItem[] = shown.map(alert => ({
    id: alert.id,
    title: alert.title,
    description: alert.description,
    time: relativeLabel(alert.date),
    read: alert.read || isAlertRead(alert, state),
    tone: alert.tone,
    details: alert.details,
    action: alert.action,
  }))

  return (
    <div className="arc">
      <NotificationCenter label="Alerts" notifications={items} notice={notice}
        onOpenChange={open => {
          if (open) { onOpen?.(); return }
          const seen = shown.filter(alert => alert.readOnClose && !isAlertRead(alert, state))
          seen.forEach(alert => setAlertRead(storageKey, alert, true))
          if (seen.length) stored()
        }}
        onReadChange={(item, read) => { const alert = byId.get(item.id); if (alert) { setAlertRead(storageKey, alert, read); stored() } }}
        onDismiss={item => { const alert = byId.get(item.id); if (alert) { dismissAlert(storageKey, alert); stored() } }} />
    </div>
  )
}
