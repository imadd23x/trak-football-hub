import type { ReactNode } from 'react'
import { COMING_SOON, ParkedContext } from './parked'

// TRAK-85: the pill and the wrapper for a parked route (see ./parked).
export function ComingSoonPill() {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-primary/40 bg-background/90 px-2.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur"
      style={{ fontFamily: "'DM Mono', monospace" }}>
      {COMING_SOON}
    </span>
  )
}

export function ParkedScreen({ children }: { children: ReactNode }) {
  return (
    <ParkedContext.Provider value={true}>
      <div role="note" aria-label="This screen is coming soon"
        className="pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex max-w-[430px] justify-end px-4">
        <ComingSoonPill />
      </div>
      {children}
    </ParkedContext.Provider>
  )
}
