import { progressLabel, type Progress } from '@/lib/objective-progress'

/* TRAK-397: the four words an objective can carry, in the colours of the TRAK-366 mockup (Not yet orange, Some progress
   blue, On track green, Met neutral). Theme tokens only, so the dark theme follows. Shared by the player and family
   season screens. */
const TONE: Record<Progress, { color: string; background: string }> = {
  not_yet: { color: 'rgb(var(--t-orange))', background: 'rgb(var(--t-orange) / 0.12)' },
  some_progress: { color: 'rgb(var(--t-info))', background: 'rgb(var(--t-info) / 0.12)' },
  on_track: { color: 'rgb(var(--t-success))', background: 'rgb(var(--t-success) / 0.12)' },
  met: { color: 'rgb(var(--t-ink))', background: 'rgb(var(--t-raised))' },
}

export function ObjectiveStatusChip({ status }: { status: Progress }) {
  return <span className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium" style={TONE[status]}>{progressLabel(status)}</span>
}
