import { KitAnnouncement } from '@/components/trak/kits/KitAnnouncement'
import { describeEventKit } from '@/lib/kit-templates'
import { TRAINING_THEMES } from '@/lib/training-theme'
import { splitVenue } from '@/lib/venue-link'
import { WEEKDAYS, eventTitle, formatEventDay, repeatProblem, type EventForm, type EventKind, type Repeat } from '@/lib/coach-events'

/* TRAK-283: Schedule's Review rows, in their own file so a game's Logistics (Games) shows the same rows without
   loading the Schedule page. */

const KIND_LABEL: Record<EventKind, string> = { match: 'Match', training: 'Training', other: 'Other' }
const font = { fontFamily: 'var(--t-font)' }

/** Review: everything the save writes, in the order the steps asked for it. */
export function EventSummary({ form, repeat, noteProblem, squad }: {
  form: EventForm; repeat: Repeat | null; noteProblem: 'link' | 'name' | null
  /** Imad, 24 Oct: for a coach with two squads or more, which squad it's for. */
  squad?: string
}) {
  const rows: [string, string][] = [
    ...(squad ? [['Squad', squad] as [string, string]] : []),
    ['Type', KIND_LABEL[form.kind]],
    ...(form.kind === 'training' ? [['Theme', TRAINING_THEMES.find(t => t.key === form.theme)?.label ?? 'Not set'] as [string, string]] : []),
    ...(form.kind === 'match' ? [['Opponent', form.opponent.trim() + (form.homeAway ? ` (${form.homeAway === 'home' ? 'Home' : 'Away'})` : '')] as [string, string]] : []),
    ['Title', eventTitle(form)],
    // TRAK-255: the name, and whether it has a map link; never the link itself.
    ['Venue', (() => { const v = splitVenue(form.venue); return (v.name.trim() || (v.link ? 'Unnamed place' : 'Not set')) + (v.link ? ' · on the map' : '') })()],
    [repeat?.on ? 'First date' : 'Date', form.date ? formatEventDay(form.date) : 'Not set'],
    [form.kind === 'match' ? 'Kickoff' : 'Start', form.time || 'Not set'],
    ['Meet', form.meetTime || 'At the start'],
    ['Length', `${form.duration} min`],
    ...(repeat?.on && form.kind !== 'match' && !repeatProblem(form, repeat)
      ? [['Repeats', `${repeat.days.map(d => WEEKDAYS[d]).join(', ')} until ${formatEventDay(repeat.until)}`] as [string, string]] : []),
    ['Kit', form.kitSnapshot ? describeEventKit(form.kitSnapshot) : form.kit.trim() || 'None'],
    ['Message to players', form.familyNote.trim() || 'None'],
  ]
  return <>
    <dl className="rounded-[14px] border border-line divide-y divide-line" style={font}>
      {rows.map(([term, value]) => (
        <div key={term} className="flex gap-3 px-3 py-2.5 text-[13px]">
          <dt className="w-[38%] shrink-0 text-ink-3">{term}</dt>
          <dd className="flex-1 min-w-0 text-ink break-words">{value}</dd>
        </div>
      ))}
    </dl>
    {form.kitSnapshot && <KitAnnouncement kit={form.kitSnapshot.design} slot={form.kitSnapshot.slot} animated={false} />}
    {noteProblem && (
      <p role="status" className="text-[11px] text-warning" style={font}>
        Players and parents won't see this message: {noteProblem === 'link' ? 'it has a link' : 'it names a player'}.
      </p>
    )}
  </>
}
