import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'

export interface ParentChild {
  id: string
  name: string
}

// Explicit projections keep private assessment fields out of the parent client.
// Coach deletion retains history with a null author; generated types predate this.
export type ParentAssessment = Pick<Tables<'coach_assessments'>,
  'id' | 'created_at' | 'coach_rating' | 'work_rate' |
  'tactical' | 'attitude' | 'technical' | 'physical' | 'coachability'> & { coach_user_id: string | null }
export type ParentAward = Pick<Tables<'recognition_awards'>,
  'id' | 'created_at' | 'award_type' | 'awarded_for' | 'note'> & { coach_user_id: string | null }
export type ParentDetails = Pick<Tables<'player_details'>, 'position' | 'current_club' | 'age_group'>
export interface ParentMatch {
  id: string
  created_at: string | null
  match_date: string | null
  opponent: string | null
  competition: string | null
  venue: string | null
  computed_rating: number | null
  team_score: number | null
  opponent_score: number | null
}

export interface ParentDevelopment {
  details: ParentDetails | null
  assessments: ParentAssessment[]
  awards: ParentAward[]
  coachNames: Record<string, string>
}

export interface AwaitingConsentChild {
  player_user_id: string
  full_name: string
  age_years: number
}

// TanStack Query owns retries; avoid stacking PostgREST network backoff underneath it.
export async function fetchParentChildren(parentId: string, signal: AbortSignal): Promise<ParentChild[]> {
  const { data: links, error } = await supabase.from('player_parent_links')
    .select('player_user_id').eq('parent_user_id', parentId).abortSignal(signal).retry(false)
  if (error) throw error
  const ids = [...new Set((links ?? []).map(link => link.player_user_id))].sort()
  if (!ids.length) return []
  const { data: profiles, error: profileError } = await supabase.from('profiles')
    .select('user_id, full_name').in('user_id', ids).abortSignal(signal).retry(false)
  if (profileError) throw profileError
  const names = new Map((profiles ?? []).map(profile => [profile.user_id, profile.full_name]))
  // A linked child with a temporarily unavailable profile is still a link.
  return ids.map((id, index) => ({ id, name: names.get(id)?.trim() || `Linked child ${index + 1}` }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export async function fetchParentMatches(childId: string, signal: AbortSignal): Promise<ParentMatch[]> {
  const { data, error } = await supabase.from('matches')
    .select('id, team_score, opponent_score, competition, venue, match_date, created_at, opponent, computed_rating')
    .eq('user_id', childId)
    .order('match_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }).abortSignal(signal).retry(false)
  if (error) throw error
  return data ?? []
}

export async function fetchParentDevelopment(childId: string, signal: AbortSignal): Promise<ParentDevelopment> {
  const [detailsResult, squadResult] = await Promise.all([
    supabase.from('player_details').select('position, current_club, age_group')
      .eq('user_id', childId).abortSignal(signal).retry(false).maybeSingle(),
    supabase.from('squad_players').select('id').eq('linked_player_id', childId).abortSignal(signal).retry(false),
  ])
  if (detailsResult.error) throw detailsResult.error
  if (squadResult.error) throw squadResult.error
  const ids = (squadResult.data ?? []).map(row => row.id)
  if (!ids.length) return { details: detailsResult.data, assessments: [], awards: [], coachNames: {} }

  const [assessmentResult, awardResult] = await Promise.all([
    supabase.from('coach_assessments')
      .select('id, created_at, coach_user_id, coach_rating, work_rate, tactical, attitude, technical, physical, coachability')
      .in('squad_player_id', ids).order('created_at', { ascending: false }).limit(10).abortSignal(signal).retry(false),
    supabase.from('recognition_awards').select('id, created_at, coach_user_id, award_type, awarded_for, note')
      .in('squad_player_id', ids).order('created_at', { ascending: false }).limit(10).abortSignal(signal).retry(false),
  ])
  if (assessmentResult.error) throw assessmentResult.error
  if (awardResult.error) throw awardResult.error
  const assessments: ParentAssessment[] = assessmentResult.data ?? []
  const awards: ParentAward[] = awardResult.data ?? []
  // Filter only the optional name lookup, never the retained history records.
  const coachIds = [...new Set([...assessments, ...awards].map(row => row.coach_user_id)
    .filter((coachId): coachId is string => coachId !== null))]
  let coachNames: Record<string, string> = {}
  if (coachIds.length) {
    const { data, error } = await supabase.from('profiles').select('user_id, full_name')
      .in('user_id', coachIds).abortSignal(signal).retry(false)
    if (error) throw error
    coachNames = Object.fromEntries((data ?? []).map(profile => [profile.user_id, profile.full_name]))
  }
  return { details: detailsResult.data, assessments, awards, coachNames }
}

export async function fetchAwaitingConsent(signal: AbortSignal): Promise<AwaitingConsentChild[]> {
  // This existing RPC is not yet in the generated Supabase function types.
  const { data, error } = await supabase.rpc('get_children_awaiting_consent' as never)
    .returns<AwaitingConsentChild[]>().abortSignal(signal).retry(false)
  if (error) throw error
  return data ?? []
}

export function averageRecordedRating(matches: ParentMatch[]): number | null {
  const ratings = matches.map(match => match.computed_rating)
    .filter((rating): rating is number => rating != null && Number.isFinite(rating))
  return ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null
}

export function matchResult(match: ParentMatch): 'W' | 'D' | 'L' | null {
  if (match.team_score == null || match.opponent_score == null) return null
  return match.team_score > match.opponent_score ? 'W' : match.team_score < match.opponent_score ? 'L' : 'D'
}

export function formatParentDate(value: string | null): string {
  if (!value) return 'Date unavailable'
  // A calendar date is not a UTC instant: do not move it to the previous day.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable'
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatParentAward(type: string): string {
  return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
