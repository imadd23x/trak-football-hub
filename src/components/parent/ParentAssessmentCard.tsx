import { Link } from 'react-router-dom'
import { ParentAssessmentBands, ParentRating } from './ParentFamily'
import { formatParentDate } from '@/lib/parent-data'
import type { ParentAssessment } from '@/lib/parent-assessments'

/** TRAK-194 (Kostas, 16 Oct): the date leads and the coach isn't named; "Dora Fotiadi · Good" read as the parent rating the coach. */
export function ParentAssessmentCard({ assessment, active = true, showOpenLink = true, openHref, progressLine }: {
  assessment: ParentAssessment; active?: boolean; showOpenLink?: boolean
  /** TRAK-401: "Progress: 1 on track, 1 some progress" on an evaluation's assessment. */
  progressLine?: string | null
  /** Where Open assessment goes; the parent's page unless given (the player's is /player/feedback/:id). */
  openHref?: string
}) {
  // TRAK-229: a light card like the rest; the bands carry their own colours.
  return <div className="rounded-xl bg-card border border-border p-5">
    <div className="flex items-center justify-between gap-2 mb-4">
      <p className="min-w-0 text-sm text-foreground">{formatParentDate(assessment.created_at)}</p>
      <ParentRating rating={assessment.coach_rating} missing="Not assessed" />
    </div>
    <ParentAssessmentBands assessment={assessment} />
    {progressLine && <p className="mt-3 text-sm text-muted-foreground">{progressLine}</p>}
    {showOpenLink && <Link to={openHref ?? `/parent/assessment/${encodeURIComponent(assessment.id)}`} tabIndex={active ? 0 : -1}
      className="inline-flex min-h-11 items-center mt-3 text-sm text-primary focus-visible:ring-2 focus-visible:ring-primary">Open assessment</Link>}
  </div>
}
