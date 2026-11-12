import { i18n } from '@/lib/i18n'
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { useFeatureState } from '@/components/trak/parked'
import { planToForm, type PlanForm } from '@/lib/games/plan'

/* TRAK-360 (Season plan 12/18, spec TRAK-348): the first time the coach opens the line-up of a match that has none, the
   squad's default formation for the match's format loads as a copy (load_default_formation decides, and does it once).
   What loaded joins the form the coach is typing, so a later save writes it back as it is. */

/** The latest formation copied into this match, for the line-up's note; null when none was. */
export function useFormationCopy(eventId: string) {
  const { user } = useAuth()
  const seasonPlan = useFeatureState('season_plan')
  return useQuery({
    queryKey: ['coach', user?.id, 'game-copy', eventId],
    enabled: !!user && seasonPlan.on,
    queryFn: async () => {
      const { data, error } = await supabase.from('formation_copies')
        .select('copied_at, not_coming, skipped, by_default, formations(name, format)')
        .eq('event_id', eventId).order('copied_at', { ascending: false }).limit(1)
      if (error) throw error
      const row = data?.[0]
      return row ? { name: row.formations?.name ?? i18n.t('coachMatches:aFormation'), format: row.formations?.format ?? null, notComing: row.not_coming, skipped: row.skipped, byDefault: row.by_default } : null
    },
  })
}

export function useDefaultFormation({ eventId, form, onForm, enabled }: {
  eventId: string; form: PlanForm; onForm: (form: PlanForm) => void; enabled: boolean
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const seasonPlan = useFeatureState('season_plan')
  const asked = useRef(new Set<string>())
  const latest = useRef({ form, onForm })
  latest.current = { form, onForm }
  useEffect(() => {
    if (!enabled || !user || !seasonPlan.on || asked.current.has(eventId)) return
    asked.current.add(eventId)
    void (async () => {
      const { data, error } = await supabase.rpc('load_default_formation', { p_event_id: eventId })
      if (error || !data) return
      const [plan, rows] = await Promise.all([
        supabase.from('game_plans').select('strength, scouting, goals, format, formation').eq('event_id', eventId).maybeSingle(),
        supabase.from('game_plan_players').select('squad_player_id, role, slot, job, note, context, expectation').eq('event_id', eventId),
      ])
      if (plan.error || rows.error || !plan.data) return
      const loaded = planToForm(plan.data, rows.data ?? [])
      const { form: now, onForm: set } = latest.current
      set({ ...now, format: loaded.format, formation: loaded.formation, players: { ...now.players, ...loaded.players } })
      await Promise.all(['game-plan', 'game-players', 'game-plans', 'game-copy'].map(key =>
        client.invalidateQueries({ queryKey: ['coach', user.id, key] })))
    })()
  }, [enabled, user, seasonPlan.on, eventId, client])
}
