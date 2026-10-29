import { Link, useNavigate, useLocation } from 'react-router-dom'
import { MetadataLabel, MobileShell, NavBar } from '@/components/trak'
import { SeeMoreList } from '@/components/trak/SeeMoreList'
import { ParentChildSelector, ParentFamilyContent, ParentLoadError, ParentLoading, ParentRating } from '@/components/parent/ParentFamily'
import { useParentMatches } from '@/hooks/useParentData'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { TrainingHistory } from '@/components/player/TrainingHistory'
import { ParentUpcomingEvents } from '@/components/parent/ParentEvents'
import { formatParentDate, parentMatchHref, matchResult } from '@/lib/parent-data'
import { EVENT_COLOR } from '@/lib/coach-events'
import { useReviews } from '@/lib/games/reviews'
import { Badge } from '@/components/arc/badge/badge'

export default function ParentMatches() {
  const navigate = useNavigate()
  const location = useLocation()
  const query = useParentMatches()
  const matches = query.data ?? []
  const { selectedChild } = useParentChildren()
  // TRAK-289: a Games match has no rating; its coach's review is on the match's event page.
  const reviews = useReviews(selectedChild?.id)
  const reviewOf = (match: { session_id?: string | null }) => match.session_id ? reviews.data?.bySession.get(match.session_id) : undefined
  return (
    <MobileShell>
      <div className="pt-3 pb-4">
        {/* TRAK-171 (live run 3): the tab is Events (players keep Sessions); the calendar icon opens this page too. */}
        <h1 className="text-xl text-foreground mb-5">Events</h1>
        <ParentChildSelector />
        <ParentFamilyContent>
          {/* J8.8 (TRAK-131): the selected child's upcoming events. */}
          <ParentUpcomingEvents />
          {/* TRAK-214 (Kostas, 16 Oct list item 3): past matches are boxed cards under
              their own heading, the same box as an Upcoming card, 3 then See more. */}
          <section className="mb-5" aria-label="Match history">
            <MetadataLabel text="MATCH HISTORY" />
            <div className="mt-2 space-y-2">
              {query.isError ? <ParentLoadError message="Couldn't load matches." onRetry={() => { void query.refetch() }} />
                : query.isPending ? <ParentLoading />
                  : matches.length === 0 ? <p className="text-sm text-muted-foreground">No matches yet.</p>
                    : <SeeMoreList items={matches} render={match => <Link key={match.id} to={reviewOf(match) ? `/parent/event/${reviewOf(match)}` : parentMatchHref(match)}
                      state={{ matchId: match.id, childId: selectedChild?.id }}
                      className="flex items-stretch gap-3 rounded-[14px] p-3.5"
                      style={{ background: 'rgb(var(--t-surface))', border: '1px solid rgb(var(--t-line))' }}>
                      <div aria-hidden="true" className="w-1 rounded-full flex-shrink-0" style={{ background: EVENT_COLOR.match }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-ink truncate">{match.opponent || match.competition || 'Match'}</p>
                        <p className="text-[11px] mt-0.5 text-ink-2">
                          {[formatParentDate(match.match_date ?? match.created_at), match.competition, match.venue].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0 self-center">
                        {reviewOf(match) ? <span className="arc"><Badge size="sm" tone="success">Coach’s review</Badge></span>
                          : <ParentRating rating={match.computed_rating} />}
                        <p className="text-[11px] text-ink-2 mt-1">{matchResult(match)
                          ? `${matchResult(match)} ${match.team_score}–${match.opponent_score}` : 'Score not recorded'}</p>
                      </div>
                    </Link>} />}
            </div>
          </section>
          {/* J6 (TRAK-77): the training the coach logged for this child. */}
          {selectedChild && <TrainingHistory key={selectedChild.id} playerUserId={selectedChild.id}
            assessmentHref={sessionId => `/parent/session/${encodeURIComponent(sessionId)}/assessment`}
            waitingText="Training appears once you approve this child." />}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
