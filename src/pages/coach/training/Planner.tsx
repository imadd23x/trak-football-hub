import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Pencil, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { trainingMinutes } from '@/lib/training/sessions'
import type { PlannerState } from '@/lib/training/plans'
import { partInfo, type PartType } from '@/lib/training/shelf'
import {
  NOTE_MAX, PARTS_MAX, PART_NAME_MAX, candidates, fromMyDrill, isStandard, isSameDrill, lastShape, minuteOptions, moveTo, newKey,
  partsFromSaved, partsFromShape, planProblem, playersLine, partColour, shownFor, standardShape, tagFor, totalMinutes, usageOf,
  usualFor, type Part, type PastPlan, type PlanDrill, type Usage,
} from '@/lib/training/parts'
import { gameWhen } from '@/components/coach/games/useGames'
import {
  useDrafts, useDrills, usePastSessions, useSaveDraft, useSavePlan, type Draft, type Plan, type Training,
} from '@/components/coach/training/useTraining'
import { ActionTile, DrillTile, PlanRows, SessionCard, TimeBar, TotalLine } from '@/components/coach/training/PlannerParts'
import { AddPartSheet, LeaveSheet, MoreDrillsSheet, OwnDrillSheet } from '@/components/coach/training/PlannerSheets'
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
   whole session at a glance, where parts are moved, removed and added. Save as draft keeps it for later, only the
   coach's. Replaces Write my own (TRAK-295). */

const TRAINING_PATH = '/coach/training'
const SAVE_FAILED = 'Couldn’t save. Check your connection and try again. Nothing you changed is lost.'
const REVIEW = 'review'

type Start = { parts: Part[]; note: string; at: string; fromShape: boolean; copiedFrom: string | null; dirty: boolean
  /** TRAK-341: opened from a saved plan's Review page to change or add one part, then save and go back. */
  only?: 'edit' | 'add' }

/** Where the planner starts: a copied plan; a drill sent from My drills; the draft; the saved plan (at Review); else
 *  the coach's last shape or Trak's five. */
function startFrom({ state, saved, draft, past, drills, usage }: {
  state: PlannerState; saved: Plan | null; draft: Draft | undefined; past: PastPlan[]; drills: Parameters<typeof candidates>[1]; usage: Usage
}): Start {
  const fresh = () => {
    const shape = lastShape(past)
    return { parts: partsFromShape(shape ?? standardShape(), drills, usage), fromShape: !!shape }
  }
  if (saved?.practices.length && state?.editPart != null) {
    const parts = partsFromSaved(saved.practices)
    const part = parts[Math.min(Math.max(0, state.editPart), parts.length - 1)]
    return { parts, note: saved.note, at: part.key, fromShape: false, copiedFrom: null, dirty: false, only: 'edit' }
  }
  if (saved?.practices.length && state?.addPart) {
    const { type, name } = state.addPart
    const part: Part = { key: newKey(), type, name, minutes: partInfo(type).mins, drill: usualFor(type, candidates(type, drills), usage) }
    return { parts: [...partsFromSaved(saved.practices), part].slice(0, PARTS_MAX), note: saved.note, at: part.key, fromShape: false,
      copiedFrom: null, dirty: true, only: 'add' }
  }
  if (state?.copy?.length) {
    const parts = partsFromSaved(state.copy).slice(0, PARTS_MAX)
    return { parts, note: '', at: parts[0].key, fromShape: false, copiedFrom: state.copiedFrom ?? null, dirty: true }
  }
  if (state?.addDrill) {
    const base = draft ? draft.parts : saved ? partsFromSaved(saved.practices) : fresh().parts
    const drill = state.addDrill as Parameters<typeof fromMyDrill>[0]
    const type = (drill.part_type ?? 'own') as PartType
    const part: Part = { key: newKey(), type, name: (type === 'own' ? drill.name : partInfo(type).name).slice(0, PART_NAME_MAX),
      minutes: drill.minutes, drill: fromMyDrill({ ...drill, part_type: drill.part_type ?? null, players_kind: drill.players_kind ?? null, group_size: drill.group_size ?? null }) }
    return { parts: [...base, part].slice(0, PARTS_MAX), note: draft?.note ?? saved?.note ?? '', at: REVIEW, fromShape: false, copiedFrom: null, dirty: true }
  }
  if (draft?.parts.length) {
    const at = draft.step < draft.parts.length ? draft.parts[draft.step].key : REVIEW
    return { parts: draft.parts, note: draft.note, at, fromShape: false, copiedFrom: null, dirty: false }
  }
  if (saved?.practices.length) return { parts: partsFromSaved(saved.practices), note: saved.note, at: REVIEW, fromShape: false, copiedFrom: null, dirty: false }
  const { parts, fromShape } = fresh()
  return { parts, note: '', at: parts[0]?.key ?? REVIEW, fromShape, copiedFrom: null, dirty: false }
}

