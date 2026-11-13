import { useTranslation } from '@/lib/i18n'
import { partName, partNote } from '@/lib/training/words'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { trainingMinutes } from '@/lib/training/sessions'
import { libraryDrill, squadPlayers, type LibraryDrill } from '@/lib/training/library'
import type { PlannerState } from '@/lib/training/plans'
import { partInfo, type PartType } from '@/lib/training/shelf'
import {
  NOTE_MAX, PARTS_MAX, PART_NAME_MAX, candidates, fromLibrary, hasOwnDrills, isStandard, libraryOf, libraryPart, isSameDrill, lastShape, minuteOptions, moveTo, newKey,
  partsFromSaved, partsFromShape, planProblem, partColour, shownFor, standardShape, tagFor, totalMinutes, usageOf,
  usualFor, type Part, type PastPlan, type PlanDrill, type Usage,
} from '@/lib/training/parts'
import { gameWhen } from '@/components/coach/games/useGames'
import {
  useBookmarks, useDrafts, usePastSessions, useSaveDraft, useSavePlan, useSquadSize, type Draft, type Plan, type Training,
} from '@/components/coach/training/useTraining'
import { ActionTile, DrillTile, PlanRows, SessionCard, TimeBar, TotalLine } from '@/components/coach/training/PlannerParts'
import { AddPartSheet, MoreDrillsSheet, ViewDrillSheet } from '@/components/coach/training/PlannerSheets'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useParked } from '@/components/trak/parked'
import { LoadError } from '@/components/trak'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { Stepper } from '@/components/arc/stepper/stepper'
import { Textarea } from '@/components/arc/textarea/textarea'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'

/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): Plan session. A plan is a list of parts; the coach goes
   through them one step each, then Review, and saves the plan whole. A new plan starts from the parts the coach saved
   last time, or Trak's five (Kostas, 2 Nov: some coaches don't follow the standard five, so the shape is theirs). Each
   part offers three drills, the usual one picked, plus See more and Write your own. Your session, beside it, is the
   whole session at a glance, where parts are moved, removed and added. A draft keeps it for later, only the
   coach's. Replaces Write my own (TRAK-295). TRAK-392 (Drill Library 7/11): the drills are the Library's, fitted to
   the training's squad; View drill shows one with Easier / Harder, and the level set there is saved with the plan.
   Write your own left with coach-made drills (Kostas, 8 Nov); plans saved before keep their drills as saved.
   TRAK-404 (Kostas, 10 Nov): less on the page. The three choices show names only (View drill has the rest); no
   logistics line, guide lines or "We picked a drill" line; the step bar jumps to any step; × alone removes a part; and
   there's no Save as draft: every change saves the draft by itself, so leaving never asks. */

const TRAINING_PATH = '/coach/training'
const REVIEW = 'review'

type Start = { parts: Part[]; note: string; at: string; fromShape: boolean; copiedFrom: string | null; dirty: boolean
  /** TRAK-391: what happened to the Library drill sent from its page. */
  added?: { name: string; how: 'added' | 'there' | 'full'; part?: string }
  /** TRAK-341: opened from a saved plan's Review page to change or add one part, then save and go back. */
  only?: 'edit' | 'add' }

/** Where the planner starts: a copied plan; a Library drill sent from its page; the draft; the saved plan (at Review);
 *  else the coach's last shape or Trak's five. */
