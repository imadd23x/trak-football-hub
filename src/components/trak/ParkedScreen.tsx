import type { ReactNode } from 'react'
import { COMING_SOON, ParkedContext, useFeature, type Feature } from './parked'

// TRAK-85: the pill and the wrapper for a parked route (see ./parked).
export function ComingSoonPill() {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-primary/40 bg-background/90 px-2.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur"
      style={{ fontFamily: "'DM Mono', monospace" }}>
      {COMING_SOON}
    </span>
  )
}

// `unless`: the screen shows plainly once that feature is switched on for the
// caller's academy (TRAK-124). Same tree either way, so the screen isn't
// remounted when the answer arrives.
export function ParkedScreen({ children, unless }: { children: ReactNode; unless?: Feature }) {
  const parked = !useFeature(unless)
  return (
    <ParkedContext.Provider value={parked}>
      {parked && (
        <div role="note" aria-label="This screen is coming soon"
          className="pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex max-w-[430px] justify-end px-4">
          <ComingSoonPill />
        </div>
      )}
      {children}
    </ParkedContext.Provider>
  )
}
