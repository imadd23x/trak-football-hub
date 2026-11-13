import { useTranslation } from '@/lib/i18n'
import { partName, whyWord } from '@/lib/training/words'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardList, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { registerProblem } from '@/lib/event-register'
import { DRILL_DETAILS, trainingEnd, trainingMinutes } from '@/lib/training/sessions'
import { loopNote, loopState, practiceStarts } from '@/lib/training/loop'
import { fromSaved, herePath, overTime, planPath, viewPath, type PlannerState, type Practice } from '@/lib/training/plans'
import { keepKeys, moveTo, partsFromSaved, sameOrder, totalMinutes, type Part } from '@/lib/training/parts'
import { gameWhen } from '@/components/coach/games/useGames'
import { useNotes, usePlan, useRegisters, useSavePlan, useTraining, type Plan, type Training } from '@/components/coach/training/useTraining'
import { PlanRows, TimeBar, TotalLine } from '@/components/coach/training/PlannerParts'
import { AddPartSheet } from '@/components/coach/training/PlannerSheets'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { LoopStrip } from '@/components/coach/training/LoopStrip'
import { RegisterSheet } from '@/components/coach/training/RegisterSheet'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Planner } from './Planner'
import { WhosHere } from './WhosHere'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-295 (Training 2/5, spec TRAK-293, mockup boards 3A and 5): a training's plan. Write my own
   (/coach/training/:eventId/plan) types practices one at a time and saves the plan whole; the plan
   (/coach/training/:eventId) shows it with the loop. Only the coach sees either. TRAK-296 (Training 3/5): a practice
   comes from My drills or the Library too, added or swapped in through AddSheet, and Training › Drills can send a
   drill here ("Add to <training>"). TRAK-297 (Training 4/5): Copy a past session opens the planner filled in with its
   practices; nothing saves until Save the plan. TRAK-298 (Training 5/5): the plan page runs the loop: Who's here opens
   the existing register, and the training closes on its own once it has ended with its register taken (Kostas,
   28 Oct). View (/coach/training/:eventId/view) is the plan read at the pitch side: TRAK-309 (Kostas, 29 Oct) took Run
   it out of the loop and named the button and its page View. */

const TRAINING_PATH = '/coach/training'
const linkClass = 'rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** The training and its plan, read together, so the page never shows "Not planned" before the plan arrives. */
function WithTraining({ children, wide = false }: { children: (training: Training, plan: Plan | null) => ReactNode; wide?: boolean }) {
  const { eventId } = useParams()
  const { t } = useTranslation()
  const training = useTraining(eventId)
  const plan = usePlan(eventId)
  return (
    <div className="min-h-screen bg-ground pb-28">
      {/* TRAK-340: Plan session takes the coach pages' width (TRAK-307), for its two columns. */}
      <div className={wide ? WIDE_COLUMN : 'mx-auto w-full max-w-[1040px] px-5 tablet:px-8'}>
        {training.error || plan.error
          ? <div className="pt-10"><LoadError what={t('coachTraining:thisTrainingWhat')} onRetry={() => { void training.refetch(); void plan.refetch() }}
              retrying={training.isFetching || plan.isFetching} /></div>
          : training.isPending || plan.isPending ? <LoadingSkeleton label={t('coachTraining:loadingTraining')} lines={4} rows={2} className="pt-6" />
          : !training.data ? <div className="grid gap-3 pt-10">
              <p className="text-[15px] text-ink-2">{t('coachTraining:notOnSchedule')}</p>
              <Link to={TRAINING_PATH} className={linkClass}>{t('coachTraining:backToTraining')}</Link>
            </div>
          // Keyed by training: a route that only changes :eventId must never carry one plan's typing into another's.
          : <div key={training.data.id}>{children(training.data, plan.data)}</div>}
      </div>
    </div>
  )
}