function startFrom({ state, saved, draft, past, players, usage }: {
  state: PlannerState; saved: Plan | null; draft: Draft | undefined; past: PastPlan[]; players: number; usage: Usage
}): Start {
  const fresh = () => {
    const shape = lastShape(past)
    return { parts: partsFromShape(shape ?? standardShape(), players, usage), fromShape: !!shape }
  }
  if (saved?.practices.length && state?.editPart != null) {
    const parts = partsFromSaved(saved.practices)
    const part = parts[Math.min(Math.max(0, state.editPart), parts.length - 1)]
    return { parts, note: saved.note, at: part.key, fromShape: false, copiedFrom: null, dirty: false, only: 'edit' }
  }
  if (saved?.practices.length && state?.addPart) {
    const { type, name } = state.addPart
    const part: Part = { key: newKey(), type, name, minutes: partInfo(type).mins, drill: usualFor(type, candidates(type, players), usage) }
    return { parts: [...partsFromSaved(saved.practices), part].slice(0, PARTS_MAX), note: saved.note, at: part.key, fromShape: false,
      copiedFrom: null, dirty: true, only: 'add' }
  }
  if (state?.copy?.length) {
    const parts = partsFromSaved(state.copy).slice(0, PARTS_MAX)
    return { parts, note: '', at: parts[0].key, fromShape: false, copiedFrom: state.copiedFrom ?? null, dirty: true }
  }
  const library = state?.addLibrary ? libraryDrill(state.addLibrary.drill) : undefined
  if (state?.addLibrary && library) {
    // TRAK-391 (Kostas, 8 Nov): the drill joins the plan, the draft or the coach's usual shape as a new part at the end,
    // then Review. Already in it (the usual shape's starter drill since TRAK-392, or Back from Training after Save as
    // draft): not twice, but that part takes the players and level set on the drill's page. A full plan: said, not cut.
    const { players: setFor, level } = state.addLibrary
    const fromShape = !draft && !saved?.practices.length
    const base = draft ? draft.parts : saved?.practices.length ? partsFromSaved(saved.practices) : fresh().parts
    const note = draft?.note ?? saved?.note ?? ''
    const there = base.findIndex(p => libraryOf(p.drill)?.id === library.id)
    if (there >= 0) {
      const parts = base.map((p, i) => i === there ? { ...p, drill: fromLibrary(library, setFor, level) } : p)
      return { parts, note, at: REVIEW, fromShape, copiedFrom: null, dirty: true, added: { name: library.name, how: 'there', part: base[there].name } }
    }
    const how = base.length >= PARTS_MAX ? 'full' as const : 'added' as const
    const parts = how === 'added' ? [...base, libraryPart(library, setFor, level)] : base
    return { parts, note, at: REVIEW, fromShape, copiedFrom: null, dirty: how === 'added' || fromShape, added: { name: library.name, how } }
  }
  if (draft?.parts.length) {
    const at = draft.step < draft.parts.length ? draft.parts[draft.step].key : REVIEW
    return { parts: draft.parts, note: draft.note, at, fromShape: false, copiedFrom: null, dirty: false }
  }
  if (saved?.practices.length) return { parts: partsFromSaved(saved.practices), note: saved.note, at: REVIEW, fromShape: false, copiedFrom: null, dirty: false }
  const { parts, fromShape } = fresh()
  return { parts, note: '', at: parts[0]?.key ?? REVIEW, fromShape, copiedFrom: null, dirty: false }
}

/** Reads what the planner needs before it starts: drafts, the coach's past plans, and how many players the training's
 *  squad has (TRAK-392: the drills are fitted to it; unknown, they're fitted to 15). */
export function Planner({ training, saved }: { training: Training; saved: Plan | null }) {
  const { t } = useTranslation()
  const drafts = useDrafts()
  const past = usePastSessions()
  const size = useSquadSize(training.squad)
  const reads = [drafts, past]
  if (reads.some(r => r.error)) return <div className="pt-10"><LoadError what={t('coachTraining:yourPlansWhat')}
    onRetry={() => reads.forEach(r => void r.refetch())} retrying={reads.some(r => r.isFetching)} /></div>
  if (reads.some(r => r.isPending) || size.isPending) return <LoadingSkeleton label={t('coachTraining:loadingPlans')} rows={2} className="pt-6" />
  const pastPlans: PastPlan[] = (past.data ?? []).filter(s => s.id !== training.id).map(s => ({ day: gameWhen(s).day, practices: s.practices }))
  return <PlannerBody training={training} saved={saved} draft={drafts.data!.get(training.id)} past={pastPlans} players={squadPlayers(size.data)} />
}

