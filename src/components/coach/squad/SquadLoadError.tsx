import { WifiOff } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

/** A failed squad read: said as a failure with a way to retry, never shown as an empty squad. */
export function SquadLoadError({ onRetry, title }: { onRetry: () => void; title?: string }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-center text-center pt-14 px-6">
      <div
        className="w-14 h-14 rounded-[16px] flex items-center justify-center mb-4"
        style={{ background: 'rgb(var(--t-warning) / 0.08)', border: '1px solid rgb(var(--t-warning) / 0.15)' }}
      >
        <WifiOff size={22} className="text-warning" strokeWidth={1.5} />
      </div>
      <p className="text-[15px] text-ink-2 font-medium mb-1">{title ?? t('coachSquad:couldntLoadSquad')}</p>
      <p className="text-[12px] text-ink-3 leading-relaxed mb-5">
        {navigator.onLine
          ? t('coachSquad:reachFailed')
          : t('coachSquad:offlineSafe')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-2.5 rounded-[10px] text-[13px] font-medium text-on-brand"
        style={{ background: 'rgb(var(--t-brand))' }}
      >
        {t('coachSquad:tryAgain')}
      </button>
    </div>
  )
}
