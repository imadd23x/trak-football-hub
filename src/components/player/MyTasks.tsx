import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import { SeeMoreList } from '@/components/trak/SeeMoreList'
import { ANSWER, dueLabel, tasksToShow, useAnswerTask, useMyTasks, type MyTask } from '@/lib/tasks'

/* TRAK-579 (coach–player P02, Makis's PR list of 23 Nov): what the coach asked the player to confirm, on Home under
   the week. One card per task with the one answer it asks for; Undo until it's due, then the card goes. A Got it the
   coach has since changed comes back first, marked Updated. Nothing when there's nothing to answer, which is also
   every academy with the tasks switch off (my_tasks returns no rows), so no empty line and no skeleton that vanishes. */

const onlineStore = {
  subscribe: (changed: () => void) => {
    window.addEventListener('online', changed)
    window.addEventListener('offline', changed)
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed) }
  },
  read: () => navigator.onLine,
}

export function MyTasks() {
  const { data, isError, isFetching, refetch } = useMyTasks()
  const answer = useAnswerTask()
  const online = useSyncExternalStore(onlineStore.subscribe, onlineStore.read)
  const [now, setNow] = useState(Date.now)
  const [said, setSaid] = useState('')
  const shown = tasksToShow(data ?? [], now)

  // Redraw when the soonest one falls due, so it leaves with its Undo (again if the timer fires a little early).
  const next = Math.min(...shown.map(t => (t.due_at ? Date.parse(t.due_at) : Infinity)))
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(next - Date.now(), 0), 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [next, now])

  const heading = <h2 id="my-tasks" className="mb-2 text-lg font-medium text-ink">My tasks</h2>
  if (!data) {
    return isError
      ? <section aria-labelledby="my-tasks" className="arc">{heading}<LoadError what="your tasks" onRetry={() => refetch()} retrying={isFetching} /></section>
      : null
  }
  if (!shown.length) return null

  const send = (task: MyTask, undo: boolean) => {
    const what = `${ANSWER[task.answer_kind]}: ${task.title}`
    setSaid(undo ? `Taken back. ${what}` : what)
    answer.mutate({ taskId: task.task_id, undo }, {
      onError: () => { setSaid(''); toast("That didn't save. Try again.") },
    })
  }
  return (
    <section aria-labelledby="my-tasks" className="arc">
      {heading}
      {!online && <p className="mb-2 text-sm text-ink-2">You're offline. Try again when you're back online.</p>}
      <div className="grid gap-4">
        <SeeMoreList items={shown} render={task => <TaskCard key={task.task_id} task={task} offline={!online} onAnswer={undo => send(task, undo)} />} />
      </div>
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </section>
  )
}

function TaskCard({ task, offline, onAnswer }: { task: MyTask; offline: boolean; onAnswer: (undo: boolean) => void }) {
  const label = ANSWER[task.answer_kind]
  const asks = !task.answered || task.outdated
  return (
    <article className="grid gap-4 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
      <div className="grid gap-2">
        {task.outdated && <span className="w-fit rounded-full px-[9px] py-[3px] text-[12px] font-semibold uppercase tracking-[0.04em]"
          style={{ color: 'rgb(var(--t-brand))', background: 'rgb(var(--t-brand) / 0.12)' }}>Updated</span>}
        {/* TRAK-601: a training plan's Got it opens the plan to read first. */}
        <h3 className="text-base font-medium text-ink">{task.source_type === 'training_plan' && task.source_id
          ? <Link to={`/player/event/${task.source_id}`} state={{ from: '/player/home' }}
            className="rounded-md underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-brand">{task.title}</Link>
          : task.title}</h3>
        <p className="text-sm text-ink-3">{['From Coach', task.due_at && dueLabel(task.due_at, task.time_zone)].filter(Boolean).join(' · ')}</p>
      </div>
      {asks
        ? <span><Button size="sm" disabled={offline} aria-label={`${label}: ${task.title}`} onClick={() => onAnswer(false)}>{label}</Button></span>
        : <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><Check size={16} aria-hidden="true" />{label}</span>
            <Button size="sm" variant="ghost" disabled={offline} aria-label={`Undo ${label}: ${task.title}`} onClick={() => onAnswer(true)}>Undo</Button>
          </span>}
    </article>
  )
}
