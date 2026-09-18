import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'

export interface ParentChild {
  id: string
  name: string
}

// Explicit projections keep private assessment fields out of the parent client.
export type ParentAssessment = Pick<Tables<'coach_assessments'>,
  'id' | 'created_at' | 'coach_user_id' | 'coach_rating' | 'work_rate' |
  'tactical' | 'attitude' | 'technical' | 'physical' | 'coachability'>
export type ParentAward = Pick<Tables<'recognition_awards'>,
  'id' | 'created_at' | 'coach_user_id' | 'award_type' | 'awarded_for' | 'note'>
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

export interface ParentMatchSummary {
  total_count: number
  rated_count: number
  average_rating: number | null
  wins: number
  draws: number
  losses: number
}

export type ParentMatchCursor = Pick<ParentMatch, 'id' | 'match_date' | 'created_at'>
export interface ParentMatchPage {
  matches: ParentMatch[]
  nextCursor: ParentMatchCursor | null
}

export const PARENT_MATCH_PAGE_SIZE = 50
export const PARENT_ACTIVITY_LIMIT = 20
const MATCH_COLUMNS = 'id, team_score, opponent_score, competition, venue, match_date, created_at, opponent, computed_rating'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isNullableNumber = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'

function parseMatches(value: unknown, limit: number): ParentMatch[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid match history response')
  const ids = new Set<string>()
  return value.map(row => {
    // PostgreSQL serializes special numeric values as strings. They are unrated,
    // not malformed history; ordinary numeric strings still fail validation.
    const rating = isRecord(row) ? row.computed_rating : undefined
    const normalizedRating = (typeof rating === 'number' && !Number.isFinite(rating))
      || rating === 'NaN' || rating === 'Infinity' || rating === '-Infinity' ? null : rating
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || !isNullableString(row.created_at) || !isNullableString(row.match_date)
      || !isNullableString(row.opponent) || !isNullableString(row.competition) || !isNullableString(row.venue)
      || !isNullableNumber(normalizedRating) || !isNullableNumber(row.team_score) || !isNullableNumber(row.opponent_score)) {
      throw new Error('Invalid match history response')
    }
    ids.add(row.id)
    return {
      id: row.id, created_at: row.created_at, match_date: row.match_date,
      opponent: row.opponent, competition: row.competition, venue: row.venue,
      computed_rating: normalizedRating, team_score: row.team_score, opponent_score: row.opponent_score,
    }
  })
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

export async function fetchParentMatchSummary(childId: string, signal: AbortSignal): Promise<ParentMatchSummary> {
  const { data, error } = await supabase.rpc('get_parent_match_summary', { p_child_id: childId })
    .abortSignal(signal).retry(false)
  if (error) throw error
  const row: unknown = Array.isArray(data) && data.length === 1 ? data[0] : null
  // An unauthorized child yields no row. Never reinterpret that as zero matches.
  if (!isRecord(row) || !isCount(row.total_count) || !isCount(row.rated_count)
    || !isCount(row.wins) || !isCount(row.draws) || !isCount(row.losses)
    || row.rated_count > row.total_count || row.wins + row.draws + row.losses > row.total_count
    || !isNullableNumber(row.average_rating)
    || (row.rated_count === 0 ? row.average_rating !== null : row.average_rating === null)) {
    throw new Error('Invalid or unavailable match summary')
  }
  return {
    total_count: row.total_count, rated_count: row.rated_count, average_rating: row.average_rating,
    wins: row.wins, draws: row.draws, losses: row.losses,
  }
}

export async function fetchParentMatchPage(childId: string, after: ParentMatchCursor | null, signal: AbortSignal): Promise<ParentMatchPage> {
  const { data, error } = await supabase.rpc('get_parent_match_page', {
    p_child_id: childId,
    p_after_id: after?.id ?? null,
    // Preserve the server's timestamp precision and nullable cursor components.
    p_after_match_date: after?.match_date ?? null,
    p_after_created_at: after?.created_at ?? null,
    p_limit: PARENT_MATCH_PAGE_SIZE + 1,
  }).abortSignal(signal).retry(false)
  if (error) throw error
  const rows = parseMatches(data, PARENT_MATCH_PAGE_SIZE + 1)
  const matches = rows.slice(0, PARENT_MATCH_PAGE_SIZE)
  const last = matches[matches.length - 1]
  return {
    matches,
    nextCursor: rows.length > PARENT_MATCH_PAGE_SIZE
      ? { id: last.id, match_date: last.match_date, created_at: last.created_at } : null,
  }
}

export async function fetchParentRecentMatches(childId: string, signal: AbortSignal): Promise<ParentMatch[]> {
  const { data, error } = await supabase.from('matches')
    .select(MATCH_COLUMNS)
    .eq('user_id', childId)
    .order('match_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false }).limit(5).abortSignal(signal).retry(false)
  if (error) throw error
  return parseMatches(data, 5)
}

export async function fetchParentMatchActivity(childId: string, signal: AbortSignal): Promise<ParentMatch[]> {
  const { data, error } = await supabase.from('matches').select(MATCH_COLUMNS)
    .eq('user_id', childId)
    .order('created_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
    .limit(PARENT_ACTIVITY_LIMIT).abortSignal(signal).retry(false)
  if (error) throw error
  return parseMatches(data, PARENT_ACTIVITY_LIMIT)
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
      .in('squad_player_id', ids).order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false }).limit(PARENT_ACTIVITY_LIMIT).abortSignal(signal).retry(false),
    supabase.from('recognition_awards').select('id, created_at, coach_user_id, award_type, awarded_for, note')
      .in('squad_player_id', ids).order('created_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false }).limit(PARENT_ACTIVITY_LIMIT).abortSignal(signal).retry(false),
  ])
  if (assessmentResult.error) throw assessmentResult.error
  if (awardResult.error) throw awardResult.error
  const assessments = assessmentResult.data ?? []
  const awards = awardResult.data ?? []
  const coachIds = [...new Set([...assessments, ...awards].map(row => row.coach_user_id))]
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

export function compareParentActivity(a: { id: string; date: string | null }, b: { id: string; date: string | null }): number {
  const millis = (value: string | null) => value ? Date.parse(value) : NaN
  const rank = (value: string | null) => value === 'infinity' ? 3 : Number.isFinite(millis(value)) ? 2 : value === '-infinity' ? 1 : 0
  const rankDifference = rank(b.date) - rank(a.date)
  if (rankDifference) return rankDifference
  const difference = millis(b.date) - millis(a.date)
  if (difference) return difference
  // Date.parse drops sub-millisecond precision; Postgres timestamps do not.
  const remainder = (value: string | null) => (value?.match(/\.(\d+)/)?.[1] ?? '').slice(3).padEnd(6, '0')
  return remainder(b.date).localeCompare(remainder(a.date)) || b.id.localeCompare(a.id)
}