/** Reads what the planner needs before it starts: drafts, My drills and the coach's past plans. */
export function Planner({ training, saved }: { training: Training; saved: Plan | null }) {
  const drafts = useDrafts()
  const drills = useDrills()
  const past = usePastSessions()
  const reads = [drafts, drills, past]
  if (reads.some(r => r.error)) return <div className="pt-10"><LoadError what="your plans and drills"
    onRetry={() => reads.forEach(r => void r.refetch())} retrying={reads.some(r => r.isFetching)} /></div>
  if (reads.some(r => r.isPending)) return <LoadingSkeleton label="Loading your plans and drills…" rows={2} className="pt-6" />
  const pastPlans: PastPlan[] = (past.data ?? []).filter(s => s.id !== training.id).map(s => ({ day: gameWhen(s).day, practices: s.practices }))
  return <PlannerBody training={training} saved={saved} draft={drafts.data!.get(training.id)} past={pastPlans} drills={drills.data ?? []} />
}

function PlannerBody({ training, saved, draft, past, drills }: {
  training: Training; saved: Plan | null; draft: Draft | undefined; past: PastPlan[]; drills: Parameters<typeof candidates>[1]
}) {
  const { parked, comingSoon } = useParked()
  const navigate = useNavigate()
  const location = useLocation()
  const usage = useMemo(() => usageOf(past), [past])
  const [start] = useState(() => startFrom({ state: location.state as PlannerState, saved, draft, past, drills, usage }))
  const [parts, setPartsRaw] = useState(start.parts)
  const [note, setNote] = useState(start.note)
  const [at, setAt] = useState(start.at)
  const [dirty, setDirty] = useState(start.dirty)
  // Opened from Review to change one part: Back to Review, not Next.
  const [fromReview, setFromReview] = useState(start.at === REVIEW && !!saved)
  const [sheet, setSheet] = useState<'add' | 'more' | 'own' | 'leave' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const savePlan = useSavePlan(training.id)
  const saveDraft = useSaveDraft(training.id)
  const length = trainingMinutes(training)
  const { day, time } = gameWhen(training)

  const setParts = (next: Part[]) => { setPartsRaw(next); setDirty(true); setProblem(null) }
  const step = at === REVIEW ? parts.length : Math.max(0, parts.findIndex(p => p.key === at))
  const part = at === REVIEW ? null : parts[step] ?? null
  const all = part ? candidates(part.type, drills) : []
  const update = (key: string, change: Partial<Part>) => setParts(parts.map(p => p.key === key ? { ...p, ...change } : p))
  const go = (index: number) => { setRenaming(null); setAt(index >= parts.length ? REVIEW : parts[index].key); document.scrollingElement?.scrollTo?.(0, 0) }

  const remove = (index: number) => {
    const gone = parts[index]
    const next = parts.filter((_, i) => i !== index)
    setParts(next)
    if (gone.key === at) setAt(next[Math.min(index, next.length - 1)]?.key ?? REVIEW)
    toast(`${gone.name} removed.`, { action: { label: 'Undo', onClick: () => {
      setPartsRaw(list => list.some(p => p.key === gone.key) ? list : [...list.slice(0, index), gone, ...list.slice(index)])
    } } })
  }
  const add = (type: PartType, name: string) => {
    if (parts.length >= PARTS_MAX) { setSheet(null); return setProblem(`A plan holds at most ${PARTS_MAX} parts.`) }
    const part: Part = { key: newKey(), type, name, minutes: partInfo(type).mins, drill: usualFor(type, candidates(type, drills), usage) }
    setParts([...parts, part])
    setSheet(null)
    // From Review, the new part opens to pick its drill, then comes back.
    if (at === REVIEW) { setFromReview(true); setAt(part.key) }
  }
  const pick = (drill: PlanDrill) => { if (part) update(part.key, { drill }); setSheet(null) }
  const toStandard = () => {
    const next = partsFromShape(standardShape(), drills, usage)
    setParts(next)
    setAt(next[0].key)
  }

  const keepDraft = () => {
    if (parked) return comingSoon()
    saveDraft.mutate({ step, parts, note }, {
      onSuccess: () => { toast.success('Draft saved. Only you see it.'); navigate(TRAINING_PATH) },
      onError: () => { setSheet(null); setProblem(SAVE_FAILED) },
    })
  }
  const save = () => {
    if (parked) return comingSoon()
    const why = planProblem(parts)
    if (why) return setProblem(why)
    savePlan.mutate({ parts, note }, {
      onSuccess: () => {
        toast.success('Plan saved')
        // From a saved plan's Review page, back to it; otherwise Training, which offers the next one to plan.
        if (start.only) navigate(reviewPage, { replace: true })
        else navigate(TRAINING_PATH, { replace: true, state: { savedPlan: training.id } })
      },
      onError: error => setProblem('code' in error && error.code === 'P0001' ? `${error.message}.` : SAVE_FAILED),
    })
  }
  const leave = () => dirty ? setSheet('leave') : navigate(TRAINING_PATH)
  const reviewPage = `${TRAINING_PATH}/${training.id}`

  const steps = [...parts.map(p => ({ id: p.key, label: p.name })), { id: REVIEW, label: 'Review' }]

  return <div className="grid gap-5 pt-5">
    <header className="arc grid gap-2">
      {/* TRAK-367: the trail says which training; its name can be long, so by its day. */}
      <CoachTrail current={`Plan session · ${day}`} />
      <h1 className="text-[24px] font-medium tracking-[-0.01em] text-ink break-words">{start.only && part
        ? `${start.only === 'add' ? 'Add' : 'Edit'}: ${part.name}` : `Plan session: ${training.title}`}</h1>
      <p className="text-sm text-ink-2">{[start.only ? training.title : null, day, time, training.venue, length ? `${length} min` : null].filter(Boolean).join(' · ')}</p>
      {start.only && <p className="text-sm text-ink-3">{start.only === 'add' ? 'Pick a drill, then add it to the plan.'
        : 'Only this part changes. The rest of the plan stays as it is.'}</p>}
    </header>
    {start.copiedFrom && <p role="status" className="rounded-xl bg-raised px-4 py-3 text-sm text-ink-2">
      Copied from {start.copiedFrom}. Check it, change any part, then save. Nothing is saved until you do.</p>}
    {!start.only && <div className="arc"><Stepper label="Planning steps" steps={steps} current={step} onStepSelect={go} /></div>}
    {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}

    <div className="grid gap-5 laptop:grid-cols-[minmax(0,1fr)_360px] laptop:items-start">
      {part ? <section aria-label={part.name} className="arc grid min-w-0 gap-5 rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">Part {step + 1} of {parts.length} · {partInfo(part.type).note}</p>
            {renaming !== null ? <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
              e.preventDefault()
              if (renaming.trim()) update(part.key, { name: renaming.trim().slice(0, PART_NAME_MAX) })
              setRenaming(null)
            }}>
              <div className="w-[260px]"><Input label="New name for this part" value={renaming} maxLength={PART_NAME_MAX} autoFocus
                onChange={e => setRenaming(e.target.value)} /></div>
              <Button size="sm" type="submit">Save name</Button>
              <Button size="sm" variant="secondary" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
            </form> : <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] font-medium text-ink break-words">{part.name}</h2>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(part.name)}><Pencil aria-hidden size={14} />Rename</Button>
            </div>}
          </div>
          {/* As the mockup: "How long?" on the same line as its minutes. */}
          <div className="flex flex-wrap items-center gap-2">
            <p id="how-long" className="text-sm font-medium text-ink-2">How long?</p>
            <div role="group" aria-labelledby="how-long" className="flex flex-wrap gap-1.5">
              {minuteOptions(part.type, part.minutes).map(m => <button key={m} type="button" aria-pressed={part.minutes === m}
                onClick={() => update(part.key, { minutes: m })}
                className={`min-h-9 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${part.minutes === m ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:bg-raised'}`}>{m} min</button>)}
            </div>
          </div>
        </div>
        <p className="max-w-[640px] text-sm text-ink-2">{partInfo(part.type).guide}</p>
        <div className="grid gap-3">
          {/* A part of the coach's own already says "Pick any drill, or write your own." in its guide line. */}
          <p className="text-sm font-medium text-ink">Pick a drill {part.type !== 'own' && <span className="font-normal text-ink-3">{part.drill
            ? 'We picked your usual. Change it if you like.' : 'Pick one for this part.'}</span>}</p>
          <ul aria-label={`Drills for ${part.name}`} className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-4">
            {shownFor(part.type, part.drill, all, usage).map(d => <li key={`${d.source}:${d.trak_drill ?? d.drill_id ?? d.name}`}>
              <DrillTile drill={d} picked={isSameDrill(d, part.drill)} tag={tagFor(d, part.type, all, usage)} onPick={() => pick(d)} /></li>)}
            {part.type === 'own' && <li><ActionTile icon="search" label="Browse all drills" onClick={() => setSheet('more')} /></li>}
            <li><ActionTile icon="plus" label="Write your own" onClick={() => setSheet('own')} /></li>
          </ul>
          {part.type !== 'own' && all.length > 3 && <div><button type="button" onClick={() => setSheet('more')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded px-1 text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Search aria-hidden size={14} />See more drills ({all.length - 3})</button></div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {start.only ? <>
            <Button variant="secondary" onClick={() => navigate(reviewPage)}>Cancel</Button>
            <span className="flex-1" />
            <Button loading={savePlan.isPending} onClick={save}>{start.only === 'add' ? 'Add to the plan' : 'Save and go back to Review'}</Button>
          </> : fromReview ? <>
            <Button variant="ghost" loading={saveDraft.isPending} onClick={keepDraft}>Save as draft</Button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => remove(step)}><X aria-hidden size={16} />Remove this part</Button>
            <Button onClick={() => { setFromReview(false); go(parts.length) }}>Back to Review<ArrowRight aria-hidden size={16} /></Button>
          </> : <>
            <Button variant="secondary" onClick={() => step === 0 ? leave() : go(step - 1)}>{step === 0 ? 'Cancel' : 'Back'}</Button>
            <Button variant="ghost" loading={saveDraft.isPending} onClick={keepDraft}>Save as draft</Button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => remove(step)}><X aria-hidden size={16} />Remove this part</Button>
            <Button onClick={() => go(step + 1)}>Next: {step + 1 < parts.length ? parts[step + 1].name : 'Review'}<ArrowRight aria-hidden size={16} /></Button>
          </>}
        </div>
      </section> : <Review parts={parts} length={length} note={note} onNote={value => { setNote(value); setDirty(true) }}
        onEdit={i => { setFromReview(true); go(i) }} onRemove={remove} onReorder={setParts} onMove={(i, by) => setParts(moveTo(parts, i, i + by))}
        onAdd={() => setSheet('add')}
        onBack={() => parts.length ? go(parts.length - 1) : leave()} onDraft={keepDraft} onSave={save}
        saving={savePlan.isPending} drafting={saveDraft.isPending} />}

      {part && start.only ? <OnTheDay parts={parts} title="Your session" />
        : part ? <SessionCard parts={parts} length={length} current={part.key} onOpen={key => setAt(key)} onReorder={setParts}
        onMove={(i, by) => setParts(moveTo(parts, i, i + by))} onRemove={remove} onAdd={() => setSheet('add')} onStandard={toStandard}
        fromShape={start.fromShape && !dirty} standard={isStandard(parts)} />
        : <OnTheDay parts={parts} />}
    </div>

    <AddPartSheet open={sheet === 'add'} onClose={() => setSheet(null)} onAdd={add} />
    <MoreDrillsSheet part={sheet === 'more' ? part : null} all={all} usage={usage} onClose={() => setSheet(null)} onPick={pick}
      onWrite={() => setSheet('own')} />
    <OwnDrillSheet part={sheet === 'own' ? part : null} onClose={() => setSheet(null)} onSaved={pick} />
    <LeaveSheet open={sheet === 'leave'} onClose={() => setSheet(null)} onDraft={keepDraft} saving={saveDraft.isPending}
      onLeave={() => { setSheet(null); navigate(TRAINING_PATH) }} />
  </div>
}

