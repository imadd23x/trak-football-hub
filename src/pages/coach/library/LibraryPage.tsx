import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell } from '@/components/trak'
import { PitchArt } from '@/components/library/LibraryArt'
import { useCoachSquad } from '@/lib/coach-squad'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { ON_COLOUR_TRAIL, ON_LIBRARY, ON_LIBRARY_RING } from '@/lib/fixed-colours'
import {
  AGE_BANDS, LIBRARY_PATH, SESSIONS, TOPICS, ageLabel, forAge, formatLabel, libraryByKey, libraryOf, libraryOrder, sessionById,
  squadsAgeBand, titleParts, type Library, type LibrarySession,
} from '@/lib/library/library'
import { BesideList, Chip, CloseButton, ProgrammeRow, SessionDetail, SessionHeading, SessionRow } from './parts'

/* TRAK-264: one library (Defending, Technical…). Its coloured header, the
   squad's age group as a filter the coach can clear, its topics as tabs, its
   six-week programmes, then its sessions. On a laptop a session opens beside
   the list, the way Squad opens a player (TRAK-263), so the coach keeps their place. */

const FORMATS = ['1-4 Per Side', '5-8 Per Side', '9-11 Per Side']
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export default function LibraryPage() {
  const { key } = useParams()
  const library = libraryByKey(key)
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  const wide = useSideMenuScreen()
  const [params, setParams] = useSearchParams()
  if (!library) return <Navigate to={LIBRARY_PATH} replace />

  const all = SESSIONS.filter(s => s.library === library.name)
  const topics = TOPICS[library.name] ?? []
  // The squad's age group is on until the coach clears it (?age=all) or picks another (?age=<group>).
  const squadBand = squadsAgeBand(coachSquad.squads)
  const asked = params.get('age')
  const band = asked === 'all' ? null : asked ?? squadBand
  const size = params.get('size') ?? ''
  const skill = params.get('skill') ?? ''
  const shown = all.filter(s => forAge(s, band) && (!size || s.format.includes(size)) && (!skill || s.skills.includes(skill)))
  const counts = topics.map(t => shown.filter(s => s.topic === t).length)
  const picked = params.get('topic')
  const topic = picked && topics.includes(picked) ? picked : topics.find((_, i) => counts[i] > 0) ?? topics[0]
  const inTopic = shown.filter(s => s.topic === topic).sort(libraryOrder)
  const programmes = inTopic.filter(s => s.is_programme)
  const sessions = inTopic.filter(s => !s.is_programme)
  const open = wide ? sessionById(params.get('session') ?? undefined) : undefined

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) next.delete(name)
      else next.set(name, value)
    }
    setParams(next, { replace: true })
  }
  const skills = [...new Set(all.flatMap(s => s.skills))].sort()

  return (
    <MobileShell width="wide">
      <div className="pb-36">
        <Header library={library} sessions={all.length} topics={topics.length} />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {band
            ? <Chip on onClick={() => set({ age: 'all', session: null })} label={`${ageLabel(band)}, tap to clear`}>{ageLabel(band)}</Chip>
            : <Picker label="Age group" value="" onChange={value => set({ age: value || 'all', session: null })}
                options={[['', 'Any age'], ...AGE_BANDS.map(b => [b, ageLabel(b)] as [string, string])]} />}
          <Picker label="Players per side" value={size} onChange={value => set({ size: value || null, session: null })}
            options={[['', 'Any size'], ...FORMATS.map(f => [f, formatLabel(f)] as [string, string])]} />
          {skills.length > 1 && <Picker label="Skill" value={skill} onChange={value => set({ skill: value || null, session: null })}
            options={[['', 'Any skill'], ...skills.map(s => [s, s] as [string, string])]} />}
        </div>

        {topics.length > 1 && (
          <div role="tablist" aria-label="Topics" className="mt-5 flex gap-6 overflow-x-auto border-b border-line">
            {topics.map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={t === topic} onClick={() => set({ topic: t, session: null })}
                className={`flex-none whitespace-nowrap border-b-[3px] pb-2.5 text-[15px] ${t === topic ? 'font-semibold text-ink' : 'border-transparent text-ink-2'}`}
                style={t === topic ? { borderColor: 'rgb(var(--t-brand))' } : undefined}>
                {t.replace('&', 'and')} {counts[i]}
              </button>
            ))}
          </div>
        )}

        <p className="mt-3 text-[14px] text-ink-2">
          {band ? `${ageLabel(band)}: ` : ''}{plural(programmes.length, 'programme')}, {plural(sessions.length, 'session')}
        </p>

        {inTopic.length === 0 ? (
          <div className="mt-6">
            <p className="text-[15px] text-ink">No sessions match these filters.</p>
            <button type="button" onClick={() => set({ age: 'all', size: null, skill: null })} className="mt-2 text-[15px] font-medium text-brand underline">Clear the filters</button>
          </div>
        ) : <>
          {programmes.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-[20px] font-bold text-ink">Six-week programmes</h2>
              <div className="grid gap-2 tablet:grid-cols-2">
                {programmes.map(p => <ProgrammeRow key={p.id} programme={p} tinted />)}
              </div>
            </section>
          )}
          {sessions.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[20px] font-bold text-ink">Sessions</h2>
              {wide
                ? <SessionBrowser sessions={sessions} open={open} onOpen={id => set({ session: id })} onClose={() => set({ session: null })} />
                : <div className="grid gap-1 tablet:grid-cols-2 tablet:gap-x-2">
                    {sessions.map(s => <SessionRow key={s.id} session={s} />)}
                  </div>}
            </section>
          )}
        </>}
      </div>
    </MobileShell>
  )
}

