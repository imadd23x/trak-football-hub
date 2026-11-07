import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { EventRow } from '@/lib/coach-events'
import { formToPlan, type PlanForm } from '@/lib/games/plan'
import { rowsToSave } from '@/lib/games/lineup'
import type { useWhoCanCome } from './useGames'
import { TacticsAndAnalysis } from './TacticsAndAnalysis'
import { LineUpAndJobs } from './LineUpAndJobs'
import { ShareStep } from './ShareStep'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Stepper } from '@/components/arc/stepper/stepper'

/* TRAK-284, TRAK-285, TRAK-286 (Games 2 to 4/8): the Game plan tab. Tactics & analysis (TRAK-328), Line-up and jobs,
   then Share. One draft, only the coach sees it: Save draft keeps both steps, and a failed save keeps everything typed
   and says so, as Schedule's does. Sharing saves what's typed first, so what goes out is what's on screen. The game page holds what's
   typed and the step, above its tabs, so a look at Logistics never loses them. TRAK-287: at kick-off the plan locks; the
   saved plan shows read only, and Save and Share go (TRAK-372, Imad 5 Nov: with no alert). TRAK-290: Share at… schedules
   it; until then Save draft also rewrites what's waiting, so it goes out as saved (Imad, 29 Oct). TRAK-332 (Imad, 2 Nov):
   the last step is Review & share, and the face-to-face tick and Share plan (Share at… on its chevron) sit in its card;
   the bottom bar keeps Back and Save draft (it was TRAK-318's place for Share). Match header (Imad, 6 Nov): Save draft
   moves to the match's header, so the page holds the draft's saving and sharing (useGamePlanDraft); the bottom bar
   keeps Back, the draft line and Next. */

const STEPS = [{ id: 'opponent', label: 'Tactics & analysis' }, { id: 'line-up', label: 'Line-up and jobs' }, { id: 'share', label: 'Review & share' }]
const SAVE_FAILED = "Couldn't save the plan. Check your connection and try again; everything you typed is still here."
const SHARE_FAILED = "Couldn't share the plan. Check your connection and try again; everything you typed is still here."
const SCHEDULE_FAILED = "Couldn't schedule the plan. Check your connection and try again; everything you typed is still here."