function PlannerBody({ training, saved, draft, past, players }: {
  training: Training; saved: Plan | null; draft: Draft | undefined; past: PastPlan[]; players: number
}) {
  const { parked, comingSoon } = useParked()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const usage = useMemo(() => usageOf(past), [past])
  const [start] = useState(() => startFrom({ state: location.state as PlannerState, saved, draft, past, players, usage }))
  const [parts, setPartsRaw] = useState(start.parts)
  const [note, setNote] = useState(start.note)
  const [at, setAt] = useState(start.at)
  const [dirty, setDirty] = useState(start.dirty)
  // Opened from Review to change one part: Back to Review, not Next.
  const [fromReview, setFromReview] = useState(start.at === REVIEW && !!saved)
  const [sheet, setSheet] = useState<'add' | 'more' | null>(null)
  const [viewing, setViewing] = useState<LibraryDrill | null>(null)
  const bookmarks = useBookmarks().data ?? []
  const [renaming, setRenaming] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const savePlan = useSavePlan(training.id)
  const saveDraft = useSaveDraft(training.id)
  const length = trainingMinutes(training)
  const { day } = gameWhen(training)

  const setParts = (next: Part[]) => { setPartsRaw(next); setDirty(true); setProblem(null) }
  const step = at === REVIEW ? parts.length : Math.max(0, parts.findIndex(p => p.key === at))
  const part = at === REVIEW ? null : parts[step] ?? null
  const all = useMemo(() => part ? candidates(part.type, players) : [], [part?.type, players]) // eslint-disable-line react-hooks/exhaustive-deps -- by the part's type
  const update = (key: string, change: Partial<Part>) => setParts(parts.map(p => p.key === key ? { ...p, ...change } : p))
  const go = (index: number) => { setRenaming(null); setAt(index >= parts.length ? REVIEW : parts[index].key); document.scrollingElement?.scrollTo?.(0, 0) }

  const remove = (index: number) => {
    const gone = parts[index]
    const next = parts.filter((_, i) => i !== index)
    setParts(next)
    if (gone.key === at) setAt(next[Math.min(index, next.length - 1)]?.key ?? REVIEW)
    toast(t('coachTraining:removed', { name: partName(gone.name) }), { action: { label: t('coachTraining:undo'), onClick: () => {
      setPartsRaw(list => list.some(p => p.key === gone.key) ? list : [...list.slice(0, index), gone, ...list.slice(index)])
    } } })
  }
  const add = (type: PartType, name: string) => {
    if (parts.length >= PARTS_MAX) { setSheet(null); return setProblem(t('coachTraining:planMax', { max: PARTS_MAX })) }
    const part: Part = { key: newKey(), type, name, minutes: partInfo(type).mins, drill: usualFor(type, candidates(type, players), usage) }
    setParts([...parts, part])
    setSheet(null)
    // From Review, the new part opens to pick its drill, then comes back.
    if (at === REVIEW) { setFromReview(true); setAt(part.key) }
  }
  const pick = (drill: PlanDrill) => { if (part) update(part.key, { drill }); setSheet(null); setViewing(null) }
  const toStandard = () => {
    const next = partsFromShape(standardShape(), players, usage)
    setParts(next)
    setAt(next[0].key)
  }

  // TRAK-404 (Kostas, 10 Nov): every change saves the draft by itself, a moment after the coach stops. Not when only one
  // part of a saved plan is open (that saves straight to the plan), and not once the plan itself is being saved.
  const autosave = !start.only && !parked
  const [drafted, setDrafted] = useState(false)
  const done = useRef(false)
  const latest = useRef({ step, parts, note })
  latest.current = { step, parts, note }
  const keepDraft = useRef(() => {})
  keepDraft.current = () => {
    if (!autosave || done.current) return
    saveDraft.mutate(latest.current, { onSuccess: () => setDrafted(true), onError: () => setProblem(t('coachTraining:planSaveFailed')) })
  }
  const pending = useRef(false)
  useEffect(() => {
    if (!autosave || !dirty) return
    setDrafted(false)
    pending.current = true
    const timer = setTimeout(() => { pending.current = false; keepDraft.current() }, 800)
    return () => clearTimeout(timer)
  }, [parts, note, step, dirty, autosave])
  // Leaving within that moment still keeps the change.
  useEffect(() => () => { if (pending.current) keepDraft.current() }, [])

  const save = () => {
    if (parked) return comingSoon()
    const why = planProblem(parts)
    if (why) return setProblem(why)
    done.current = true
    savePlan.mutate({ parts, note }, {
      onSuccess: () => {
        toast.success(t('coachTraining:planSaved'))
        // From a saved plan's Review page, back to it; otherwise Training, which offers the next one to plan.
        if (start.only) navigate(reviewPage, { replace: true })
        else navigate(TRAINING_PATH, { replace: true, state: { savedPlan: training.id } })
      },
      onError: error => { done.current = false; setProblem('code' in error && error.code === 'P0001' ? `${error.message}.` : t('coachTraining:planSaveFailed')) },
    })
  }
  const leave = () => navigate(TRAINING_PATH)
  const reviewPage = `${TRAINING_PATH}/${training.id}`

  const steps = [...parts.map(p => ({ id: p.key, label: partName(p.name) })), { id: REVIEW, label: t('coachSchedule:stepReview') }]

  return <div className="grid gap-5 pt-5">
    <header className="arc grid gap-2">
      {/* TRAK-367: the trail says which training; its name can be long, so by its day. */}
      <CoachTrail current={t('coachTraining:planSessionDay', { day })} />
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink break-words">{start.only && part
        ? t(start.only === 'add' ? 'coachTraining:addNamed' : 'coachTraining:editNamed', { part: partName(part.name) }) : t('coachTraining:planSessionTitle', { title: training.title })}</h1>
      {/* TRAK-404 (Kostas, 10 Nov): no logistics here. Opened for one part, the training's name says which plan. */}
      {start.only && <p className="text-sm text-ink-2">{training.title}</p>}
      {start.only && <p className="text-sm text-ink-3">{start.only === 'add' ? t('coachTraining:pickThenAdd')
        : t('coachTraining:onlyThisPart')}</p>}
    </header>
    {start.added && <p role="status" className={`rounded-xl px-4 py-3 text-sm ${start.added.how === 'full' ? 'bg-warning/15 text-ink' : 'bg-raised text-ink-2'}`}>
      {start.added.how === 'added' ? t('coachTraining:addedAtEnd', { name: start.added.name })
        : start.added.how === 'there' ? t('coachTraining:alreadyIn', { name: start.added.name, part: start.added.part ? partName(start.added.part) : '' })
        : t('coachTraining:notAddedFull', { name: start.added.name, max: PARTS_MAX })}</p>}
    {start.copiedFrom && <p role="status" className="rounded-xl bg-raised px-4 py-3 text-sm text-ink-2">
      {t('coachTraining:copiedFrom', { from: start.copiedFrom })}</p>}
    {!start.only && <div className="arc"><Stepper label={t('coachTraining:planningSteps')} steps={steps} current={step} onStepSelect={go} jumpAhead /></div>}
    {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}

    <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
      {part ? <section aria-label={partName(part.name)} className="arc grid min-w-0 gap-5 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">{t('coachTraining:partOf', { n: step + 1, total: parts.length, note: partNote(part.type) })}</p>
            {renaming !== null ? <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
              e.preventDefault()
              if (renaming.trim()) update(part.key, { name: renaming.trim().slice(0, PART_NAME_MAX) })
              setRenaming(null)
            }}>
              <div className="w-[260px]"><Input label={t('coachTraining:newPartName')} value={renaming} maxLength={PART_NAME_MAX} autoFocus
                onChange={e => setRenaming(e.target.value)} /></div>
              <Button size="sm" type="submit">{t('coachTraining:saveName')}</Button>
              <Button size="sm" variant="secondary" type="button" onClick={() => setRenaming(null)}>{t('coachSchedule:cancel')}</Button>
            </form> : <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] font-medium text-ink break-words">{partName(part.name)}</h2>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(partName(part.name))}><Pencil aria-hidden size={14} />{t('coachTraining:rename')}</Button>
            </div>}
          </div>
          {/* As the mockup: "How long?" on the same line as its minutes. */}
          <div className="flex flex-wrap items-center gap-2">
            <p id="how-long" className="text-sm font-medium text-ink-2">{t('coachTraining:howLong')}</p>
            <div role="group" aria-labelledby="how-long" className="flex flex-wrap gap-1.5">
              {minuteOptions(part.type, part.minutes).map(m => <button key={m} type="button" aria-pressed={part.minutes === m}
                onClick={() => update(part.key, { minutes: m })}
                className={`min-h-9 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${part.minutes === m ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:bg-raised'}`}>{m} min</button>)}
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          <ul aria-label={t('coachTraining:drillsFor', { part: partName(part.name) })} className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-4">
            {shownFor(part.type, part.drill, all, usage).map(d => {
              const lib = libraryOf(d)
              // The tiles in a row share one height, so their View drill links line up.
              return <li key={`${d.source}:${d.trak_drill ?? d.drill_id ?? d.name}`} className="grid grid-rows-[1fr_auto] gap-1">
                <DrillTile drill={d} picked={isSameDrill(d, part.drill)} tag={tagFor(d, part.type, all, usage, bookmarks)} onPick={() => pick(d)} />
                {lib && <button type="button" aria-label={t('coachTraining:viewDrillNamed', { name: lib.name })} onClick={() => setViewing(lib)}
                  className="justify-self-start rounded px-1 py-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{t('coachTraining:viewDrill')}</button>}
              </li>
            })}
            {/* TRAK-404 (Kostas, 10 Nov): a fourth choice, any drill from the Drill Library. */}
            <li className="grid grid-rows-[1fr_auto] gap-1"><ActionTile icon="search" label={t('coachTraining:findAnother')} note={t('coachTraining:fromLibrary')} onClick={() => setSheet('more')} />
              {/* As tall as a View drill link, so this tile ends level with the others. */}
              <span aria-hidden className="invisible px-1 py-1 text-sm">{t('coachTraining:viewDrill')}</span></li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {start.only ? <>
            <Button variant="secondary" onClick={() => navigate(reviewPage)}>{t('coachSchedule:cancel')}</Button>
            <span className="flex-1" />
            <Button loading={savePlan.isPending} onClick={save}>{start.only === 'add' ? t('coachTraining:addToPlan') : t('coachTraining:saveBackReview')}</Button>
          </> : fromReview ? <>
            <DraftNote saving={saveDraft.isPending} saved={drafted} />
            <span className="flex-1" />
            <RemoveButton name={partName(part.name)} onRemove={() => remove(step)} />
            <Button onClick={() => { setFromReview(false); go(parts.length) }}>{t('coachTraining:backToReview')}<ArrowRight aria-hidden size={16} /></Button>
          </> : <>
            <Button variant="secondary" onClick={() => step === 0 ? leave() : go(step - 1)}>{step === 0 ? t('coachSchedule:cancel') : t('common:back')}</Button>
            <DraftNote saving={saveDraft.isPending} saved={drafted} />
            <span className="flex-1" />
            <RemoveButton name={partName(part.name)} onRemove={() => remove(step)} />
            <Button onClick={() => go(step + 1)}>{t('coachTraining:nextNamed', { name: step + 1 < parts.length ? partName(parts[step + 1].name) : t('coachSchedule:stepReview') })}<ArrowRight aria-hidden size={16} /></Button>
          </>}
        </div>
      </section> : <Review parts={parts} length={length} note={note} onNote={value => { setNote(value); setDirty(true) }}
        onEdit={i => { setFromReview(true); go(i) }} onRemove={remove} onReorder={setParts} onMove={(i, by) => setParts(moveTo(parts, i, i + by))}
        onAdd={() => setSheet('add')}
        onBack={() => parts.length ? go(parts.length - 1) : leave()} onSave={save}
        saving={savePlan.isPending} draftNote={autosave ? <DraftNote saving={saveDraft.isPending} saved={drafted} /> : null} />}

      {part && start.only ? <OnTheDay parts={parts} mode="rest" />
        : part ? <SessionCard parts={parts} length={length} current={part.key} onOpen={key => setAt(key)} onReorder={setParts}
        onMove={(i, by) => setParts(moveTo(parts, i, i + by))} onRemove={remove} onAdd={() => setSheet('add')} onStandard={toStandard}
        fromShape={start.fromShape && !dirty} standard={isStandard(parts)} />
        : <OnTheDay parts={parts} />}
    </div>

    <AddPartSheet open={sheet === 'add'} onClose={() => setSheet(null)} onAdd={add} />
    <MoreDrillsSheet part={sheet === 'more' ? part : null} players={players} usage={usage} bookmarks={bookmarks} onClose={() => setSheet(null)}
      onPick={pick} />
    <ViewDrillSheet drill={viewing} part={part} players={players} onClose={() => setViewing(null)} onUse={pick} />
  </div>
}

