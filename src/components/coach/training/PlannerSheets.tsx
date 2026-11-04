import { useEffect, useState, type FormEvent } from 'react'
import { Check, Plus, Users } from 'lucide-react'
import { DRILL_LIMITS, blankDrill } from '@/lib/training/sessions'
import { PART_TYPES, type PartType } from '@/lib/training/shelf'
import {
  PART_NAME_MAX, answerProblems, blankAnswers, drillKey, fromMyDrill, isSameDrill, playersLine, tagFor, type DrillAnswers, type Part, type PlanDrill, type PlayersKind, type Usage,
} from '@/lib/training/parts'
import { useAddDrill } from './useTraining'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { Checkbox } from '@/components/arc/checkbox/checkbox'
import { Input } from '@/components/arc/input/input'
import { SearchField } from '@/components/arc/search-field/search-field'
import SegmentedControl from '@/components/arc/segmented-control/segmented-control'
import { Textarea } from '@/components/arc/textarea/textarea'

/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): the planner's pop-ups. Add a part (Trak's eight, or
   the coach's own name), See more drills (search, and All / You've used / My drills), and Write your own: every drill
   in Trak has the same three things, a name, what the players do and how many players (Kostas, 30 Oct). */

/** Add a part: it goes at the end; the planner then opens it. */
export function AddPartSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (type: PartType, name: string) => void }) {
  const [picked, setPicked] = useState<PartType | null>(null)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (open) { setPicked(null); setName(''); setProblem(null) } }, [open])
  const add = () => {
    const own = name.trim()
    if (own) return onAdd('own', own.slice(0, PART_NAME_MAX))
    if (!picked) return setProblem('Pick a part, or name your own.')
    onAdd(picked, PART_TYPES.find(p => p.key === picked)!.name)
  }
  return <BottomSheet className="arc" open={open} onOpenChange={next => { if (!next) onClose() }} detents={[0.92]} title="Add a part"
    description="It goes at the end of the session. Drag it to move it.">
    <div className="grid gap-5 pb-4">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">Pick a part</legend>
        <div className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
          {PART_TYPES.map(type => <button key={type.key} type="button" aria-pressed={picked === type.key}
            onClick={() => { setPicked(type.key); setName(''); setProblem(null) }}
            className={`grid gap-0.5 rounded-xl border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${picked === type.key ? 'border-brand bg-brand/10' : 'border-line bg-surface'}`}>
            <span className="text-[15px] font-medium text-ink">{type.name}</span>
            <span className="text-sm text-ink-3">{type.note}</span>
          </button>)}
        </div>
      </fieldset>
      <Input label="Or name your own" description="For example: Pressing game, Goalkeeper work, Fitness test." value={name}
        maxLength={PART_NAME_MAX} autoComplete="off" onChange={e => { setName(e.target.value); if (e.target.value.trim()) setPicked(null); setProblem(null) }} />
      {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={add}>Add part</Button>
      </div>
    </div>
  </BottomSheet>
}

type Filter = 'all' | 'used' | 'mine'

/** Every drill that fits the part, to search and pick from. */
export function MoreDrillsSheet({ part, all, usage, onClose, onPick, onWrite }: {
  part: Part | null; all: PlanDrill[]; usage: Usage; onClose: () => void; onPick: (drill: PlanDrill) => void; onWrite: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => { if (part) { setQuery(''); setFilter('all') } }, [part?.key]) // eslint-disable-line react-hooks/exhaustive-deps -- a new part starts afresh
  if (!part) return null
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const shown = all.filter(d => filter === 'all' || (filter === 'used' ? usage.byDrill.has(drillKey(d) ?? '') : d.source === 'drill'))
    .filter(d => words.every(w => `${d.name} ${d.how}`.toLocaleLowerCase().includes(w)))
  return <BottomSheet className="arc" open onOpenChange={next => { if (!next) onClose() }} detents={[0.92]}
    title={part.type === 'own' ? 'All drills' : `More drills for ${part.name}`}>
    <div className="grid gap-4 pb-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><SearchField label="Search drills" placeholder="For example: pairs, cones, 4 v 2" value={query} onValueChange={setQuery} /></div>
        <SegmentedControl label="Show" value={filter} onValueChange={value => setFilter(value as Filter)}
          options={[{ value: 'all', label: 'All' }, { value: 'used', label: 'You’ve used' }, { value: 'mine', label: 'My drills' }]} />
      </div>
      {shown.length === 0 ? <p className="text-[15px] text-ink-2">{filter === 'mine' && !words.length
        ? 'You haven’t written any drills for this part yet.' : 'No drills match. Try another word, or write your own.'}</p>
        : <ul aria-label="Drills" className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
          {shown.map(d => {
            const picked = isSameDrill(d, part.drill)
            const players = playersLine(d)
            return <li key={drillKey(d) ?? d.name} className="flex flex-wrap items-start justify-between gap-3 py-3.5">
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="text-[15px] font-medium text-ink break-words">{d.name}</p>
                {d.how && <p className="text-sm text-ink-2 break-words">{d.how}</p>}
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                  {players && <span className="inline-flex items-center gap-1"><Users aria-hidden size={14} />{players}</span>}
                  <Badge size="sm" tone={d.source === 'drill' ? 'success' : 'neutral'}>{tagFor(d, part.type, all, usage)}</Badge>
                </p>
              </div>
              {picked ? <Badge tone="success"><Check aria-hidden size={14} />Picked</Badge>
                : <Button size="sm" variant="secondary" aria-label={`Pick ${d.name}`} onClick={() => onPick(d)}>Pick</Button>}
            </li>
          })}
        </ul>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onWrite}><Plus aria-hidden size={16} />Write your own</Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  </BottomSheet>
}

