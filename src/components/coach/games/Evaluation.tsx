import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ClipboardCheck, Moon } from 'lucide-react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { EventRow } from '@/lib/coach-events'
import type { PlayerPlans } from '@/lib/games/lineup'
import { formToSave, hasPlayed, lineUpAtKickOff, publishSummary, type EvaluationForm } from '@/lib/games/evaluation'
import { useWhoCanCome } from './useGames'
import { ResultStep } from './ResultStep'
import { TeamStep } from './TeamStep'
import { PlayersStep } from './PlayersStep'
import { PublishStep, ReviewPreview, type PublishChoices } from './PublishStep'
import { GameHistory } from './GameHistory'
import { LoadError } from '@/components/trak'
import { Alert } from '@/components/arc/alert/alert'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { Stepper } from '@/components/arc/stepper/stepper'

/* TRAK-288 (Games 6/8): the Evaluation tab. It opens at full time; before that it says when. Result, Team and Players,
   read against the plan as it locked at kick-off, as one draft only the coach sees: Save draft · sleep on it saves
   every step at once and never publishes. The game page holds what's entered and the step, above its tabs, as it does
   for the plan. TRAK-289: Publish saves what's entered, then publishes it, and the loop closes: the alert, what each
   reads, and the game's History. Published is final. In the app only: no email, no push. */

const STEPS = [{ id: 'result', label: 'Result' }, { id: 'team', label: 'Team' }, { id: 'players', label: 'Players' }, { id: 'publish', label: 'Publish' }]
const NEXT = ['Next: Team', 'Next: Players', 'Next: Publish']
const SAVE_FAILED = "Couldn't save the evaluation. Check your connection and try again; everything you entered is still here."
const PUBLISH_FAILED = "Couldn't publish the evaluation. Check your connection and try again; everything you entered is still here."
// The database says why it refused: not full time yet, published, a missing answer, or a child who can't be recorded.
const said = (error: { code?: string; message?: string }, otherwise: string) =>
  (error.code === 'P0001' || error.code === '42501') && error.message ? error.message : otherwise