/** The last step, and a saved plan opened again: the whole plan, a part to change, remove or add, and a note. */
function Review({ parts, length, note, onNote, onEdit, onRemove, onReorder, onMove, onAdd, onBack, onSave, saving, draftNote }: {
  parts: Part[]; length: number | null; note: string; onNote: (note: string) => void; onEdit: (index: number) => void
  onRemove: (index: number) => void; onReorder: (parts: Part[]) => void; onMove: (index: number, by: -1 | 1) => void
  onAdd: () => void; onBack: () => void; onSave: () => void
  saving: boolean; draftNote: ReactNode
}) {
  const { t } = useTranslation()
  return <section aria-labelledby="review" className="arc grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">{t('coachTraining:lastStep')}</p>
        <h2 id="review" className="text-[22px] font-medium text-ink">{t('coachSchedule:stepReview')}</h2>
      </div>
      <TotalLine parts={parts} length={length} />
    </div>
    <TimeBar parts={parts} length={length} />
    <PlanRows parts={parts} onEdit={onEdit} onRemove={onRemove} onReorder={onReorder} onMove={onMove} />
    <div><Button size="sm" variant="secondary" onClick={onAdd}><Plus aria-hidden size={16} />{t('coachTraining:addAPart')}</Button></div>
    {/* Kostas, 30 Oct: one optional note at the end, not one per drill. */}
    <Textarea label={t('coachTraining:noteForYou')} description={t('coachTraining:noteForYouDesc')} rows={2} maxLength={NOTE_MAX}
      value={note} onChange={e => onNote(e.target.value)} placeholder={t('coachTraining:noteForYouEx')} />
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <Button variant="secondary" onClick={onBack}>{t('common:back')}</Button>
      {draftNote}
      <span className="flex-1" />
      <Button size="lg" loading={saving} onClick={onSave}>{t('coachTraining:savePlan')}</Button>
    </div>
  </section>
}

