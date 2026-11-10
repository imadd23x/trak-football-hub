import { ObjectiveStatusChip } from '@/components/player/ObjectiveStatusChip'
import { evalDay, squadEvaluation } from '@/lib/evaluation'
import { objectiveWord, type MySeason } from '@/lib/my-season'

/* TRAK-398, TRAK-400 (Season plan 18/18 builds 3 and 5, spec TRAK-366): the body of the season page, shared by the
   player's My season and the family's "Alex's season". Same read, same words; only the headings change. `child` is the
   child's first name on the family page and absent for the player ("Your position"). */

const font = { fontFamily: 'var(--t-font)' }
const card = 'rounded-2xl border border-line bg-surface p-4 grid gap-3'
const heading = 'text-[15px] font-medium text-ink-2'

/** "Set by Coach Rami. Next evaluation Sun 29 Nov 2026." The date is left out once none is left or the next is waiting on the coach. */
export function seasonSubtitle(plan: MySeason): string {
  const by = plan.coach_name ? `Set by ${plan.coach_name}.` : 'Set by your coach.'
  if (!plan.shared_at) return by
  const { due } = squadEvaluation({
    plan: { starts_on: plan.starts_on, ends_on: plan.ends_on, shared_at: plan.shared_at, eval_every: plan.eval_every, eval_day: plan.eval_day },
    lastDueOn: plan.last_evaluation_on, zone: plan.time_zone, now: new Date(),
  })
  return due.next && !due.dueOn ? `${by} Next evaluation ${evalDay(due.next, true)}.` : by
}

export function SeasonPlanSections({ plan, child }: { plan: MySeason; child?: string }) {
  const own = child ? `${child}'s` : 'Your'
  return <>
    <section aria-label={`${own} position`} className={card}>
      <h2 className={heading} style={font}>{own} position</h2>
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
      <section aria-label={`${own} objectives`} className={card}>
        <h2 className={heading} style={font}>{own} objectives</h2>
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
