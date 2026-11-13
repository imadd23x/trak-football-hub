import { useNavigate, useLocation } from 'react-router-dom'
import { MobileShell, NavBar, MetadataLabel } from '@/components/trak'
import { HomeHeader } from '@/components/trak/HomeHeader'
import { LoadedWeekStrip } from '@/components/trak/WeekStrip'
import { EventSheet } from '@/components/trak/EventSheet'
import { CantMakeIt, CantMakeItButton } from '@/components/parent/CantMakeIt'
import { supabase } from '@/integrations/supabase/client'
import { ParentChildSwitcher, ParentFamilyContent, ParentLoadError, ParentLoading, ParentRating } from '@/components/parent/ParentFamily'
import { ParentAlertsBell } from '@/components/parent/ParentAlertsBell'
import { ApprovedAwaitingList } from '@/components/parent/ApprovedAwaitingSignup'
import { useParentChildren } from '@/contexts/ParentChildrenContext'
import { useChildrenAwaitingConsent, useParentDevelopment, useParentEvents, useParentMatches, useRosterChildrenAwaitingConsent, useChildLogins } from '@/hooks/useParentData'
import { averageRecordedRating, formatParentAward, formatParentDate, matchResult } from '@/lib/parent-data'
import { CalendarHomePrompt } from '@/components/trak/AddToCalendar'
import { ParentAssessmentCarousel } from '@/components/parent/ParentAssessmentCarousel'
import { useProgressLines } from '@/lib/evaluation-progress'
import { useMySeason } from '@/lib/my-season'
import { FamilySeasonCard } from '@/components/parent/FamilySeasonCard'
import { ParentConsentBar } from '@/pages/parent/ParentConsent'
import { FrameActions, useFamilyLook } from '@/components/trak/FamilyFrame'
import { ForYou } from '@/components/trak/ForYou'
import { LatestEvaluation } from '@/components/player/LatestEvaluation'
import { SeasonSoFar } from '@/components/player/SeasonSoFar'

