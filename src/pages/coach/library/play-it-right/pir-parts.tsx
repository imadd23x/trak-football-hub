import { useState, type ReactNode } from 'react'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { Link } from 'react-router-dom'
import { MomentArt } from '@/components/library/LibraryArt'
import { ON_LIBRARY } from '@/lib/fixed-colours'
import {
  PIR_PATH, kindOf, momentPath, partById, partPath, shownOrder, speaker, type FollowUp, type Moment, type Panel, type Part, type SeniorPart, type Why,
} from '@/lib/library/play-it-right'
import { CloseButton } from '../parts'

/* TRAK-268: Play It Right's pieces, in Trak's look. A coach can try a call before
   seeing the answers; nothing they tap is saved. */

const h2 = 'text-[20px] font-bold text-ink tablet:text-[22px]'
const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th'][n] ?? `${n + 1}th`

/** A match moment in a list: its picture, its title, and what kind of call it is. */
export function MomentRow({ moment, part, onSelect, selected = false }: { moment: Moment; part: Part; onSelect?: () => void; selected?: boolean }) {
  const cls = 'flex h-16 w-full min-w-0 items-center gap-3 rounded-[6px] px-2 text-left tablet:h-[68px] tablet:px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const body = <>
    <MomentArt colour={part.colour} rank={moment.type === 'rank'} />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={`truncate text-[16px] font-semibold ${selected ? 'text-brand' : 'text-ink'}`}>{moment.title}</span>
      <span className="truncate text-[13px] text-ink-2">{kindOf(moment)} · Week {moment.wk}</span>
    </span>
  </>
  return onSelect
    ? <button type="button" onClick={onSelect} aria-pressed={selected} className={`${cls} ${selected ? '' : 'hover:bg-raised'}`}
        style={selected ? { background: 'rgb(var(--t-raised))', boxShadow: 'inset 3px 0 0 rgb(var(--t-brand))' } : undefined}>{body}</button>
    : <Link to={momentPath(moment)} className={cls}>{body}</Link>
}

