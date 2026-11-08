import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { planSquad, useSeasonPlan } from '@/lib/season-plan'
import { evalDay, latestRatings, rhythmOf, rhythmText } from '@/lib/evaluation'
import { NavBar, WIDE_COLUMN } from '@/components/trak'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { useSquadEvaluations } from '@/components/coach/season-plan/useEvaluation'
import { EvaluationSteps } from '@/components/coach/season-plan/Evaluation'
import { usePlayerObjectives } from '@/components/coach/season-plan/usePlayerObjectives'

/* TRAK-364 (Season plan 16/18, spec TRAK-348): the squad's evaluation, behind the season plan's switch (App.tsx). It
   opens on its due date, once the plan is shared, and stays open until it's published (a missed date stays due). Home's
   Evaluation due card leads here. Before it's due it says when; after the season's last one, that there are no more.
   The session assessment (/coach/assess) stays as it is. */

export default function CoachEvaluation() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const squad = planSquad(useCoachSquad(user?.id))
  const season = useSeasonPlan(user?.id, squad)
  const squads = useMemo(() => (squad ? [squad] : []), [squad])
  const evaluations = useSquadEvaluations(user?.id, squads)
  const roster = useSquadRoster()
  // TRAK-365: the evaluation also asks how each open objective is going.
  const held = usePlayerObjectives(user?.id, !!season.plan?.shared_at)
  // Who it went out to, shown once it's published: the page then says when the next one is.
  const [published, setPublished] = useState<number | null>(null)
  const plan = season.plan
  const mine = evaluations.list.find(e => e.squad === squad) ?? null
  const due = mine?.due ?? null

  let body
  if (!squad) body = <p className="text-sm text-ink-2">Pick one squad in the menu to evaluate it.</p>
  else if (season.error) body = <LoadError what="your season plan" onRetry={season.retry} />
  else if (season.isPending) body = <LoadingSkeleton label="Loading your evaluation…" lines={3} className="pt-2" />
  else if (!plan?.shared_at) {
    body = <div className="arc grid justify-items-start gap-3">
      <p className="text-sm text-ink-2">The evaluation opens once the season plan is shared, on its first date.</p>
      <Button variant="secondary" onClick={() => navigate('/coach/season-plan')}>Season plan</Button>
    </div>
  } else if (evaluations.failed || roster.error || held.isError) {
    body = <LoadError what="your evaluation" onRetry={() => { evaluations.retry(); roster.retry(); void held.refetch() }} />
  } else if (!evaluations.ready || !mine || roster.isPending || held.isPending) body = <LoadingSkeleton label="Loading your evaluation…" lines={1} avatar rows={4} className="pt-2" />
  else if (!due?.dueOn) {
    const { every, day } = rhythmOf(plan)
    body = <div className="arc grid gap-4">
      {published !== null && <Alert tone="success" title={`Published to ${published} ${published === 1 ? 'player' : 'players'}.`}>
        Each sees their band and your note. Their families see the band, never the note.</Alert>}
      <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-ink-2">{due?.next
        ? `The next evaluation opens ${evalDay(due.next, true)}. Everyone starts where they were last time; you change only who moved.`
        : 'No more evaluations this season.'} <span className="text-ink-3">You evaluate {rhythmText(every, day)}.</span></p>
      <div><Button variant="secondary" onClick={() => navigate('/coach/home')}>Back to Home</Button></div>
    </div>
  } else {
    const inSquad = roster.players.filter(p => p.age_group?.trim() === squad)
    const players = inSquad.filter(p => !roster.consentPending.has(p.id))
      .map(p => ({ id: p.id, name: p.player_name, detail: [p.position, p.shirt_number != null ? `#${p.shirt_number}` : null].filter(Boolean).join(' · ') }))
    const waiting = inSquad.filter(p => roster.consentPending.has(p.id)).map(p => p.player_name)
    body = <div className="grid gap-4">
      {due.since && due.since < evaluations.today && <Alert tone="warning" title={`Due since ${evalDay(due.since)}.`}>
        It stays here until you publish it. One evaluation covers every date since.</Alert>}
      <EvaluationSteps key={`${plan.id}:${due.dueOn}`} coachId={user!.id} planId={plan.id} squad={squad} dueOn={due.dueOn}
        players={players} waiting={waiting} latest={latestRatings(roster.assessments)} objectivesOf={held.of}
        onPublished={setPublished} onRefused={roster.retry} />
    </div>
  }

  return (
    <div className="min-h-screen bg-ground pb-24">
      <div className={WIDE_COLUMN}>
        <CoachTrail className="mt-5" current="Evaluation" />
        <header className="pt-4 pb-4">
          <div className="flex items-center gap-2">
            <CoachMenuButton name={profile?.full_name || 'Coach'} />
            <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Evaluation</h1>
          </div>
          {squad && due?.dueOn && <p className="mt-1 text-sm text-ink-3">{squad} · due {evalDay(due.dueOn)} · only you see it until you publish</p>}
        </header>
        {body}
      </div>
      <NavBar role="coach" activeTab={location.pathname} onNavigate={navigate} />
    </div>
  )
}
