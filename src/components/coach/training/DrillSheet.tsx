import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet'
import { Button } from '@/components/arc/button/button'
import { useParked } from '@/components/trak/parked'
import { PART_TYPES } from '@/lib/training/shelf'
import { blankDrill, drillProblem, type Drill } from '@/lib/training/sessions'
import { answerProblems, blankAnswers, type DrillAnswers, type MyDrill, type PlayersKind } from '@/lib/training/parts'
import { DrillQuestions } from './PlannerSheets'
import { useDeleteDrill, useSaveDrill } from './useTraining'

/* TRAK-294 (Training 1/5): New drill, and the same sheet to change or delete one of the coach's drills. A sheet on a
   phone, a window on a laptop (Arc's bottom sheet). A failed save keeps everything typed. TRAK-367 (Kostas, 3 Nov): the
   same three questions as the planner's Write your own, so a drill is written one way. The part is asked here because
   there's no plan to take it from: it's what puts the drill among that part's drills while planning. An older drill's
   other details (minutes, what to tell them) stay as they were. */

const SAVE_FAILED = "Couldn't save the drill. Check your connection and try again. Nothing you typed is lost."
const DELETE_FAILED = "Couldn't delete the drill. Check your connection and try again."

const toAnswers = (drill: (Drill & MyDrill) | null): DrillAnswers => drill
  ? { name: drill.name, how: drill.how, kind: drill.players_kind as PlayersKind | null, size: drill.group_size ?? 4 }
  : blankAnswers()

export function DrillSheet({ open, drill, onOpenChange }: { open: boolean; drill: (Drill & MyDrill) | null; onOpenChange: (open: boolean) => void }) {
  const { parked, comingSoon } = useParked()
  const [answers, setAnswers] = useState(() => toAnswers(drill))
  const [part, setPart] = useState<string | null>(drill?.part_type ?? null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const save = useSaveDrill()
  const remove = useDeleteDrill()

  // Each opening starts from the drill picked (or a blank one), never from the last one typed.
  useEffect(() => {
    if (!open) return
    setAnswers(toAnswers(drill)); setPart(drill?.part_type ?? null); setErrors({}); setProblem(null); setConfirming(false)
  }, [open, drill])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (parked) return comingSoon()
    const found = answerProblems(answers)
    setErrors(found)
    if (Object.keys(found).length) return
    const { id: _id, updated_at: _at, ...kept } = drill ?? { id: '', updated_at: '', ...blankDrill() }
    const { name, how, kind, size } = answers
    const draft = { ...kept, name, how, part_type: part, players_kind: kind, group_size: kind === 'groups' ? size : null }
    const why = drillProblem(draft)
    setProblem(why)
    if (why) return
    save.mutate({ id: drill?.id, draft }, {
      onSuccess: () => { toast.success(drill ? 'Drill saved' : 'Added to My drills'); onOpenChange(false) },
      onError: () => setProblem(SAVE_FAILED),
    })
  }
  const deleteDrill = () => {
    if (parked) return comingSoon()
    if (!drill) return
    remove.mutate(drill.id, {
      onSuccess: () => { toast.success('Drill deleted'); onOpenChange(false) },
      onError: () => { setConfirming(false); setProblem(DELETE_FAILED) },
    })
  }

  return <BottomSheet className="arc" open={open} onOpenChange={onOpenChange} detents={[0.92]}
    title={drill ? 'Edit drill' : 'New drill'} description="Write it once, use it in any session. Only you see it.">
    <form onSubmit={submit} noValidate aria-label={drill ? 'Edit drill' : 'New drill'} className="grid gap-5 pb-4">
      <DrillQuestions answers={answers} onChange={change => setAnswers(a => ({ ...a, ...change }))} errors={errors} />

      <div className="grid gap-2">
        <p id="drill-part" className="text-sm font-medium text-ink">4. Which part of a session is it for?</p>
        <p className="text-sm text-ink-3">It shows with that part’s drills when you plan.</p>
        <div role="group" aria-labelledby="drill-part" className="flex flex-wrap gap-1.5">
          {[{ key: null, name: 'Any part' }, ...PART_TYPES].map(option => <button key={option.key ?? 'any'} type="button" aria-pressed={part === option.key}
            onClick={() => setPart(option.key)}
            className={`min-h-9 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${part === option.key ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2 hover:bg-raised'}`}>
            {option.name}</button>)}
        </div>
      </div>

      {problem && <p role="alert" className="text-[15px] text-danger">{problem}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={save.isPending} disabled={save.isPending || remove.isPending}>Save drill</Button>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        {drill && (confirming
          ? <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-2">Delete this drill?</span>
            <Button type="button" variant="danger" size="sm" loading={remove.isPending} onClick={deleteDrill}>Delete</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep it</Button>
          </span>
          : <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>Delete drill</Button>)}
      </div>
    </form>
  </BottomSheet>
}
