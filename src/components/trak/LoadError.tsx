import { WifiOff, RefreshCw } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

/**
 * Shown when a query failed — never when it succeeded and returned nothing.
 *
 * The distinction matters: every player screen used to discard the error from
 * its Supabase call, so a failed read fell through to the same "no matches
 * yet" copy as a genuinely empty season. A player on a bad connection was told
 * their record did not exist.
 */
export function LoadError({
  what,
  onRetry,
  retrying = false,
}: {
  what?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  const { t } = useTranslation()
  // TRAK-407: `what` arrives in the language showing, as the thing being loaded (Greek: in the accusative).
  const named = what ?? t('common:loadThis')
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div
      className="rounded-[18px] p-5 border text-center"
      style={{ borderColor: 'rgb(var(--t-line))', background: 'rgb(var(--t-raised))' }}
      role="alert"
    >
      <WifiOff size={20} className="mx-auto text-ink-3" />
      <p className="mt-3 text-[13px] text-ink-2">
        {offline ? t('common:offline') : t('common:couldntConnect')}
      </p>
      <p className="mt-1 text-[11px] text-ink-3 leading-relaxed">
        {offline
          ? t('common:loadOffline', { what: named })
          : t('common:loadFailed', { what: named })}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-[12px] text-ink-2 border border-line active:bg-raised disabled:opacity-40"
          style={{ fontFamily: 'var(--t-font-mono)' }}
        >
          <RefreshCw size={13} className={retrying ? 'animate-spin' : undefined} />
          {retrying ? t('common:retrying') : t('common:retry')}
        </button>
      )}
    </div>
  )
}
