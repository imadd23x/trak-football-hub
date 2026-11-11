import { currentLanguage, i18n } from '@/lib/i18n'

/* TRAK-250: small pure helpers the Squad tabs share. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `2026-10-17` -> `17 Oct`. Not locale-formatted, so it reads the same on every device. */
export const dayMonth = (iso: string) => {
  const [y, m, d] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))]
  // TRAK-407: another language names the month itself; English is as it was.
  if (currentLanguage() !== 'en') return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(currentLanguage(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${d} ${MONTHS[m - 1]}`
}

/** `2026-10-24` -> `Sat 24 Oct`, from the calendar date itself so no time zone can move the day. */
export function weekdayDayMonth(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return ''
  if (currentLanguage() !== 'en') return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(currentLanguage(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

/** `2012-02-26` on 22 Oct 2026 -> `26/2/2012 · 14 years old` (Imad's format). The age turns on the birthday itself. */
export function bornLine(born: string, today: Date) {
  const [y, m, d] = born.split('-').map(Number)
  const month = today.getMonth() + 1
  const age = today.getFullYear() - y - (month < m || (month === m && today.getDate() < d) ? 1 : 0)
  return i18n.t('coachSquad:bornLine', { date: `${d}/${m}/${y}`, count: age })
}

/** PostgREST value quoting for an `or=` filter, so a squad name with a comma or bracket cannot change the filter. */
export const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
