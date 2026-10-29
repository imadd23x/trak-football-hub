import { addDays, format, parseISO } from 'date-fns'
import { supabase } from '@/integrations/supabase/client'
import type { EventRow } from '@/lib/coach-events'
import type { WeekSession } from '@/lib/coach-week'

/** Coach Home's week (TRAK-262) and Needs you (Imad, 24 Oct): the coach's events and logged sessions between two days.
 *  TRAK-288: where Games is on, also which of the matches have an evaluation draft (null where it's off). */
export async function loadWeek(coachId: string, from: string, to: string, games = false): Promise<{
  events: EventRow[]; sessions: WeekSession[]; evaluated: Set<string> | null; published: Set<string>
}> {
  // Every squad's events: a draft's clash counts them all, as the database does (TRAK-218). A day either side, as a
  // late or early event can fall in this week on this phone's clock (Imad, 23 Oct); the week keeps only its own days.
  const day = (date: string, by: number) => format(addDays(parseISO(date), by), 'yyyy-MM-dd')
  const events = await supabase.from('coach_calendar_events').select('*')
    .eq('coach_user_id', coachId).gte('event_date', day(from, -1)).lte('event_date', day(to, 1))
    .order('event_date', { ascending: true })
  if (events.error) throw events.error
  // A date correction can move a completed session to another week; its old calendar entry stays hidden.
  // IDs are UUID columns from the coach's event rows, never free text.
  const eventIds = (events.data ?? []).map(event => event.id)
  const thisWeek = `and(session_date.gte.${from},session_date.lte.${to})`
  const sessions = await supabase.from('coach_sessions').select('id, event_id, title, session_type, session_date, venue, squad')
    .eq('coach_user_id', coachId)
    .or(eventIds.length ? `${thisWeek},event_id.in.(${eventIds.join(',')})` : thisWeek)
    .order('session_date', { ascending: true })
  if (sessions.error) throw sessions.error
  // The database returns only the coach's own evaluations.
  const matchIds = (events.data ?? []).filter(event => event.event_type === 'match').map(event => event.id)
  const evaluations = games && matchIds.length
    ? await supabase.from('game_evaluations').select('event_id, published_at').in('event_id', matchIds) : null
  if (evaluations?.error) throw evaluations.error
  const rows = evaluations?.data ?? []
  return {
    events: (events.data ?? []) as EventRow[], sessions: (sessions.data ?? []) as WeekSession[],
    evaluated: games ? new Set(rows.filter(row => !row.published_at).map(row => row.event_id)) : null,
    // TRAK-289: published, the loop is closed.
    published: new Set(rows.filter(row => row.published_at).map(row => row.event_id)),
  }
}
