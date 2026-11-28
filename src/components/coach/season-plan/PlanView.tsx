import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowUpRight, BellRing, CalendarRange, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Clock, Pencil, Plus,
  Printer, Share2, SlidersHorizontal, UserX,
} from 'lucide-react'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { PlayerFace } from '@/components/trak/PlayerFace'
import { PageTop } from '@/components/coach/PageTop'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useSquadRoster } from '@/components/coach/squad/useSquadRoster'
import { PositionAndRolesSheet } from '@/components/coach/squad/PositionAndRolesSheet'
import { useFormations } from '@/components/coach/squad/formations/useFormations'
import { POSITIONS, isPosition, positionsBoard } from '@/lib/positions'
import { shortPosition, slotPosition } from '@/lib/squad/formation-board'
import {
  changesText, lastShared, loadRemovedSeasonObjectives, notSharedYet, phaseLabel, removedSeasonObjectivesKey, seasonPlanKey, shareSeasonPlan,
  shortDate, type SeasonObjective, type SeasonPlan,
} from '@/lib/season-plan'
import { defaultFormation, missingFirst, nextReportText, pitchOf } from '@/lib/season-plan-page'
import type { Tables } from '@/integrations/supabase/types'
import { isWatchRule, ruleText } from '@/lib/watch-first'
import { PlayerObjectivesSheet } from './PlayerObjectivesSheet'
import { usePlayerObjectives } from './usePlayerObjectives'
import { useWatchList, useWatchPlayers } from './useWatching'
import { WatchBadge } from './WatchFirst'
import { useSquadEvaluations } from './useEvaluation'
import { rhythmOf, rhythmText } from '@/lib/evaluation'
import { BTN, BTN_DARK, CARD, FOCUS, GOOD, PILL, SectionHeading, SquadBadge, WAIT } from '@/components/coach/pitch-ready'

/* TRAK-356 (Season plan 8/18, spec TRAK-348): View plan. Once shared, the set-up never comes back: the plan reads part
   by part, each with its Edit. Edits save straight away and wait under "Not shared yet" until the coach shares the
   changes (Tarek, 6 Nov). Positions are edited in Squad; a player's objectives in their sheet. A season objective or
   player objective removed after sharing stays in its history, with its dates. Watching (TRAK-355) lists who is watched
   first. Home's Set up for a watched player lands here with their sheet open (?player=).
   Pitch-ready page (Tarek, 24 Nov, season_plan_pitch_ready_mockup.html, its look taken literally): a header with the
   squad, the share state, Share and Print; one schedule strip with the next report; the season objectives as three
   cards by phase of play; Squad readiness: Positions on the squad's default formation (Squad › Formations) with a
   bench and a list, and Player objectives with the first player missing one, players without one listed first.
   Share Plan shares the changes (no link: the plan is read in the app). Print hides everything but this page. */

type Player = Tables<'squad_players'>
const SHARE_FAILED = "Couldn't share the changes. Check your connection and try again."
const WATCH_FAILED = "Couldn't start watching. Check your connection and try again."
const PREVIEW = 4
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const shortOf = (position: string | null) => POSITIONS.find(p => p.value === position)?.short ?? '–'
const lastName = (name: string) => name.trim().split(/\s+/).slice(-1)[0]

// Every state renders the same root and header first, so the header stays put when the plan finishes loading.
const PAGE = 'grid gap-6 pb-4 sm:gap-7'
const PHASE_THEME: Record<string, { top: string; badge: string; dot: string }> = {
  in_possession: { top: 'border-t-success', badge: 'border-success bg-success/10 text-success', dot: 'bg-success' },
  out_of_possession: { top: 'border-t-info', badge: 'border-info bg-info/10 text-info', dot: 'bg-info' },
  transition: { top: 'border-t-attention', badge: 'border-attention bg-attention/10 text-warning', dot: 'bg-attention' },
}
const NO_PHASE_THEME = { top: 'border-t-ink', badge: 'border-line-strong bg-raised text-ink', dot: 'bg-ink' }

