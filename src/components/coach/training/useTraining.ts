import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useFeature } from '@/components/trak/parked'
import type { Json, Tables } from '@/integrations/supabase/types'
import { WEEK, cleanDrill, trainingEnd, type Drill, type DrillDraft } from '@/lib/training/sessions'
import type { SavedPractice } from '@/lib/training/plans'
import { toSave, type MyDrill, type Part } from '@/lib/training/parts'
import type { Again } from '@/lib/training/next'

/* TRAK-294 (Training 1/5): the coach's own trainings for Training home, not cancelled (a published event is cancelled,
   never deleted), from a week ago on; and the coach's own drills (coach_drills, only they read them).
   TRAK-295 (Training 2/5): one training, its plan, which trainings are planned, and saving a plan whole.
   TRAK-297 (Training 4/5): every planned session, to copy. Nothing new is stored: a past session is its plan.
   TRAK-298 (Training 5/5): which trainings have their register taken (the loop's Who's here and Close).
   TRAK-339 (Training redo 1/5, spec TRAK-338): each training's Notes, how many came, every past training, and the
   message to families the card shows from Logistics. */

export type Training = Pick<Tables<'coach_calendar_events'>, 'id' | 'squad' | 'title' | 'published' | 'status' | 'starts_at'
  | 'ends_at' | 'event_date' | 'start_time' | 'venue' | 'family_note'>

const TRAINING_COLUMNS = 'id, squad, title, published, status, starts_at, ends_at, event_date, start_time, venue, family_note'

export function useTrainings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'trainings'],
    enabled: !!user,
    queryFn: async (): Promise<Training[]> => {
      // A training a week and a day ago can still have ended inside the last seven days (one with no time lasts all day).
      const from = new Date(Date.now() - WEEK - 24 * 60 * 60_000).toISOString()
      const { data, error } = await supabase.from('coach_calendar_events')
        .select(TRAINING_COLUMNS)
        .eq('coach_user_id', user!.id).eq('event_type', 'training').neq('status', 'cancelled').gte('starts_at', from)
        .order('starts_at')
      if (error) throw error
      return data ?? []
    },
  })
}

/** One of the coach's trainings, cancelled or not, or null when it isn't theirs or isn't a training. */
export function useTraining(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training', eventId],
    enabled: !!user && !!eventId,
    queryFn: async (): Promise<Training | null> => {
      const { data, error } = await supabase.from('coach_calendar_events').select(TRAINING_COLUMNS)
        .eq('id', eventId!).eq('coach_user_id', user!.id).eq('event_type', 'training').maybeSingle()
      if (error) throw error
      return data
    },
  })
}

const PRACTICE_COLUMNS = 'position, name, minutes, how, tell, area, numbers, direction, targets, conditions, source, drill_id, library_session, part, part_type, trak_drill, players_kind, group_size'
export type Plan = { updatedAt: string; note: string; practices: SavedPractice[] }

/** A training's plan, or null before its first save. Only its coach reads it (the database's rule). */
export function usePlan(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-plan', eventId],
    enabled: !!user && !!eventId,
    queryFn: async (): Promise<Plan | null> => {
      const plan = await supabase.from('training_plans').select('updated_at, note').eq('event_id', eventId!).maybeSingle()
      if (plan.error) throw plan.error
      if (!plan.data) return null
      const practices = await supabase.from('training_plan_practices').select(PRACTICE_COLUMNS)
        .eq('event_id', eventId!).order('position')
      if (practices.error) throw practices.error
      return { updatedAt: plan.data.updated_at, note: plan.data.note, practices: practices.data ?? [] }
    },
  })
}

/** The trainings the coach has planned. The database returns only their own plans. */
export function usePlannedTrainings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-plans'],
    enabled: !!user,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.from('training_plans').select('event_id')
      if (error) throw error
      return new Set((data ?? []).map(plan => plan.event_id))
    },
  })
}

/** The coach's trainings whose register is taken, to the completed session it made (one per event, TRAK-138). */
export function useRegisters() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-registers'],
    enabled: !!user,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.from('coach_sessions').select('id, event_id')
        .eq('coach_user_id', user!.id).not('event_id', 'is', null)
      if (error) throw error
      return new Map((data ?? []).flatMap(row => row.event_id ? [[row.event_id, row.id] as const] : []))
    },
  })
}

export type PastSession = Training & { practices: SavedPractice[] }

