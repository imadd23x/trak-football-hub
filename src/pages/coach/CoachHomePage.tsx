import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { QuickAdd } from '@/components/coach/QuickAdd'
import { HomeHeader, HomeTitle } from '@/components/trak/HomeHeader'
import { CoachAlertsBell } from '@/components/coach/CoachAlertsBell'
import { CoachWeekStrip, NextStep } from '@/components/coach/CoachWeekStrip'
import { squadName } from '@/lib/coach-week'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { SquadShape } from '@/components/coach/home/SquadShape'
import { TodayPlan } from '@/components/coach/home/TodayPlan'
import { NeedsYou, type OwedEvent } from '@/components/coach/home/NeedsYou'
import { useOwedEvents } from '@/components/coach/home/useOwedEvents'
import { gameTitle, gameWhen, useGamePlanChanges, useGamePlans, useGameShares, useGames } from '@/components/coach/games/useGames'
import { STATE, actionLink, gameState, needsAPlan } from '@/lib/games/loop'
import { useFeature } from '@/components/trak/parked'
import { eventHeading, toPlayerEvent } from '@/lib/player-events'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { useCoachSquad } from '@/lib/coach-squad'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { needsYou } from '@/lib/coach-needs-you'
import { squadShape } from '@/lib/squad/shape'
import { localParts, localTodayISO } from '@/lib/event-time'

/* TRAK-262 (Imad, 22 Oct): coach Home on Arc. Squad pills (each squad, then All, which is Home's only); the week
   in Tarek's colour key with one next step per event; the Squad shape radar; Needs you. "Assess a player" and
   "Log a match" left: the "+" has both. TRAK-266: no onboarding for now (Imad, 22 Oct).
   Imad, 23 Oct: no role and academy line under the header. TRAK-304 (Kostas, 28 Oct): where Training or Games is
   switched on, Today (that day's training or game plan) takes Squad shape's place; on a phone it comes first. */

