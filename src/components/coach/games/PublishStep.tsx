import { useState } from 'react'
import { Lock } from 'lucide-react'
import { COMPETITIONS, type Competition } from '@/lib/coach-events'
import type { PlayerPlans } from '@/lib/games/lineup'
import { hasPlayed, planAnswered, previewReview, publishSummary, type EvaluationForm } from '@/lib/games/evaluation'
import { GameReviewSection } from '@/components/player/GameReviewSection'
import { Button } from '@/components/arc/button/button'
import { RadioGroup } from '@/components/arc/radio-group/radio-group'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Select } from '@/components/arc/select/select'

/* TRAK-289 (Games 7/8): the evaluation's Publish step (TRAK-282). The summary, who sees what, and a preview drawn by
   the player's and the parent's own After the game section, as Share previews the plan. "Publish to N players and
   families" waits for every "Did the plan work?" answer, and for the competition and home or away when the match has
   none (Imad, 29 Oct). In the app only: no email, no push. */

const card = 'grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5'
const first = (name: string) => name.split(/\s+/)[0] || name
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
type Listed = { id: string; name: string; starter: boolean }
export type PublishChoices = { competition: Competition | ''; homeAway: 'home' | 'away' | '' }

export function PublishStep({ eventId, form, listed, plans, goals, coachName, askCompetition, askHomeAway, onPublish, publishing, problem }: {
  eventId: string; form: EvaluationForm; listed: Listed[]; plans: PlayerPlans
  /** How many goals the plan had: each needs a "Did the plan work?" answer. */
  goals: number
  coachName: string | null
  /** The match has no competition, or no home or away, yet: ask it here. */
  askCompetition: boolean; askHomeAway: boolean
  onPublish: (choices: PublishChoices) => void
  publishing: boolean
  problem: string | null
}) {
  const [choices, setChoices] = useState<PublishChoices>({ competition: '', homeAway: '' })
  const summary = publishSummary(form, listed)
  const blocked = !planAnswered(form, goals) ? 'Answer “Did the plan work?” for every goal first.'
    : askCompetition && !choices.competition ? 'Pick the competition first.'
    : askHomeAway && !choices.homeAway ? 'Say whether it was home or away first.'
    : summary.players === 0 ? 'Tick who played in Result first.' : null
  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:items-start">
      <div className="grid min-w-0 gap-4">
        <section aria-labelledby="evaluation-publish" className={card}>
          <div>
            <h2 id="evaluation-publish" className="text-lg font-medium text-ink">Publish</h2>
            <p className="mt-1 text-sm text-ink-2">
              {count(summary.players, 'player', 'players')} · {summary.changed} changed from “Met” · {count(summary.notes, 'note', 'notes')}</p>
          </div>
          {askCompetition && <RadioGroup label="Competition" name={`publish-competition-${eventId}`} options={COMPETITIONS}
            value={choices.competition} onValueChange={value => setChoices({ ...choices, competition: value as Competition })} />}
          {askHomeAway && <RadioGroup label="Home or away" name={`publish-home-away-${eventId}`}
            options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
            value={choices.homeAway} onValueChange={value => setChoices({ ...choices, homeAway: value as 'home' | 'away' })} />}
          <span><Button disabled={!!blocked} loading={publishing} onClick={() => onPublish(choices)}>
            Publish to {count(summary.players, 'player', 'players')} and families</Button></span>
          {blocked && <p className="text-sm text-ink-3">{blocked}</p>}
          {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
        </section>
        <section aria-labelledby="evaluation-who" className={card}>
          <h2 id="evaluation-who" className="text-lg font-medium text-ink">Who sees what</h2>
          <ul className="divide-y divide-line">
            <li className="grid gap-0.5 py-3"><span className="text-sm font-medium text-ink">Each player</span>
              <span className="text-sm text-ink-3">Their job, how it went, what you expected and how they did against it, and your note.</span></li>
            <li className="grid gap-0.5 py-3"><span className="text-sm font-medium text-ink">Families</span>
              <span className="text-sm text-ink-3">The same, without your note. That’s the player’s business.</span></li>
            <li className="grid gap-0.5 py-3"><span className="flex items-center gap-1.5 text-sm font-medium text-ink">Only you<Lock size={14} aria-hidden="true" /></span>
              <span className="text-sm text-ink-3">How strong they were, scouting and how they scored, always.</span></li>
          </ul>
        </section>
      </div>
      <ReviewPreview eventId={eventId} form={form} listed={listed} plans={plans} coachName={coachName} />
    </div>
  )
}

/** What each player and their parent read, drawn by their own After the game section. Also the published view's. */
export function ReviewPreview({ eventId, form, listed, plans, coachName }: {
  eventId: string; form: EvaluationForm; listed: Listed[]; plans: PlayerPlans; coachName: string | null
}) {
  const [as, setAs] = useState<'player' | 'parent'>('player')
  const [pick, setPick] = useState<string | null>(null)
  const played = listed.filter(p => hasPlayed(form, p.id, p.starter))
  const shown = played.find(p => p.id === pick) ?? played[0]
  return (
    <section aria-labelledby={`evaluation-preview-${eventId}`} className={card}>
      <h2 id={`evaluation-preview-${eventId}`} className="text-lg font-medium text-ink">Preview</h2>
      {!shown ? <p className="text-sm text-ink-2">Nobody is ticked as playing, so nobody would read it.</p> : <>
        <SegmentedControl label="Preview as" value={as} onValueChange={value => setAs(value as 'player' | 'parent')}
          options={[{ value: 'player', label: 'As the player' }, { value: 'parent', label: 'As the parent' }]} />
        <div className="max-w-[320px]">
          <Select label="Player" value={shown.id} onValueChange={setPick} options={played.map(p => ({ value: p.id, label: p.name }))} />
        </div>
        <div className="rounded-[24px] border border-line bg-ground p-4">
          <GameReviewSection review={previewReview(form, shown.id, plans, coachName, as)} as={as} childName={first(shown.name)} />
        </div>
      </>}
    </section>
  )
}
