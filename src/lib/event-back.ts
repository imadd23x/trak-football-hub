import { useLocation, useNavigate } from 'react-router-dom'

/**
 * TRAK-182 (live run 3, 16 Oct): the family event page's Back returns where the
 * page was opened from, in one step (Home's event sheet passes `from`). Opened
 * any other way (a shared link, the bell), it goes to `list`, as before.
 */
const LABEL: Record<string, string> = {
  '/player/home': 'Home', '/player/matches': 'Sessions', '/player/trainings': 'Trainings',
  '/parent/home': 'Home', '/parent/matches': 'Events',
}

export function useEventBack(list: string) {
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  return from && LABEL[from]
    ? { label: LABEL[from], href: from, go: () => navigate(-1) }
    : { label: LABEL[list], href: list, go: () => navigate(list) }
}
