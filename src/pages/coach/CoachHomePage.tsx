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
import { SeasonPlanCard } from '@/components/coach/home/SeasonPlanCard'
import { planSquad } from '@/lib/season-plan'
import { useOwedEvents } from '@/components/coach/home/useOwedEvents'
import { gameTitle, gameWhen, useGamePlanChanges, useGamePlans, useGameShares, useGames } from '@/components/coach/games/useGames'
import { STATE, gameState, needsAPlan } from '@/lib/games/loop'
import { MatchAction } from '@/components/coach/games/MatchAction'
import { useFeature } from '@/components/trak/parked'
import { eventHeading, toPlayerEvent } from '@/lib/player-events'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { useCoachSquad } from '@/lib/coach-squad'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { needsYou } from '@/lib/coach-needs-you'
import { unplacedBySquad } from '@/lib/positions'
import { useWatchList } from '@/components/coach/season-plan/useWatching'
import { useSquadEvaluations } from '@/components/coach/season-plan/useEvaluation'
import { useStuckObjectives } from '@/components/coach/season-plan/useObjectiveProgress'
import { usePlayerObjectives } from '@/components/coach/season-plan/usePlayerObjectives'
import { StuckSheet, type StuckTarget } from '@/components/coach/season-plan/StuckSheet'
import { evalDay } from '@/lib/evaluation'
import { Button } from '@/components/arc/button/button'
import { squadShape } from '@/lib/squad/shape'
import { localParts, localTodayISO } from '@/lib/event-time'
import { dateLocale, useLanguage } from '@/lib/i18n'

/* TRAK-262 (Imad, 22 Oct): coach Home on Arc. Squad pills (each squad, then All, which is Home's only); the week
   in Tarek's colour key with one next step per event; the Squad shape radar; Needs you. "Assess a player" and
   "Log a match" left: the "+" has both. TRAK-266: no onboarding for now (Imad, 22 Oct).
   Imad, 23 Oct: no role and academy line under the header. TRAK-304 (Kostas, 28 Oct): where Training or Games is
   switched on, Today (that day's training or game plan) takes Squad shape's place; on a phone it comes first. */

