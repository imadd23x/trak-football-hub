import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/types'

/** Parent readers never request the coach's message or private note. */
export const PARENT_ASSESSMENT_COLUMNS = 'id, session_id, evaluation_id, created_at, coach_user_id, coach_rating, work_rate, tactical, attitude, technical, physical, coachability' as const
export type ParentAssessment = Pick<Tables<'coach_assessments'>,
  'id' | 'created_at' | 'coach_rating' | 'work_rate' | 'tactical' | 'attitude' | 'technical' | 'physical' | 'coachability'> & {
    coach_user_id: string | null
    session_id?: string | null
    /** TRAK-402: set when this assessment closed a season evaluation. */
    evaluation_id?: string | null
  }
export type AssessmentTarget = { kind: 'assessment' | 'session'; id: string }
export interface ParentAssessmentPage {
  assessments: ParentAssessment[]
  hasMore: boolean
}
const PAGE_SIZE = 20

export async function fetchCoachNames(ids: string[], signal: AbortSignal): Promise<Record<string, string>> {
  if (!ids.length) return {}
  const { data, error } = await supabase.from('profiles').select('user_id, full_name')
    .in('user_id', [...new Set(ids)]).abortSignal(signal).retry(false)
  if (error) throw error
  return Object.fromEntries((data ?? []).map(profile => [profile.user_id, profile.full_name || 'Coach']))
}

async function childSquadIds(childId: string, signal: AbortSignal): Promise<string[]> {
  const { data, error } = await supabase.from('squad_players').select('id')
    .eq('linked_player_id', childId).abortSignal(signal).retry(false)
  if (error) throw error
  return (data ?? []).map(row => row.id)
}

export async function fetchParentAssessmentPage(childId: string, page: number, signal: AbortSignal): Promise<ParentAssessmentPage> {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid assessment page')
  const ids = await childSquadIds(childId, signal)
  if (!ids.length) return { assessments: [], hasMore: false }
  const start = page * PAGE_SIZE
  const { data, error } = await supabase.from('coach_assessments').select(PARENT_ASSESSMENT_COLUMNS)
    .in('squad_player_id', ids).order('created_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false }).range(start, start + PAGE_SIZE).abortSignal(signal).retry(false)
  if (error) throw error
  const assessments: ParentAssessment[] = (data ?? []).slice(0, PAGE_SIZE)
  // TRAK-194: a parent's assessment never names the coach, so no names are read.
  return { assessments, hasMore: (data?.length ?? 0) > PAGE_SIZE }
}

/** TRAK-439: which of these sessions the coach has actually assessed this child at. Only those get a link in the history; a
 *  training with no assessment (every one, where the coach evaluates on the season plan's cadence) opens nothing empty. */
export async function fetchAssessedSessionIds(childId: string, sessionIds: string[], signal: AbortSignal): Promise<Set<string>> {
  if (!sessionIds.length) return new Set()
  const ids = await childSquadIds(childId, signal)
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('coach_assessments').select('session_id')
    .in('squad_player_id', ids).in('session_id', sessionIds).abortSignal(signal).retry(false)
  if (error) throw error
  return new Set((data ?? []).map(row => row.session_id).filter((id): id is string => !!id))
}

/** An exact record, scoped to every roster row belonging to the selected child. */
export async function fetchParentAssessment(childId: string, target: AssessmentTarget, signal: AbortSignal): Promise<{
  assessment: ParentAssessment | null
}> {
  const ids = await childSquadIds(childId, signal)
  if (!ids.length) return { assessment: null }
  const { data, error } = await supabase.from('coach_assessments').select(PARENT_ASSESSMENT_COLUMNS)
    .in('squad_player_id', ids).eq(target.kind === 'assessment' ? 'id' : 'session_id', target.id)
    // Nothing stops two assessments on one session; show the newest instead of erroring.
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
    .abortSignal(signal).retry(false).maybeSingle()
  if (error) throw error
  return { assessment: data ?? null }
}
