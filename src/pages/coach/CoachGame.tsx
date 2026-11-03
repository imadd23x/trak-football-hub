import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import { publishEvent } from '@/lib/event-publish'
import { askToEmailFamilies } from '@/lib/event-emails'
import { SAVE_FAILED, failed, pastProblem, type EditSheet } from '@/lib/event-edit'
import { useCoachSquad } from '@/lib/coach-squad'
import { blankRepeat, clashMessage, formProblem, formToRow, lockedMessage, rowToForm, savedVenues, startedLocked, type EventRow } from '@/lib/coach-events'
import { fullTime, gameStatus, type GameTab } from '@/lib/games/loop'
import { formToPlan, planToForm, type PlanForm } from '@/lib/games/plan'
import { evaluationToForm, type EvaluationForm } from '@/lib/games/evaluation'
import type { Tables } from '@/integrations/supabase/types'
import { gameTitle, gameWhen, useGame, useGameEvaluation, useGamePlan, useGamePlanChanges, useGamePlayers, useGameShares, useGames } from '@/components/coach/games/useGames'
import { GamePlan } from '@/components/coach/games/GamePlan'
import { Evaluation } from '@/components/coach/games/Evaluation'
import { EventSummary } from '@/components/coach/EventSummary'
import { EventEditSheet } from '@/components/coach/EventEditSheet'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Countdown } from '@/components/arc/countdown/countdown'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-283 (Games 1/8): a game's page. Its header says where it is in the loop; Logistics, Game plan and
   Evaluation are peer panels of the one game (Arc tabs), and the panel lives in the URL (?tab=). TRAK-284 to
   TRAK-286: the Game plan (GamePlan). TRAK-288: the Evaluation, from full time. */

const TABS: { id: GameTab; label: string }[] = [
  { id: 'logistics', label: 'Logistics' }, { id: 'plan', label: 'Game plan' }, { id: 'evaluation', label: 'Evaluation' },
]
type Plan = UseQueryResult<Tables<'game_plans'> | null>
type Players = UseQueryResult<Pick<Tables<'game_plan_players'>, 'squad_player_id' | 'role' | 'slot' | 'job' | 'note' | 'context' | 'expectation'>[]>
type Evaluated = ReturnType<typeof useGameEvaluation>

export default function CoachGame() {
  const { eventId } = useParams()
  const game = useGame(eventId)
  // Read beside the game, so the header's state never flips from "Plan not written" once the draft arrives.
  const plan = useGamePlan(eventId)
  const players = useGamePlayers(eventId)
  const shares = useGameShares()
  const evaluation = useGameEvaluation(eventId)
  return (
    <div className="min-h-screen bg-ground pb-24">
      {/* TRAK-323 (Imad, 30 Oct): the plan's steps use the screen: the coach's wide column (TRAK-307), not 960 px. */}
      <div className={WIDE_COLUMN}>
        {/* TRAK-334: where the coach came from (Home, Matches, Schedule), in place of "‹ Matches". It waits for the
            match's name, so the last crumb never swaps; a match that can't be read still offers the way back. */}
        {!game.isPending && <CoachTrail className="mt-5" current={game.data ? gameTitle(game.data) : 'Match'} />}
        {game.error || shares.error ? <div className="pt-6"><LoadError what="this match" onRetry={() => { void game.refetch(); void shares.refetch() }}
            retrying={game.isFetching || shares.isFetching} /></div>
          : game.isPending || plan.isPending || players.isPending || shares.isPending || evaluation.isPending
            ? <LoadingSkeleton label="Loading the match…" lines={4} rows={2} className="pt-6" />
          : !game.data ? <p className="pt-10 text-[15px] text-ink-2">This match isn’t in your matches.</p>
          // Keyed by match: a route that only changes :eventId must never carry one match's typing into another's.
          : <Game key={game.data.id} row={game.data} plan={plan} players={players} sharedAt={shares.data.get(game.data.id) ?? null} evaluation={evaluation} />}
      </div>
    </div>
  )
}

