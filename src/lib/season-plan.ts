import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useFeatureState } from '@/components/trak/parked'
import type { Tables } from '@/integrations/supabase/types'
import { localTodayISO } from '@/lib/event-time'

/* TRAK-350 (Season plan 2/18, spec TRAK-348): a squad's season plan, set up once. This slice holds the season's dates
   and up to three season objectives, a draft only the squad's coach sees. A squad is the coach's roster rows with one
   age group (TRAK-176). The academy's season_plan switch gates every write; with it off nothing here is read.
   TRAK-356: Share. Once shared, the set-up never comes back, a removed season objective is retired with its date, and
   what changed since the last share waits on the plan until the coach shares the changes. */

export type SeasonPlan = Pick<Tables<'season_plans'>, 'id' | 'squad' | 'starts_on' | 'ends_on' | 'shared_at' | 'positions_known' | 'watch_rule'
  | 'last_shared_at' | 'unshared_parts' | 'unshared_players'>
/** TRAK-352: the answer to "Do you know where they play yet?" */
export type PositionsKnown = 'yes' | 'some' | 'not_yet'
export type SeasonObjective = Pick<Tables<'season_objectives'>, 'id' | 'place' | 'title' | 'looks_like'>
/** TRAK-356: a season objective removed after the plan was shared, kept with when it was added and removed. */
export type RemovedSeasonObjective = Pick<Tables<'season_objectives'>, 'id' | 'title' | 'looks_like' | 'created_at'> & { retired_at: string }

export const MAX_SEASON_OBJECTIVES = 3
export const OBJECTIVE_TITLE_MAX = 80
export const OBJECTIVE_LINE_MAX = 300

/** The mockup's six (2 Nov), each with what it looks like. */
export const SEASON_OBJECTIVE_PRESETS = [
  { title: 'Win it back within 5 seconds', looksLike: 'The nearest three press the moment we lose it.' },
  { title: 'Play through the middle', looksLike: 'Show between the lines and play forward.' },
  { title: 'Attack the wide areas', looksLike: 'Get it wide early and cross before they set.' },
  { title: 'Stay compact', looksLike: 'No more than 35 m from back to front.' },
  { title: 'Own the set pieces', looksLike: 'Everyone knows their job at corners and free kicks.' },
  { title: 'React first', looksLike: 'Win it: look forward. Lose it: get back.' },
] as const

export const seasonPlanKey = (coachId: string | undefined, squad: string | null) => ['coach', coachId, 'season-plan', squad] as const
export const seasonObjectivesKey = (coachId: string | undefined, planId: string | undefined) => ['coach', coachId, 'season-objectives', planId] as const
export const removedSeasonObjectivesKey = (coachId: string | undefined, planId: string | undefined) => ['coach', coachId, 'season-objectives', planId, 'removed'] as const

export async function loadSeasonPlan(coachId: string, squad: string): Promise<SeasonPlan | null> {
  const { data, error } = await supabase.from('season_plans')
    .select('id, squad, starts_on, ends_on, shared_at, positions_known, watch_rule, last_shared_at, unshared_parts, unshared_players')
    .eq('coach_user_id', coachId).eq('squad', squad).maybeSingle()
  if (error) throw error
  // A plan read before TRAK-356 has no list of changes: nothing waits.
  return data && { ...data, unshared_parts: data.unshared_parts ?? [], unshared_players: data.unshared_players ?? [] }
}

/** Every season objective of a plan, open and removed. A row with no status is open. */
async function loadSeasonObjectiveRows(planId: string) {
  const { data, error } = await supabase.from('season_objectives').select('id, place, title, looks_like, status, created_at, retired_at')
    .eq('plan_id', planId).order('place')
  if (error) throw error
  return data ?? []
}

/** The plan's open season objectives, in their places. */
export async function loadSeasonObjectives(planId: string): Promise<SeasonObjective[]> {
  return (await loadSeasonObjectiveRows(planId)).filter(o => o.status !== 'retired')
    .map(({ id, place, title, looks_like }) => ({ id, place, title, looks_like }))
}

/** TRAK-356: the ones removed after sharing, the latest first. */
export async function loadRemovedSeasonObjectives(planId: string): Promise<RemovedSeasonObjective[]> {
  return (await loadSeasonObjectiveRows(planId))
    .flatMap(({ id, title, looks_like, created_at, status, retired_at }) => (status === 'retired' && retired_at ? [{ id, title, looks_like, created_at, retired_at }] : []))
    .sort((a, b) => b.retired_at.localeCompare(a.retired_at))
}

export type ObjectiveDraft = { id?: string; title: string; looksLike: string }

/** Writes a plan's season objectives as the coach left them: what's gone is deleted while the plan is a draft and
 *  retired once it's shared (TRAK-356), what changed is reworded, and what's new takes a free place. What's gone goes
 *  first, so its place is free: three places, one open objective each. */
