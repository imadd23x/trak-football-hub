import { Badge } from '@/components/arc/badge/badge'
import { useTranslation } from '@/lib/i18n'

/* TRAK-355: the set-up steps' Watch first, as the sheets show it: "Watch first", or "Keep watching" for a player
   already watched, which restarts their clock. And the badge a watched player's row wears: Watching, or Ready once
   their reminder is due. */

export type WatchAction = { label: 'Watch first' | 'Keep watching'; onWatch: () => void; pending: boolean }

export function WatchBadge({ watch }: { watch: { ready: boolean } | undefined }) {
  const { t } = useTranslation()
  if (!watch) return null
  return watch.ready ? <Badge tone="warning" size="sm">{t('coachSquad:watchReady')}</Badge> : <Badge tone="neutral" size="sm">{t('coachSquad:watchWatching')}</Badge>
}