function Header({ training, children }: { training: Training; children: ReactNode }) {
  const { day, time, academy } = gameWhen(training)
  const { t } = useTranslation()
  const minutes = trainingMinutes(training)
  return (
    <header className="arc grid gap-4 pt-5 pb-2">
      {/* TRAK-334: where the coach came from (Training, Home), as every coach page's trail. */}
      <CoachTrail current={day} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">{t('coachTraining:trainingCaps')}</p>
          <h1 className="text-[26px] font-medium tracking-[-0.01em] text-ink">{[day, time].filter(Boolean).join(' · ')}</h1>
          <p className="text-sm text-ink-2 break-words">{[training.title, training.venue, minutes ? t('coachHome:minutes', { count: minutes }) : null].filter(Boolean).join(' · ')}</p>
          {academy && <p className="text-sm text-ink-3">{academy}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </header>
  )
}

/** The plan runs longer than the training was set for: said plainly, never a block (Kostas, 28 Oct). */
function OverTime({ text }: { text: string }) {
  return <p role="status" className="mt-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">{text}</p>
}

/** The details a practice has, in the mockup's order: "20 × 30 m · 4v4 + 2". */
const detailsLine = (practice: Practice) => DRILL_DETAILS.map(d => practice[d.key].trim()).filter(Boolean).join(' · ')


/* ── Plan session (TRAK-340) ──────────────────────────────────────────────── */

export function PlanEditorRoute() {
  const { t } = useTranslation()
  return <WithTraining wide>{(training, plan) => training.status === 'cancelled'
    ? <><Header training={training}><Badge tone="danger">{t('coachHome:noteCancelled')}</Badge></Header>
      <p className="pt-4 text-[15px] text-ink-2">{t('coachTraining:cancelledCantChange')}</p></>
    : <Planner training={training} saved={plan} />}</WithTraining>
}

/* ── The plan ─────────────────────────────────────────────────────────────── */

export function PlanRoute() {
  return <WithTraining>{(training, plan) => <PlanView training={training} plan={plan} />}</WithTraining>
}

function PlanView({ training, plan }: { training: Training; plan: Plan | null }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const registers = useRegisters()
  const notes = useNotes()
  const [sheet, setSheet] = useState<'register' | 'log' | null>(null)
  const [now] = useState(() => Date.now())
  const cancelled = training.status === 'cancelled'
  const sessionId = registers.data?.get(training.id) ?? null
  const started = Date.parse(training.starts_at) <= now
  const over = trainingEnd(training) <= now
  const loop = loopState({ planned: !!plan, registered: !!sessionId, noted: !!notes.data?.has(training.id), started, over })
  // Who's here opens as the register does everywhere else: published, not cancelled, started.
  const registerWhy = registerProblem({ ...training, event_type: 'training' }, new Date(now))
  const canRegister = !!registers.data && !sessionId && !registerWhy
  const view = () => navigate(viewPath(training.id))
  // TRAK-339 (Kostas, 29 Oct): planning goes straight to the planner; no "How do you want to plan it?".
  const planIt = () => navigate(planPath(training.id))

  return <>
    <Header training={training}>
      {cancelled ? <Badge tone="danger">{t('coachHome:noteCancelled')}</Badge>
        : loop.closed ? <>
          <Badge tone="success">{t('coachTraining:closedBadge')}</Badge>
          <Button variant="secondary" onClick={() => setSheet('log')}>{t('coachTraining:viewLog')}</Button>
        </> : <>
          <Badge tone={plan ? 'success' : 'warning'}>{plan ? t('coachTraining:readyBadge') : t('coachTraining:notPlanned')}</Badge>
          {/* On the day, the main action is Who's here; otherwise View, the plan at the pitch side. */}
          {/* TRAK-342: Who's here is a page of its own: the register, then Trak's suggestions for the plan. */}
          {canRegister && <Button onClick={() => navigate(herePath(training.id))}>{t('coachTraining:loopHere')}</Button>}
          {plan && <Button variant={canRegister ? 'secondary' : 'primary'} onClick={view}>{t('coachTraining:view')}</Button>}
          {sessionId && <Button variant="ghost" onClick={() => navigate(herePath(training.id))}>{t('coachTraining:loopHere')}</Button>}
          {/* TRAK-341: a saved plan is changed part by part below (Kostas, 30 Oct), so no Change the plan up here. */}
          {!plan && <Button variant={canRegister ? 'secondary' : 'primary'} onClick={planIt}>{t('coachTraining:planSession')}</Button>}
        </>}
    </Header>
    {!cancelled && <div className="grid gap-2 pt-2">
      <LoopStrip state={loop} note={loopNote(loop, started)} />
      {registers.error ? <p role="alert" className="text-sm text-danger">{t('coachTraining:couldntCheckRegister')} <button type="button"
        className={`min-h-11 ${linkClass}`} onClick={() => void registers.refetch()}>{t('coachTraining:tryAgain')}</button></p>
        : !sessionId && registerWhy && <p className="text-sm text-ink-3">{registerWhy === 'The register opens once the event has started'
          ? t('coachTraining:hereOpens') : t('coachTraining:hereWhy', { why: whyWord(registerWhy) })}</p>}
    </div>}

    {plan && plan.practices.length ? <SavedReview training={training} plan={plan} cancelled={cancelled} />
      : <section aria-labelledby="practices" className="mt-6 grid max-w-[720px] gap-2.5">
        <h2 id="practices" className="sr-only">{t('coachTraining:practices')}</h2>
        <div className="arc">
          <EmptyState icon={<ClipboardList size={24} strokeWidth={1.5} />} title={cancelled ? t('coachTraining:wasCancelled') : t('coachTraining:notPlannedYet')}
            description={cancelled ? t('coachTraining:hadNoPlan') : t('coachTraining:planYourWay')}
            action={cancelled ? undefined : <Button onClick={planIt}>{t('coachTraining:planSession')}</Button>} />
        </div>
      </section>}
    <Link to={`/coach/schedule?event=${training.id}`} className={`mt-4 inline-block ${linkClass}`}>{t('coachTraining:openInSchedule')}</Link>

    <RegisterSheet training={training} sheet={sheet} sessionId={sessionId} onClose={() => setSheet(null)} />
  </>
}

/* ── Who's here (TRAK-342) ─────────────────────────────────────────────────── */

export function WhosHereRoute() {
  return <WithTraining wide>{(training, plan) => <WhosHere training={training} plan={plan} />}</WithTraining>
}

/* ── Review (TRAK-341) ──────────────────────────────────────────────────────── */

/** A saved plan, to review and change part by part (Kostas, 30 Oct): Edit opens only that part in the planner, ×
 *  removes one at once (with Undo), Add a part adds one. TRAK-367 (Kostas, 3 Nov): a part moves as it does while
 *  planning, saved once it lands. Each change saves the plan whole. */
function SavedReview({ training, plan, cancelled }: { training: Training; plan: Plan; cancelled: boolean }) {
  const navigate = useNavigate()
  const save = useSavePlan(training.id)
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Read once per saved plan, and each part keeps its key when the plan comes back saved: a part just moved stays the
  // same row, with the keyboard's focus on it. Held here so a part can move before it's saved.
  const [parts, setParts] = useState(() => partsFromSaved(plan.practices))
  const [read, setRead] = useState(plan.practices)
  if (read !== plan.practices) { setRead(plan.practices); setParts(keepKeys(parts, partsFromSaved(plan.practices))) }
  const length = trainingMinutes(training)
  const over = overTime(totalMinutes(parts), length)
  const edit = (index: number) => navigate(planPath(training.id), { state: { editPart: index } satisfies PlannerState })
  const remove = (index: number) => {
    if (parts.length === 1) return setProblem(t('coachTraining:needsOnePart'))
    setProblem(null)
    const gone = parts[index]
    save.mutate({ parts: parts.filter((_, i) => i !== index), note: plan.note }, {
      onSuccess: () => toast(t('coachTraining:removed', { name: partName(gone.name) }), { action: { label: t('coachTraining:undo'), onClick: () => save.mutate({ parts, note: plan.note }) } }),
      onError: () => setProblem(t('coachTraining:couldntRemove')),
    })
  }
  const saveOrder = (next: Part[]) => {
    setProblem(null)
    save.mutate({ parts: next, note: plan.note }, {
      onError: () => { setParts(keepKeys(next, partsFromSaved(plan.practices))); setProblem(t('coachTraining:couldntMove')) },
    })
  }
  const move = (index: number, by: -1 | 1) => {
    if (save.isPending) return
    const next = moveTo(parts, index, index + by)
    setParts(next)
    saveOrder(next)
  }
  const drop = () => { if (!sameOrder(parts, partsFromSaved(plan.practices))) saveOrder(parts) }
  return <div className="mt-6 grid gap-5 laptop:grid-cols-[minmax(0,1fr)_320px] laptop:items-start">
    <section aria-labelledby="review" className="arc grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="review" className="text-[22px] font-medium text-ink">{t('coachSchedule:stepReview')}</h2>
        <TotalLine parts={parts} length={length} />
      </div>
      <TimeBar parts={parts} length={length} />
      {over && !cancelled && <OverTime text={over} />}
      {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
      {cancelled
        ? <ol aria-label={t('coachMatches:thePlan')} className="grid divide-y divide-line">{parts.map((part, i) => <li key={part.key} className="py-3 text-[15px] text-ink">
            {t('coachHome:minutes', { count: part.minutes })} · {part.drill?.name}</li>)}</ol>
        : <PlanRows parts={parts} onEdit={edit} onRemove={remove} onReorder={setParts} onMove={move} onDrop={drop} busy={save.isPending} />}
      {!cancelled && <div><Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus aria-hidden size={16} />{t('coachTraining:addAPart')}</Button></div>}
      {plan.note && <div className="rounded-xl bg-raised px-4 py-3 text-sm text-ink-2"><span className="font-medium text-ink">{t('coachTraining:yourNote')}</span> {plan.note}</div>}
    </section>
    <aside aria-labelledby="players" className="arc grid content-start gap-3 rounded-2xl border border-line bg-surface p-5">
      <h2 id="players" className="text-lg font-medium text-ink">{t('coachTraining:players')}</h2>
      <p className="text-sm text-ink-2">{t('coachTraining:plannedSquadHere')}</p>
    </aside>
    <AddPartSheet open={adding} onClose={() => setAdding(false)}
      onAdd={(type, name) => { setAdding(false); navigate(planPath(training.id), { state: { addPart: { type, name } } satisfies PlannerState }) }} />
  </div>
}

/* ── View ─────────────────────────────────────────────────────────────────── */

export function PitchViewRoute() {
  return <WithTraining>{(training, plan) => <PitchView training={training} plan={plan} />}</WithTraining>
}

/** The plan at the pitch side, on a phone: big type, one practice per row, when each starts and how long it runs. */
function PitchView({ training, plan }: { training: Training; plan: Plan | null }) {
  const practices = fromSaved(plan?.practices ?? [])
  const { t } = useTranslation()
  const { day, time } = gameWhen(training)
  const starts = practiceStarts(time || null, practices)
  return <div className="mx-auto grid max-w-[720px] gap-5 pt-5">
    {/* TRAK-334: opened from Training home's View plan, the trail goes back there; from the training's page, to that,
        which is also where it sits when opened from a link. */}
    <CoachTrail current={t('coachTraining:view')} parents={[{ label: day, href: `${TRAINING_PATH}/${training.id}` }]} />
    <header className="grid gap-1">
      <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">{t('coachTraining:view')}</p>
      <h1 className="text-[28px] font-medium leading-tight text-ink">{[day, time].filter(Boolean).join(' · ')}</h1>
      <p className="text-base text-ink-2 break-words">{[training.title, training.venue].filter(Boolean).join(' · ')}</p>
    </header>
    {practices.length === 0 ? <p className="text-[17px] text-ink-2">{t('coachTraining:nothingPlannedYet')} <Link to={planPath(training.id)} className={linkClass}>{t('coachTraining:planIt')}</Link></p>
      : <ol aria-label="Practices to run" className="grid gap-3">
        {practices.map((practice, i) => {
          const details = detailsLine(practice)
          return <li key={i} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 tablet:p-5">
            <div className="w-16 flex-none text-center">
              {starts[i] && <p className="text-[15px] font-medium text-brand">{starts[i]}</p>}
              <p className="text-[28px] font-medium leading-none text-ink">{practice.minutes}</p>
              <p className="text-[13px] text-ink-3">{t('coachTraining:minShort')}</p>
            </div>
            <div className="grid min-w-0 flex-1 content-start gap-1.5">
              {/* TRAK-341: the part it fills, when it isn't named after the drill. */}
              {practice.part && practice.part !== practice.name && <p className="text-[15px] font-medium text-brand break-words">{partName(practice.part)}</p>}
              <p className="text-[22px] font-medium leading-snug text-ink break-words">{practice.name}</p>
              {practice.tell.trim() && <p className="text-[19px] leading-snug text-ink break-words">“{practice.tell.trim()}”</p>}
              {details && <p className="text-[17px] text-ink-2 break-words">{details}</p>}
            </div>
          </li>
        })}
      </ol>}
  </div>
}
