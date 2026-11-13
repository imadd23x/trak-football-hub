import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

/**
 * TRAK-163 (Imad, 12 Oct): the top of every Home. Calendar on the left, the
 * person's name in the middle (the parent's child switcher), the bell on the
 * right. The coach's bell says who can't make it (TRAK-232).
 */
export function HomeHeader({ calendarTo, center, right, left }: { calendarTo: string; center: ReactNode; right?: ReactNode; left?: ReactNode }) {
  // TRAK-259: a coach's phone has the avatar on the left and the calendar beside the bell.
  const coach = left !== undefined
  const { t } = useTranslation()
  return (
    <header className={`grid ${coach ? 'grid-cols-[1fr_minmax(0,auto)_1fr]' : 'grid-cols-[44px_minmax(0,1fr)_44px]'} items-center gap-2 mb-3`}>
      <div className="flex">{coach ? left : <CalendarLink to={calendarTo} />}</div>
      <div className="min-w-0 flex justify-center">{center}</div>
      {/* TRAK-255: the coach's is called Events (TRAK-449); players' and parents' stay Calendar. */}
      <div className="flex justify-end gap-2">{coach && <CalendarLink to={calendarTo} label={t('nav:events')} />}{right}</div>
    </header>
  )
}

// TRAK-415: Trak's own colour names (line, ink) here and in HomeTitle: inside `.arc` (the coach's frame on a phone too)
// --border and --foreground are Arc's, which Tailwind's border-border and text-foreground can't read.
function CalendarLink({ to, label }: { to: string; label?: string }) {
  const { t } = useTranslation()
  return <Link to={to} aria-label={label ?? t('common:calendar')}
    className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center border border-line bg-card text-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <CalendarDays size={19} strokeWidth={1.75} aria-hidden="true" />
  </Link>
}

export function HomeTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="truncate text-[19px] font-semibold text-ink/90"
      style={{ fontFamily: 'var(--t-font)', letterSpacing: '-0.02em' }}>
      {children}
    </h1>
  )
}