/** The plan as a draft: what Save draft, Share and Schedule write, and what they said. `change` is the form's onChange. */
export function useGamePlanDraft({ game, form, onFormChange, sharedAt, who, onSaved }: {
  game: EventRow; form: PlanForm; onFormChange: (form: PlanForm) => void
  /** After Save draft has saved. */
  onSaved?: () => void
  /** TRAK-286: when the plan was first shared, or null. */
  sharedAt: string | null
  who: ReturnType<typeof useWhoCanCome>
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [savedNow, setSavedNow] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [shareProblem, setShareProblem] = useState<string | null>(null)
  // Every change counts, so a save that lands after more typing doesn't say "Saved" for what it never sent.
  const version = useRef(0)
  const change = (next: PlanForm) => {
    version.current += 1
    onFormChange(next)
    setSavedNow(false)
    setProblem(null)
    setShareProblem(null)
  }

  /** What Save draft and Share write. */
  const draft = () => {
    // Only children who can still be recorded. Until that's known, every row goes and the database checks each one.
    const eligible = who.isPending || who.error ? null : new Set(who.players.map(player => player.id))
    return { plan: formToPlan(form), players: rowsToSave(game.id, form.players, eligible), version: version.current }
  }
  const write = async ({ plan, players }: ReturnType<typeof draft>) => {
    const { error } = await supabase.from('game_plans').upsert({ event_id: game.id, ...plan })
    if (error) throw error
    if (players.length === 0) return
    const { error: lineUpError } = await supabase.from('game_plan_players').upsert(players)
    if (lineUpError) throw lineUpError
  }
  const refresh = (shared: boolean) => Promise.all([
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-plan', game.id] }),
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-players', game.id] }),
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-plans'] }),
    client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-plan-changes'] }),
    shared && client.invalidateQueries({ queryKey: ['coach', user?.id, 'game-shares'] }),
  ])

  const save = useMutation({
    mutationFn: async (sent: ReturnType<typeof draft>) => {
      await write(sent)
      // TRAK-290: a plan that waits for its time goes out as saved, so saving rewrites what's waiting; the time stays.
      if (sharedAt == null || Date.now() >= Date.parse(sharedAt)) return
      const { error } = await supabase.rpc('schedule_game_plan', { p_event_id: game.id })
      // It went out while this saved: the edits then wait for Share changes, as on any shared plan.
      if (error && error.code !== 'P0001') throw error
    },
    onSuccess: (_, sent) => {
      if (sent.version === version.current) setSavedNow(true)
      onSaved?.()
      void refresh(false)
    },
    onError: () => setProblem(SAVE_FAILED),
  })
  const submit = () => save.mutate(draft())

  // TRAK-286: Share plan, Share now and Share changes. The database checks the logistics, the tick and kick-off, and says why.
  const share = useMutation({
    mutationFn: async ({ sent, talked }: { sent: ReturnType<typeof draft>; talked: boolean }) => {
      await write(sent)
      const { error } = await supabase.rpc('share_game_plan', { p_event_id: game.id, p_talked: talked })
      if (error) throw error
    },
    // Awaited, so the step shows the shared plan as soon as the button stops loading.
    onSuccess: async (_, { sent }) => {
      if (sent.version === version.current) setSavedNow(true)
      await refresh(true)
    },
    onError: (error: { code?: string; message?: string }) => setShareProblem(error.code === 'P0001' && error.message ? error.message : SHARE_FAILED),
  })
  const shareNow = (talked: boolean) => {
    setShareProblem(null)
    share.mutate({ sent: draft(), talked })
  }

  // TRAK-290: Share at… and Change time. What's typed is saved first, as for Share now; the database checks the time.
  const schedule = useMutation({
    mutationFn: async ({ sent, talked, at }: { sent: ReturnType<typeof draft>; talked: boolean; at: string }) => {
      await write(sent)
      const { error } = await supabase.rpc('schedule_game_plan', { p_event_id: game.id, p_talked: talked, p_at: at })
      if (error) throw error
    },
    onSuccess: async (_, { sent }) => {
      if (sent.version === version.current) setSavedNow(true)
      await refresh(true)
    },
    onError: (error: { code?: string; message?: string }) => setShareProblem(error.code === 'P0001' && error.message ? error.message : SCHEDULE_FAILED),
  })
  const scheduleAt = (at: string, talked: boolean) => {
    setShareProblem(null)
    schedule.mutate({ sent: draft(), talked, at })
  }

  return { change, submit, saving: save.isPending, savedNow, problem, shareNow, scheduleAt, sharing: share.isPending || schedule.isPending, shareProblem }
}

export function GamePlan({ game, form, draft, who, step, onStep, sharedAt, changes, locked = false, onEditLogistics, picking, onPicking }: {
  game: EventRow; form: PlanForm; draft: ReturnType<typeof useGamePlanDraft>; who: ReturnType<typeof useWhoCanCome>
  step: number; onStep: (step: number) => void
  /** TRAK-286: when the plan was first shared, or null; and whose copies a share would change now. */
  sharedAt: string | null; changes: string[]
  /** TRAK-287: kick-off has passed, so the plan only shows. */
  locked?: boolean
  /** TRAK-332: Review & share's Logistics part pulls up the event's edit sheet (TRAK-331). */
  onEditLogistics: () => void
  /** Whether Review & share's Schedule pickers are open. */
  picking: boolean; onPicking: (open: boolean) => void
}) {
  const { change, shareNow, scheduleAt, sharing, shareProblem } = draft
  return (
    <div className="grid gap-5 pt-4">
      {/* TRAK-346 (Imad, 3 Nov): any step opens from here, ahead as well as back, so an Edit never means walking back. */}
      <Stepper steps={STEPS} current={step} onStepSelect={onStep} label="Game plan" jumpAhead />
      {step === 0 ? <TacticsAndAnalysis eventId={game.id} opponent={game.opponent ?? null} squad={game.squad ?? null} form={form} onFormChange={change} locked={locked} />
        : step === 1 ? <LineUpAndJobs form={form} onFormChange={change} who={who} locked={locked} />
        : <ShareStep game={game} form={form} who={who} sharedAt={sharedAt} changes={changes} onShare={shareNow} onSchedule={scheduleAt}
            sharing={sharing} problem={shareProblem} locked={locked} onStep={onStep} onEditLogistics={onEditLogistics} picking={picking} onPicking={onPicking} />}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && <Button variant="ghost" onClick={() => onStep(step - 1)}>Back</Button>}
        {/* Imad, 6 Nov: Evaluation's Draft badge, with no "only you see it". */}
        {!locked && <span className="arc ml-auto"><Badge>Draft</Badge></span>}
        {step < 2 && <Button className={locked ? 'ml-auto' : undefined} onClick={() => onStep(step + 1)}>{step === 0 ? 'Next: Line-up and jobs' : 'Next: Review & share'}</Button>}
      </div>
    </div>
  )
}
