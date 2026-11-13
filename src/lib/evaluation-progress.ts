import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { isProgress, progressLabel, type Progress } from '@/lib/objective-progress'

/* TRAK-401 (Season plan 18/18 build 6/8, spec TRAK-366): the progress on a published evaluation, for the player's
   evaluation page and the Home assessment card. One read, evaluation_progress() (TRAK-401): the child, or in TRAK-402 a
   linked guardian, gets each shared objective's word at that evaluation and the words before it. It carries no note: the
   note is the player's alone and comes from its own table. Assessments that are not evaluation assessments are never
   asked for, so a session assessment makes no request at all. */

export type EvaluationObjective = { id: string; title: string; status: Progress; history: { due_on: string; status: Progress }[] }
export type EvaluationProgress = { assessment_id: string; due_on: string; objectives: EvaluationObjective[] }

export const evaluationProgressKey = (userId: string | undefined, ids: string[], child?: string) =>
  ['evaluation-progress', userId, child ?? null, ...ids] as const

/** ids: only the assessments that closed an evaluation (evaluation_id set). */
export function useEvaluationProgress(ids: string[], child?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: evaluationProgressKey(user?.id, ids, child),
    enabled: !!user && ids.length > 0,
    queryFn: async (): Promise<Map<string, EvaluationProgress>> => {
      const { data, error } = await supabase.rpc('evaluation_progress', { p_assessments: ids, ...(child ? { p_child: child } : {}) })
      if (error) throw error
      return new Map((data ?? []).map(row => {
        const objectives = (row.objectives as unknown as EvaluationObjective[]).filter(o => isProgress(o.status))
        return [row.assessment_id, { assessment_id: row.assessment_id, due_on: row.due_on, objectives }]
      }))
    },
  })
}

/** "1 on track, 1 some progress, 1 not yet": Met first, then the order of the mockup. Null when nothing was rated. */
export function progressSummary(objectives: Pick<EvaluationObjective, 'status'>[]): string | null {
  const parts = (['met', 'on_track', 'some_progress', 'not_yet'] as const)
    .map(status => [status, objectives.filter(o => o.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${progressLabel(status).toLowerCase()}`)
  return parts.length ? `Progress: ${parts.join(', ')}` : null
}

/** TRAK-402: the Home card line of each evaluation assessment (only those are asked for), for a child when a guardian reads. */
export function useProgressLines(assessments: { id: string; evaluation_id?: string | null }[], child?: string) {
  const progress = useEvaluationProgress(assessments.filter(a => a.evaluation_id).map(a => a.id), child)
  const lines: Record<string, string> = {}
  for (const [id, p] of progress.data ?? []) {
    const line = progressSummary(p.objectives)
    if (line) lines[id] = line
  }
  return lines
}