/** How Home's Today card will show the plan (TRAK-304): every drill and its minutes. */
function OnTheDay({ parts, mode = 'day' }: { parts: Part[]; mode?: 'day' | 'rest' }) {
  const { t } = useTranslation()
  const title = mode === 'day' ? t('coachTraining:onTheDay') : t('coachTraining:yourSession')
  return <aside aria-labelledby="on-the-day" className="arc grid content-start gap-3 rounded-2xl border border-line bg-surface p-5">
    <h2 id="on-the-day" className="text-lg font-medium text-ink">{title}</h2>
    <p className="text-sm text-ink-3">{mode === 'day' ? t('coachTraining:todayCardNote')
      : t('coachTraining:restOfPlan')}</p>
    <div className="grid gap-1.5 rounded-xl bg-raised p-4">
      <p className="flex justify-between text-sm"><span className="font-medium text-ink">{t('coachHome:trainingPlan')}</span><span className="text-ink-3">{t('coachHome:minutes', { count: totalMinutes(parts) })}</span></p>
      {parts.filter(p => p.drill).map(p => <p key={p.key} className="flex justify-between gap-3 text-sm text-ink-2">
        <span className="truncate">{p.name === p.drill!.name ? p.name : `${partName(p.name)} · ${p.drill!.name}`}</span><span className="flex-none">{t('coachHome:minutes', { count: p.minutes })}</span></p>)}
    </div>
    <p className="text-sm text-ink-3">{t('coachTraining:plannedWholeSquad')}</p>
  </aside>
}

/** TRAK-404: says quietly that the draft saved itself. */
function DraftNote({ saving, saved }: { saving: boolean; saved: boolean }) {
  const { t } = useTranslation()
  return <span role="status" className="text-sm text-ink-3">{saving ? t('coachTraining:savingDraft') : saved ? t('coachSchedule:draftSaved') : ''}</span>
}

/** TRAK-404 (Kostas, 10 Nov): × alone removes a part; its name is still read out. */
function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  const { t } = useTranslation()
  return <button type="button" aria-label={t('coachTraining:removeNamed', { name })} title={t('coachTraining:removeNamed', { name })} onClick={onRemove}
    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-raised hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <X aria-hidden size={18} /></button>
}