/** Every training the coach has planned, with its practices, newest first. The database returns only their own. */
export function usePastSessions(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'past-sessions'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<PastSession[]> => {
      const plans = await supabase.from('training_plans').select('event_id')
      if (plans.error) throw plans.error
      const ids = (plans.data ?? []).map(plan => plan.event_id)
      if (!ids.length) return []
      const [events, practices] = await Promise.all([
        supabase.from('coach_calendar_events').select(TRAINING_COLUMNS).eq('coach_user_id', user!.id).in('id', ids),
        supabase.from('training_plan_practices').select(`event_id, ${PRACTICE_COLUMNS}`).in('event_id', ids).order('position'),
      ])
      if (events.error) throw events.error
      if (practices.error) throw practices.error
      return (events.data ?? []).map(event => ({
        ...event,
        practices: (practices.data ?? []).filter(p => p.event_id === event.id).map(({ event_id: _e, ...p }) => p),
      })).filter(session => session.practices.length > 0)
        .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
    },
  })
}

/** Saves the whole plan in one go (save_training_plan: every part or none), with the coach's note. The training's
 *  draft goes with it (TRAK-340). */
export function useSavePlan(eventId: string) {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ parts, note }: { parts: Part[]; note: string }) => {
      const { error } = await supabase.rpc('save_training_plan', { p_event_id: eventId, p_practices: toSave(parts), p_note: note.trim() })
      if (error) throw error
    },
    onSuccess: () => Promise.all(['training-plan', 'training-plans', 'past-sessions', 'past-trainings', 'drills', 'training-drafts']
      .map(key => client.invalidateQueries({ queryKey: key === 'training-plan' ? ['coach', user?.id, key, eventId] : ['coach', user?.id, key] }))),
  })
}

/* ── TRAK-340: drafts ─────────────────────────────────────────────────── */

export type Draft = { step: number; parts: Part[]; note: string; updatedAt: string }

const asDraft = (row: { step: number; body: Json; updated_at: string }): Draft | null => {
  const body = row.body as { parts?: Part[]; note?: string } | null
  return Array.isArray(body?.parts) ? { step: row.step, parts: body!.parts!, note: body!.note ?? '', updatedAt: row.updated_at } : null
}

/** The trainings the coach has a draft for, with where they stopped. Only their own. */
export function useDrafts() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-drafts'],
    enabled: !!user,
    queryFn: async (): Promise<Map<string, Draft>> => {
      const { data, error } = await supabase.from('training_plan_drafts').select('event_id, step, body, updated_at')
      if (error) throw error
      return new Map((data ?? []).flatMap(row => { const draft = asDraft(row); return draft ? [[row.event_id, draft] as const] : [] }))
    },
  })
}

/** Keeps the planner as it is, to carry on later. Only the coach sees it; it never counts as planned. */
export function useSaveDraft(eventId: string) {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ step, parts, note }: { step: number; parts: Part[]; note: string }) => {
      const { error } = await supabase.from('training_plan_drafts')
        .upsert({ event_id: eventId, step: Math.min(step, 12), body: { parts, note } as unknown as Json }, { onConflict: 'event_id' })
        .select('event_id').single()
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['coach', user?.id, 'training-drafts'] }),
  })
}

const DRILL_COLUMNS = 'id, name, minutes, how, tell, area, numbers, direction, targets, conditions, updated_at, part_type, players_kind, group_size'

export function useDrills() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'drills'],
    enabled: !!user,
    queryFn: async (): Promise<(Drill & MyDrill)[]> => {
      const { data, error } = await supabase.from('coach_drills').select(DRILL_COLUMNS)
        .eq('coach_user_id', user!.id).order('updated_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

/** Adds a drill, or changes one when it has an id. The database stamps the coach and refuses another's drill. */
export function useSaveDrill() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, draft }: { id?: string; draft: DrillDraft & Pick<MyDrill, 'part_type' | 'players_kind' | 'group_size'> }) => {
      const drill = cleanDrill(draft)
      const { error } = id
        ? await supabase.from('coach_drills').update(drill).eq('id', id).eq('coach_user_id', user!.id).select('id').single()
        : await supabase.from('coach_drills').insert(drill).select('id').single()
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['coach', user?.id, 'drills'] }),
  })
}

/** TRAK-340: Write your own, saved to My drills under its part, and the drill as saved. */
export function useAddDrill() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (drill: DrillDraft & Pick<MyDrill, 'part_type' | 'players_kind' | 'group_size'>): Promise<MyDrill> => {
      const { data, error } = await supabase.from('coach_drills').insert({ ...cleanDrill(drill), part_type: drill.part_type,
        players_kind: drill.players_kind, group_size: drill.group_size }).select(DRILL_COLUMNS).single()
      if (error) throw error
      return data
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['coach', user?.id, 'drills'] }),
  })
}