const KINDS: { value: PlayersKind; label: string }[] = [
  { value: 'any', label: 'Any number' }, { value: 'pairs', label: 'In pairs' }, { value: 'groups', label: 'In groups' }, { value: 'teams', label: 'Two teams' },
]

/** The same three questions wherever a coach writes a drill (TRAK-367): Write your own, New drill, Edit drill. */
export function DrillQuestions({ answers, onChange, errors }: { answers: DrillAnswers; onChange: (change: Partial<DrillAnswers>) => void; errors: Record<string, string> }) {
  const { name, how, kind, size } = answers
  return <>
    <Input label="1. Name it" description="Short, and says what happens. For example: Rondo 4 v 2 with a target." value={name}
      maxLength={DRILL_LIMITS.name} autoComplete="off" error={errors.name} onChange={e => onChange({ name: e.target.value })} />
    <Textarea label="2. What do the players do?" rows={3} maxLength={DRILL_LIMITS.how} value={how} error={errors.how}
      description="One or two sentences. Set-up first, then the action. For example: 15 × 15 m square. Four keep the ball from two; five passes in a row is a point."
      onChange={e => onChange({ how: e.target.value })} />
    <div className="grid justify-items-start gap-2">
      <p aria-hidden="true" className="text-sm font-medium text-ink">3. How many players?</p>
      <p className="text-sm text-ink-3">Trak uses this to adjust the drill when fewer players turn up.</p>
      <SegmentedControl label="3. How many players?" value={kind ?? ''} options={KINDS} onValueChange={value => onChange({ kind: value as PlayersKind })} />
      {kind === 'groups' && <div className="flex items-center gap-3">
        <span id="group-size" className="text-sm text-ink-2">Players in each group</span>
        <Button type="button" size="sm" variant="secondary" aria-label="One fewer" disabled={size <= 2} onClick={() => onChange({ size: size - 1 })}>−</Button>
        <span aria-labelledby="group-size" className="w-6 text-center text-base font-medium text-ink">{size}</span>
        <Button type="button" size="sm" variant="secondary" aria-label="One more" disabled={size >= 12} onClick={() => onChange({ size: size + 1 })}>+</Button>
      </div>}
      {errors.kind && <p role="alert" className="text-sm text-danger">{errors.kind}</p>}
    </div>
  </>
}

/** Write your own: the same three things as every drill. Ticked (the default), it's saved to My drills under this part
 *  straight away; otherwise it lives only in this plan. */
export function OwnDrillSheet({ part, onClose, onSaved }: { part: Part | null; onClose: () => void; onSaved: (drill: PlanDrill) => void }) {
  const add = useAddDrill()
  const [answers, setAnswers] = useState(blankAnswers)
  const [keep, setKeep] = useState(true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  useEffect(() => { if (part) { setAnswers(blankAnswers()); setKeep(true); setErrors({}); setFailed(false) } }, [part?.key]) // eslint-disable-line react-hooks/exhaustive-deps -- each opening starts blank
  if (!part) return null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = answerProblems(answers)
    setErrors(found)
    if (Object.keys(found).length) return
    const { name, how, kind, size } = answers
    const draft = { ...blankDrill(), name: name.trim(), how: how.trim(), minutes: part.minutes }
    const players = { players_kind: kind, group_size: kind === 'groups' ? size : null }
    if (!keep) {
      const { minutes: _m, ...rest } = draft
      return onSaved({ ...rest, minutes: 0, source: 'own', trak_drill: null, drill_id: null, library_session: null, ...players })
    }
    setFailed(false)
    add.mutate({ ...draft, part_type: part.type, ...players }, {
      onSuccess: drill => onSaved({ ...fromMyDrill(drill), minutes: 0 }),
      onError: () => setFailed(true),
    })
  }
  return <BottomSheet className="arc" open onOpenChange={next => { if (!next) onClose() }} detents={[0.92]} title="Write your own drill"
    description="Every drill in Trak has the same three things: a name, what the players do, and how many players. Fill them in and yours will look like all the others.">
    <form noValidate onSubmit={submit} aria-label="Write your own drill" className="grid gap-5 pb-4">
      <DrillQuestions answers={answers} onChange={change => setAnswers(a => ({ ...a, ...change }))} errors={errors} />
      <Checkbox label="Save it to My drills, so I can use it again" checked={keep} onCheckedChange={on => setKeep(on === true)} />
      {failed && <p role="alert" className="text-[15px] text-danger">Couldn’t save the drill. Check your connection and try again. Nothing you typed is lost.</p>}
      <p className="text-sm text-ink-3">It goes next to the other drills for {part.name}.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={add.isPending}>Save drill</Button>
      </div>
    </form>
  </BottomSheet>
}

/** Leaving with changes not saved: keep them as a draft, or let them go. */
export function LeaveSheet({ open, onClose, onDraft, onLeave, saving }: {
  open: boolean; onClose: () => void; onDraft: () => void; onLeave: () => void; saving: boolean
}) {
  return <BottomSheet className="arc" open={open} onOpenChange={next => { if (!next) onClose() }} title="Leave this plan?"
    description="Your changes aren’t saved yet. Save them as a draft to carry on later, or leave without saving.">
    <div className="flex flex-wrap justify-end gap-2 pb-4">
      <Button variant="ghost" onClick={onLeave}>Leave without saving</Button>
      <Button variant="secondary" onClick={onClose}>Keep planning</Button>
      <Button loading={saving} onClick={onDraft}>Save as draft</Button>
    </div>
  </BottomSheet>
}