export function Evaluation({ game, opensAt, plans, planGoals, form, onFormChange, step, onStep, savedAt, publishedAt, planCreatedAt }: {
  game: EventRow
  /** Full time as the header shows it ("12:30") while it's still to come; null once it has passed. */
  opensAt: string | null
  /** The line-up and the plan's goals, as they locked at kick-off. */
  plans: PlayerPlans; planGoals: string[]
  form: EvaluationForm; onFormChange: (form: EvaluationForm) => void; step: number; onStep: (step: number) => void
  /** When the draft was last saved, and when it was published; null before. */
  savedAt: string | null; publishedAt: string | null
  /** For the History: when the plan was first saved; null without one. */
  planCreatedAt: string | null
}) {
  const { user, profile } = useAuth()
  const client = useQueryClient()
  const who = useWhoCanCome(game)
  const [savedNow, setSavedNow] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [publishProblem, setPublishProblem] = useState<string | null>(null)
  // Who got it, as publish counted (a child who can no longer be recorded is skipped).
  const [published, setPublished] = useState<{ reviews: number; skipped: number } | null>(null)
  // Every change counts, so a save that lands after more typing doesn't say "Saved" for what it never sent.
  const version = useRef(0)
  const change = (next: EvaluationForm) => {
    version.current += 1
    onFormChange(next)
    setSavedNow(false)
    setProblem(null)
    setPublishProblem(null)
  }
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-evaluation', game.id] }),
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-evaluations'] }),
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'owed-events'] }),
  ])

  const save = useMutation({
    mutationFn: async ({ args }: { args: ReturnType<typeof formToSave>; version: number }) => {
      const { error } = await supabase.rpc('save_game_evaluation', args)
      if (error) throw error
    },
    onSuccess: (_, sent) => {
      if (sent.version === version.current) setSavedNow(true)
      void refresh()
    },
    onError: (error: { code?: string; message?: string }) => setProblem(said(error, SAVE_FAILED)),
  })

  // What's on screen is saved first, so what goes out is what the coach sees.
  const publish = useMutation({
    mutationFn: async ({ args, choices }: { args: ReturnType<typeof formToSave>; choices: PublishChoices }) => {
      const saved = await supabase.rpc('save_game_evaluation', args)
      if (saved.error) throw saved.error
      const { data, error } = await supabase.rpc('publish_game_evaluation',
        { p_event_id: game.id, p_competition: choices.competition || null, p_home_away: choices.homeAway || null })
      if (error) throw error
      return data as { reviews: number; skipped: string[] }
    },
    // Awaited, so the closed loop shows as soon as the button stops loading.
    onSuccess: async result => {
      setPublished({ reviews: result.reviews, skipped: result.skipped.length })
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-share-log', game.id] })])
    },
    onError: (error: { code?: string; message?: string }) => setPublishProblem(said(error, PUBLISH_FAILED)),
  })

  if (opensAt !== null) {
    return <div className="pt-4"><EmptyState icon={<ClipboardCheck size={24} strokeWidth={1.5} />} title={`Opens at full time, ${opensAt}`}
      description="The result, whether the plan worked, and each player against what you expected. Only you see it until you publish it." /></div>
  }
  if (who.error) return <div className="pt-4"><LoadError what="who played" onRetry={who.retry} /></div>
  if (who.isPending) return <p role="status" className="pt-6 text-center text-[13px] text-ink-3">Loading who played…</p>

  const { starters, bench } = lineUpAtKickOff(plans, who.players)
  const listed = [...starters.map(p => ({ id: p.id, name: p.name, starter: true })), ...bench.map(p => ({ id: p.id, name: p.name, starter: false }))]
  const named = (players: typeof starters) => players.map(p => ({ id: p.id, name: p.name }))
  const played = [...starters.filter(p => hasPlayed(form, p.id, true)), ...bench.filter(p => hasPlayed(form, p.id, false))]
  const coachName = profile?.full_name?.trim() || null

  if (publishedAt) {
    const reached = published?.reviews ?? publishSummary(form, listed).players
    return (
      <div className="grid gap-5 pt-4">
        <Alert tone="success" title={`Published to ${reached} ${reached === 1 ? 'player' : 'players'} and their families. The loop is closed.`}>
          {published?.skipped ? `${published.skipped} ${published.skipped === 1 ? 'player is' : 'players are'} no longer on your roster or waiting for a parent, so they got nothing.` : 'Published is final.'}
        </Alert>
        <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tablet:items-start">
          {/* A div, not a section: the timeline is the History region itself. */}
          <div className="grid min-w-0 content-start gap-4 rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-lg font-medium text-ink">History</h2>
            <GameHistory game={game} planCreatedAt={planCreatedAt} savedAt={savedAt} publishedAt={publishedAt} />
          </div>
          <ReviewPreview eventId={game.id} form={form} listed={listed} plans={plans} coachName={coachName} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-5 pt-4">
      <Alert tone="info" icon={Moon} open={savedAt !== null} title={savedAt ? `Draft saved ${format(new Date(savedAt), 'HH:mm')}` : 'Draft saved'}>
        Only you can see it.
      </Alert>
      <Stepper steps={STEPS} current={step} onStepSelect={onStep} label="Evaluation" />
      {step === 0 ? <ResultStep form={form} onFormChange={change} starters={named(starters)} bench={named(bench)} />
        : step === 1 ? <TeamStep eventId={game.id} form={form} onFormChange={change} goals={planGoals} />
        : step === 2 ? <PlayersStep eventId={game.id} form={form} onFormChange={change} played={named(played)} plans={plans} />
        : <PublishStep eventId={game.id} form={form} listed={listed} plans={plans} goals={planGoals.length} coachName={coachName}
            askCompetition={!game.competition} askHomeAway={game.home_away !== 'home' && game.home_away !== 'away'}
            onPublish={choices => { setPublishProblem(null); publish.mutate({ args: formToSave(game.id, form, listed), choices }) }}
            publishing={publish.isPending} problem={publishProblem} />}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && <Button variant="ghost" onClick={() => onStep(step - 1)}>Back</Button>}
        <span className="ml-auto text-sm text-ink-3">Draft · only you see it</span>
        <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate({ args: formToSave(game.id, form, listed), version: version.current })}>
          <Moon size={16} aria-hidden="true" />{savedNow ? 'Saved' : 'Save draft · sleep on it'}</Button>
        {step < 3 && <Button onClick={() => onStep(step + 1)}>{NEXT[step]}</Button>}
      </div>
      {problem && <p role="alert" className="text-right text-[15px] text-danger">{problem}</p>}
    </div>
  )
}