function Game({ row, plan, players, sharedAt, evaluation }: { row: EventRow; plan: Plan; players: Players; sharedAt: string | null; evaluation: Evaluated }) {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.id === params.get('tab'))?.id ?? 'logistics'
  const [now, setNow] = useState(() => Date.now())
  const whistle = fullTime({ ...row, ends_at: row.ends_at ?? null })
  // TRAK-287, TRAK-288: the page reads the clock again at kick-off and at full time itself, so the plan locks and the
  // evaluation opens with no reload, even when the header's countdown never ticked on screen. TRAK-290: and when a
  // scheduled plan goes out. A wait past setTimeout's limit (24 days) just wakes early and waits again.
  const sharesAt = sharedAt ? Date.parse(sharedAt) : NaN
  useEffect(() => {
    const left = [sharesAt, Date.parse(row.starts_at), whistle].map(at => at - now).filter(wait => wait > 0).sort((a, b) => a - b)[0]
    if (left === undefined) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [sharesAt, row.starts_at, whistle, now])
  const cancelled = row.status === 'cancelled'
  // TRAK-286: who a share would change now. Only asked once the plan is shared; a failed read shows no changes.
  const changes = useGamePlanChanges([row.id], !!sharedAt && !cancelled).data?.get(row.id) ?? []
  const state = gameStatus({ ...row, ends_at: row.ends_at ?? null }, now,
    { drafted: !!plan.data, shared: !!sharedAt, sharedAt: sharedAt ?? undefined, changes: changes.length,
      evaluated: !!evaluation.data?.evaluation, published: !!evaluation.data?.evaluation?.published_at })
  // The plan as typed, and its step, live here, above the tabs: Arc unmounts a panel that isn't shown. Until the coach
  // types, it is the saved plan, so a retried read still fills the form. Needs you's "Share changes" opens Review & share.
  const [typed, setTyped] = useState<PlanForm | null>(null)
  // TRAK-332: a plan that is shared or scheduled opens on Review & share, not on its first step.
  const [planStep, setPlanStep] = useState(() => params.get('step') === 'share' || sharedAt != null ? 2 : 0)
  // TRAK-288: the evaluation as entered, and its step, kept here for the same reason; until the coach enters anything,
  // the saved draft.
  const [entered, setEntered] = useState<EvaluationForm | null>(null)
  const [evaluationStep, setEvaluationStep] = useState(0)
  // The evaluation reads against the plan as it locked at kick-off.
  const lockedPlan = planToForm(plan.data ?? null, players.data ?? [])
  const { day, time, academy } = gameWhen(row)
  // TRAK-287: at kick-off the plan locks, on the event's instant (the academy's clock), never the device's.
  const locked = !cancelled && now >= Date.parse(row.starts_at)
  const squad = coachSquad.squads.length >= 2 && row.squad ? row.squad : undefined
  const where = [day, time ? `Kick-off ${time}` : '', row.home_away === 'home' ? 'Home' : row.home_away === 'away' ? 'Away' : '', row.venue ?? '', squad ?? '']
  const logistics = useLogisticsEdit(row)

  return <>
    <header className="arc grid gap-2 pt-4 pb-2">
      <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink break-words">{gameTitle(row)}</h1>
      <p className="text-sm text-ink-2">{where.filter(Boolean).join(' · ')}</p>
      {academy && <p className="text-sm text-ink-3">{academy}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {cancelled ? <Badge tone="danger">Cancelled</Badge> : <Badge tone={state.tone}>{state.label}</Badge>}
        {!cancelled && now < fullTime({ ...row, ends_at: row.ends_at ?? null }) && <Countdown variant="compact" units={['days', 'hours', 'minutes']}
          target={row.starts_at} label="Kick-off in" completeLabel="Locked" />}
      </div>
    </header>

    {cancelled ? <p className="pt-4 text-[15px] text-ink-2">This match was cancelled.</p> : (
      <div className="arc pt-4">
        <Tabs value={tab} onValueChange={next => setParams({ tab: next }, { replace: true })}>
          <TabsList aria-label="This match">
            {TABS.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="logistics"><Logistics row={row} squad={squad} onEdit={logistics.open} publish={logistics.publish} /></TabsContent>
          <TabsContent value="plan">
            {(plan.isError && plan.data === undefined) || (players.isError && players.data === undefined)
              ? <div className="pt-4"><LoadError what="the plan" onRetry={() => { void plan.refetch(); void players.refetch() }}
                  retrying={plan.isFetching || players.isFetching} /></div>
              // Locked, it shows the plan as saved at kick-off: what the evaluation reads against.
              : <GamePlan game={row} form={(locked ? null : typed) ?? planToForm(plan.data ?? null, players.data ?? [])} onFormChange={setTyped}
                  step={planStep} onStep={setPlanStep} sharedAt={sharedAt} changes={changes} lockedAt={locked ? time : null}
                  onEditLogistics={() => logistics.open?.()} planStartedAt={plan.data?.created_at ?? null} />}
          </TabsContent>
          <TabsContent value="evaluation">
            {(evaluation.isError && evaluation.data === undefined) || (plan.isError && plan.data === undefined) || (players.isError && players.data === undefined)
              ? <div className="pt-4"><LoadError what="the evaluation" onRetry={() => { void evaluation.refetch(); void plan.refetch(); void players.refetch() }}
                  retrying={evaluation.isFetching || plan.isFetching || players.isFetching} /></div>
              : <Evaluation game={row} opensAt={now < whistle ? format(new Date(whistle), 'HH:mm') : null}
                  plans={lockedPlan.players} planGoals={formToPlan(lockedPlan).goals.map((goal, i) => goal.title || goal.looks_like || `Instruction ${i + 1}`)}
                  form={entered ?? evaluationToForm(evaluation.data ?? { evaluation: null, players: [], notes: [] })} onFormChange={setEntered}
                  step={evaluationStep} onStep={setEvaluationStep} savedAt={evaluation.data?.evaluation?.saved_at ?? null}
                  remindAt={evaluation.data?.evaluation?.remind_at ?? null}
                  publishedAt={evaluation.data?.evaluation?.published_at ?? null} planCreatedAt={plan.data?.created_at ?? null} />}
          </TabsContent>
        </Tabs>
      </div>
    )}
    {logistics.sheet}
  </>
}

/** TRAK-331 (Imad, 2 Nov): Schedule's own edit sheet on the match page, so the coach never leaves the match; it saves as
 *  Schedule saves an event that isn't part of a series. TRAK-332: the page holds it, so both the Logistics tab and
 *  Review & share's Logistics part open it. A draft publishes in place, as Home's event sheet publishes one
 *  (publishEvent: families are emailed the logistics, as today). */
function useLogisticsEdit(row: EventRow) {
  const { user } = useAuth()
  const client = useQueryClient()
  const publish = useMutation({
    mutationFn: () => publishEvent(row.id),
    onSuccess: () => {
      toast.success('Published to the squad')
      void client.invalidateQueries({ queryKey: ['coach'] })
    },
    onError: error => toast.error(error.message),
  })
  const [edit, setEdit] = useState<EditSheet | null>(null)
  const [saving, setSaving] = useState(false)
  // What the sheet offers as the coach types: venues the coach's matches used, and the names a family note mustn't hold.
  const games = useGames(!!edit)
  const children = useQuery({
    queryKey: ['coach', user?.id, 'child-names'], enabled: !!user && !!edit,
    queryFn: async () => {
      const { data, error } = await supabase.from('squad_players').select('player_name').eq('coach_user_id', user!.id)
      if (error) throw error
      return (data ?? []).map(child => child.player_name ?? '').filter(Boolean)
    },
  })
  const save = async (publishNow = false) => {
    if (!edit) return
    const problem = formProblem(edit.form) ?? pastProblem(edit.form, row)
    if (problem) { setEdit({ ...edit, error: problem }); return }
    setSaving(true)
    const { data, error } = await supabase.from('coach_calendar_events').update(formToRow(edit.form)).eq('id', row.id).select('id')
    setSaving(false)
    // Errors keep what was typed and say what failed, as Schedule's do.
    if (failed(error, data)) { setEdit({ ...edit, error: clashMessage(error) ?? lockedMessage(error) ?? SAVE_FAILED }); return }
    setEdit(null)
    void client.invalidateQueries({ queryKey: ['coach'] })
    if (publishNow && !row.published) return publish.mutate()
    if (row.published) askToEmailFamilies() // TRAK-135: a published event's change goes to families, as from Schedule
    toast.success(row.published ? 'Saved. Families see the change.' : 'Draft saved')
  }
  // TRAK-230: once it has started, what families were told is fixed, so there is nothing to open.
  const open = startedLocked(row) ? null : () => setEdit({ row, form: rowToForm(row), repeat: blankRepeat(''), scope: 'one', step: 0, error: null })
  const sheet = edit && <EventEditSheet key={row.id} sheet={edit} onChange={update => setEdit(current => current && update(current))} onClose={() => setEdit(null)}
    onSave={publishNow => void save(publishNow)} saving={saving} venues={savedVenues(games.data ?? [])} childNames={children.data ?? null} />
  return { open, sheet, publish }
}

/** Schedule's Review rows, read only, with Publish for a draft and Edit (useLogisticsEdit). */
function Logistics({ row, squad, onEdit, publish }: {
  row: EventRow; squad?: string; onEdit: (() => void) | null; publish: ReturnType<typeof useLogisticsEdit>['publish']
}) {
  return (
    <div className="grid gap-4 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={row.published ? 'success' : 'neutral'}>{row.published ? 'Shared with families' : 'Draft'}</Badge>
        {!row.published && <Button loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
        {onEdit && <Button variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} aria-hidden="true" />Edit</Button>}
      </div>
      <EventSummary form={rowToForm(row)} repeat={null} noteProblem={null} squad={squad} />
    </div>
  )
}
