import { useId, type ReactNode } from 'react'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { BandPill } from '@/components/trak'
import { scoreToBand } from '@/lib/rating-engine'
import { BANDS } from '@/lib/types'
import type { ParentAssessment } from '@/lib/parent-data'

export function ParentLoadError({ onRetry, message = "Couldn't load this child's information." }: {
  onRetry: () => void
  message?: string
}) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-4 my-4">
      <p className="text-sm text-foreground">{message}</p>
      <p className="text-sm text-muted-foreground mt-1">Check your connection and try again.</p>
      <button onClick={onRetry} className="mt-3 min-h-11 px-4 rounded-lg border border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
        Retry
      </button>
    </div>
  )
}

export function ParentLoading() {
  return <p role="status" className="py-6 text-sm text-muted-foreground">Loading…</p>
}

export function ParentChildSelector() {
  const { children, selectedChild, selectChild } = useParentChildren()
  const id = useId()
  if (!selectedChild) return null
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-xs text-muted-foreground mb-2">Following</label>
      <select id={id} value={selectedChild.id} onChange={event => selectChild(event.target.value)}
        className="w-full min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">
        {children.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
      </select>
    </div>
  )
}

export function ParentFamilyContent({ children }: { children: ReactNode }) {
  const family = useParentChildren()
  if (family.loading) return <ParentLoading />
  if (family.error) return <ParentLoadError message="Couldn't load your linked children." onRetry={family.retry} />
  if (!family.selectedChild) return (
    <div className="py-8 text-center">
      <p className="text-foreground">No child linked yet</p>
      <p className="text-sm text-muted-foreground mt-2">Open the parent invite sent to your email to link your child.</p>
    </div>
  )
  return <>{children}</>
}

export function ParentRating({ rating, missing = 'Not rated' }: { rating: number | null | undefined; missing?: string }) {
  return rating == null || !Number.isFinite(rating)
    ? <span className="text-xs text-muted-foreground">{missing}</span>
    : <BandPill band={scoreToBand(rating)} />
}

/** The six category bands of one assessment. Bands only: parents never see the coach's message (TRAK-63). */
export function ParentAssessmentBands({ assessment }: { assessment: ParentAssessment }) {
  return (
    <div className="space-y-3">
      {[
        { label: 'Work Rate', score: assessment.work_rate },
        { label: 'Tactical', score: assessment.tactical },
        { label: 'Attitude', score: assessment.attitude },
        { label: 'Technical', score: assessment.technical },
        { label: 'Physical', score: assessment.physical },
        { label: 'Coachability', score: assessment.coachability },
      ].map(category => {
        const rated = category.score != null && Number.isFinite(category.score)
        const band = rated ? BANDS.find(item => item.word.toLowerCase() === scoreToBand(category.score)) : null
        return <div key={category.label} className="flex items-center gap-3">
          <span className="w-24 text-xs text-muted-foreground">{category.label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
            {rated && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(10, category.score)) * 10}%`, backgroundColor: band?.color }} />}
          </div>
          <span className="text-xs w-20 text-right text-muted-foreground" style={band ? { color: band.color } : undefined}>{band?.word ?? 'Not assessed'}</span>
        </div>
      })}
    </div>
  )
}
