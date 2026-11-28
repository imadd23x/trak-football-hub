import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { supabase } from '@/integrations/supabase/client'
import type { EventRow } from '@/lib/coach-events'
import { isCancelled } from '@/lib/coach-events'
import { homeTodos, upcomingSteps, type HomeMatch, type HomeReport, type HomeTodo, type HomeTraining } from '@/lib/home-todos'
import { useGamePlanChanges, useGamePlans, useGameShares } from '@/components/coach/games/useGames'
import { usePlannedTrainings } from '@/components/coach/training/useTraining'
import { useAcademyTimeZone } from '@/components/coach/season-plan/useWatching'
import { useOwnTodos } from './useOwnTodos'
import { dayIn } from '@/lib/watch-first'
import { offersEventTodo } from '@/components/coach/EventTodo'

/* TRAK-608 (New Home 2/8): what homeTodos() (TRAK-607) reads, from the records Home already asks for. The coach's events
   from 9 days back (a register is owed 48 h, an evaluation 7 days) to 8 days ahead (the next training or match on a day
   with no events), each event's register and its Notes with when they were saved, and each match's evaluation. */

const DAY = 24 * 60 * 60_000

export type HomeTodoEvent = { todo: HomeTodo; row: EventRow | null }

/** TRAK-611: an event in Upcoming (tomorrow to 7 days ahead), with its next missing step, or null when nothing is. */
export type UpcomingEvent = { row: EventRow; step: HomeTodoEvent | null }
/** TRAK-625: an "Other" event for Upcoming, and whether it's today at the academy. */
export type UpcomingOther = { row: EventRow; today: boolean }

/** Today's trainings and matches in view, for the greeting's line; and whether yesterday had a match. */
export type HomeDay = { trainings: EventRow[]; matches: EventRow[]; matchYesterday: boolean; now: number; today: string }