/** The last step, and a saved plan opened again: the whole plan, a part to change, remove or add, and a note. */
function Review({ parts, length, note, onNote, onEdit, onRemove, onReorder, onMove, onAdd, onBack, onDraft, onSave, saving, drafting }: {
  parts: Part[]; length: number | null; note: string; onNote: (note: string) => void; onEdit: (index: number) => void
  onRemove: (index: number) => void; onReorder: (parts: Part[]) => void; onMove: (index: number, by: -1 | 1) => void
  onAdd: () => void; onBack: () => void; onDraft: () => void; onSave: () => void
  saving: boolean; drafting: boolean
}) {
  return <section aria-labelledby="review" className="arc grid min-w-0 gap-4 rounded-2xl border border-line bg-surface p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <p className="text-[11px] font-medium uppercase tracking-[.09em] text-brand">Last step</p>
        <h2 id="review" className="text-[22px] font-medium text-ink">Review</h2>
      </div>
      <TotalLine parts={parts} length={length} />
    </div>
    <TimeBar parts={parts} length={length} />
    <PlanRows parts={parts} onEdit={onEdit} onRemove={onRemove} onReorder={onReorder} onMove={onMove} />
    <div><Button size="sm" variant="secondary" onClick={onAdd}><Plus aria-hidden size={16} />Add a part</Button></div>
    {/* Kostas, 30 Oct: one optional note at the end, not one per drill. */}
    <Textarea label="A note for you (optional)" description="Anything to remember on the day. Only you see it." rows={2} maxLength={NOTE_MAX}
      value={note} onChange={e => onNote(e.target.value)} placeholder="For example: remind the back four to talk to each other in the box" />
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <Button variant="secondary" onClick={onBack}>Back</Button>
      <Button variant="ghost" loading={drafting} onClick={onDraft}>Save as draft</Button>
      <span className="flex-1" />
      <Button size="lg" loading={saving} onClick={onSave}>Save the plan</Button>
    </div>
  </section>
}

/** How Home's Today card will show the plan (TRAK-304): every drill and its minutes. */
function OnTheDay({ parts, title = 'On the day' }: { parts: Part[]; title?: string }) {
  return <aside aria-labelledby="on-the-day" className="arc grid content-start gap-3 rounded-2xl border border-line bg-surface p-5">
    <h2 id="on-the-day" className="text-lg font-medium text-ink">{title}</h2>
    <p className="text-sm text-ink-3">{title === 'On the day' ? 'Your Today card on Home shows the plan like this. Only you see it.'
      : 'The rest of the plan, as it is.'}</p>
    <div className="grid gap-1.5 rounded-xl bg-raised p-4">
      <p className="flex justify-between text-sm"><span className="font-medium text-ink">Training plan</span><span className="text-ink-3">{totalMinutes(parts)} min</span></p>
      {parts.filter(p => p.drill).map(p => <p key={p.key} className="flex justify-between gap-3 text-sm text-ink-2">
        <span className="truncate">{p.name === p.drill!.name ? p.name : `${p.name} · ${p.drill!.name}`}</span><span className="flex-none">{p.minutes} min</span></p>)}
    </div>
    <p className="text-sm text-ink-3">Planned for your whole squad.</p>
  </aside>
}
