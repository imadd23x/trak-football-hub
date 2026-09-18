import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar } from '@/components/trak'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading, ParentRating } from '@/components/parent/ParentFamily'
import { useParentMatchHistory, useParentMatchSummary } from '@/hooks/useParentData'
import { formatParentDate, matchResult } from '@/lib/parent-data'
import { useParentChildren } from '@/contexts/ParentChildrenContext'

export default function ParentMatches() {
  const navigate = useNavigate()
  const location = useLocation()
  const history = useParentMatchHistory()
  const summary = useParentMatchSummary()
  const { parentId, selectedChild } = useParentChildren()
  const childId = selectedChild?.id
  const matches = history.matches
  const hasError = history.isError || summary.isError
  const loading = history.isPending || summary.isPending
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const previousPage = useRef({ parentId, childId, number: history.pageNumber })
  useEffect(() => {
    const previous = previousPage.current
    previousPage.current = { parentId, childId, number: history.pageNumber }
    // Explicit page navigation moves to the new page's start. Initial loading
    // and child/account changes leave keyboard focus with the user's control.
    if (previous.parentId === parentId && previous.childId === childId
      && previous.number !== history.pageNumber && !loading && !hasError) {
      pageHeading.current?.focus({ preventScroll: true })
      pageHeading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    }
  }, [parentId, childId, history.pageNumber, loading, hasError])
  const buttonClass = 'min-h-11 px-4 rounded-lg border border-border text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40'
  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        <h1 className="text-xl text-foreground mb-5">Matches</h1>
        <ParentChildSelector />
        <ParentFamilyContent>
          {hasError ? <ParentLoadError message="Couldn't load matches." onRetry={() => { history.retry(); void summary.refetch() }} />
            : loading ? <ParentLoading />
              : <>
                <p className="text-sm text-muted-foreground mb-3">{summary.data?.total_count} recorded {summary.data?.total_count === 1 ? 'match' : 'matches'} · all history</p>
                <h2 ref={pageHeading} tabIndex={-1} className="text-sm font-medium text-foreground mb-3 focus:outline-none">Match history · page {history.pageNumber}</h2>
                {matches.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-12">{summary.data?.total_count === 0 ? 'No matches yet.' : 'No matches on this page.'}</p>
                  : <div className="divide-y divide-border" aria-label="Match history">
                  {matches.map(match => <div key={match.id} className="flex items-center gap-3 py-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{match.opponent || match.competition || 'Match'}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {[formatParentDate(match.match_date ?? match.created_at), match.competition, match.venue].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <ParentRating rating={match.computed_rating} />
                      <p className="text-xs text-muted-foreground mt-1">{matchResult(match)
                        ? `${matchResult(match)} ${match.team_score}–${match.opponent_score}` : 'Score not recorded'}</p>
                    </div>
                  </div>)}
                  </div>}
                {history.nextPageError && <ParentLoadError message="Couldn't load the next page. Your current matches are still shown." onRetry={() => { void history.nextPage() }} />}
                {history.isLoadingPage && <p role="status" className="py-3 text-sm text-muted-foreground">Loading next page…</p>}
                {(matches.length > 0 || history.hasPrevious) && <nav aria-label="Match history pages" className="flex items-center justify-between gap-3 mt-4">
                  <button className={buttonClass} disabled={!history.hasPrevious || history.isFetching} onClick={history.previousPage}>Previous</button>
                  <span className="text-xs text-muted-foreground">Page {history.pageNumber}</span>
                  <button className={buttonClass} disabled={!history.hasNext || history.isFetching} onClick={() => { void history.nextPage() }}>Next</button>
                </nav>}
                {!history.hasNext && matches.length > 0 && <p className="text-xs text-muted-foreground text-center mt-3">End of match history.</p>}
              </>}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
