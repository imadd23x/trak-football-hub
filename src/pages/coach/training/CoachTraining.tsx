import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Plus, TrafficCone } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { localTodayISO, phoneEventTime } from '@/lib/event-time'
import { LIBRARIES, SESSIONS, libraryPath } from '@/lib/library/library'
import { ON_LIBRARY } from '@/lib/fixed-colours'
import { searchDrills, splitTrainings, trainingMinutes, type Drill } from '@/lib/training/sessions'
import { planPath, viewPath, type PlannerState, type ViewState } from '@/lib/training/plans'
import { gameWhen } from '@/components/coach/games/useGames'
import { useDrills, usePlannedTrainings, useRegisters, useTrainings, type Training } from '@/components/coach/training/useTraining'
import { DrillSheet } from '@/components/coach/training/DrillSheet'
import { PlanWaySheet } from '@/components/coach/training/PlanWaySheet'
import { PitchViewRoute, PlanEditorRoute, PlanRoute } from './CoachTrainingPlan'
import { CoachMenuButton } from '@/components/coach/CoachFrame'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'

/* TRAK-294 (Training 1/5, spec TRAK-293): Training home, behind the academy's training switch. Sessions lists the
   coach's trainings from Schedule (Coming up, then Last week); Drills holds My drills, then the Library's tiles.
   Homework and Value of the month are parked (TRAK-293). TRAK-295 (Training 2/5): a training coming up says whether
   it's planned; Plan this session and New session ask how (PlanWaySheet), and a plan has its own pages. TRAK-296: a
   drill can be added to the next training not planned yet. TRAK-298: Last week says which trainings are closed (ended
   with their register taken) and opens each one's page. TRAK-310 (Kostas, 29 Oct): a training coming up has View plan
   and Edit plan, or Create plan, and New session is gone, since every training coming up has its own Create plan. */

export const TRAINING_PATH = '/coach/training'
/** Schedule's quick hand-over (TRAK-182 part 8): New event, on its first step, with Training picked. */
const ADD_TRAINING = { quickEvent: { kind: 'training' } }
const linkClass = 'rounded text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

