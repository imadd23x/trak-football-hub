import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CalendarDays, Check, ClipboardCheck, Clock, MapPin, Pencil, Save, Share, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/integrations/supabase/client'
import { publishEvent } from '@/lib/event-publish'
import { askToEmailFamilies } from '@/lib/event-emails'
import { SAVE_FAILED, failed, pastProblem, type EditSheet } from '@/lib/event-edit'
import { useCoachSquad } from '@/lib/coach-squad'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { blankRepeat, clashMessage, formProblem, formToRow, lockedMessage, rowToForm, savedVenues, startedLocked, type EventRow } from '@/lib/coach-events'
import { fullTime, gameStatus, type GameTab } from '@/lib/games/loop'
import { formToPlan, planToForm, type PlanForm } from '@/lib/games/plan'
import { planParts } from '@/lib/games/share'
import { evaluationToForm, type EvaluationForm } from '@/lib/games/evaluation'
import type { Tables } from '@/integrations/supabase/types'
import { gameTitle, gameWhen, useGame, useGameEvaluation, useGamePlan, useGamePlanChanges, useGamePlayers, useGameShares, useGames, useWhoCanCome } from '@/components/coach/games/useGames'
import { GamePlan, useGamePlanDraft } from '@/components/coach/games/GamePlan'
import { Evaluation, evaluationLineUp, useEvaluationDraft } from '@/components/coach/games/Evaluation'
import { EventSummary } from '@/components/coach/EventSummary'
import { EventEditSheet } from '@/components/coach/EventEditSheet'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { PageHeader, PageHeaderPanel, type PageHeaderAction, type PageHeaderTab } from '@/components/arc/blocks/page-header/page-header'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-283 (Games 1/8): a game's page. Its header says where it is in the loop; Logistics, Game plan and
   Evaluation are peer panels of the one game, and the panel lives in the URL (?tab=). TRAK-284 to
   TRAK-286: the Game plan (GamePlan). TRAK-288: the Evaluation, from full time.
   Match header (Imad, 6 Nov, Concept A): Arc's Page header over the three tabs. The match's name and state, when and
   where, the squad; Save draft, Review & share and a "…" menu at the top right; the top row and the tabs stay pinned
   as the page scrolls. Save draft saves the draft on screen: the plan until kick-off, the evaluation from full time
   until it's published. Review & share opens the plan's last step, Review & publish the evaluation's. */

const TABS: { id: GameTab; label: string }[] = [
  { id: 'logistics', label: 'Logistics' }, { id: 'plan', label: 'Game plan' }, { id: 'evaluation', label: 'Evaluation' },
]
/** The laptop's top bar (Arc's sidebar rail) is pinned above the page; the header pins under it. */
const TOP_BAR = '60px'
const icon = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const metaIcon = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const
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
  // TRAK-334: where the coach came from (Home, Matches, Schedule). It waits for the match's name, so the last crumb
  // never swaps; a match that can't be read still offers the way back. The match's own header holds it once it's read.
  const trail = !game.isPending && <CoachTrail className="mt-5" current={game.data ? gameTitle(game.data) : 'Match'} />
  return (
    <div className="min-h-screen bg-ground pb-24">
      {/* TRAK-323 (Imad, 30 Oct): the plan's steps use the screen: the coach's wide column (TRAK-307), not 960 px. */}
      <div className={WIDE_COLUMN}>
        {game.error || shares.error ? <>{trail}<div className="pt-6"><LoadError what="this match" onRetry={() => { void game.refetch(); void shares.refetch() }}
            retrying={game.isFetching || shares.isFetching} /></div></>
          : game.isPending || plan.isPending || players.isPending || shares.isPending || evaluation.isPending
            ? <>{trail}<LoadingSkeleton label="Loading the match…" lines={4} rows={2} className="pt-6" /></>
          : !game.data ? <>{trail}<p className="pt-10 text-[15px] text-ink-2">This match isn’t in your matches.</p></>
          // Keyed by match: a route that only changes :eventId must never carry one match's typing into another's.
          : <Game key={game.data.id} row={game.data} plan={plan} players={players} sharedAt={shares.data.get(game.data.id) ?? null} evaluation={evaluation} />}
      </div>
    </div>
  )
}