/** The moment's strip: captions, and who says or thinks what, each with their round badge. */
export function Strip({ panels }: { panels: Panel[] }) {
  return (
    <ol className="grid gap-2.5" aria-label="The moment">
      {panels.map((panel, i) => {
        if ('cap' in panel) return <li key={i} className="rounded-[10px] bg-raised px-4 py-3 text-[15px] leading-snug text-ink">{panel.cap}</li>
        const thinks = 'think' in panel
        const who = speaker(panel.who)
        return (
          <li key={i} className="flex items-start gap-2.5">
            <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-semibold" style={{ background: who.colour, color: ON_LIBRARY }}>{who.initials}</span>
            <p className={`min-w-0 rounded-[4px_16px_16px_16px] border bg-surface px-3.5 py-2.5 text-[15px] leading-snug text-ink ${thinks ? 'border-dashed' : ''}`}
              style={{ borderColor: 'rgb(var(--t-line-strong) / 0.5)' }}>
              <span className="block text-[12px] font-semibold text-ink-2">{panel.who}{thinks ? ' (thinking)' : ''}</span>
              <span className={thinks ? 'italic' : undefined}>{'say' in panel ? panel.say : panel.think}</span>
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function Tag({ best, children }: { best?: boolean; children: ReactNode }) {
  return <span className="flex h-6 flex-none items-center rounded-full px-2.5 text-[12px] font-semibold"
    style={best ? { background: 'rgb(var(--t-brand))', color: 'rgb(var(--t-on-brand))' } : { boxShadow: 'inset 0 0 0 1px rgb(var(--t-line-strong))', color: 'rgb(var(--t-ink-2))' }}>{children}</span>
}

function Option({ badge, text, feedback, chosen, best, tags, onClick, done }: {
  badge: string; text: string; feedback?: string; chosen: boolean; best: boolean; tags: ReactNode; onClick: () => void; done: boolean
}) {
  return (
    <li>
      <button type="button" onClick={onClick} disabled={done} aria-pressed={chosen}
        className="flex w-full items-start gap-3 rounded-[10px] border bg-surface p-3 text-left disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ borderColor: done && best ? 'rgb(var(--t-brand))' : chosen ? 'rgb(var(--t-ink))' : 'rgb(var(--t-line))', borderWidth: done && best ? 2 : 1 }}>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold"
          style={chosen ? { background: 'rgb(var(--t-ink))', color: 'rgb(var(--t-surface))' } : { background: 'rgb(var(--t-raised))', color: 'rgb(var(--t-ink))' }}>{badge}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug text-ink">{text}</span>
          {done && <span className="mt-1.5 block text-[14px] leading-snug text-ink-2">{feedback}</span>}
        </span>
        {done && <span className="flex flex-col items-end gap-1">{tags}</span>}
      </button>
    </li>
  )
}

/** A call to make: tap an option (or rank them, best first), then see the best call and why for each.
 *  `onReveal` tells the moment to show what the coach saw. */
export function Call({ id, question, options, feedback, rank = false, onReveal }: {
  id: string; question: string; options: string[]; feedback: string[]; rank?: boolean; onReveal?: (shown: boolean) => void
}) {
  const shown = shownOrder(id, options.length)
  const [pick, setPick] = useState<number | null>(null)
  const [order, setOrder] = useState<number[]>([])
  const [all, setAll] = useState(false)
  const done = all || (rank ? order.length === options.length : pick !== null)
  const reveal = (now: boolean) => onReveal?.(now)
  const choose = (i: number) => {
    if (done) return
    if (!rank) { setPick(i); reveal(true); return }
    const at = order.indexOf(i)
    const next = at >= 0 ? order.filter(o => o !== i) : [...order, i]
    setOrder(next)
    if (next.length === options.length) reveal(true)
  }
  const reset = () => { setPick(null); setOrder([]); setAll(false); reveal(false) }

  return (
    <section className="grid gap-3">
      <h2 className="text-[18px] font-bold leading-snug text-ink tablet:text-[20px]">{question}</h2>
      {rank && !done && <p className="text-[14px] text-ink-2">Tap the best option first, then the second, then the third. Tap again to undo.</p>}
      <ul className="grid gap-2">
        {shown.map((i, pos) => {
          const ranked = order.indexOf(i)
          const chosen = rank ? ranked >= 0 : pick === i
          const tags = rank
            ? <><Tag best={i === 0}>{i === 0 ? 'Best' : `Best ${ordinal(i)}`}</Tag>{ranked >= 0 && <Tag>You: {ordinal(ranked)}</Tag>}</>
            : <>{i === 0 && <Tag best>Best call</Tag>}{pick === i && <Tag>Your call</Tag>}</>
          return <Option key={i} badge={rank ? (ranked >= 0 ? String(ranked + 1) : '') : 'ABCD'[pos]} text={options[i]} feedback={feedback[i]}
            chosen={chosen} best={i === 0} tags={tags} done={done} onClick={() => choose(i)} />
        })}
      </ul>
      <div className="flex flex-wrap gap-4">
        {!done && <button type="button" onClick={() => { setAll(true); reveal(true) }} className="text-[15px] font-medium text-brand underline">Show the answers</button>}
        {done && <button type="button" onClick={reset} className="text-[15px] font-medium text-brand underline">Try again</button>}
      </div>
    </section>
  )
}

/** Why it matters, for the player, the club and the game. */
export function WhyCards({ why }: { why: Why }) {
  return (
    <section>
      <h2 className={`${h2} mb-2.5`}>Why it matters</h2>
      <ul className="grid gap-2 tablet:grid-cols-3">
        {([['For you', why.you], ['For the club', why.club], ['For the game', why.game]] as const).map(([who, text]) => (
          <li key={who} className="rounded-[10px] bg-raised p-3.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{who}</span>
            <span className="mt-1 block text-[15px] leading-snug text-ink">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Tip({ label, text, part }: { label: string; text: string; part: Part }) {
  return (
    <p className="rounded-[10px] p-3.5 text-[15px] leading-snug text-ink" style={{ background: part.tint, boxShadow: `inset 3px 0 0 ${part.colour}` }}>
      <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{label}</span>{text}
    </p>
  )
}

/** A quick call with no strip: a follow-up question, or one of a senior story's three calls. */
export function QuickCall({ id, call }: { id: string; call: FollowUp }) {
  return <Call id={id} question={call.q} options={call.opts} feedback={call.fb} />
}

/** Everything a match moment holds. `pane` is a laptop's open moment beside its list. */
export function MomentView({ moment, pane, onClose }: { moment: Moment; pane?: boolean; onClose?: () => void }) {
  const part = partById(moment.sec)!
  const [answered, setAnswered] = useState(false)
  const meta = `${kindOf(moment)} · Week ${moment.wk} · Ages 13–16`
  return (
    <article aria-label={moment.title} className={pane ? 'grid gap-6 p-6' : 'grid gap-6'}>
      {pane ? (
        <div className="flex items-start gap-4 rounded-[12px] p-5" style={{ background: part.tint }}>
          <MomentArt colour={part.colour} size={72} rank={moment.type === 'rank'} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink-2">Match moment · {part.name}</p>
            <h2 className="mt-0.5 text-[28px] font-bold leading-tight text-ink">{moment.title}</h2>
            <p className="mt-1 text-[14px] text-ink-2">{meta}</p>
          </div>
          {onClose && <CloseButton onClose={onClose} />}
        </div>
      ) : (
        <header className="-mx-5 px-5 pt-3.5 pb-6 tablet:mx-0 tablet:mt-7 tablet:rounded-[12px] tablet:px-7 tablet:pt-6" style={{ background: part.tint }}>
          {/* TRAK-334: the trail, in place of Back; opened from a link, under its part. */}
          <CoachTrail current={moment.title} parents={[{ label: 'Play It Right', href: PIR_PATH }, { label: part.name, href: partPath(part) }]} />
          <div className="mt-4 flex items-center gap-4 tablet:gap-6">
            <MomentArt colour={part.colour} size={84} rank={moment.type === 'rank'} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-2 tablet:text-[14px]">Match moment · {part.name}</p>
              <h1 className="mt-0.5 text-[30px] font-bold leading-[1.08] tracking-[-0.01em] text-ink tablet:text-[42px]">{moment.title}</h1>
              <p className="mt-1.5 text-[14px] text-ink-2">{meta}</p>
            </div>
          </div>
        </header>
      )}
      <div className="grid max-w-[720px] gap-6">
        <Strip panels={moment.panels} />
        <Call key={moment.id} id={moment.id} question={moment.q} options={moment.opts} feedback={moment.fb} rank={moment.type === 'rank'} onReveal={setAnswered} />
        {answered && <>
          <section className="rounded-[12px] border border-line bg-surface p-4">
            <h2 className={`${h2} mb-1.5`}>What the coach saw</h2>
            <p className="text-[15px] leading-relaxed text-ink">{moment.coach}</p>
          </section>
          <WhyCards why={moment.why} />
          <Tip label="Tip" text={moment.tip} part={part} />
          {moment.next && <section className="grid gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">What happens next</p>
            <QuickCall id={`${moment.id}-next`} call={moment.next} />
          </section>}
        </>}
      </div>
    </article>
  )
}

/** Ages 17–20: a part's story, its three steps, why it matters, the leader's lens, and three quick calls. */
export function SeniorStory({ part, story }: { part: Part; story: SeniorPart }) {
  return (
    <div className="grid max-w-[880px] gap-6">
      <section>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">The story</p>
        <h2 className="mt-0.5 text-[24px] font-bold leading-tight text-ink tablet:text-[28px]">{story.title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">{story.scene}</p>
      </section>
      <ol className="grid gap-2 tablet:grid-cols-3">
        {story.steps.map((step, i) => (
          <li key={i} className="rounded-[10px] bg-raised p-3.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: part.colour }}>{i + 1}. {story.stepLabels[i]}</span>
            <span className="mt-1 block text-[15px] leading-snug text-ink">{step}</span>
          </li>
        ))}
      </ol>
      <WhyCards why={story.why} />
      <Tip label={story.tipLabel} text={story.tip} part={part} />
      <section className="grid gap-5">
        <h2 className={h2}>Three quick calls</h2>
        {story.qs.map((call, i) => <QuickCall key={i} id={`${part.id}-senior-${i}`} call={call} />)}
      </section>
    </div>
  )
}