export default function CoachHomePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const coachSquad = useCoachSquad(user?.id)
  const wide = useSideMenuScreen()
  // TRAK-182 part 8: a quick-add draft shows in the week at once.
  const [weekVersion, setWeekVersion] = useState(0)
  // TRAK-305: All or one squad, as picked at the top of the frame. All exists only with two squads or more.
  const { everySquad } = coachSquad
  const roster = useSquadRoster()
  const squadLabel = everySquad ? 'All squads' : coachSquad.squad ?? coachSquad.squads[0] ?? 'Your squad'

  // The coach's "Needs you" switch (Settings, TRAK-261): on unless turned off. A switch that can't be read shows the cards.
  const needsYouSwitch = useQuery({
    queryKey: ['coach', user?.id, 'needs-you'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_settings').select('needs_you').eq('user_id', user!.id).maybeSingle()
      if (error) throw error
      return data?.needs_you ?? true
    },
  })

  const loaded = !roster.isPending && !roster.error
  const shape = useMemo(() => loaded ? squadShape(roster.assessments, localTodayISO(), iso => localParts(iso).date) : null,
    [loaded, roster.assessments])
  const cards = useMemo(() => loaded
    ? needsYou({ players: roster.players, waitingForParent: roster.consentPending, assessments: roster.assessments, now: Date.now() })
    : null, [loaded, roster.players, roster.consentPending, roster.assessments])

  // Imad, 24 Oct: events the week marks "Needs you" are in Needs you too, with the week's own next step.
  const client = useQueryClient()
  const eventsOn = useFeature('events')
  // TRAK-284: a match a week out or less, its logistics shared, without a shared plan. TRAK-286: or with changes since
  // it was shared that wait for "Share the changes". TRAK-288: a played match is evaluated, not logged.
  const gamesOn = useFeature('games')
  const owed = useOwedEvents(user?.id, everySquad ? () => true : coachSquad.eventInSquad, eventsOn, gamesOn)
  const trainingOn = useFeature('training')
  const showToday = trainingOn || gamesOn
  const games = useGames(gamesOn)
  const plans = useGamePlans(gamesOn)
  const shares = useGameShares(gamesOn)
  const soon = !gamesOn ? [] : needsAPlan((games.data ?? []).filter(game => everySquad || coachSquad.eventInSquad(game.squad)), Date.now())
  // TRAK-287: a plan's card closes at its match's kick-off, with Home open or not.
  const [, setKickedOff] = useState(0)
  const nextKickOff = Math.min(...soon.map(game => Date.parse(game.starts_at)))
  useEffect(() => {
    if (!Number.isFinite(nextKickOff)) return
    const timer = setTimeout(() => setKickedOff(n => n + 1), Math.max(0, nextKickOff - Date.now()) + 250)
    return () => clearTimeout(timer)
  }, [nextKickOff])
  const sharedSoon = soon.filter(game => shares.data?.has(game.id)).map(game => game.id)
  const changes = useGamePlanChanges(sharedSoon, gamesOn)
  const gamesFailed = gamesOn && (games.isError || plans.isError || shares.isError)
  // Shown once all have answered: events added in front of player cards already on screen left the row scrolled past them.
  // A failed read of the changes only leaves their cards out.
  const needsReady = (!eventsOn || owed.items !== null || owed.failed)
    && (!gamesOn || gamesFailed || (!games.isPending && !plans.isPending && !shares.isPending && (!sharedSoon.length || !changes.isPending)))
  const owedChanged = () => {
    setWeekVersion(v => v + 1)
    void client.invalidateQueries({ queryKey: ['coach', user?.id, 'owed-events'] })
  }
  const owedEvents: OwedEvent[] = !user ? [] : (owed.items ?? []).map(item => {
    const event = toPlayerEvent(item.source)
    return {
      id: item.id,
      title: event ? eventHeading(event) : item.title,
      when: `${format(parseISO(item.date), 'EEE d MMM')}${item.time ? ` · ${item.time}` : ''}`,
      squad: coachSquad.squads.length >= 2 ? squadName(item.source.squad) : null,
      reason: item.step === 'evaluate' ? 'Played, not evaluated yet' : item.step === 'publish-evaluation' ? 'Evaluation draft · only you see it'
        : item.kind === 'match' ? 'Played, not logged yet' : 'Started, no register yet',
      action: <NextStep item={item} coachId={user.id} roster={undefined} onChanged={owedChanged} />,
    }
  })
  // The game's own next step (Write the plan, Share the plan, Share the changes); a shared plan with nothing new has none.
  const planEvents: OwedEvent[] = soon.flatMap(game => {
    const changed = changes.data?.get(game.id)?.length ?? 0
    const state = gameState(game, Date.now(), { drafted: plans.data?.has(game.id), shared: shares.data?.has(game.id), changes: changed })
    const action = STATE[state].action
    if (!action) return []
    const { day, time } = gameWhen(game)
    return [{
      id: game.id, title: gameTitle(game), when: [day, time].filter(Boolean).join(' · '),
      squad: coachSquad.squads.length >= 2 ? squadName(game.squad) : null,
      reason: state === 'changes' ? `Changes not shared · ${changed} ${changed === 1 ? 'player' : 'players'}` : 'Plan not shared',
      action: <Link to={actionLink(game.id, action)}
        className="arc inline-flex h-9 min-w-[128px] items-center justify-center gap-2 rounded-full bg-brand px-4 text-[14px] font-medium text-on-brand focus-visible:ring-2 focus-visible:ring-primary">{action.label}</Link>,
    }]
  })


  return (
    <MobileShell width="wide">
      <div className="pt-3 pb-24">
        {/* TRAK-259: on a phone the avatar opens the menu and the calendar sits beside the bell; a laptop has both
            in the frame (the sidebar, the top bar). */}
        {!wide && <HomeHeader calendarTo="/coach/schedule" left={<CoachMenuButton name={profile?.full_name || 'Coach'} />}
          center={<HomeTitle>{profile?.full_name || 'Coach'}</HomeTitle>} right={user && <CoachAlertsBell coachId={user.id} />} />}

        <div className={wide ? 'grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-6' : 'grid gap-5'}>
          {user && <CoachWeekStrip coachId={user.id} version={weekVersion} everySquad={everySquad} />}
          {showToday
            // Kostas, 28 Oct: on a phone the week comes first, then today's plan.
            ? <TodayPlan trainingOn={trainingOn} gamesOn={gamesOn} inView={squad => everySquad || coachSquad.eventInSquad(squad)} />
            : <SquadShape squadLabel={squadLabel} shape={shape} failed={!!roster.error} onRetry={roster.retry} />}
        </div>
        {/* Shown once the switch is known, so a coach who turned it off never sees it flash in. */}
        {(needsYouSwitch.data === true || needsYouSwitch.isError) && <div className={wide ? 'mt-6' : 'mt-5'}>
          <NeedsYou items={needsReady ? cards : null} events={[...owedEvents, ...planEvents]} failed={!!roster.error || owed.failed || gamesFailed}
            onRetry={() => { roster.retry(); owed.retry(); if (gamesOn) { void games.refetch(); void plans.refetch(); void shares.refetch() } }}
            onOpen={item => item.kind === 'draft'
              // TRAK-200: the profile's assessment card says Draft and has Publish.
              ? navigate(`/coach/player/${item.playerId}`)
              : navigate('/coach/assess', { state: { preselectedPlayerId: item.playerId } })} />
        </div>}
      </div>
      <QuickAdd onSaved={() => setWeekVersion(v => v + 1)} />
    </MobileShell>
  )
}
