import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { coachWeek, type WeekItem } from '@/lib/coach-week'
import { loadWeek } from '@/lib/coach-week-load'

/** How far back Needs you looks for an event still waiting. ponytail: two weeks; widen if older ones go missing. */
const DAYS = 14

/**
 * Imad, 24 Oct: the week marked an event "Needs you" (a register or a match log owed) but Home's Needs you listed only
 * players. These are the events of the last two weeks still waiting, by the week's own rule (coachWeek), oldest first.
 */
export function useOwedEvents(coachId: string | undefined, inView: (squad: string | null | undefined) => boolean, enabled: boolean, games = false) {
  const read = useQuery({
    queryKey: ['coach', coachId, 'owed-events', games],
    enabled: !!coachId && enabled,
    queryFn: async () => {
      const today = new Date()
      const dates = Array.from({ length: DAYS }, (_, i) => format(addDays(today, i - (DAYS - 1)), 'yyyy-MM-dd'))
      return { dates, ...(await loadWeek(coachId!, dates[0], dates[DAYS - 1], games)) }
    },
  })
  const items = useMemo<WeekItem[] | null>(() => read.data
    ? [...coachWeek({ ...read.data, inView }).values()].flat().filter(item => item.state === 'needs-you')
    : null, [read.data, inView])
  return { items, failed: read.isError, retry: () => { void read.refetch() } }
}
