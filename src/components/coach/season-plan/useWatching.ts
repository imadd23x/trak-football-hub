import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import type { SquadRoster } from '@/components/coach/squad/useSquadRoster'
import { usePlayerObjectives } from './usePlayerObjectives'
import { DEFAULT_WATCH_RULE, effectiveRule, isWatchRule, watchedPlayers, type RegisterSession, type WatchRule } from '@/lib/watch-first'
import { seasonPlanKey } from '@/lib/season-plan'

/* TRAK-355 (Season plan 7/18): who the coach is watching, and when each comes back. Watches are rows the coach reads
   (only their own players'); the rule is the squad's, on its season plan; trainings come from the register (a
   present row against a training session); days are the academy's, in its time zone. watch_players() starts or
   restarts a watch. */

const ACADEMY_DEFAULT_ZONE = 'Asia/Dubai'
/** Watches last 28 days at most, so the register a few days past that is enough. */
const REGISTER_DAYS = 35

export const watchesKey = (coachId: string) => ['coach', coachId, 'player-watches'] as const
const rulesKey = (coachId: string) => ['coach', coachId, 'watch-rules'] as const

export function usePlayerWatches(coachId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: watchesKey(coachId ?? ''), enabled: !!coachId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('player_watches').select('squad_player_id, since')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Each squad's reminder rule, from its season plan; "after 2 trainings" where it has none. */
export function useWatchRules(coachId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: rulesKey(coachId ?? ''), enabled: !!coachId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('season_plans').select('squad, watch_rule')
      if (error) throw error
      return new Map((data ?? []).map(p => [p.squad, isWatchRule(p.watch_rule) ? p.watch_rule : DEFAULT_WATCH_RULE]))
    },
  })
}

/** The coach's academy's time zone, which a watch's days are counted in. */
export function useAcademyTimeZone(coachId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['coach', coachId, 'academy-time-zone'], enabled: !!coachId && enabled, staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('coach_details').select('organization_id').eq('user_id', coachId!).maybeSingle()
      if (error) throw error
      if (!data?.organization_id) return ACADEMY_DEFAULT_ZONE
      const org = await supabase.from('organizations').select('time_zone').eq('id', data.organization_id).maybeSingle()
      if (org.error) throw org.error
      return (org.data as { time_zone?: string } | null)?.time_zone || ACADEMY_DEFAULT_ZONE
    },
  })
  return { ...query, zone: query.data ?? ACADEMY_DEFAULT_ZONE }
}

/** The register of the last five weeks, by player: each session they were at, and its day and kind. */
export function useWatchRegister(coachId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['coach', coachId, 'watch-register'], enabled: !!coachId && enabled,
    queryFn: async (): Promise<Record<string, RegisterSession[]>> => {
      const from = new Date(Date.now() - REGISTER_DAYS * 86_400_000).toISOString().slice(0, 10)
      const sessions = await supabase.from('coach_sessions').select('id, session_date, session_type').gte('session_date', from)
      if (sessions.error) throw sessions.error
      const byId = new Map((sessions.data ?? []).filter(s => s.session_date).map(s => [s.id, s]))
      if (!byId.size) return {}
      const attendance = await supabase.from('session_attendance').select('session_id, squad_player_id, status').in('session_id', [...byId.keys()])
      if (attendance.error) throw attendance.error
      const register: Record<string, RegisterSession[]> = {}
      for (const row of attendance.data ?? []) {
        const session = byId.get(row.session_id)
        if (!session) continue
        ;(register[row.squad_player_id] ??= []).push({ date: session.session_date!, type: session.session_type, present: row.status === 'present' })
      }
      return register
    },
  })
}

/** Which squads have trainings in Trak, on the schedule or in the register (`all`: a training for every squad). Without
 *  any, a reminder by trainings would never come, so a squad without them is offered and given weeks (Tarek, 6 Nov). */