export default function CoachHomePage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  // TRAK-407: the words, and a new render when the language changes.
  const { t, language } = useLanguage()
  const coachSquad = useCoachSquad(user?.id)
  const wide = useSideMenuScreen()
  // TRAK-182 part 8: a quick-add draft shows in the week at once.
  const [weekVersion, setWeekVersion] = useState(0)
  // TRAK-305: All or one squad, as picked at the top of the frame. All exists only with two squads or more.
  const { everySquad } = coachSquad
  const roster = useSquadRoster()
  const squadLabel = everySquad ? t('coachHome:allSquads') : coachSquad.squad ?? coachSquad.squads[0] ?? t('coachHome:yourSquad')

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
  // TRAK-364: where the season plan is on and a squad's plan is shared, the squad's evaluation takes the place of its
  // per-player Assess cards. Until that's known the cards wait, so none shows and then goes. A failed read only leaves
  // the evaluation out: the per-player cards show as before (the season plan's card says what failed).
  const evaluations = useSquadEvaluations(user?.id, coachSquad.squads)
  const cards = useMemo(() => loaded
    ? needsYou({ players: roster.players, waitingForParent: roster.consentPending, assessments: roster.assessments, now: Date.now(),
      evaluatedSquads: evaluations.failed ? undefined : evaluations.evaluated })
    // TRAK-407: the reasons are words, so a new language writes them again.
    : null, [loaded, roster.players, roster.consentPending, roster.assessments, evaluations.evaluated, evaluations.failed, language])

  // Imad, 24 Oct: events the week marks "Needs you" are in Needs you too, with the week's own next step.
  const client = useQueryClient()
  const eventsOn = useFeature('events')
  // TRAK-284: a match a week out or less, its logistics shared, without a shared plan. TRAK-286: or with changes since
  // it was shared that wait for "Share changes". TRAK-288: a played match is evaluated, not logged.
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
    && evaluations.ready
  const owedChanged = () => {
    setWeekVersion(v => v + 1)
    void client.invalidateQueries({ queryKey: ['coach', user?.id, 'owed-events'] })
  }
  const owedEvents: OwedEvent[] = !user ? [] : (owed.items ?? []).map(item => {
    const event = toPlayerEvent(item.source)
    const remindAt = item.step === 'publish-evaluation' ? owed.reminders?.get(item.id) : undefined
    return {
      id: item.id,
      title: event ? eventHeading(event) : item.title,
      when: `${format(parseISO(item.date), 'EEE d MMM', { locale: dateLocale() })}${item.time ? ` · ${item.time}` : ''}`,
      squad: coachSquad.squads.length >= 2 ? squadName(item.source.squad) : null,
      reason: item.step === 'evaluate' ? t('coachHome:owedEvaluate') : item.step === 'publish-evaluation' ? t('coachHome:owedEvaluationDraft')
        : item.kind === 'match' ? t('coachHome:owedLog') : t('coachHome:owedRegister'),
      action: <NextStep item={item} coachId={user.id} roster={undefined} onChanged={owedChanged} />,
      // TRAK-444: when it is about, so the newest come first.
      at: Date.parse(`${item.date}T${/^\d{2}:\d{2}/.test(item.time ?? '') ? item.time!.slice(0, 5) : '00:00'}`),
      // TRAK-290: from 09:00 the morning after the draft was saved (the academy's clock), worked out as Home is read.
      urgent: remindAt !== undefined && Date.now() >= Date.parse(remindAt),
    }
  })
  // The game's own next step (Write plan, Share plan, Share changes); a shared plan with nothing new has none.
  const planEvents: OwedEvent[] = soon.flatMap(game => {
    const changed = changes.data?.get(game.id)?.length ?? 0
    const state = gameState(game, Date.now(), { drafted: plans.data?.has(game.id), shared: shares.data?.has(game.id), sharedAt: shares.data?.get(game.id), changes: changed })
    const action = STATE[state].action
    if (!action) return []
    const { day, time } = gameWhen(game)
    return [{
      id: game.id, title: gameTitle(game), when: [day, time].filter(Boolean).join(' · '),
      squad: coachSquad.squads.length >= 2 ? squadName(game.squad) : null,
      reason: state === 'changes' ? t('coachHome:changesNotShared', { count: changed }) : t('coachHome:planNotShared'),
      // TRAK-333 (Imad, 2 Nov): every match action is a split button, with the match's other pages behind its chevron.
      action: <MatchAction state={state} eventId={game.id} />,
      at: Date.parse(game.starts_at),
    }]
  })
  // TRAK-364: one Evaluation due card per squad whose evaluation is due, in place of its per-player Assess cards. A
  // missed date stays due (urgent once its day has passed). Under All, the card picks its squad, as the others do.
  const evaluationEvents: OwedEvent[] = evaluations.list.filter(e => e.due.dueOn && (everySquad || coachSquad.inSquad(e.squad))).map(({ squad, due }) => ({
    id: `evaluation:${squad}`,
    title: t('coachHome:evaluationDue'),
    when: evalDay(due.since!),
    squad: coachSquad.squads.length >= 2 ? squad : null,
    reason: due.since! < evaluations.today ? t('coachHome:evaluationDueSince', { day: evalDay(due.since!) })
      : t('coachHome:evaluationDueNow'),
    urgent: due.since! < evaluations.today,
    at: Date.parse(`${due.since}T00:00`),
    action: <span className="arc"><Button size="sm" onClick={() => { if (everySquad) coachSquad.pick(squad); navigate('/coach/evaluation') }}>{t('coachHome:evaluate')}</Button></span>,
  }))
  // TRAK-352: where the season plan is on, one card per squad with consented players still to place. A newly
  // consented child has no position, so they join it.
  // Under All, a card picks its squad as the switcher does (TRAK-361): the season plan is one squad's, so All has to go.
  const seasonPlanOn = useFeature('season_plan')
  const positionEvents: OwedEvent[] = !seasonPlanOn || !loaded ? [] : unplacedBySquad(roster.players, roster.consentPending).map(({ squad, count }) => ({
    id: `positions:${squad ?? ''}`,
    title: t('coachHome:needPosition', { count }),
    when: '',
    squad: coachSquad.squads.length >= 2 ? squad : null,
    reason: t('coachHome:needPositionWhy'),
    action: <span className="arc"><Button size="sm" onClick={() => { if (everySquad && squad) coachSquad.pick(squad); navigate('/coach/season-plan/positions') }}>{t('coachHome:placeThem')}</Button></span>,
  }))
  // TRAK-355: a watched player whose reminder is due comes back, one card each, opening the step where they were left.
  const watching = useWatchList(user?.id, roster, seasonPlanOn)
  // TRAK-365: an objective with Not yet three evaluations in a row, one card each. Asked only where an evaluation exists.
  const [stuckTarget, setStuckTarget] = useState<StuckTarget | null>(null)
  const stuck = useStuckObjectives(user?.id, seasonPlanOn && evaluations.evaluated.size > 0)
  const heldObjectives = usePlayerObjectives(user?.id, seasonPlanOn && (stuck.data?.length ?? 0) > 0)
  const stuckEvents: OwedEvent[] = (stuck.data ?? []).flatMap(row => {
    const player = roster.players.find(p => p.id === row.squad_player_id)
    const objective = heldObjectives.of(row.squad_player_id).find(o => o.id === row.player_objective_id)
    const squad = player?.age_group?.trim() ?? null
    if (!player || !objective || (!everySquad && !coachSquad.inSquad(squad ?? ''))) return []
    return [{
      id: `stuck:${objective.id}`,
      title: t('coachHome:stuckTitle', { name: player.player_name.split(' ')[0] }),
      when: '',
      squad: coachSquad.squads.length >= 2 ? squad : null,
      reason: t('coachHome:stuckWhy', { objective: objective.title }),
      action: <span className="arc"><Button size="sm" onClick={() => setStuckTarget({ objectiveId: objective.id, objective: objective.title, playerId: player.id, playerName: player.player_name })}>{t('coachHome:choose')}</Button></span>,
    }]
  })
  const watchEvents: OwedEvent[] = !seasonPlanOn ? [] : watching.list.filter(w => w.ready).map(w => ({
    id: `watch:${w.playerId}`,
    title: t('coachHome:watchTitle', { why: w.why === '4 weeks, the latest' ? t('coachHome:watchedFourWeeks') : w.why, name: w.name.split(' ')[0] }),
    when: '',
    squad: coachSquad.squads.length >= 2 ? w.squad : null,
    reason: w.step === 'positions' ? t('coachHome:watchPositions') : t('coachHome:watchObjectives'),
    action: <span className="arc"><Button size="sm" onClick={() => { if (everySquad && w.squad) coachSquad.pick(w.squad); navigate(`/coach/season-plan/${w.step}?player=${w.playerId}`) }}>{t('coachHome:setUp')}</Button></span>,
  }))


  return (
    <MobileShell width="wide">
      <div className="pt-3 pb-24">
        {/* TRAK-259: on a phone the avatar opens the menu and the calendar sits beside the bell; a laptop has both
            in the frame (the sidebar, the top bar). */}
        {!wide && <HomeHeader calendarTo="/coach/schedule" left={<CoachMenuButton name={profile?.full_name || t('nav:coach')} />}
          center={<HomeTitle>{profile?.full_name || t('nav:coach')}</HomeTitle>} right={user && <CoachAlertsBell coachId={user.id} />} />}

        <div className={wide ? 'grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-6' : 'grid gap-5'}>
          {user && <CoachWeekStrip coachId={user.id} version={weekVersion} everySquad={everySquad} />}
          {showToday
            // Kostas, 28 Oct: on a phone the week comes first, then today's plan.
            ? <TodayPlan trainingOn={trainingOn} gamesOn={gamesOn} inView={squad => everySquad || coachSquad.eventInSquad(squad)}
              squadOf={everySquad && coachSquad.squads.length >= 2 ? squadName : null} />
            : <SquadShape squadLabel={squadLabel} shape={shape} failed={!!roster.error} onRetry={roster.retry} />}
        </div>
        {/* Shown once the switch is known, so a coach who turned it off never sees it flash in. */}
        {(needsYouSwitch.data === true || needsYouSwitch.isError) && <div className={wide ? 'mt-6' : 'mt-5'}>
          <NeedsYou items={needsReady ? cards : null} events={[...owedEvents, ...planEvents, ...evaluationEvents, ...stuckEvents, ...positionEvents, ...watchEvents]}
            failed={!!roster.error || owed.failed || gamesFailed}
            onRetry={() => { roster.retry(); owed.retry(); if (evaluations.failed) evaluations.retry(); if (gamesOn) { void games.refetch(); void plans.refetch(); void shares.refetch() } }}
            onOpen={item => item.kind === 'draft'
              // TRAK-200: the profile's assessment card says Draft and has Publish.
              ? navigate(`/coach/squad/player/${item.playerId}`)
              : navigate('/coach/assess', { state: { preselectedPlayerId: item.playerId } })} />
        </div>}
        {/* TRAK-350: the season plan, where the academy's switch is on; TRAK-361: the card that folds, one per squad under All. */}
        {user && <SeasonPlanCard coachId={user.id} squads={coachSquad.squads} squadsReady={coachSquad.ready} squadsFailed={coachSquad.failed} onRetry={coachSquad.retry}
          squad={planSquad(coachSquad)} everySquad={everySquad}
          onPick={coachSquad.pick} className={wide ? 'mt-6' : 'mt-5'} />}
      </div>
      {user && <StuckSheet coachId={user.id} target={stuckTarget} onClose={() => setStuckTarget(null)} onSwapped={id => navigate(`/coach/squad/player/${id}`)} />}
      <QuickAdd onSaved={() => setWeekVersion(v => v + 1)} />
    </MobileShell>
  )
}
