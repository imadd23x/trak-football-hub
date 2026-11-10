import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { ObjectiveStatusChip } from '@/components/player/ObjectiveStatusChip'
import { evalDay, squadEvaluation } from '@/lib/evaluation'
import { objectiveWord, useMarkSeen, useMySeason, type MySeason } from '@/lib/my-season'

/* TRAK-398 (Season plan 18/18 build 3/8, spec TRAK-366): the player's My season page, opened from the Home card. Read-
   only; Back is the only control. Position (main, Can also play, role), the squad's objectives with what each looks
   like, and the player's own with their word now and one row per published evaluation. Opening it clears New. Removed
   objectives never reach this page (the function leaves them out); a Met objective keeps its Met row. A player the
   coach has not shared, or one whose switch or consent is off, gets the same short line: the database does not say
   which. The evaluation note is not here: it is the player's alone, on the evaluation (TRAK-401). */

const font = { fontFamily: 'var(--t-font)' }
const card = 'rounded-2xl border border-line bg-surface p-4 grid gap-3'
const heading = 'text-[15px] font-medium text-ink-2'

/** "Set by Coach Rami. Next evaluation Sun 29 Nov 2026." The date is left out once none is left or the next is waiting on the coach. */
function subtitle(plan: MySeason): string {
  const by = plan.coach_name ? `Set by ${plan.coach_name}.` : 'Set by your coach.'
  if (!plan.shared_at) return by
  const { due } = squadEvaluation({
    plan: { starts_on: plan.starts_on, ends_on: plan.ends_on, shared_at: plan.shared_at, eval_every: plan.eval_every, eval_day: plan.eval_day },
    lastDueOn: plan.last_evaluation_on, zone: plan.time_zone, now: new Date(),
  })
  return due.next && !due.dueOn ? `${by} Next evaluation ${evalDay(due.next, true)}.` : by
}

export default function PlayerSeason() {
  const navigate = useNavigate()
  const { data: plan, isPending, isError, refetch, isFetching } = useMySeason()
  const seen = useMarkSeen()
  // Opening the page is seeing it. It runs when New turns up, once; the re-read after it says New is gone.
  const unseen = plan?.is_new === true
  useEffect(() => { if (unseen) seen.mutate() }, [unseen]) // eslint-disable-line react-hooks/exhaustive-deps

  let body: JSX.Element
  if (isPending) {
    body = <div className="flex items-center justify-center h-[50vh]" role="status" aria-label="Loading your season">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  } else if (isError) {
    body = <LoadError what="your season" onRetry={() => { void refetch() }} retrying={isFetching} />
  } else if (!plan) {
    body = <p className="text-[13px] text-ink-2" style={font}>Your coach hasn't shared a season plan with you yet.</p>
  } else {
    body = <>
      <div className="grid gap-1">
        <h1 className="m-0 text-[26px] font-medium text-ink" style={{ ...font, letterSpacing: '-0.01em' }}>My season</h1>
        <p className="m-0 text-[15px] text-ink-2" style={font}>{subtitle(plan)}</p>
      </div>
      <section aria-label="Your position" className={card}>
        <h2 className={heading} style={font}>Your position</h2>
        <div className="flex flex-wrap gap-2">
          {[plan.position, ...plan.also_plays.map(p => `Can also play ${p}`), ...plan.roles].filter(Boolean).map((text, i) => (
            <span key={`${text}-${i}`} className={`rounded-full border border-line bg-surface px-3 py-1 text-[14px] text-ink ${i === 0 ? 'font-medium' : ''}`} style={font}>{text}</span>
          ))}
        </div>
      </section>
      <section aria-label="Squad objectives" className={card}>
        <h2 className={heading} style={font}>Squad objectives</h2>
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {plan.season_objectives.map(o => (
            <li key={o.id} className="grid gap-0.5">
              <span className="text-[16px] font-medium text-ink" style={font}>{o.title}</span>
              {o.looks_like && <span className="text-[14px] text-ink-2" style={font}>{o.looks_like}</span>}
            </li>
          ))}
        </ul>
      </section>
      {plan.objectives.length > 0 && (
        <section aria-label="Your objectives" className={card}>
          <h2 className={heading} style={font}>Your objectives</h2>
          <ul className="m-0 grid list-none gap-3.5 p-0">
            {plan.objectives.map(o => {
              const word = objectiveWord(o)
              return (
                <li key={o.id} className="grid gap-1.5">
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="text-[16px] font-medium text-ink" style={font}>{o.title}</span>
                    {word && <ObjectiveStatusChip status={word} />}
                  </div>
                  {o.history.length > 0 && (
                    <ul aria-label={`History of ${o.title}`} className="m-0 grid list-none gap-1 p-0">
                      {o.history.map(h => (
                        <li key={h.due_on} className="flex items-center justify-between gap-2 text-[14px] text-ink-2" style={font}>
                          <span>{evalDay(h.due_on)}</span>
                          <ObjectiveStatusChip status={h.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  }

  return (
    <MobileShell>
      <div className="pt-12 pb-28 space-y-5">
        <Link to="/player/home" className="flex min-h-11 items-center gap-1 text-[13px] text-ink-2"><ChevronLeft size={16} /> Back</Link>
        {body}
      </div>
      <NavBar role="player" activeTab="/player/home" onNavigate={navigate} />
    </MobileShell>
  )
}