function Game({ row, plan, players, sharedAt, evaluation }: { row: EventRow; plan: Plan; players: Players; sharedAt: string | null; evaluation: Evaluated }) {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const wide = useSideMenuScreen()
  const who = useWhoCanCome(row)
  const [params, setParams] = useSearchParams()
  const tab = TABS.find(t => t.id === params.get('tab'))?.id ?? 'logistics'
  const [now, setNow] = useState(() => Date.now())
  const whistle = fullTime({ ...row, ends_at: row.ends_at ?? null })
  // TRAK-287, TRAK-288: the page reads the clock again at kick-off and at full time itself, so the plan locks and the
  // evaluation opens with no reload, whether or not a countdown is on screen. TRAK-290: and when a
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
  // The plan as typed, and its step, live here, above the tabs: a panel that isn't shown unmounts. Until the coach
  // types, it is the saved plan, so a retried read still fills the form. Needs you's "Share changes" opens Review & share.
  const [typed, setTyped] = useState<PlanForm | null>(null)
  // TRAK-332: a plan that is shared or scheduled opens on Review & share, not on its first step.
  const [planStep, setPlanStep] = useState(() => params.get('step') === 'share' || sharedAt != null ? 2 : 0)
  // Review & share's Schedule pickers; the header's menu opens them too. A new share time closes them.
  const [picking, setPicking] = useState(false)
  useEffect(() => setPicking(false), [sharedAt])
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
  const logistics = useLogisticsEdit(row)

  // A plan or evaluation that couldn't be read shows its error, never an empty form to save over it.
  const planUnread = (plan.isError && plan.data === undefined) || (players.isError && players.data === undefined)
  const evaluationUnread = (evaluation.isError && evaluation.data === undefined) || planUnread
  // On a phone Save draft sits in the header's "…" menu, where "Saved" can't be seen, so a saved draft says so there.
  const [folded, setFolded] = useState(false)
  const onSaved = () => { if (folded) toast.success('Draft saved') }
  const planForm = (locked ? null : typed) ?? lockedPlan
  const planDraft = useGamePlanDraft({ game: row, form: planForm, onFormChange: setTyped, sharedAt, who, onSaved })
  const evaluationForm = entered ?? evaluationToForm(evaluation.data ?? { evaluation: null, players: [], notes: [] })
  const evaluationDraft = useEvaluationDraft({ game: row, form: evaluationForm, onFormChange: setEntered,
    listed: evaluationLineUp(lockedPlan.players, who.players).listed, onSaved })
  const publishedAt = evaluation.data?.evaluation?.published_at ?? null
  const evaluating = !cancelled && now >= whistle && !publishedAt
  const whoKnown = !who.isPending && !who.error

  /** Review & share, or Review & publish: the last step, its footer in view. */
  const review = (target: 'plan' | 'evaluation') => {
    const footer = target === 'plan' ? 'plan-share' : 'evaluation-publish'
    const bring = () => document.getElementById(footer)?.scrollIntoView?.({ block: 'center' })
    if (tab === target && (target === 'plan' ? planStep : evaluationStep) === 2) return bring()
    if (target === 'plan') setPlanStep(2); else setEvaluationStep(2)
    setParams({ tab: target }, { replace: true })
    window.scrollTo({ top: 0 })
  }
  const primary: PageHeaderAction | undefined = cancelled ? undefined
    : !locked ? { key: 'review', label: tab === 'plan' ? 'Review & share' : 'Review game plan', icon: <Share {...icon} />, onSelect: () => review('plan') }
    : evaluating ? { key: 'review', label: tab === 'evaluation' ? 'Review & publish' : 'Review evaluation', icon: <ClipboardCheck {...icon} />, onSelect: () => review('evaluation') }
    : undefined
  // Save draft saves the draft on screen.
  const save = tab === 'plan' && !cancelled && !locked && !planUnread ? planDraft
    : tab === 'evaluation' && evaluating && !evaluationUnread && whoKnown ? evaluationDraft : null
  const secondary: PageHeaderAction[] = save ? [{ key: 'save', label: save.savedNow ? 'Saved' : 'Save draft', icon: <Save {...icon} />, onSelect: save.submit, loading: save.saving }] : []
  // TRAK-290: Schedule, or Change time while a scheduled plan waits, open their pickers in Review & share.
  const waiting = sharedAt != null && now < Date.parse(sharedAt)
  const menu: PageHeaderAction[] = !cancelled && !locked && !planUnread && (sharedAt == null || waiting) ? [{
    key: 'schedule', label: sharedAt == null ? 'Schedule share' : 'Change share time', icon: <Clock {...icon} />,
    onSelect: () => {
      setPlanStep(2)
      setPicking(true)
      setParams({ tab: 'plan' }, { replace: true })
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('plan-share')?.scrollIntoView?.({ block: 'center' })))
    },
  }] : []

  // Logistics: shared. Game plan: what Review & share still counts as incomplete, until kick-off. Evaluation: when.
  const toDo = !locked && !planUnread && whoKnown ? planParts(planForm, who.players, row.published).incomplete : 0
  const extras: Record<GameTab, PageHeaderTab['extra']> = {
    logistics: row.published && <><Check size={14} strokeWidth={2} aria-hidden="true" /><span className="sr-only">shared</span></>,
    plan: toDo > 0 && <Badge size="sm" tone="warning">{toDo} to do</Badge>,
    // On a phone the three tabs fit without it, as in the prototype; a screen reader still hears it.
    evaluation: now < whistle && <span className="sr-only tablet:not-sr-only">After the match</span>,
  }
  const homeAway = row.home_away === 'home' ? 'Home' : row.home_away === 'away' ? 'Away' : null
  const people = whoKnown ? `${who.players.length} ${who.players.length === 1 ? 'player' : 'players'}` : null

  return <>
    <PageHeader className="[--ph-bleed:1.25rem] tablet:[--ph-bleed:2rem]" top={wide ? TOP_BAR : '0px'}
      title={gameTitle(row)} crumbs={<CoachTrail current={gameTitle(row)} />}
      status={cancelled ? <Badge tone="danger" dot>Cancelled</Badge> : <Badge tone={state.tone} dot>{state.label}</Badge>}
      details={<>
        <span><CalendarDays {...metaIcon} /><strong>{day}</strong>{time && ` · Kick-off ${time}`}{academy && ` · ${academy}`}</span>
        {(row.venue || homeAway) && <span><MapPin {...metaIcon} />{row.venue && <strong>{row.venue}</strong>}{row.venue && homeAway && ' · '}{homeAway}</span>}
        {(row.squad || people) && <span><Users {...metaIcon} />{[row.squad, people].filter(Boolean).join(' · ')}</span>}
      </>}
      primary={primary} secondary={secondary} menu={menu} onFold={setFolded}
      notice={tab === 'plan' ? planDraft.problem : tab === 'evaluation' ? evaluationDraft.problem : null}
      tabsLabel="This match" value={tab} onValueChange={next => setParams({ tab: next }, { replace: true })}
      tabs={cancelled ? [] : TABS.map(t => ({ value: t.id, label: t.label, extra: extras[t.id] || undefined }))}>
      {cancelled ? <p className="pt-4 text-[15px] text-ink-2">This match was cancelled.</p> : <>
        <PageHeaderPanel value="logistics"><Logistics row={row} squad={squad} onEdit={logistics.open} publish={logistics.publish} /></PageHeaderPanel>
        <PageHeaderPanel value="plan">
          {planUnread
            ? <div className="pt-4"><LoadError what="the plan" onRetry={() => { void plan.refetch(); void players.refetch() }}
                retrying={plan.isFetching || players.isFetching} /></div>
            // Locked, it shows the plan as saved at kick-off: what the evaluation reads against.
            : <GamePlan game={row} form={planForm} draft={planDraft} who={who}
                step={planStep} onStep={setPlanStep} sharedAt={sharedAt} changes={changes} locked={locked}
                onEditLogistics={() => logistics.open?.()} picking={picking} onPicking={setPicking} />}
        </PageHeaderPanel>
        <PageHeaderPanel value="evaluation">
          {evaluationUnread
            ? <div className="pt-4"><LoadError what="the evaluation" onRetry={() => { void evaluation.refetch(); void plan.refetch(); void players.refetch() }}
                retrying={evaluation.isFetching || plan.isFetching || players.isFetching} /></div>
            : <Evaluation game={row} opensAt={now < whistle ? format(new Date(whistle), 'HH:mm') : null} who={who}
                plans={lockedPlan.players} planGoals={formToPlan(lockedPlan).goals.map((goal, i) => goal.title || goal.looks_like || `Instruction ${i + 1}`)}
                form={evaluationForm} draft={evaluationDraft}
                step={evaluationStep} onStep={setEvaluationStep} savedAt={evaluation.data?.evaluation?.saved_at ?? null}
                publishedAt={publishedAt} planCreatedAt={plan.data?.created_at ?? null} />}
        </PageHeaderPanel>
      </>}
    </PageHeader>
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
        <Badge tone={row.published ? 'success' : 'neutral'}>{row.published ? 'Shared' : 'Draft'}</Badge>
        {!row.published && <Button loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button>}
        {onEdit && <Button variant="secondary" size="sm" onClick={onEdit}><Pencil size={14} aria-hidden="true" />Edit</Button>}
      </div>
      <EventSummary form={rowToForm(row)} repeat={null} noteProblem={null} squad={squad} />
    </div>
  )
}