export function useTrainingSquads(coachId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['coach', coachId, 'training-squads'], enabled: !!coachId && enabled,
    queryFn: async () => {
      const [events, sessions] = await Promise.all([
        supabase.from('coach_calendar_events').select('squad, status').eq('event_type', 'training').limit(500),
        supabase.from('coach_sessions').select('squad').eq('session_type', 'training').limit(500),
      ])
      if (events.error) throw events.error
      if (sessions.error) throw sessions.error
      const live = (events.data ?? []).filter(e => e.status !== 'cancelled')
      return {
        all: live.some(e => e.squad == null),
        squads: new Set([...live.map(e => e.squad), ...(sessions.data ?? []).map(s => s.squad)].filter((s): s is string => !!s)),
      }
    },
  })
}
export const trainsIn = (training: { all: boolean; squads: Set<string> } | undefined, squad: string | null) =>
  !!training && (training.all || (!!squad && training.squads.has(squad)))

export function useWatchPlayers(coachId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc('watch_players', { p_squad_player_ids: ids })
      if (error) throw error
      return data
    },
    // Waited for, so the list already shows the watch when the sheet moves on.
    onSuccess: () => client.invalidateQueries({ queryKey: watchesKey(coachId) }),
  })
}

/** Sets the squad's reminder rule, starting its plan if it has none. */
export function useSetWatchRule(coachId: string, squad: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ planId, rule }: { planId: string | null; rule: WatchRule }) => {
      const { error } = planId
        ? await supabase.from('season_plans').update({ watch_rule: rule }).eq('id', planId)
        : await supabase.from('season_plans').insert({ squad, watch_rule: rule })
      if (error) throw error
    },
    onSuccess: () => Promise.all([
      client.invalidateQueries({ queryKey: rulesKey(coachId) }),
      client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) }),
    ]),
  })
}

/** Every watched player of the coach's in the roster given (the one the screen already holds), each with whether
 *  they're due and where to set them up. */
export function useWatchList(coachId: string | undefined, roster: Pick<SquadRoster, 'players' | 'consentPending' | 'isPending'>, enabled = true) {
  const watches = usePlayerWatches(coachId, enabled)
  // The rest is read only once someone is watched: most squads watch no one.
  const some = enabled && (watches.data?.length ?? 0) > 0
  const objectives = usePlayerObjectives(coachId, some)
  const rules = useWatchRules(coachId, some)
  const register = useWatchRegister(coachId, some)
  const zone = useAcademyTimeZone(coachId, some)
  const training = useTrainingSquads(coachId, some)
  const ready = !!watches.data && !roster.isPending
    && (!some || (!!objectives.data && !!rules.data && !!register.data && !!training.data && !zone.isPending))
  const list = useMemo(() => {
    if (!ready || !some) return []
    const players = roster.players.filter(p => !roster.consentPending.has(p.id))
    const bySquad = new Map<string, typeof players>()
    for (const p of players) bySquad.set(p.age_group?.trim() ?? '', [...(bySquad.get(p.age_group?.trim() ?? '') ?? []), p])
    const held = new Set([...objectives.data!.open.entries()].filter(([, list]) => list.length > 0).map(([id]) => id))
    return [...bySquad].flatMap(([squad, squadPlayers]) => {
      const rule = effectiveRule(rules.data!.get(squad) ?? DEFAULT_WATCH_RULE, trainsIn(training.data, squad || null))
      return watchedPlayers({ players: squadPlayers, watches: watches.data!, objectives: held, sessions: register.data!, rule, timeZone: zone.zone, now: new Date() })
        .map(w => ({ ...w, squad: squad || null, rule }))
    })
  }, [ready, some, roster.players, roster.consentPending, objectives.data, watches.data, register.data, rules.data, training.data, zone.zone])
  const failed = watches.isError || objectives.isError || rules.isError || register.isError || training.isError
  return { list, ready, failed, retry: () => { void watches.refetch(); void objectives.refetch(); void rules.refetch(); void register.refetch(); void training.refetch() } }
}