export default function ParentHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const { selectedChild, parentId } = useParentChildren()
  const matchQuery = useParentMatches()
  const developmentQuery = useParentDevelopment()
  // TRAK-133: the same query Next up reads (no extra request).
  const eventsQuery = useParentEvents()
  const consentQuery = useChildrenAwaitingConsent()
  const rosterConsentQuery = useRosterChildrenAwaitingConsent()
  const loginQuery = useChildLogins()
  // Children waiting on this guardian: with an account, and rostered ones who
  // have none yet (TRAK-11 phase 4; first names only).
  const waitingNames = [...(consentQuery.data ?? []).map(child => child.full_name),
    ...(rosterConsentQuery.data ?? []).map(child => child.first_name)]
  const matches = matchQuery.data ?? []
  const development = developmentQuery.data
  const award = development?.awards[0]
  const details = development?.details
  // TRAK-402: an evaluation's card says how the objectives went; a failed read leaves the card as it was.
  // TRAK-437: the position the coach set for this child, nothing if none; never the sign-up value.
  const position = useMySeason(selectedChild?.id, !!selectedChild).data?.position
  const progressLines = useProgressLines(development?.assessments.slice(0, 5) ?? [], selectedChild?.id)
  const hasError = matchQuery.isError || developmentQuery.isError
  const loading = matchQuery.isPending || developmentQuery.isPending
  // TRAK-441 slice 2.6 (Imad, 13 Nov), behind family_look: the coach's Home, as the player's.
  const look = useFamilyLook()
  const latest = development?.assessments[0]
  const bell = <ParentAlertsBell />
  const header = <HomeHeader calendarTo="/parent/matches" center={<ParentChildSwitcher />} right={bell} />
  const week = selectedChild && <LoadedWeekStrip key={selectedChild.id} loadKey={selectedChild.id} absentFor={selectedChild.id} picker={look}
    renderSheet={(event, trigger) => <EventSheet event={event} role="parent" trigger={trigger}>
      <CantMakeIt key={selectedChild.id} event={event} child={selectedChild} />
    </EventSheet>}
    renderPrimary={event => <CantMakeItButton key={selectedChild.id} event={event} child={selectedChild} />}
    load={(from, to) => supabase.rpc('child_events', { p_child: selectedChild.id })
      .gte('event_date', from).lte('event_date', to).order('event_date', { ascending: true })} />
  const calendarPrompt = <CalendarHomePrompt hasEvents={(eventsQuery.data?.length ?? 0) > 0} />
  const season = selectedChild && <FamilySeasonCard key={selectedChild.id} child={selectedChild} />
  const recognition = award && <section className="mt-5" aria-label="Recognition">
    <MetadataLabel text="RECOGNITION" />
    <div className="rounded-xl p-4 mt-2 bg-card border border-border">
      <p className="text-sm text-foreground">{formatParentAward(award.award_type)}</p>
      {award.awarded_for && <p className="text-xs text-muted-foreground mt-2">{award.awarded_for}</p>}
      {award.note && <p className="text-sm text-foreground mt-2 italic">&ldquo;{award.note}&rdquo;</p>}
      <p className="text-xs text-muted-foreground mt-2">{formatParentDate(award.created_at)}</p>
    </div>
  </section>

  return (
    <MobileShell width={look ? 'wide' : 'page'}>
      <div className="pt-3 pb-4">
        {/* TRAK-163: calendar, the child (switcher), the bell (TRAK-74: alerts are a bell, not a tab). TRAK-441: on a
            laptop the bell is in the top bar and the child switcher in the side menu. */}
        {look ? <FrameActions fallback={header}>{bell}</FrameActions> : header}
        {consentQuery.isError || rosterConsentQuery.isError ? (
          <ParentLoadError message="Couldn't check pending approvals." onRetry={() => { void consentQuery.refetch(); void rosterConsentQuery.refetch() }} />
        ) : waitingNames.length > 0 && parentId && (
          // TRAK-182 (Imad, 16 Oct): Arc's consent bar at the bottom, not a banner and a page of its own.
          <ParentConsentBar parentId={parentId} />
        )}
        {/* TRAK-98: approved children who haven't signed up aren't in the family list yet. */}
        <ApprovedAwaitingList />
        {/* TRAK-111: only for a login still to make; a ready one is listed until the child's first sign-in. */}
        {loginQuery.isError ? <ParentLoadError message="Couldn't check your children's logins." onRetry={() => {void loginQuery.refetch()}} />
          : loginQuery.data?.some(login => !login.ready) && <button onClick={()=>navigate('/parent/consent')}
            className="w-full text-left rounded-xl border border-primary/30 bg-primary/10 p-4 mb-4">
            <p className="text-sm text-foreground">Finish your child's login setup</p>
            <p className="text-xs text-muted-foreground">Create or view the username they need to sign in.</p>
          </button>}
        <ParentFamilyContent>
          {hasError ? <ParentLoadError onRetry={() => { void matchQuery.refetch(); void developmentQuery.refetch() }} />
            : loading ? <ParentLoading /> : look ? (
              // TRAK-441 slice 2.6: the week, For you and the season; then Latest evaluation and Season so far. No rating
              // (TRAK-435): "Recorded matches" and the swipe cards are gone; the evaluation's page has the rest.
              <div className="grid grid-cols-[minmax(0,1fr)] gap-5 laptop:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] laptop:items-start laptop:gap-6">
                <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5">
                  {week}
                  {calendarPrompt}
                  {selectedChild && <ForYou key={selectedChild.id} childId={selectedChild.id} as="parent" childFirst={selectedChild.name.split(' ')[0]} />}
                  {season}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5">
                  {latest && parentId && selectedChild && <LatestEvaluation assessment={latest} readerId={parentId} childId={selectedChild.id}
                    href={`/parent/assessment/${encodeURIComponent(latest.id)}`} />}
                  {selectedChild && <SeasonSoFar key={selectedChild.id} childId={selectedChild.id} />}
                  {recognition}
                </div>
              </div>
            ) : (
              <>
                {details && <p className="text-xs text-muted-foreground text-center -mt-1 pb-4">
                  {[position, details.current_club, details.age_group].filter(Boolean).join(' · ')}
                </p>}
                {/* TRAK-163: the selected child's week, Monday to Sunday, under the header. */}
                {week}
                {/* TRAK-133 (J8.10): once there are events, offer the phone calendar. */}
                {calendarPrompt}
                {/* TRAK-399: the Season plan card for the chosen child; nothing when the coach has not shared. */}
                {season}
                {matches.length > 0 && (
                  <section className="rounded-xl p-5 mb-4 bg-card border border-border" aria-label="Recorded matches summary">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <MetadataLabel text="RECORDED MATCHES" />
                        <div className="mt-3"><ParentRating rating={averageRecordedRating(matches)} /></div>
                      </div>
                      <div className="text-right"><MetadataLabel text="MATCHES" /><p className="text-3xl font-light mt-2 text-foreground">{matches.length}</p></div>
                    </div>
                    <div className="flex gap-5 pt-4 mt-4 border-t border-border">
                      {(['W', 'D', 'L'] as const).map(result => <div key={result} className="text-sm text-foreground">
                        {matches.filter(match => matchResult(match) === result).length} <span className="text-muted-foreground">{result}</span>
                      </div>)}
                    </div>
                  </section>
                )}
                {development && <ParentAssessmentCarousel
                  key={`${selectedChild?.id}:${development.assessments.slice(0, 5).map(row => row.id).join(',')}`}
                  assessments={development.assessments} progressLines={progressLines} />}

                {recognition}
                {/* TRAK-194 (Kostas, 16 Oct): no "Recent matches" here; the Matches tab lists every match. */}
              </>
            )}
        </ParentFamilyContent>
      </div>
      <NavBar role="parent" activeTab={location.pathname} onNavigate={navigate} />
    </MobileShell>
  )
}