export default function CoachTraining() {
  const { pathname } = useLocation()
  const navigation = useNavigationType()
  // As the Library's pages do: a page the coach opens (a plan once saved, too) starts at its top; Back (POP) is left to
  // the browser, which returns them to their place.
  useLayoutEffect(() => {
    if (navigation !== 'POP') (document.scrollingElement ?? document.documentElement).scrollTo(0, 0)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps -- only a new page moves to the top

  return (
    <Routes>
      <Route index element={<SessionsView />} />
      <Route path="drills" element={<DrillsView />} />
      <Route path=":eventId" element={<PlanRoute />} />
      <Route path=":eventId/plan" element={<PlanEditorRoute />} />
      <Route path=":eventId/view" element={<PitchViewRoute />} />
      {/* TRAK-309: View was Run it, at /run. An open tab or an older link (Home's Today card) still lands on it. */}
      <Route path=":eventId/run" element={<Navigate to="../view" relative="path" replace />} />
      <Route path="*" element={<Navigate to={TRAINING_PATH} replace />} />
    </Routes>
  )
}

function Page({ view, action, children }: { view: 'sessions' | 'drills'; action?: ReactNode; children: ReactNode }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 pt-6 pb-4">
          <CoachMenuButton name={profile?.full_name || 'Coach'} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink">Training</h1>
          <div className="arc">
            <SegmentedControl label="Training view" value={view}
              options={[{ value: 'sessions', label: 'Sessions' }, { value: 'drills', label: 'Drills' }]}
              onValueChange={next => navigate(next === 'drills' ? `${TRAINING_PATH}/drills` : TRAINING_PATH)} />
          </div>
          {action && <div className="arc ml-auto">{action}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

function SessionsView() {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const navigate = useNavigate()
  const trainings = useTrainings()
  const planned = usePlannedTrainings()
  const registers = useRegisters()
  // "How do you want to plan it?", for the training whose Create plan was pressed; kept while the sheet closes.
  const [planning, setPlanning] = useState<{ training: Training; open: boolean } | null>(null)
  // TRAK-305: All or one squad, as picked at the top of the frame.
  const { everySquad } = coachSquad
  const inView = (trainings.data ?? []).filter(t => everySquad || coachSquad.eventInSquad(t.squad))
  const { comingUp, lastWeek } = splitTrainings(inView, Date.now())
  const addTraining = () => navigate('/coach/schedule', { state: ADD_TRAINING })
  const isPlanned = (training: Training) => planned.data?.has(training.id)

  return (
    <Page view="sessions">
      {trainings.error ? <LoadError what="your trainings" onRetry={() => void trainings.refetch()} retrying={trainings.isFetching} />
        : trainings.isPending ? <p role="status" className="pt-14 text-center text-[13px] text-ink-3">Loading your trainings…</p>
        : <div className="grid gap-8">
          <section aria-labelledby="coming-up" className="grid gap-3">
            <h2 id="coming-up" className="text-lg font-medium text-ink">Coming up</h2>
            {comingUp.length === 0 ? (
              <div className="arc">
                <EmptyState icon={<TrafficCone size={24} strokeWidth={1.5} />} title="No training coming up"
                  description="Add a training in Schedule. You'll plan it here."
                  action={<Button onClick={addTraining}>Add a training</Button>} />
              </div>
            ) : <ul className="grid gap-3">
              {comingUp.map(training => <li key={training.id}><ComingUp training={training} showSquad={everySquad}
                planned={planned.data ? !!isPlanned(training) : null} onPlan={() => setPlanning({ training, open: true })} /></li>)}
            </ul>}
          </section>

          {lastWeek.length > 0 && <section aria-labelledby="last-week" className="grid gap-3">
            <h2 id="last-week" className="text-lg font-medium text-ink">Last week</h2>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface px-5">
              {lastWeek.map(training => {
                const { day } = gameWhen(training)
                // Every training here is over, so it is closed once its register is taken; unknown while that's read.
                const closed = registers.data ? registers.data.has(training.id) : null
                return <li key={training.id}>
                  <Link to={`${TRAINING_PATH}/${training.id}`}
                    className="arc flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[15px] text-ink"><span className="font-medium">{day}</span> · {training.title}</span>
                      {everySquad && training.squad && <span className="text-sm text-ink-3">{training.squad}</span>}
                    </span>
                    {closed !== null && <Badge size="sm" tone={closed ? 'success' : 'warning'}>{closed ? 'Closed' : 'No register'}</Badge>}
                  </Link>
                </li>
              })}
            </ul>
          </section>}
        </div>}
      {planning && <PlanWaySheet open={planning.open} onOpenChange={open => setPlanning({ ...planning, open })} training={planning.training} />}
    </Page>
  )
}

/** One training coming up: when and where, its title and length, and on its right View plan and Edit plan, or Create
    plan when it isn't planned yet (nothing while that's read, `planned` null). TRAK-310: the buttons say whether it's
    planned, so no Planned badge, and Schedule has its own tab, so no Open in Schedule. */
function ComingUp({ training, showSquad, planned, onPlan }: { training: Training; showSquad: boolean; planned: boolean | null; onPlan: () => void }) {
  const navigate = useNavigate()
  const { day, time, academy } = gameWhen(training)
  const today = phoneEventTime(training).date === localTodayISO()
  const minutes = trainingMinutes(training)
  return (
    <article aria-label={`${day}, ${training.title}`}
      className="arc flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-surface p-5">
      {/* At least 16rem wide, so on a phone the buttons go under it rather than squeezing it. */}
      <div className="grid min-w-0 flex-[1_1_16rem] gap-2">
        <p className="text-sm font-medium text-brand">{[today ? 'Today' : null, day, time, training.venue].filter(Boolean).join(' · ')}</p>
        <p className="text-lg font-medium text-ink break-words">{training.title}</p>
        <p className="text-sm text-ink-3">{[minutes ? `${minutes} min` : null, showSquad ? training.squad : null,
          training.published ? null : 'Not published yet', academy].filter(Boolean).join(' · ')}</p>
      </div>
      {planned !== null && <div className="flex flex-wrap gap-2">
        {planned ? <>
          {/* Kostas, 29 Oct: View plan opens View, as the training's own View button does. */}
          <Button size="sm" variant="secondary" onClick={() => navigate(viewPath(training.id), { state: { back: 'training' } satisfies ViewState })}>View plan</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(planPath(training.id))}>Edit plan</Button>
        </> : <Button size="sm" onClick={onPlan}>Create plan</Button>}
      </div>}
    </article>
  )
}

/* ── Drills ─────────────────────────────────────────────────────────────── */

function DrillsView() {
  const drills = useDrills()
  const navigate = useNavigate()
  const trainings = useTrainings()
  const planned = usePlannedTrainings()
  // The next training not planned yet, of any squad; none while either read is pending or failed.
  const next = trainings.data && planned.data
    ? splitTrainings(trainings.data, Date.now()).comingUp.find(training => !planned.data.has(training.id)) : undefined
  const nextDay = next ? gameWhen(next).day : null
  const [query, setQuery] = useState('')
  // The sheet: closed, a new drill, or one of the coach's drills to change.
  const [sheet, setSheet] = useState<{ drill: Drill | null } | null>(null)
  const shown = searchDrills(drills.data ?? [], query)

  return (
    <Page view="drills" action={<Button onClick={() => setSheet({ drill: null })}><Plus aria-hidden size={18} />New drill</Button>}>
      <div className="arc max-w-[560px]">
        <SearchField label="Search my drills" placeholder="Search my drills" value={query} onValueChange={setQuery} />
      </div>

      <section aria-labelledby="my-drills" className="mt-7">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="my-drills" className="text-lg font-medium text-ink">My drills</h2>
          <p className="text-sm text-ink-3">Only you see these.</p>
        </div>
        {drills.error ? <div className="mt-3"><LoadError what="your drills" onRetry={() => void drills.refetch()} retrying={drills.isFetching} /></div>
          : drills.isPending ? <p role="status" className="mt-3 text-[13px] text-ink-3">Loading your drills…</p>
          : (drills.data ?? []).length === 0 ? <p className="mt-3 text-[15px] text-ink-2">No drills yet. Add one with New drill, and use it in any session.</p>
          : shown.length === 0 ? <p className="mt-3 text-[15px] text-ink-2">No drill matches “{query.trim()}”.</p>
          : <ul className="mt-3 grid gap-3 tablet:grid-cols-2 laptop:grid-cols-3">
            {shown.map(drill => <li key={drill.id} className="flex h-full flex-col rounded-2xl border border-line bg-surface">
              <button type="button" onClick={() => setSheet({ drill })} aria-label={`${drill.name}, ${drill.minutes} min. Edit`}
                className="flex w-full flex-1 flex-col gap-1 rounded-2xl p-4 text-left transition-transform active:scale-[.98] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-[15px] font-medium text-ink">{drill.name}</span>
                  <span className="flex-none text-sm text-ink-3">{drill.minutes} min</span>
                </span>
                {drill.how && <span className="line-clamp-2 text-sm text-ink-2">{drill.how}</span>}
              </button>
              {next && <button type="button" aria-label={`Add ${drill.name} to ${nextDay}`}
                onClick={() => navigate(planPath(next.id), { state: { addDrill: drill } satisfies PlannerState })}
                className={`mx-4 mb-3 inline-flex min-h-11 items-center gap-1.5 self-start ${linkClass}`}>
                <Plus aria-hidden size={16} />Add to {nextDay}</button>}
            </li>)}
          </ul>}
      </section>

      <section aria-labelledby="from-library" className="mt-9">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="from-library" className="text-lg font-medium text-ink">From the Library</h2>
          <p className="text-sm text-ink-3">When you want ideas</p>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2.5 tablet:grid-cols-4">
          {LIBRARIES.map(library => <li key={library.key}>
            <Link to={libraryPath(library.key)}
              className="flex h-20 flex-col justify-end rounded-[10px] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              style={{ background: library.colour, color: ON_LIBRARY }}>
              <span className="text-[15px] font-medium leading-tight">{library.label}</span>
              <span className="text-[12px]">{SESSIONS.filter(s => s.library === library.name).length} sessions</span>
            </Link>
          </li>)}
        </ul>
      </section>

      <DrillSheet open={!!sheet} drill={sheet?.drill ?? null} onOpenChange={open => { if (!open) setSheet(null) }} />
    </Page>
  )
}