function Meter({ done, of, label, good }: { done: number; of: number; label: string; good: boolean }) {
  const pct = of ? Math.round((done / of) * 100) : 0
  return <div className="grid gap-2">
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-baseline gap-2">
        <span className="whitespace-nowrap text-4xl font-black tracking-tight text-ink tabular-nums">{done} / {of}</span>
        <span className="text-sm font-bold text-ink-2">{label}</span>
      </span>
      <span className={`text-sm font-black ${good ? 'text-success' : 'text-warning'}`}>{pct}%</span>
    </div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={done}
      className="h-3 w-full overflow-hidden rounded-full border border-line bg-raised">
      <div className={`h-full rounded-full transition-all duration-300 ${good ? 'bg-success' : 'bg-attention'}`} style={{ width: `${pct}%` }} />
    </div>
  </div>
}

export function PlanView({ coachId, squad, plan, seasonObjectives }: {
  coachId: string
  squad: string
  plan: SeasonPlan
  seasonObjectives: SeasonObjective[]
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const roster = useSquadRoster()
  const objectives = usePlayerObjectives(coachId)
  const watching = useWatchList(coachId, roster)
  const watch = useWatchPlayers(coachId)
  const formations = useFormations(coachId, squad)
  const removed = useQuery({ queryKey: removedSeasonObjectivesKey(coachId, plan.id), queryFn: () => loadRemovedSeasonObjectives(plan.id) })
  const evaluation = useSquadEvaluations(coachId, [squad])
  const [openId, setOpenId] = useState<string | null>(null)
  const [unit, setUnit] = useState<string>('ALL')
  const [view, setView] = useState<'pitch' | 'list'>('pitch')
  const [showAll, setShowAll] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const share = useMutation({
    mutationFn: () => shareSeasonPlan(plan.id, false),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: seasonPlanKey(coachId, squad) })
      toast.success('Changes shared')
    },
    onError: (error: { code?: string; message?: string }) => setProblem(error.code === 'P0001' && error.message ? error.message : SHARE_FAILED),
  })

  // A link to one player (Home's Set up, TRAK-355) opens their sheet once the squad is in.
  const [params, setParams] = useSearchParams()
  const asked = useRef(params.get('player'))
  useEffect(() => {
    if (!asked.current || roster.isPending) return
    if (roster.players.some(p => p.id === asked.current)) setOpenId(asked.current)
    asked.current = null
    setParams(current => { const next = new URLSearchParams(current); next.delete('player'); return next }, { replace: true })
  }, [roster.isPending, roster.players, setParams])

  const names = new Map(roster.players.map(p => [p.id, p.player_name]))
  const changes = notSharedYet(plan, id => names.get(id))
  const shared = lastShared(plan)
  const board = positionsBoard(roster.players, roster.consentPending)
  const header = (actions: boolean) => (
    <PageTop title="Season plan" trail={<CoachTrail current="Season plan" />}
      pill={<>
        <SquadBadge>
          {squad}{roster.isPending ? '' : ` · ${board.total} Players`}
        </SquadBadge>
        {changes.length
          ? <span className={`${WAIT} px-3 py-1.5 sm:text-sm`}><AlertTriangle aria-hidden size={16} strokeWidth={2.5} className="text-warning" />Changes not shared</span>
          : <span className={`${GOOD} px-3 py-1.5 sm:text-sm`}><CheckCircle2 aria-hidden size={16} strokeWidth={2.5} className="text-success" />Shared{shared ? ` · ${shortDate(shared)}` : ''}</span>}
      </>}>
      {actions && <div className="flex flex-wrap items-center gap-2.5 print:hidden">
        <button type="button" className={BTN} disabled={share.isPending}
          onClick={() => { setProblem(null); if (changes.length) share.mutate(); else toast('Everything is shared.') }}>
          <Share2 aria-hidden size={16} strokeWidth={2.25} />{share.isPending ? 'Sharing…' : 'Share Plan'}
        </button>
        <button type="button" className={BTN} onClick={() => window.print()}>
          <Printer aria-hidden size={16} strokeWidth={2.25} />Print / Pitch Sheet
        </button>
      </div>}
    </PageTop>
  )

  // The pitch is a bonus: a formation that fails to load leaves the list, never the whole plan.
  if (roster.error || objectives.error || removed.error) {
    return <div id="season-plan-print" className={PAGE}>{header(false)}<LoadError what="your season plan" onRetry={() => { roster.retry(); void objectives.refetch(); void removed.refetch() }} /></div>
  }
  if (roster.isPending || objectives.isPending || removed.isPending || formations.isPending) {
    return <div id="season-plan-print" className={PAGE}>{header(false)}<LoadingSkeleton label="Loading your season plan…" lines={4} className="pt-2" /></div>
  }

  const listed = [...board.lines.flatMap(line => line.players), ...board.unplaced]
  const placed = board.lines.flatMap(line => line.players)
  const count = (p: Player) => objectives.of(p.id).length
  const missing = placed.filter(p => count(p) === 0)
  const sorted = missingFirst(placed, count)
  const visible = showAll ? sorted : sorted.slice(0, PREVIEW)
  const opened = roster.players.find(p => p.id === openId)
  const plain = seasonObjectives.map(o => ({ id: o.id, title: o.title }))
  const watchOf = new Map(watching.list.map(w => [w.playerId, w]))
  const watched = roster.players.filter(p => watchOf.has(p.id))
  const rule = watching.list[0]?.rule ?? (isWatchRule(plan.watch_rule) ? plan.watch_rule : 't2')
  const formation = defaultFormation(formations.data ?? [])
  const pitch = formation ? pitchOf(formation, listed) : null
  const showPitch = !!pitch && view === 'pitch'
  const dim = (p: Player) => unit !== 'ALL' && shortOf(p.position) !== unit
  const { every, day: evalDay } = rhythmOf(plan)
  const mine = evaluation.list.find(e => e.squad === squad)
  // The sheets' Watch first, as in the set-up steps: watching (again) closes the sheet.
  const watchAction = (id: string) => ({ label: watchOf.has(id) ? 'Keep watching' as const : 'Watch first' as const, pending: watch.isPending,
    onWatch: () => watch.mutate([id], { onSuccess: () => setOpenId(null), onError: () => setProblem(WATCH_FAILED) }) })

  // The keeper stands lower than slotsOf's 8%, so the back line's names never touch the keeper (Rehearsal FC, 25 Nov).
  const place = (spot: NonNullable<typeof pitch>['spots'][number]) => ({ left: `${spot.x}%`, top: `${100 - (spot.slot === 1 ? 2 : spot.y)}%` })
  const dot = (spot: NonNullable<typeof pitch>['spots'][number]) => {
    const p = spot.player
    const role = shortPosition(slotPosition(formation!.shape, spot.slot))
    if (!p) return <span key={spot.slot} style={place(spot)} aria-label={`${role}, empty place`} role="img"
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
      <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-surface/60 text-xs font-black text-ink-3">{role}</span>
      <span className="whitespace-nowrap rounded border border-dashed border-line bg-surface/80 px-1.5 py-0.5 text-[11px] font-bold leading-none text-ink-3">Empty</span>
    </span>
    const none = count(p) === 0
    return <button key={spot.slot} type="button" aria-haspopup="dialog" onClick={() => setOpenId(p.id)}
      aria-label={`${p.player_name}, ${role}${none ? ', no objective yet' : ''}`} style={place(spot)}
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-lg transition-all ${FOCUS} ${dim(p) ? 'scale-95 opacity-25' : 'hover:scale-105'}`}>
      <span className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 bg-surface text-xs font-black text-ink shadow-sm ${none ? 'border-attention ring-2 ring-attention' : 'border-ink'}`}>
        {role}
        {none && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-attention text-[9px] font-black text-on-bright">!</span>}
      </span>
      <span className="whitespace-nowrap rounded border border-line bg-surface/95 px-1.5 py-0.5 text-[11px] font-extrabold leading-none text-ink shadow-sm">{lastName(p.player_name)}</span>
    </button>
  }

  const playerRow = (player: Player) => {
    const held = objectives.of(player.id)
    const gone = objectives.removedOf(player.id)
    const has = held.length > 0
    return <li key={player.id}>
      <button type="button" onClick={() => setOpenId(player.id)} aria-haspopup="dialog"
        className={`flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-raised/60 sm:items-center ${FOCUS}`}>
        <span className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black ${has ? 'border-line bg-raised text-ink' : 'border-attention bg-attention/15 text-warning'}`}>
            {shortOf(player.position)}
          </span>
          <span className="grid min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-ink">{player.player_name}</span>
              {has ? <span className="rounded border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">{held.length} obj</span>
                : <span className="rounded border border-attention bg-attention/15 px-2 py-0.5 text-[11px] font-extrabold text-warning">Missing</span>}
              <WatchBadge watch={watchOf.get(player.id)} />
            </span>
            <span className={`mt-0.5 text-xs font-semibold ${has ? 'text-ink-2' : 'text-warning'}`}>
              {has ? held.map(o => o.title).join(' · ') : 'No objective yet. Tap to assign'}
            </span>
            {gone.length > 0 && <span className="text-xs text-ink-3">Removed: {gone.map(o => `${o.title} (${shortDate(o.removed)})`).join(' · ')}</span>}
          </span>
        </span>
        <ChevronRight aria-hidden size={16} className="mt-2 shrink-0 text-ink-3 sm:mt-0" /><span className="sr-only">Edit</span>
      </button>
    </li>
  }

  return (
    <div id="season-plan-print" className={PAGE}>
      {header(true)}
      {opened && (isPosition(opened.position)
        ? <PlayerObjectivesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
          seasonObjectives={plain} open onOpenChange={open => { if (!open) setOpenId(null) }} saveNeedsChange onSaved={() => setOpenId(null)}
          watch={objectives.of(opened.id).length ? undefined : watchAction(opened.id)} />
        : <PositionAndRolesSheet coachId={coachId} player={{ id: opened.id, name: opened.player_name, position: opened.position }}
          open onOpenChange={open => { if (!open) setOpenId(null) }} saveNeedsChange onSaved={() => setOpenId(null)} watch={watchAction(opened.id)} />)}

      {changes.length > 0 && <div className="flex flex-col justify-between gap-3 rounded-xl border-2 border-attention bg-attention/10 p-4 sm:flex-row sm:items-center print:hidden">
        <span className="flex items-center gap-3">
          <AlertTriangle aria-hidden size={20} strokeWidth={2.25} className="shrink-0 text-warning" />
          <span className="text-base font-extrabold text-ink">Not shared yet: {changesText(changes)}.</span>
        </span>
        <button type="button" className={BTN_DARK} disabled={share.isPending} onClick={() => { setProblem(null); share.mutate() }}>
          {share.isPending ? 'Sharing…' : 'Share the changes'}
        </button>
      </div>}
      {problem && <p role="alert" className="rounded-xl border-2 border-danger bg-danger/10 p-4 text-sm font-bold text-danger">{problem}</p>}

      <section aria-label="Season schedule" className={`${CARD} flex flex-col justify-between gap-3.5 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center`}>
        <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised"><CalendarRange aria-hidden size={16} strokeWidth={2.25} className="text-ink" /></span>
            <span className="text-sm sm:text-base"><span className="font-semibold text-ink-2">Season: </span>
              <span className="font-extrabold text-ink">{plan.starts_on && plan.ends_on ? `${day(plan.starts_on)} – ${day(plan.ends_on)}` : 'No dates yet'}</span></span>
          </div>
          <span aria-hidden="true" className="hidden h-6 w-0.5 bg-raised sm:block" />
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised"><Clock aria-hidden size={16} strokeWidth={2.25} className="text-ink" /></span>
              <span className="min-w-0 text-sm sm:text-base"><span className="font-semibold text-ink-2">Reports: </span>
                <span className="font-bold text-ink">{rhythmText(every, evalDay).replace(/^e/, 'E')}</span></span>
            </span>
            {mine && <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-attention bg-attention/15 px-3 py-1 text-xs font-extrabold text-warning sm:text-sm">
              <BellRing aria-hidden size={14} strokeWidth={2.5} className="text-warning" />{nextReportText(mine.due, evaluation.today)}
            </span>}
          </div>
        </div>
        <button type="button" className={`${BTN} shrink-0`} onClick={() => navigate('/coach/season-plan/edit/schedule')}>
          <Pencil aria-hidden size={16} strokeWidth={2.25} />Edit Schedule
        </button>
      </section>

      <section aria-labelledby="plan-objectives" className="grid gap-3.5 break-inside-avoid">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading id="plan-objectives" bar="bg-success">Core tactical objectives</SectionHeading>
          <button type="button" className={BTN} onClick={() => navigate('/coach/season-plan/edit/objectives')}>
            <SlidersHorizontal aria-hidden size={16} strokeWidth={2.25} />Edit Objectives
          </button>
        </div>
        {seasonObjectives.length === 0
          ? <p className={`${CARD} p-5 text-base font-semibold text-ink-2`}>No season objectives yet.</p>
          : <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:gap-5 tablet:grid-cols-3">{seasonObjectives.map((o, index) => {
            const theme = (o.phase && PHASE_THEME[o.phase]) || NO_PHASE_THEME
            const phase = phaseLabel(o.phase)
            return <li key={o.id}>
              <button type="button" onClick={() => navigate('/coach/season-plan/edit/objectives')} aria-label={`Edit ${o.title}`}
                className={`group grid h-full w-full content-start gap-3 rounded-2xl border-2 border-t-[6px] border-line ${theme.top} bg-surface p-5 text-left shadow-sm transition-all hover:border-ink hover:shadow-md sm:p-6 ${FOCUS}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${theme.badge}`}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${theme.dot}`} />
                    {String(index + 1).padStart(2, '0')}{phase ? ` · ${phase}` : ''}
                  </span>
                  <Pencil aria-hidden size={16} className="text-ink-3 group-hover:text-ink print:hidden" />
                </span>
                <span className="text-xl font-black leading-snug tracking-tight text-ink sm:text-2xl">{o.title}</span>
                {o.looks_like && <span className="text-base font-semibold leading-relaxed text-ink-2">{o.looks_like}</span>}
              </button>
            </li>
          })}</ol>}
        {(removed.data ?? []).length > 0 && <div className="grid gap-1">
          <h3 className="text-xs font-black uppercase tracking-wider text-ink-3">Removed</h3>
          <ul className="m-0 grid list-none gap-1 p-0">{removed.data!.map(o => (
            <li key={o.id} className="text-sm text-ink-2"><span className="font-bold text-ink">{o.title}</span> · added {shortDate(o.created_at)}, removed {shortDate(o.retired_at)}</li>))}
          </ul>
        </div>}
      </section>

      <section aria-labelledby="plan-readiness" className="grid gap-3.5">
        <SectionHeading id="plan-readiness" bar="bg-ink">Squad readiness</SectionHeading>
        <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 xl:grid-cols-2">

          <section aria-labelledby="plan-positions" className={`${CARD} grid gap-5 p-5 break-inside-avoid sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h3 id="plan-positions" className="text-xl font-black tracking-tight text-ink">Positions</h3>
                {board.unplaced.length === 0
                  ? <span className={GOOD}><Check aria-hidden size={14} strokeWidth={3} />All Placed</span>
                  : <span className={WAIT}><AlertTriangle aria-hidden size={14} strokeWidth={2.5} className="text-warning" />{board.unplaced.length} Without Position</span>}
              </div>
              <button type="button" className={BTN} onClick={() => navigate('/coach/squad')}>Manage Positions<ArrowUpRight aria-hidden size={16} strokeWidth={2.25} /></button>
            </div>
            <Meter done={board.placed} of={board.total} label="players placed" good={board.unplaced.length === 0} />

            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Show a position" className="flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={unit === 'ALL'} className={PILL(unit === 'ALL')} onClick={() => setUnit('ALL')}>ALL: {board.total}</button>
                {board.lines.map(line => <button key={line.value} type="button" aria-pressed={unit === line.short} className={PILL(unit === line.short)}
                  onClick={() => setUnit(line.short)}>{line.short}: {line.players.length}</button>)}
              </div>
              {pitch && <div role="group" aria-label="View" className="ml-auto flex items-center rounded-xl border-2 border-line bg-surface p-0.5 print:hidden">
                {(['pitch', 'list'] as const).map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-extrabold transition-colors ${FOCUS} ${view === v ? 'bg-brand text-on-brand' : 'text-ink-2 hover:text-ink'}`}>
                  {v === 'pitch' ? `${formation!.shape} Pitch` : 'List'}
                </button>)}
              </div>}
            </div>

            {showPitch ? <div className="grid gap-3">
              <div className="relative h-96 w-full select-none overflow-hidden rounded-xl border-2 border-pitch bg-pitch/10" aria-label={`${formation!.name}, ${formation!.shape}`} role="group">
                <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-pitch opacity-45" viewBox="0 0 400 280" preserveAspectRatio="none">
                  <rect x="10" y="10" width="380" height="260" fill="none" stroke="currentColor" strokeWidth="2" />
                  <line x1="10" y1="140" x2="390" y2="140" stroke="currentColor" strokeWidth="2" />
                  <circle cx="200" cy="140" r="34" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="125" y="10" width="150" height="44" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="125" y="226" width="150" height="44" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <div className="absolute inset-x-4 inset-y-12">{pitch.spots.map(dot)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-line bg-surface p-3">
                <span className="mr-1 text-xs font-black uppercase tracking-wider text-ink-3">Bench ({pitch.bench.length}):</span>
                {pitch.bench.map(p => <button key={p.id} type="button" aria-haspopup="dialog" onClick={() => setOpenId(p.id)}
                  className={`rounded-lg border border-line bg-raised/60 px-2.5 py-1 text-xs font-bold text-ink transition-all hover:border-ink ${FOCUS} ${dim(p) ? 'opacity-30' : ''}`}>
                  <span className="mr-1 font-extrabold text-ink-3">{shortOf(p.position)}</span>{p.player_name}
                </button>)}
              </div>
            </div>
              : <div className="grid gap-2">
                {formations.isError ? <p className="text-sm font-semibold text-ink-2">
                  Couldn’t load the pitch. <button type="button" className={`font-bold text-ink underline ${FOCUS}`} onClick={() => void formations.refetch()}>Try again</button>
                </p> : !formation && <p className="text-sm font-semibold text-ink-2">
                  No default formation yet. <button type="button" className={`font-bold text-ink underline ${FOCUS}`} onClick={() => navigate('/coach/squad')}>Set one in Squad</button> to see the pitch.
                </p>}
                <ul className="m-0 max-h-[310px] list-none divide-y divide-line overflow-y-auto rounded-xl border-2 border-line p-0">
                  {listed.filter(p => unit === 'ALL' || shortOf(p.position) === unit).map(p => {
                    const starter = pitch?.spots.some(s => s.player?.id === p.id)
                    return <li key={p.id}>
                      <button type="button" aria-haspopup="dialog" onClick={() => setOpenId(p.id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-raised/60 ${FOCUS}`}>
                        <span className="flex items-center gap-3">
                          <PlayerFace name={p.player_name} playerId={p.id} size="sm" />
                          <span className="grid">
                            <span className="text-sm font-extrabold text-ink">{p.player_name}</span>
                            <span className="text-xs font-semibold text-ink-3">{!isPosition(p.position) ? 'No position yet' : !pitch ? p.position : starter ? 'Starting XI' : 'Bench'}</span>
                          </span>
                        </span>
                        <span className="rounded-lg border-2 border-line bg-surface px-2.5 py-1 text-xs font-black text-ink">{shortOf(p.position)}</span>
                      </button>
                    </li>
                  })}
                </ul>
              </div>}

            {/* Home's "Place them" lands here once the plan is shared: each name opens their position. */}
            {board.unplaced.length > 0 && <div className="grid gap-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-warning">No position yet · {board.unplaced.length}</h4>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{board.unplaced.map(p => (
                <li key={p.id}><button type="button" aria-haspopup="dialog" className={`${BTN} min-h-10 px-3 text-xs`} onClick={() => setOpenId(p.id)}>{p.player_name}</button></li>))}
              </ul>
            </div>}
          </section>

          <section aria-labelledby="plan-players" className={`${CARD} grid gap-5 p-5 break-inside-avoid sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h3 id="plan-players" className="text-xl font-black tracking-tight text-ink">Player Objectives</h3>
                {missing.length
                  ? <span className={WAIT}><AlertTriangle aria-hidden size={14} strokeWidth={2.5} className="text-warning" />{missing.length} Missing</span>
                  : <span className={GOOD}><Check aria-hidden size={14} strokeWidth={3} />All Assigned</span>}
              </div>
              {placed.length > PREVIEW && <button type="button" className={BTN} aria-expanded={showAll} aria-controls="plan-players-list" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Collapse List' : `View All (${placed.length})`}
                <ChevronDown aria-hidden size={16} strokeWidth={2.25} className={`transition-transform ${showAll ? 'rotate-180' : ''}`} />
              </button>}
            </div>
            <Meter done={placed.length - missing.length} of={placed.length} label="players have 1–2 objectives" good={missing.length === 0} />

            {missing.length > 0
              ? <div className="flex flex-col justify-between gap-3 rounded-xl border-2 border-attention bg-attention/10 p-4 sm:flex-row sm:items-center">
                <span className="flex items-start gap-3 sm:items-center">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-attention bg-attention/25 text-warning"><UserX aria-hidden size={20} strokeWidth={2.25} /></span>
                  <span className="grid">
                    <span className="text-xs font-black uppercase tracking-wider text-warning">Action needed</span>
                    <span className="text-base font-extrabold text-ink">Missing objective: {missing[0].player_name} ({shortOf(missing[0].position)})</span>
                  </span>
                </span>
                <button type="button" className={`${BTN_DARK} shrink-0`} aria-haspopup="dialog" onClick={() => setOpenId(missing[0].id)}>
                  <Plus aria-hidden size={16} strokeWidth={2.5} />Assign Objective
                </button>
              </div>
              : placed.length > 0 && <div className="flex items-center gap-3 rounded-xl border-2 border-success bg-success/10 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success bg-success/15 text-success"><CheckCheck aria-hidden size={20} strokeWidth={2.5} /></span>
                <span className="grid">
                  <span className="text-xs font-black uppercase tracking-wider text-success">Squad ready</span>
                  <span className="text-sm font-extrabold text-ink sm:text-base">All {placed.length} {squad} players have objectives.</span>
                </span>
              </div>}

            {placed.length > 0 && <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-black uppercase tracking-wider text-ink-3">
                  {showAll || placed.length <= PREVIEW ? `Full ${squad} squad (${placed.length})` : `Squad preview (showing ${PREVIEW} of ${placed.length})`}
                </span>
                <span className="text-xs font-semibold text-ink-3 print:hidden">Tap any player to edit</span>
              </div>
              <ul id="plan-players-list" className="m-0 list-none divide-y-2 divide-line-soft overflow-hidden rounded-xl border-2 border-line bg-surface p-0">
                {visible.map(playerRow)}
              </ul>
            </div>}
          </section>
        </div>
      </section>

      {watched.length > 0 && <section aria-labelledby="plan-watching" className={`${CARD} grid gap-3 p-5 sm:p-6 print:hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="plan-watching" className="text-xl font-black tracking-tight text-ink">Watching <span className="font-bold text-ink-3">· {watched.length}</span></h2>
          <button type="button" className={BTN} onClick={() => navigate('/coach/season-plan/edit/reminder')}><Pencil aria-hidden size={16} strokeWidth={2.25} />Edit Reminder</button>
        </div>
        <p className="text-sm font-semibold text-ink-2">Reminder {ruleText(rule)}, 4 weeks at the latest.</p>
        <ul className="m-0 list-none divide-y-2 divide-line-soft p-0">{watched.map(player => {
          const w = watchOf.get(player.id)!
          return <li key={player.id} className="flex items-center gap-3 py-2.5">
            <PlayerFace name={player.player_name} playerId={player.id} size="sm" />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-extrabold text-ink">{player.player_name}</span>
              <span className="text-xs font-semibold text-ink-2">{w.ready ? `${w.why}: time to set them up` : `Since ${shortDate(w.since)} · ${w.progress}`}</span>
            </span>
            <button type="button" className={`${BTN} min-h-10 px-3 text-xs`} aria-haspopup="dialog" onClick={() => setOpenId(player.id)}>
              {isPosition(player.position) ? 'Give Objectives' : 'Give a Position'}
            </button>
          </li>
        })}</ul>
      </section>}
    </div>
  )
}
