import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { ScrollArea } from '@/components/arc/scroll-area/scroll-area'
import { MetadataLabel } from '@/components/trak'
import { ParentAssessmentCard } from './ParentAssessmentCard'
import type { ParentAssessment } from '@/lib/parent-assessments'
import { trackEvent } from '@/lib/telemetry'

/** Native swipe/snap: a complete band card at rest, followed by All assessments.
    TRAK-172 (Imad, 19 Oct): the player's Home uses it too, with its own links and
    no All assessments slide (`allHref` null), since players have no such page. */
export function ParentAssessmentCarousel({ assessments, allHref = '/parent/assessments', openHref, label = 'Latest coach assessment', progressLines }: {
  assessments: ParentAssessment[]
  allHref?: string | null
  openHref?: (id: string) => string
  label?: string
  /** TRAK-401: the Progress line of each evaluation assessment, by assessment id. */
  progressLines?: Record<string, string>
}) {
  const cards = assessments.slice(0, 5)
  const last = allHref ? cards.length : cards.length - 1
  const [active, setActive] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const shownId = cards[active]?.id
  useEffect(() => {
    if (shownId) void trackEvent('assessment_viewed', { assessment_id: shownId })
  }, [shownId])
  const move = (next: number) => {
    const index = Math.max(0, Math.min(last, next))
    setActive(index)
    viewport.current?.scrollTo({ left: index * viewport.current.clientWidth, behavior: 'instant' })
  }
  return <section className="mt-5" aria-label={label}>
    <MetadataLabel text="COACH ASSESSMENTS" />
    {!cards.length ? <>
      <p className="py-4 text-sm text-muted-foreground">No coach assessments yet.</p>
      {allHref && <Link to={allHref} className="inline-flex min-h-11 items-center text-sm text-primary">All assessments</Link>}
    </> : <div className="arc mt-2">
      <ScrollArea orientation="horizontal" snap="x mandatory" fade={0} label="Assessment cards"
        viewportRef={viewport} viewportClassName="flex focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        onScroll={event => {
          const node = event.currentTarget
          if (node.clientWidth) setActive(Math.max(0, Math.min(last, Math.round(Math.abs(node.scrollLeft) / node.clientWidth))))
        }}
        onKeyDown={event => {
          if (event.target !== viewport.current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          move(active + (event.key === 'ArrowRight' ? 1 : -1))
        }}>
        {cards.map((assessment, index) => <div key={assessment.id} role="group" aria-label={`Assessment ${index + 1} of ${cards.length}`}
          aria-hidden={index !== active} className="min-w-0" style={{ flex: '0 0 100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
          <ParentAssessmentCard assessment={assessment} active={index === active} openHref={openHref?.(assessment.id)} progressLine={progressLines?.[assessment.id]} />
        </div>)}
        {allHref && <div aria-hidden={active !== cards.length} className="flex items-stretch min-w-0"
          style={{ flex: '0 0 100%', scrollSnapAlign: 'start', scrollSnapStop: 'always' }}>
          <Link to={allHref} tabIndex={active === cards.length ? 0 : -1}
            className="w-full rounded-xl border border-border bg-card flex items-center justify-center gap-2 text-foreground min-h-44 p-5 focus-visible:ring-2 focus-visible:ring-primary">
            All assessments <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>}
      </ScrollArea>
      <div className="flex items-center justify-between gap-3 mt-2">
        <button type="button" aria-label="Previous assessment" disabled={active === 0} onClick={() => move(active - 1)}
          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-border disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary"><ChevronLeft size={18} aria-hidden="true" /></button>
        <p className="text-xs text-muted-foreground" aria-live="polite">{allHref && active === cards.length ? 'All assessments' : `${active + 1} of ${cards.length}`}</p>
        <button type="button" aria-label="Next assessment" disabled={active === last} onClick={() => move(active + 1)}
          className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-border disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-primary"><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
    </div>}
  </section>
}