function Header({ library, sessions, topics }: { library: Library; sessions: number; topics: number }) {
  return (
    <header className="relative -mx-5 overflow-hidden px-5 pt-3.5 pb-6 tablet:mx-0 tablet:mt-7 tablet:rounded-[12px] tablet:px-7 tablet:pt-6"
      style={{ background: library.colour, color: ON_LIBRARY }}>
      <span aria-hidden className="absolute -right-10 -bottom-16 h-52 w-52 rounded-full border-2 tablet:-right-16 tablet:-bottom-24 tablet:h-[300px] tablet:w-[300px]" style={{ borderColor: ON_LIBRARY_RING }} />
      {/* TRAK-334: the trail, in place of Back, white on the library's colour. */}
      <CoachTrail current={library.label} style={ON_COLOUR_TRAIL} />
      <p className="mt-14 text-[12px] font-semibold tracking-[0.1em] tablet:mt-16">LIBRARY</p>
      <h1 className="mt-0.5 text-[40px] font-bold leading-[1.05] tracking-[-0.01em] tablet:text-[54px]">{library.label}</h1>
      <p className="mt-2 text-[14px] font-medium tablet:text-[16px]">{plural(sessions, 'session')} · {plural(topics, 'topic')}</p>
    </header>
  )
}

/** A filter as a chip that opens the phone's own picker. */
function Picker({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label className="relative flex-none">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="h-8 appearance-none rounded-full bg-raised pl-3.5 pr-8 text-[14px] text-ink laptop:h-[34px]">
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
      <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink"><path d="m6 9 6 6 6-6" /></svg>
    </label>
  )
}

/** On a laptop a session opens beside the list, the way Squad opens a player (BesideList). */
function SessionBrowser({ sessions, open, onOpen, onClose }: {
  sessions: LibrarySession[]; open?: LibrarySession; onOpen: (id: string) => void; onClose: () => void
}) {
  return <BesideList label="Sessions" items={sessions} open={open}
    row={(s, selected) => <SessionRow session={s} selected={selected} onSelect={() => onOpen(s.id)} />}
    view={s => <OpenSession session={s} onClose={onClose} />}
    empty={{ title: 'No session open', hint: 'Pick a session to see it here.' }} />
}

/** The session a laptop's list opened: the same name block and details as its own page. */
function OpenSession({ session, onClose }: { session: LibrarySession; onClose: () => void }) {
  const library = libraryOf(session)
  return (
    <article aria-label={titleParts(session).title} className="grid gap-6 p-6">
      <div className="flex items-start gap-5 rounded-[12px] p-5" style={{ background: library.tint }}>
        <PitchArt seed={session.id} colour={library.colour} className="w-24 flex-none xl:w-[132px]" />
        <SessionHeading session={session} level={2} />
        <CloseButton onClose={onClose} />
      </div>
      <SessionDetail session={session} />
    </article>
  )
}
