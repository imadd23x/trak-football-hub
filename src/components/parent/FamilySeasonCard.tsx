import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/arc/button/button'
import { ObjectiveStatusChip } from '@/components/player/ObjectiveStatusChip'
import { objectiveWord, useMySeason } from '@/lib/my-season'
import { firstName, type ParentChild } from '@/lib/parent-data'

/* TRAK-399 (Season plan 18/18 build 4/8, spec TRAK-366): the Season plan card on the family Home, for the child chosen
   in the picker (the read is keyed by the child, so it follows the picker). The squad's objectives as words, then the
   child's with their latest word, read-only. New, with a green outline, until the guardian opens the page: a family has
   no Got it, and the coach never reads that they looked. No card when the database returns no plan (not shared, switch
   off, consent withdrawn) and none when the read fails: Home's other errors are not this card's to show. No coach note
   and no reasons: the function never returns them. */
export function FamilySeasonCard({ child }: { child: ParentChild }) {
  const navigate = useNavigate()
  const { data: plan } = useMySeason(child.id)
  if (!plan) return null
  const font = { fontFamily: 'var(--t-font)' }
  return (
    <section aria-label="Season plan" className="arc mb-3.5 grid gap-3 rounded-2xl p-4"
      style={{ background: 'rgb(var(--t-surface))', border: `1px solid rgb(var(${plan.is_new ? '--t-brand' : '--t-line'}))`,
        boxShadow: plan.is_new ? '0 0 0 2px rgb(var(--t-brand) / 0.14)' : undefined }}>
      <div className="flex items-center justify-between gap-2.5">
        <h2 className="text-[18px] font-medium text-ink" style={font}>Season plan</h2>
        {plan.is_new && <span className="rounded-full px-[9px] py-[3px] text-[12px] font-semibold uppercase tracking-[0.04em]"
          style={{ color: 'rgb(var(--t-brand))', background: 'rgb(var(--t-brand) / 0.12)' }}>New</span>}
      </div>
      <div className="grid gap-2.5">
        <h3 className="text-[15px] font-medium text-ink-2" style={font}>Squad objectives</h3>
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {plan.season_objectives.map(o => <li key={o.id} className="text-[16px] font-medium text-ink" style={font}>{o.title}</li>)}
        </ul>
      </div>
      <hr className="m-0 border-0 border-t border-line" />
      <div className="grid gap-2.5">
        <h3 className="text-[15px] font-medium text-ink-2" style={font}>{firstName(child)}'s objectives</h3>
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {plan.objectives.map(o => {
            const word = objectiveWord(o)
            return <li key={o.id} className="flex items-start justify-between gap-2.5">
              <span className="text-[16px] font-medium text-ink" style={font}>{o.title}</span>
              {word && <ObjectiveStatusChip status={word} />}
            </li>
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <span />
        <Button variant="ghost" size="lg" onClick={() => navigate('/parent/season')}>See the season plan</Button>
      </div>
    </section>
  )
}