/** The coach's To-do, each with its event's row (for its buttons), or null until the reads answer. */
export function useHomeTodos({ coachId, inView, reports, trainingOn, gamesOn }: {
  coachId: string | undefined
  inView: (squad: string | null) => boolean
  reports: HomeReport[]
  trainingOn: boolean
  gamesOn: boolean
}): { items: HomeTodoEvent[] | null; upcoming: HomeTodoEvent[] | null; week: UpcomingEvent[] | null; others: UpcomingOther[] | null; day: HomeDay | null; failed: boolean; retry: () => void; refresh: () => void } {
  const records = useQuery({
    queryKey: ['coach', coachId, 'home-todos', gamesOn, trainingOn],
    enabled: !!coachId,
    queryFn: async () => {
      const from = format(addDays(new Date(), -9), 'yyyy-MM-dd'), to = format(addDays(new Date(), 8), 'yyyy-MM-dd')
      const events = await supabase.from('coach_calendar_events').select('*')
        .eq('coach_user_id', coachId!).gte('event_date', from).lte('event_date', to).order('starts_at')
      if (events.error) throw events.error
      const rows = (events.data ?? []) as EventRow[]
      const ids = rows.map(row => row.id)
      const matchIds = rows.filter(row => row.event_type === 'match').map(row => row.id)
      const trainingIds = rows.filter(row => row.event_type === 'training').map(row => row.id)
      // The register taken is the event's completed session (TRAK-138).
      const sessions = ids.length
        ? await supabase.from('coach_sessions').select('event_id, created_at').eq('coach_user_id', coachId!).in('event_id', ids) : null
      if (sessions?.error) throw sessions.error
      const notes = trainingOn && trainingIds.length
        ? await supabase.from('training_notes').select('event_id, created_at').in('event_id', trainingIds) : null
      if (notes?.error) throw notes.error
      // The database returns only the coach's own evaluations.
      const evaluations = gamesOn && matchIds.length
        ? await supabase.from('game_evaluations').select('event_id, saved_at, published_at, remind_at').in('event_id', matchIds) : null
      if (evaluations?.error) throw evaluations.error
      return {
        rows,
        registered: new Map((sessions?.data ?? []).flatMap(s => s.event_id ? [[s.event_id, s.created_at ?? new Date(0).toISOString()] as const] : [])),
        noted: new Map((notes?.data ?? []).map(n => [n.event_id, n.created_at] as const)),
        evaluations: new Map((evaluations?.data ?? []).map(e => [e.event_id, e] as const)),
      }
    },
  })
  const planned = usePlannedTrainings(trainingOn)
  const plans = useGamePlans(gamesOn)
  const shares = useGameShares(gamesOn)
  const zone = useAcademyTimeZone(coachId)
  // TRAK-612: the coach's own. Never waited for: Trak's to-dos show first, and a failed read only leaves them out.
  const own = useOwnTodos(coachId)
  const [now, setNow] = useState(() => Date.now())

  // Changes since sharing, for the matches today and ahead that are shared (TRAK-286).
  const sharedIds = useMemo(() => (records.data?.rows ?? [])
    .filter(row => row.event_type === 'match' && shares.data?.has(row.id) && Date.parse(row.starts_at ?? '') > now - DAY).map(row => row.id),
  [records.data, shares.data, now])
  const changes = useGamePlanChanges(sharedIds, gamesOn)

  // Wait only for what this coach's events need: no trainings, no plans to ask about; no matches, no shares.
  const rows = records.data?.rows ?? []
  const anyTraining = trainingOn && rows.some(row => row.event_type === 'training')
  const anyMatch = gamesOn && rows.some(row => row.event_type === 'match')
  const waiting = records.isPending || zone.isPending || (anyTraining && planned.isPending)
    || (anyMatch && (plans.isPending || shares.isPending || (sharedIds.length > 0 && changes.isPending)))
  const failed = records.isError || (anyTraining && planned.isError) || (anyMatch && (plans.isError || shares.isError))

  const worked = useMemo(() => {
    if (!records.data || waiting) return null
    const { rows, registered, noted, evaluations } = records.data
    const byId = new Map(rows.map(row => [row.id, row]))
    const base = (row: EventRow) => ({ id: row.id, squad: row.squad ?? null, starts_at: row.starts_at!, ends_at: row.ends_at ?? null,
      published: !!row.published, cancelled: isCancelled(row) })
    const trainings: HomeTraining[] = rows.filter(row => row.event_type === 'training' && row.starts_at).map(row => ({
      ...base(row), start_time: row.start_time ?? null, planned: !!planned.data?.has(row.id),
      registeredAt: registered.get(row.id) ?? null, notedAt: noted.get(row.id) ?? null,
    }))
    const matches: HomeMatch[] = !gamesOn ? [] : rows.filter(row => row.event_type === 'match' && row.starts_at).map(row => {
      const evaluation = evaluations.get(row.id)
      return {
        ...base(row),
        plan: { drafted: !!plans.data?.has(row.id), shared: !!shares.data?.has(row.id), sharedAt: shares.data?.get(row.id), changes: changes.data?.get(row.id)?.length ?? 0 },
        evaluatedAt: evaluation?.saved_at ?? null, publishedAt: evaluation?.published_at ?? null, remindAt: evaluation?.remind_at ?? null,
      }
    })
    const withRow = (todo: HomeTodo) => ({ todo, row: todo.eventId ? byId.get(todo.eventId) ?? null : null })
    // TRAK-610: what's still missing this week, for the first suggestion.
    const upcoming = upcomingSteps({ trainings, matches, now, zone: zone.zone, inView, training: trainingOn }).map(withRow)
    // TRAK-611: Upcoming lists every training and match from tomorrow to 7 days ahead, each with its missing step.
    const stepOf = new Map(upcoming.map(item => [item.todo.eventId, item]))
    const today = dayIn(zone.zone, new Date(now))
    const week: UpcomingEvent[] = rows
      .filter(row => (row.event_type === 'training' || (gamesOn && row.event_type === 'match')) && row.starts_at && !isCancelled(row)
        && inView(row.squad ?? null) && dayIn(zone.zone, new Date(row.starts_at)) > today && Date.parse(row.starts_at) <= now + 7 * DAY)
      .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))
      .map(row => ({ row, step: stepOf.get(row.id) ?? null }))
    // TRAK-625: Upcoming's Other card, Makis's gentle reminder: the coach's "Other" events from today to 7 days ahead
    // that can still go into the To-do (not cancelled, not over), each with Add to To-do or In To-do.
    const others = rows
      .filter(row => row.event_type === 'other' && inView(row.squad ?? null) && Date.parse(row.starts_at) <= now + 7 * DAY
        && offersEventTodo(row, coachId, zone.zone, now))
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map(row => ({ row, today: (row.event_date || dayIn(zone.zone, new Date(row.starts_at))) === today }))
    return {
      others,
      items: homeTodos({ trainings, matches, reports, own: own.data ?? [], now, zone: zone.zone, inView, training: trainingOn }).map(withRow),
      upcoming, week,
    }
  }, [own.data, records.data, waiting, planned.data, plans.data, shares.data, changes.data, reports, now, zone.zone, inView, trainingOn, gamesOn])

  const items = worked?.items ?? null
  const upcoming = worked?.upcoming ?? null
  const week = worked?.week ?? null
  const others = worked?.others ?? null

  // The clock moves Home on by itself: at the next time a button opens or a to-do leaves (a match's plan at kick-off,
  // TRAK-287), and at least once a minute.
  const nextChange = useMemo(() => Math.min(...(items ?? []).flatMap(({ todo }) => [todo.opensAt, todo.leavesAt])
    .filter((at): at is number => at !== null && at > now)), [items, now])
  useEffect(() => {
    const wait = Math.min(60_000, Math.max(1_000, (Number.isFinite(nextChange) ? nextChange : Infinity) - Date.now() + 250))
    const timer = setTimeout(() => setNow(Date.now()), wait)
    return () => clearTimeout(timer)
  }, [now, nextChange])

  const day = useMemo((): HomeDay | null => {
    if (!records.data) return null
    const live = records.data.rows.filter(row => !isCancelled(row) && row.starts_at && inView(row.squad ?? null))
    const today = dayIn(zone.zone, new Date(now)), yesterday = dayIn(zone.zone, new Date(now - DAY))
    const on = (row: EventRow, date: string) => dayIn(zone.zone, new Date(row.starts_at!)) === date
    return {
      trainings: live.filter(row => row.event_type === 'training' && on(row, today)),
      matches: live.filter(row => row.event_type === 'match' && on(row, today)),
      matchYesterday: live.some(row => row.event_type === 'match' && row.published && on(row, yesterday)),
      now, today,
    }
  }, [records.data, inView, zone.zone, now])

  return {
    items, upcoming, week, others, day, failed,
    retry: () => { void records.refetch(); void planned.refetch(); void plans.refetch(); void shares.refetch() },
    refresh: () => { void records.refetch() },
  }
}