export function useDeleteDrill() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('coach_drills').delete().eq('id', id).eq('coach_user_id', user!.id).select('id').single()
      if (error) throw error
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['coach', user?.id, 'drills'] }),
  })
}

/* ── TRAK-339: Notes, who came, past trainings ──────────────────────────── */

export type Notes = { again: Again | null; note: string }

/** Every training the coach has answered Notes for (or skipped), by training. The database returns only their own. */
export function useNotes(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-notes'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<Map<string, Notes>> => {
      const { data, error } = await supabase.from('training_notes').select('event_id, again, note')
      if (error) throw error
      return new Map((data ?? []).map(row => [row.event_id, { again: row.again as Again | null, note: row.note }]))
    },
  })
}

const NOTHING_NOTED = new Set<string>()

/** TRAK-367: the trainings with Notes saved or skipped, for the pages outside Training that ask for a register. Nothing
 *  where Training is off. */
export function useNotedTrainings(): Set<string> {
  const { data } = useNotes(useFeature('training'))
  return useMemo(() => data ? new Set(data.keys()) : NOTHING_NOTED, [data])
}

/** Saves a training's Notes; no answer and no note is a skip. Either way the training leaves the Next training card. */
export function useSaveNotes() {
  const { user } = useAuth()
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ eventId, again, note }: { eventId: string } & Notes) => {
      const { error } = await supabase.from('training_notes')
        .upsert({ event_id: eventId, again, note: note.trim() }, { onConflict: 'event_id' }).select('event_id').single()
      if (error) throw error
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: ['coach', user?.id, 'training-notes'] }),
      client.invalidateQueries({ queryKey: ['coach', user?.id, 'past-trainings'] }),
    ]),
  })
}

/** How many were marked present in each register taken, by the session it made. */
export function useHere(sessionIds: string[]) {
  const { user } = useAuth()
  const ids = [...new Set(sessionIds)].sort()
  return useQuery({
    queryKey: ['coach', user?.id, 'training-here', ids],
    enabled: !!user && ids.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.from('session_attendance').select('session_id').in('session_id', ids).eq('status', 'present')
      if (error) throw error
      const counts = new Map(ids.map(id => [id, 0]))
      for (const row of data ?? []) counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1)
      return counts
    },
  })
}

export type PastTraining = Training & { practices: SavedPractice[]; planned: boolean; notes: Notes | null }

const PAST_SHOWN = 100

/** The coach's trainings that are over, newest first (the last 100), not cancelled: each with its plan, if it had one,
 *  and its Notes. */
export function usePastTrainings() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'past-trainings'],
    enabled: !!user,
    queryFn: async (): Promise<PastTraining[]> => {
      const now = Date.now()
      const events = await supabase.from('coach_calendar_events').select(TRAINING_COLUMNS)
        .eq('coach_user_id', user!.id).eq('event_type', 'training').neq('status', 'cancelled')
        .lte('starts_at', new Date(now).toISOString()).order('starts_at', { ascending: false }).limit(PAST_SHOWN)
      if (events.error) throw events.error
      const over = (events.data ?? []).filter(event => trainingEnd(event) <= now)
        .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
      const ids = over.map(event => event.id)
      if (!ids.length) return []
      const [plans, practices, notes] = await Promise.all([
        supabase.from('training_plans').select('event_id').in('event_id', ids),
        supabase.from('training_plan_practices').select(`event_id, ${PRACTICE_COLUMNS}`).in('event_id', ids).order('position'),
        supabase.from('training_notes').select('event_id, again, note').in('event_id', ids),
      ])
      if (plans.error) throw plans.error
      if (practices.error) throw practices.error
      if (notes.error) throw notes.error
      const planned = new Set((plans.data ?? []).map(plan => plan.event_id))
      return over.map(event => {
        const note = notes.data?.find(n => n.event_id === event.id)
        return {
          ...event,
          planned: planned.has(event.id),
          practices: (practices.data ?? []).filter(p => p.event_id === event.id).map(({ event_id: _e, ...p }) => p),
          notes: note ? { again: note.again as Again | null, note: note.note } : null,
        }
      })
    },
  })
}

/** TRAK-342: how many players a training's squad has (its whole roster when it has none), the number a plan is made
 *  for. Players whose coach left don't count. */
export function useSquadSize(squad: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'squad-size', squad],
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.from('squad_players').select('id, age_group, status').eq('coach_user_id', user!.id)
      if (error) throw error
      return (data ?? []).filter(p => p.status !== 'coach_departed' && (squad == null || p.age_group?.trim() === squad)).length
    },
  })
}
