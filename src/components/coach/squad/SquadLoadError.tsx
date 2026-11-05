import { WifiOff } from 'lucide-react'

/** A failed squad read: said as a failure with a way to retry, never shown as an empty squad. */
export function SquadLoadError({ onRetry, title = "Couldn't load your squad" }: { onRetry: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center pt-14 px-6">
      <div
        className="w-14 h-14 rounded-[16px] flex items-center justify-center mb-4"
        style={{ background: 'rgb(var(--t-warning) / 0.08)', border: '1px solid rgb(var(--t-warning) / 0.15)' }}
      >
        <WifiOff size={22} className="text-warning" strokeWidth={1.5} />
      </div>
      <p className="text-[15px] text-ink-2 font-medium mb-1">{title}</p>
      <p className="text-[12px] text-ink-3 leading-relaxed mb-5">
        {navigator.onLine
          ? "We couldn't reach Trak just now. Nothing has been lost — your squad is safe."
          : 'You appear to be offline. Nothing has been lost — your squad is safe.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-2.5 rounded-[10px] text-[13px] font-medium text-on-brand"
        style={{ background: 'rgb(var(--t-brand))' }}
      >
        Try again
      </button>
    </div>
  )
}
