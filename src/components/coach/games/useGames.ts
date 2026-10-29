import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { Tables } from '@/integrations/supabase/types'
import type { EventRow } from '@/lib/coach-events'
import { academyClock, displayEventTime, phoneEventTime } from '@/lib/event-time'
import { weekdayDayMonth } from '@/lib/squad/format'
import { splitAvailability, type AvailPlayer } from '@/lib/squad/availability'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { absentKey, confirmedKey, loadConfirmed, loadReportedAbsent } from '@/components/coach/squad/availability-reads'

/* TRAK-283: the coach's own matches for Games, not cancelled (a published event is cancelled, never deleted).
   The squad pills filter them on screen, as Schedule's do. */
export type Game = Pick<Tables<'coach_calendar_events'>, 'id' | 'squad' | 'title' | 'published' | 'status' | 'starts_at'
  | 'ends_at' | 'event_date' | 'start_time' | 'opponent' | 'home_away' | 'venue'>

/** `enabled`: Home asks only while the academy's games switch is on (TRAK-284). */
export function useGames(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'games'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<Game[]> => {
      const { data, error } = await supabase.from('coach_calendar_events')
        .select('id, squad, title, published, status, starts_at, ends_at, event_date, start_time, opponent, home_away, venue')
        .eq('coach_user_id', user!.id).eq('event_type', 'match').neq('status', 'cancelled').order('starts_at')
      if (error) throw error
      return data ?? []
    },
  })
}

/** One of the coach's own matches, whole, for its page: Logistics shows every field Schedule's Review does. */
export function useGame(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game', eventId],
    enabled: !!user && !!eventId,
    queryFn: async (): Promise<EventRow | null> => {
      const { data, error } = await supabase.from('coach_calendar_events').select('*')
        .eq('id', eventId!).eq('coach_user_id', user!.id).eq('event_type', 'match').maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** TRAK-284: one match's plan, or null before its first save. Only the match's coach reads it (the database's rule). */
export function useGamePlan(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-plan', eventId],
    enabled: !!user && !!eventId,
    queryFn: async (): Promise<Tables<'game_plans'> | null> => {
      const { data, error } = await supabase.from('game_plans').select('*').eq('event_id', eventId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** TRAK-284: when each of the coach's plans was last saved, by match. The database returns only their own. */
export function useGamePlans(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-plans'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.from('game_plans').select('event_id, updated_at')
      if (error) throw error
      return new Map((data ?? []).map(plan => [plan.event_id, plan.updated_at]))
    },
  })
}

/** TRAK-286: when each of the coach's plans was first shared, by match. The database returns only their own. */
export function useGameShares(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-shares'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.from('game_shares').select('event_id, shared_at').order('shared_at', { ascending: false })
      if (error) throw error
      // Newest first, so the first share wins.
      return new Map((data ?? []).map(share => [share.event_id, share.shared_at]))
    },
  })
}

/** TRAK-286: who would read something new if the coach shared now, by shared match (game_plan_changes). */
export function useGamePlanChanges(eventIds: string[], enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-plan-changes', [...eventIds].sort().join(',')],
    enabled: !!user && enabled && eventIds.length > 0,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const { data, error } = await supabase.rpc('game_plan_changes', { p_event_ids: eventIds })
      if (error) throw error
      const changes = new Map<string, string[]>()
      for (const row of data ?? []) changes.set(row.event_id, [...changes.get(row.event_id) ?? [], row.squad_player_id])
      return changes
    },
  })
}

/** TRAK-285: the line-up rows saved for one match. Only the match's coach reads them (the database's rule). */
export function useGamePlayers(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-players', eventId],
    enabled: !!user && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from('game_plan_players')
        .select('squad_player_id, role, slot, job, note, context, expectation').eq('event_id', eventId!)
      if (error) throw error
      return data ?? []
    },
  })
}

/** TRAK-288: when each of the coach's evaluations was last saved, by match; TRAK-289: and published, if it was. The
 *  database returns only their own. */
export function useGameEvaluations(enabled = true) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-evaluations'],
    enabled: !!user && enabled,
    queryFn: async (): Promise<Map<string, { savedAt: string; publishedAt: string | null }>> => {
      const { data, error } = await supabase.from('game_evaluations').select('event_id, saved_at, published_at')
      if (error) throw error
      return new Map((data ?? []).map(row => [row.event_id, { savedAt: row.saved_at, publishedAt: row.published_at }]))
    },
  })
}

/** TRAK-288: one match's evaluation: the result, each player listed and the notes. Only the match's coach reads them (the
 *  database's rule); `evaluation` is null before the first save. */
export function useGameEvaluation(eventId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['coach', user?.id, 'game-evaluation', eventId],
    enabled: !!user && !!eventId,
    queryFn: async () => {
      const [evaluation, players, notes] = await Promise.all([
        supabase.from('game_evaluations').select('our_score, their_score, goals, how_they_scored, plan_worked, saved_at, published_at')
          .eq('event_id', eventId!).maybeSingle(),
        supabase.from('game_evaluation_players').select('squad_player_id, played, did_job, against_expectation').eq('event_id', eventId!),
        supabase.from('game_evaluation_notes').select('squad_player_id, note').eq('event_id', eventId!),
      ])
      const error = evaluation.error ?? players.error ?? notes.error
      if (error) throw error
      return { evaluation: evaluation.data, players: players.data ?? [], notes: notes.data ?? [] }
    },
  })
}

export type Candidate = AvailPlayer & { confirmed: boolean; absent: boolean }

/** TRAK-285: who can come to a match, as Squad > Availability shows it: the match's squad, consented children only (a
 *  departed child never reads), Confirmed first, and a guardian's "Can't make it" as a flag, never its reason. */
export function useWhoCanCome(game: { id: string; squad?: string | null }) {
  const { user } = useAuth()
  const roster = useSquadRoster({ everySquad: true })
  const confirmed = useQuery({ queryKey: confirmedKey(user?.id, game.id), queryFn: () => loadConfirmed(game.id), enabled: !!user })
  const absent = useQuery({ queryKey: absentKey(user?.id, game.id), queryFn: () => loadReportedAbsent(game.id), enabled: !!user })
  const players = useMemo<Candidate[]>(() => {
    const squad = roster.players.filter(p => game.squad == null || p.age_group?.trim() === game.squad)
      .map(p => ({ id: p.id, name: p.player_name, shirt: p.shirt_number, position: p.position }))
    const split = splitAvailability(squad, roster.consentPending, new Set(confirmed.data ?? []), new Set(absent.data ?? []))
    return [...split.confirmed.map(p => ({ ...p, confirmed: true })), ...split.notConfirmed.map(p => ({ ...p, confirmed: false }))]
  }, [roster.players, roster.consentPending, confirmed.data, absent.data, game.squad])
  return {
    players,
    isPending: roster.isPending || confirmed.isPending || absent.isPending,
    error: roster.error ?? confirmed.error ?? absent.error ?? null,
    retry: () => { roster.retry(); void confirmed.refetch(); void absent.refetch() },
  }
}

export const gameTitle = (game: { opponent?: string | null; title: string }) => game.opponent ? `vs ${game.opponent}` : game.title

/** When a game is, on this phone's clock (Imad, 23 Oct), and the academy's own time when that differs. */
export function gameWhen(game: { event_date?: string | null; start_time?: string | null; starts_at: string }) {
  const here = phoneEventTime(game)
  const academy = displayEventTime(game)
  return { day: weekdayDayMonth(here.date), time: here.time, academy: academyClock({ ...academy, startsAt: game.starts_at }) }
}
