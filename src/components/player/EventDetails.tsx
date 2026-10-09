import { eventDay, eventHeading, eventTime, type PlayerEvent } from '@/lib/player-events'

/**
 * Every detail of one event (TRAK-130), shared by the player's and the
 * parent's event pages (TRAK-131) so both show exactly the same thing.
 * Cancelled stays visible, with the coach's reason.
 */
export function EventDetails({ event: e }: { event: PlayerEvent }) {
  const cancelled = e.status === 'cancelled'
  const rows: [string, string][] = [
    ['Date', eventDay(e)],
    ['Time', eventTime(e)],
    ...(e.meetTime ? [['Meet', e.meetTime] as [string, string]] : []),
    ...(e.venue ? [['Venue', e.venue] as [string, string]] : []),
    ...(e.kind === 'match' && e.homeAway ? [['Home or away', e.homeAway === 'home' ? 'Home' : 'Away'] as [string, string]] : []),
    ...(e.kind === 'match' && e.kit ? [['Kit', e.kit] as [string, string]] : []),
  ]
  return (
    <div className="space-y-4">
      <h1 className={`text-[22px] font-medium ${cancelled ? 'line-through text-white/50' : 'text-white/90'}`}>{eventHeading(e)}</h1>
      {cancelled && (
        <div className="rounded-[14px] px-4 py-3" style={{ border: '1px solid hsl(var(--destructive) / 0.5)' }}>
          <p className="text-[13px] font-semibold text-destructive">This event is cancelled.</p>
          {e.cancelReason && <p className="text-[13px] text-white/70 mt-1">{e.cancelReason}</p>}
        </div>
      )}
      <ul aria-label="Event details" className="rounded-[18px] divide-y divide-white/[0.06]"
        style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)' }}>
        {rows.map(([label, value]) => (
          <li key={label} className="flex justify-between gap-4 px-4 py-3 text-[13px]">
            <span className="text-white/45">{label}</span>
            <span className="text-white/85 text-right">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