export async function writeSeasonObjectives(planId: string, saved: SeasonObjective[], next: ObjectiveDraft[], shared: boolean) {
  const kept = new Set(next.flatMap(o => (o.id ? [o.id] : [])))
  const gone = saved.filter(o => !kept.has(o.id)).map(o => o.id)
  if (gone.length) {
    const { error } = shared
      ? await supabase.from('season_objectives').update({ status: 'retired' }).in('id', gone)
      : await supabase.from('season_objectives').delete().in('id', gone)
    if (error) throw error
  }
  for (const o of next) {
    const before = saved.find(s => s.id === o.id)
    if (!before || (before.title === o.title.trim() && before.looks_like === o.looksLike.trim())) continue
    const { error } = await supabase.from('season_objectives').update({ title: o.title.trim(), looks_like: o.looksLike.trim() }).eq('id', before.id)
    if (error) throw error
  }
  const taken = new Set(saved.filter(s => kept.has(s.id)).map(s => s.place))
  const free = [1, 2, 3].filter(place => !taken.has(place))
  const fresh = next.filter(o => !o.id).map((o, i) => ({ plan_id: planId, place: free[i], title: o.title.trim(), looks_like: o.looksLike.trim() }))
  if (fresh.length) {
    const { error } = await supabase.from('season_objectives').insert(fresh)
    if (error) throw error
  }
}

/** TRAK-356: shares the plan, the first time or its changes. The face-to-face talk counts only the first time. */
export async function shareSeasonPlan(planId: string, talked: boolean) {
  const { error } = await supabase.rpc('share_season_plan', { p_plan_id: planId, p_talked: talked })
  if (error) throw error
}

/** When the plan was last shared: each share of the changes moves it on. */
export const lastShared = (plan: SeasonPlan) => plan.last_shared_at ?? plan.shared_at

const PART_NAMES: Record<string, string> = { dates: 'season dates', season_objectives: 'season objectives' }

/** What waits under "Not shared yet": the parts, then each player whose objectives changed, by first name. A player
 *  no longer in the squad is counted with the rest of them. */
export function notSharedYet(plan: SeasonPlan, nameOf: (squadPlayerId: string) => string | undefined): string[] {
  const names = plan.unshared_players.map(nameOf)
  const others = names.filter(name => !name).length
  return [
    ...plan.unshared_parts.map(part => PART_NAMES[part] ?? part),
    ...names.flatMap(name => (name ? [`${name.split(' ')[0]}’s objectives`] : [])),
    ...(others ? [others === 1 ? 'another player’s objectives' : `${others} other players’ objectives`] : []),
  ]
}

/** The mockup's line: up to three changes by name, more as a count. */
export const changesText = (changes: string[]) => (changes.length > 3 ? `${changes.length} changes` : changes.join(', '))

/** The squad a season plan is for: the picked one, or the only one. None under All, or before the squads load. */
export function planSquad({ squads, squad, everySquad }: { squads: string[]; squad: string | null; everySquad: boolean }): string | null {
  if (squads.length === 1) return squads[0]
  return everySquad ? null : squad
}

/** The squad's plan, read only where the switch is on. `on` is false while the switch is unknown or off; `isPending`
 *  stays true until the switch has answered, so a screen never shows "Not started" for a plan it hasn't asked for. */
export function useSeasonPlan(coachId: string | undefined, squad: string | null) {
  const { on, known } = useFeatureState('season_plan')
  const query = useQuery({
    queryKey: seasonPlanKey(coachId, squad),
    queryFn: () => loadSeasonPlan(coachId!, squad!),
    enabled: on && !!coachId && !!squad,
  })
  return { on, plan: query.data ?? null, isPending: !known || (on && !!squad && query.isPending), error: query.error, retry: () => void query.refetch() }
}

/** A date picker's day as the plan's ISO date, and back. */
export const isoToDate = (iso: string) => (iso ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) : undefined)
export const dateToIso = (date: Date | undefined) => (date
  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '')

/** "6 Nov", for "Shared …" and a removed objective's dates. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const DAY = 86_400_000
const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY

/** TRAK-361: "34 weeks left", or when the season starts or that it's over, by the device's day. */
export function seasonLeft(plan: Pick<SeasonPlan, 'starts_on' | 'ends_on'>, today = localTodayISO()): string | null {
  if (!plan.starts_on || !plan.ends_on) return null
  if (today < plan.starts_on) return `starts ${shortDate(`${plan.starts_on}T00:00:00`)}`
  if (today > plan.ends_on) return 'season over'
  const weeks = Math.max(1, Math.ceil((dayNumber(plan.ends_on) - dayNumber(today)) / 7))
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} left`
}

/** TRAK-361: Home's folded line, where the plan stands and what comes next. */
export function planState(plan: SeasonPlan, today = localTodayISO()): string {
  if (!plan.shared_at) return 'Not shared yet'
  if (plan.unshared_parts.length || plan.unshared_players.length) return 'Changes not shared'
  const shared = lastShared(plan)
  return [`Shared ${shared ? shortDate(shared) : ''}`, seasonLeft(plan, today)].filter(Boolean).join(' · ')
}

/** "1 September", for "since …" lines. */
export function seasonStartLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}
