import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { HomeOwnTodo } from '@/lib/home-todos'

/* TRAK-612 (New Home 6/8): the coach's own to-dos (coach_todos; only they read or write them). Home reads the ones not
   ticked and the ones ticked in the last two days (a ticked one stays until the academy's midnight). */

const DAY = 24 * 60 * 60_000
const key = (coachId: string | undefined) => ['coach', coachId, 'own-todos']

export function useOwnTodos(coachId: string | undefined) {
  return useQuery({
    queryKey: key(coachId),
    enabled: !!coachId,
    queryFn: async (): Promise<HomeOwnTodo[]> => {
      const since = new Date(Date.now() - 2 * DAY).toISOString()
      const { data, error } = await supabase.from('coach_todos').select('id, title, due_on, urgent, done_at, created_at, calendar_event_id')
        // A value with ':' or '.' is quoted inside or(), as PostgREST asks.
        .or(`done_at.is.null,done_at.gte."${since}"`).order('created_at')
      if (error) throw error
      return (data ?? []).map(row => ({ id: row.id, title: row.title, dueOn: row.due_on, urgent: row.urgent, doneAt: row.done_at, createdAt: row.created_at,
        // TRAK-622: the event it's for, when it was added from one.
        eventId: row.calendar_event_id ?? null }))
    },
  })
}

/** Adds a to-do for an academy day (YYYY-MM-DD). Linked to an event, it fails with 23505 while that event has one open. */
export function useAddTodo() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    /** `eventId` (TRAK-622): the coach's own event it's for, from Add to To-do. */
    mutationFn: async ({ title, dueOn, urgent, eventId }: { title: string; dueOn: string; urgent: boolean; eventId?: string }) => {
      const { error } = await supabase.from('coach_todos').insert({ title: title.trim(), due_on: dueOn, urgent, ...(eventId && { calendar_event_id: eventId }) })
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(user?.id) }),
  })
}

/** Ticks a to-do. */
export function useTickTodo() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coach_todos').update({ done_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(user?.id) }),
  })
}

/** TRAK-613: marks one of the coach's own to-dos urgent, or not. */
export function useSetUrgent() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, urgent }: { id: string; urgent: boolean }) => {
      const { error } = await supabase.from('coach_todos').update({ urgent }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(user?.id) }),
  })
}

/** TRAK-613: removes one of the coach's own to-dos. */
export function useRemoveTodo() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coach_todos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(user?.id) }),
  })
}
