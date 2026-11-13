import { useTranslation } from '@/lib/i18n'
import { COMPETITION_WORD } from '@/lib/games/match-words'
import { useState } from 'react'
import { COMPETITIONS, type Competition } from '@/lib/coach-events'
import type { PlayerPlans } from '@/lib/games/lineup'
import { hasPlayed, planAnswered, previewReview, publishSummary, type EvaluationForm } from '@/lib/games/evaluation'
import { GameReviewSection } from '@/components/player/GameReviewSection'
import { PlanReview, type ReviewRow } from '@/components/arc/blocks/plan-review/plan-review'
import { Button } from '@/components/arc/button/button'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Select } from '@/components/arc/select/select'

/* TRAK-289 (Games 7/8): the evaluation's Publish step (TRAK-282). "Publish to N players and families" waits for every
   "Did the plan work?" answer, and for the competition and home or away when the match has none (Imad, 29 Oct). In the
   app only: no email, no push. TRAK-375 (Imad, 5 Nov): one Evaluation review card, Game plan review's kind: the gauge,
   each part with its Edit, and Publish in the card. No preview or "Who sees what" here; the published page keeps the
   preview (ReviewPreview). */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const first = (name: string) => name.split(/\s+/)[0] || name
type Listed = { id: string; name: string; starter: boolean }
export type PublishChoices = { competition: Competition | ''; homeAway: 'home' | 'away' | '' }

export function PublishStep({ eventId, form, listed, goals, askCompetition, askHomeAway, onPublish, publishing, problem, onStep }: {
  eventId: string; form: EvaluationForm; listed: Listed[]
  /** How many goals the plan had: each needs a "Did the plan work?" answer. */
  goals: number
  /** The match has no competition, or no home or away, yet: ask it here. */
  askCompetition: boolean; askHomeAway: boolean
  onPublish: (choices: PublishChoices) => void
  publishing: boolean
  problem: string | null
  /** Opens a step, for a part's Edit. */
  onStep: (step: number) => void
}) {
  const [choices, setChoices] = useState<PublishChoices>({ competition: '', homeAway: '' })
  const { t } = useTranslation()
  const summary = publishSummary(form, listed)
  const answered = form.planWorked.slice(0, goals).filter(answer => answer != null).length
  const unscored = form.goals.filter(goal => !goal.scorer && !goal.own).length
  const outcome = t(form.ourScore > form.theirScore ? 'coachMatches:resultWon' : form.ourScore === form.theirScore ? 'coachMatches:resultDrew' : 'coachMatches:resultLost', { our: form.ourScore, their: form.theirScore })
  const rows: ReviewRow[] = [
    { id: 'result', label: t('coachMatches:evStepResult'), status: unscored ? 'watch' : 'good', onEdit: () => onStep(0),
      detail: `${outcome}${unscored ? t('coachMatches:goalsNoScorer', { count: unscored }) : ''}` },
    { id: 'played', label: t('coachMatches:whoPlayed'), status: summary.players ? 'good' : 'risk', onEdit: () => onStep(0), detail: t('coachMatches:playedCount', { count: summary.players }) },
    { id: 'plan', label: t('coachMatches:didPlanWork'), status: planAnswered(form, goals) ? 'good' : 'risk', onEdit: () => onStep(0),
      detail: goals ? t('coachMatches:answeredOf', { answered, goals }) : t('coachMatches:noInstructionsInPlan') },
    { id: 'players', label: t('coachMatches:evStepPlayers'), status: 'good', onEdit: () => onStep(1),
      detail: t('coachMatches:changedNotes', { changed: summary.changed, count: summary.notes }) },
  ]
  const incomplete = rows.filter(row => row.status !== 'good').length
  const band = incomplete === 0 ? { status: 'good' as const, label: t('coachMatches:readyToPublish') }
    : { status: rows.some(row => row.status === 'risk') ? 'risk' as const : 'watch' as const, label: t('coachMatches:incompleteCount', { count: incomplete }) }
  const blocked = !planAnswered(form, goals) ? t('coachMatches:blockedPlan')
    : askCompetition && !choices.competition ? t('coachMatches:blockedCompetition')
    : askHomeAway && !choices.homeAway ? t('coachMatches:blockedHomeAway')
    : summary.players === 0 ? t('coachMatches:blockedPlayed') : null
  return (
    <div className="arc">
      <PlanReview title={t('coachMatches:evReviewTitle')} footerId="evaluation-publish" rows={rows} band={band}>
        {askCompetition && <RadioGroup label={t('coachSchedule:competition')} name={`publish-competition-${eventId}`} options={COMPETITIONS.map(option => ({ ...option, label: t(COMPETITION_WORD[option.value]) }))}
          value={choices.competition} onValueChange={value => setChoices({ ...choices, competition: value as Competition })} />}
        {askHomeAway && <RadioGroup label={t('coachSchedule:homeOrAway')} name={`publish-home-away-${eventId}`}
          options={[{ value: 'home', label: t('coachSchedule:home') }, { value: 'away', label: t('coachSchedule:away') }]}
          value={choices.homeAway} onValueChange={value => setChoices({ ...choices, homeAway: value as 'home' | 'away' })} />}
        <div className="flex flex-wrap items-center gap-3">
          {blocked && <span className="text-sm text-ink-3">{blocked}</span>}
          <span className="ml-auto"><Button disabled={!!blocked} loading={publishing} onClick={() => onPublish(choices)}>
            {t('coachMatches:publishTo', { count: summary.players })}</Button></span>
        </div>
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      </PlanReview>
    </div>
  )
}

/** What each player and their parent read, drawn by their own After the match section. Also the published view's. */
export function ReviewPreview({ eventId, form, listed, plans, coachName }: {
  eventId: string; form: EvaluationForm; listed: Listed[]; plans: PlayerPlans; coachName: string | null
}) {
  const [as, setAs] = useState<'player' | 'parent'>('player')
  const { t } = useTranslation()
  const [pick, setPick] = useState<string | null>(null)
  const played = listed.filter(p => hasPlayed(form, p.id, p.starter))
  const shown = played.find(p => p.id === pick) ?? played[0]
  return (
    <section aria-labelledby={`evaluation-preview-${eventId}`} className={card}>
      <h2 id={`evaluation-preview-${eventId}`} className="text-lg font-medium text-ink">{t('coachMatches:preview')}</h2>
      {!shown ? <p className="text-sm text-ink-2">{t('coachMatches:nobodyWouldRead')}</p> : <>
        <SegmentedControl label={t('coachMatches:previewAs')} value={as} onValueChange={value => setAs(value as 'player' | 'parent')}
          options={[{ value: 'player', label: t('coachMatches:asPlayer') }, { value: 'parent', label: t('coachMatches:asParent') }]} />
        <div className="max-w-[320px]">
          <Select label={t('nav:player')} value={shown.id} onValueChange={setPick} options={played.map(p => ({ value: p.id, label: p.name }))} />
        </div>
        <div className="rounded-[24px] border border-line bg-ground p-4">
          <GameReviewSection review={previewReview(form, shown.id, plans, coachName, as)} as={as} childName={first(shown.name)} />
        </div>
      </>}
    </section>
  )
}
