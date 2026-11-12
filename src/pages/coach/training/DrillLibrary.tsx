import { useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Bookmark, ChevronRight, LayoutGrid, List, Minus, Plus, Repeat } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCoachSquad } from '@/lib/coach-squad'
import { ON_LIBRARY, PRACTICE_KIND_COLOURS } from '@/lib/fixed-colours'
import {
  CHANGE_PRACTICE_PATH, CHARACTERISTICS, KINDS, KIND_ORDER, LIBRARY, MY_DRILLS_PATH, PLAYERS_TODAY, START_LEVEL, allDrillsPath, alsoCalled, anotherDrill,
  changedBy, characteristic, drillPath, fit, foundAs, squadPlayers, type Changed, kindInfo, kindPath, libraryDrill, nextLevel, practiceKey, practiceLayout, refit, searchDrills, step, typesOf, type Change,
  type Kind, type LibraryDrill, type Squad,
} from '@/lib/training/library'
import { useBookmarks, useSquadSize } from '@/components/coach/training/useTraining'
import { DrillCards } from '@/components/coach/training/library/DrillCard'
import { DrillPitch, PitchKey, PitchPicture } from '@/components/coach/training/library/DrillPitch'
import { PageBookmark } from '@/components/coach/training/library/BookmarkButton'
import { AddToTraining } from '@/components/coach/training/library/AddToTraining'
import { AboutDrill, CHIP, ChangeNote, DetailList } from '@/components/coach/training/library/DrillInfo'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { LoadError, WIDE_COLUMN } from '@/components/trak'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { ChipGroup } from '@/components/arc/chip-group/chip-group'
import { Button } from '@/components/arc/button/button'
import { EmptyState } from '@/components/arc/empty-state/empty-state'

/* TRAK-387 (Drill Library 3/11, parent TRAK-384): Training › Drills is the new Library, from the 8 Nov mockup. Find a
   drill (results take the place of everything else while the coach types), My drills and All drills, then "What kind
   of practice?" with Steve's three kinds. A practice page lists its drill types simple to complex; All drills groups
   every drill Get ready → Technical → Skill → Game related. Every picture is fitted to the coach's squad at the standard
   level. Searches and filters live in the address, so Back returns to the same spot. No coach-made drills (Kostas,
   8 Nov). TRAK-394 (Drill Library 9/11): Change any practice joins the links under the kinds, and the old FA Library's
   tiles left (Play It Right was only reached through them). The FA Library still opens at /coach/trainings for an
   academy with Training off, and players keep Play It Right; nothing is deleted. No Programmes link (Kostas, 8 Nov). */

type PracticeKind = Exclude<Kind, 'warmup'>
const GROUP_NAME: Record<Kind, string> = { warmup: 'Get ready', technical: 'Technical practices', skill: 'Skill practices', game: 'Game related practices' }

/** The squad every picture is fitted to: the squad picked at the top (or the whole roster on All), kept to what a
 *  drill can be drawn for, at the standard level. */
function useLibrarySquad(): { squad: Squad | null; line: string; name: string | null } {
  const { user } = useAuth()
  const coachSquad = useCoachSquad(user?.id)
  // Wait for the squads, so the squad (and the drill page's Easier, Harder and Players today) doesn't start over when
  // they arrive. Without them, the whole roster.
  const known = coachSquad.ready || coachSquad.failed
  const name = known && !coachSquad.everySquad ? coachSquad.squad : null
  const size = useSquadSize(name)
  if (!known || size.isPending) return { squad: null, line: '', name }
  const roster = size.data ?? 0
  const players = squadPlayers(roster)
  return {
    squad: { players, level: START_LEVEL },
    line: `Each picture is set for ${players} players${name ? `, your ${name}s` : ''}.`,
    name,
  }
}

function SubPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ground pb-28">
      <div className={WIDE_COLUMN}>
        <header className="arc grid gap-3 pt-5 pb-4">
          <CoachTrail current={title} />
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-ink tablet:text-[28px]">{title}</h1>
          <p className="max-w-[60ch] text-[15px] text-ink-2">{intro}</p>
        </header>
        {children}
      </div>
    </div>
  )
}

const searchClass = 'min-h-12 w-full rounded-xl border border-line-strong bg-surface px-4 text-[17px] text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** The search box: plain, with no magnifying glass (Kostas, 6 Nov: the icon is kept for a search across all of Trak). */
function FindBox({ value, onChange, big = false }: { value: string; onChange: (q: string) => void; big?: boolean }) {
  return <>
    <label htmlFor="find-a-drill" className="sr-only">Search drills</label>
    <input id="find-a-drill" type="search" autoComplete="off" value={value} onChange={e => onChange(e.target.value)}
      placeholder="Search, e.g. rondo or pressing" className={`${searchClass} ${big ? 'min-h-14 rounded-2xl text-lg' : ''}`} />
  </>
}

/** The search in the address: typing replaces it, so Back skips each letter. */
function useQueryParam(key: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? ''
  const set = (next: string) => setParams(current => {
    const p = new URLSearchParams(current)
    if (next) p.set(key, next); else p.delete(key)
    return p
  }, { replace: true })
  return [value, set]
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const Empty = ({ children }: { children: ReactNode }) =>
  <p className="rounded-2xl border border-line bg-surface p-4 text-[15px] text-ink-2">{children}</p>

const GroupLabel = ({ id, children }: { id: string; children: ReactNode }) =>
  <h2 id={id} className="mb-2.5 text-xs font-medium uppercase tracking-[0.08em] text-ink-3">{children}</h2>

/* ── Library home ───────────────────────────────────────────────────────── */

const GLYPHS: Record<PracticeKind, ReactNode> = {
  technical: <><path className="fill-current stroke-none" d="M9 38 16 13l7 25Z" /><path className="fill-current stroke-none" d="M26 38l7-25 7 25Z" /><path d="M4 41h40" /></>,
  skill: <><circle className="fill-current stroke-none" cx="24" cy="24" r="4.5" /><circle cx="24" cy="7" r="4" /><circle cx="41" cy="24" r="4" /><circle cx="24" cy="41" r="4" /><circle cx="7" cy="24" r="4" /></>,
  game: <><rect x="4" y="9" width="40" height="30" rx="2" /><path d="M24 9v30M4 18h6v12H4M44 18h-6v12h6" /><circle cx="24" cy="24" r="5" /></>,
}

/** The Drills tab: Find a drill, My drills and All drills, then the three kinds of practice. */
export function LibraryHome() {
  const { squad, line } = useLibrarySquad()
  const bookmarks = useBookmarks()
  const [query, setQuery] = useQueryParam('q')
  const searching = !!query.trim()
  const saved = (bookmarks.data ?? []).filter(id => libraryDrill(id)).length
  const found = squad && searching ? searchDrills(query, squad) : []

  return (
    <div className="grid gap-6 pt-2">
      <div className="grid gap-3">
        <h2 className="text-[22px] font-medium tracking-[-0.01em] text-ink tablet:text-[28px]">Find a drill</h2>
        <FindBox value={query} onChange={setQuery} big />
      </div>

      {!squad ? <LoadingSkeleton label="Loading the drills…" rows={3} />
        : searching ? <section aria-label="Search results" className="grid gap-3">
          <p role="status" className="text-sm text-ink-3">{found.length ? `${plural(found.length, 'drill')} found. ${line}` : ''}</p>
          {found.length ? <DrillCards drills={found} players={squad.players} level={squad.level} notes={d => foundAs(d, query, squad)} label="Drills found" />
            : <Empty>No drills match. Try another word, like rondo or shooting.</Empty>}
        </section>
        : <>
          <div className="grid gap-3 tablet:grid-cols-2">
            <HomeLink to={MY_DRILLS_PATH} icon={<List aria-hidden size={26} />} title="My drills" note={!bookmarks.isSuccess ? ' ' : saved ? plural(saved, 'drill') : 'Nothing added yet'} />
            <HomeLink to={allDrillsPath()} icon={<LayoutGrid aria-hidden size={26} />} title="All drills" note={`Every drill in the Library, ${LIBRARY.length} in all`} />
          </div>

          <section aria-labelledby="practice-kinds" className="grid gap-3">
            <h2 id="practice-kinds" className="text-lg font-medium text-ink">What kind of practice?</h2>
            <ul className="grid gap-3 tablet:grid-cols-3">
              {KINDS.map(kind => <li key={kind.key}>
                <Link to={kindPath(kind.key)} style={{ background: PRACTICE_KIND_COLOURS[kind.key], color: ON_LIBRARY }}
                  className="flex h-full flex-row items-center gap-3.5 rounded-2xl p-4 transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 tablet:min-h-[150px] tablet:flex-col tablet:items-start tablet:justify-between tablet:p-[18px]">
                  <svg viewBox="0 0 48 48" aria-hidden className="h-[30px] w-[30px] flex-none fill-none stroke-current tablet:h-10 tablet:w-10" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{GLYPHS[kind.key]}</svg>
                  <span className="grid gap-0.5">
                    <span className="text-[21px] font-medium leading-tight tablet:text-2xl">{kind.name}</span>
                    <span className="text-[15px] leading-snug">{kind.note}</span>
                  </span>
                </Link>
              </li>)}
            </ul>
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <Link to={CHANGE_PRACTICE_PATH} className="font-medium text-brand underline-offset-4 hover:underline">Change any practice</Link>
              <Link to={allDrillsPath('Individual')} className="font-medium text-brand underline-offset-4 hover:underline">Individual work</Link>
              <Link to={allDrillsPath('Goalkeeping')} className="font-medium text-brand underline-offset-4 hover:underline">Goalkeeping</Link>
            </p>
          </section>

        </>}
    </div>
  )
}

function HomeLink({ to, icon, title, note }: { to: string; icon: ReactNode; title: string; note: string }) {
  return (
    <Link to={to} className="flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex min-w-0 items-center gap-3.5">
        <span className="flex-none text-brand">{icon}</span>
        <span className="grid min-w-0">
          <span className="text-[17px] font-medium text-ink">{title}</span>
          <span className="text-sm text-ink-3">{note}</span>
        </span>
      </span>
      <ChevronRight aria-hidden size={18} className="flex-none text-ink-3" />
    </Link>
  )
}

/* ── My drills ──────────────────────────────────────────────────────────── */

/** The Library drills the coach bookmarked (TRAK-390), as picture cards grouped Get ready → Technical → Skill → Game
 *  related. A drill no longer in the Library is left out. */
export function MyDrills() {
  const navigate = useNavigate()
  const { squad, line } = useLibrarySquad()
  const bookmarks = useBookmarks()
  const mine = (bookmarks.data ?? []).flatMap(id => libraryDrill(id) ?? [])
  return (
    <SubPage title="My drills" intro={<>Drills you added from the Library. {mine.length ? line : ''}</>}>
      {bookmarks.error ? <LoadError what="your drills" onRetry={() => void bookmarks.refetch()} retrying={bookmarks.isFetching} />
        : !squad || bookmarks.isPending ? <LoadingSkeleton label="Loading your drills…" rows={2} />
        : !mine.length ? <div className="arc"><EmptyState icon={<Bookmark size={24} strokeWidth={1.5} />} title="Nothing in My drills yet"
            description="Open a drill and choose Add to My drills, or use the bookmark on its card."
            action={<Button onClick={() => navigate(allDrillsPath())}>Browse all drills</Button>} /></div>
        : <div className="grid gap-7">
          {KIND_ORDER.map(kind => {
            const drills = LIBRARY.filter(d => d.kind === kind && mine.includes(d))
            return drills.length ? <section key={kind} aria-labelledby={`mine-${kind}`}>
              <GroupLabel id={`mine-${kind}`}>{GROUP_NAME[kind]}</GroupLabel>
              <DrillCards drills={drills} players={squad.players} level={squad.level} />
            </section> : null
          })}
        </div>}
    </SubPage>
  )
}

/* ── A practice page ────────────────────────────────────────────────────── */

/** Technical, Skill or Game related: its drill types as buttons (and All), then its drills by type, simple to complex. */
export function PracticePage() {
  const { kind } = useParams()
  const info = KINDS.find(k => k.key === kind)
  const { squad, line } = useLibrarySquad()
  const [type, setType] = useQueryParam('type')
  if (!info) return <Navigate to="/coach/training/drills" replace />
  const types = typesOf(info.key)
  const shown = types.includes(type as never) ? [type] : types
  const empty = (t: string) => t === '11 v 11' ? 'Needs 22 players and a full pitch. None yet.' : 'None yet.'

  return (
    <SubPage title={info.long} intro={<>{info.note} Listed simple to complex. {line}</>}>
      <div className="arc mb-5">
        <ChipGroup label="Show drills" multiple={false} value={[shown.length === 1 ? shown[0] : '']}
          options={[{ value: '', label: 'All' }, ...types.map(t => ({ value: t, label: t }))]}
          onValueChange={next => setType(next[0] ?? '')} />
      </div>
      {!squad ? <LoadingSkeleton label="Loading the drills…" rows={3} />
        : <div className="grid gap-7">
          {shown.map(t => {
            const drills = LIBRARY.filter(d => d.kind === info.key && d.type === t)
            const id = `type-${t.replace(/\W+/g, '-').toLowerCase()}`
            return <section key={t} aria-labelledby={id}>
              <GroupLabel id={id}>{t}</GroupLabel>
              {drills.length ? <DrillCards drills={drills} players={squad.players} level={squad.level} /> : <Empty>{empty(t)}</Empty>}
            </section>
          })}
        </div>}
    </SubPage>
  )
}

/* ── All drills ─────────────────────────────────────────────────────────── */

const SHOW = ['Technical', 'Skill', 'Game related', 'Individual', 'Goalkeeping'] as const

const keepFor = (show: string) => (d: LibraryDrill) =>
  !show ? true : show === 'Individual' ? d.focus === 'individual' : show === 'Goalkeeping' ? d.focus === 'goalkeeping' : kindInfo(d.kind).name === show

/** Every drill as cards, grouped by kind; searching shows the best match first. Filters: the three kinds, Individual,
 *  Goalkeeping. */
export function AllDrills() {
  const { squad, line } = useLibrarySquad()
  const [rawShow, setShow] = useQueryParam('show')
  const show = (SHOW as readonly string[]).includes(rawShow) ? rawShow : ''
  const [query, setQuery] = useQueryParam('q')
  const searching = !!query.trim()
  const found = squad ? searchDrills(query, squad, keepFor(show)) : []
  const title = show || 'All drills'

  return (
    <SubPage title={title} intro={squad ? `${plural(found.length, 'drill')}. ${line}` : ''}>
      <div className="arc mb-4">
        <ChipGroup label="Show" multiple={false} value={[show]}
          options={[{ value: '', label: 'All' }, ...SHOW.map(s => ({ value: s, label: s }))]}
          onValueChange={next => setShow(next[0] ?? '')} />
      </div>
      <div className="mb-6"><FindBox value={query} onChange={setQuery} /></div>
      {!squad ? <LoadingSkeleton label="Loading the drills…" rows={3} />
        : !found.length ? <Empty>No drills match. Try another word.</Empty>
        : searching ? <DrillCards drills={found} players={squad.players} level={squad.level} notes={d => foundAs(d, query, squad)} label="Drills found" />
        : <div className="grid gap-7">
          {KIND_ORDER.map(kind => {
            const drills = found.filter(d => d.kind === kind)
            return drills.length ? <section key={kind} aria-labelledby={`all-${kind}`}>
              <GroupLabel id={`all-${kind}`}>{GROUP_NAME[kind]}</GroupLabel>
              <DrillCards drills={drills} players={squad.players} level={squad.level} />
            </section> : null
          })}
        </div>}
    </SubPage>
  )
}

/* ── A drill ──────────────────────────────────────────────────────────── */

const STEPPER_BUTTON = 'inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-surface text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

/** The drill page as the coach left it, kept in its history entry: a page laid out again (phone ↔ laptop) or opened
 *  again with Back comes back the same. */
type Kept = { drill: string; players: number; level: number; changed: Changed | null }

/** A drill's page (TRAK-389, from the 8 Nov mockup), fitted to the squad at the standard level: Players today, the
 *  picture and its key, Easier and Harder (each says what it changed and why), the five details with the changed ones
 *  marked, why, how and what to watch for, and Another drill. A new drill starts fresh. Add to training (TRAK-391), at
 *  the players and level set here, and Add to My drills (TRAK-390) sit under them. */
export function DrillPage() {
  const { drillId } = useParams()
  const drill = libraryDrill(drillId)
  const { squad, name } = useLibrarySquad()
  if (!drill) return <Navigate to="/coach/training/drills" replace />
  return <SubPage title={drill.name} intro={<DrillHead drill={drill} />}>
    {!squad ? <LoadingSkeleton label="Loading the drill…" rows={2} />
      : <DrillBody key={drill.id} drill={drill} start={squad} squadName={name} />}
  </SubPage>
}

function DrillHead({ drill }: { drill: LibraryDrill }) {
  const also = alsoCalled(drill)
  return <span className="grid gap-2">
    <span className="flex flex-wrap gap-1.5">
      <span className={CHIP}>{kindInfo(drill.kind).name}</span>
      {drill.kind !== 'warmup' && <span className={CHIP}>{drill.type}</span>}
      {drill.focus !== 'team' && <span className={CHIP}>{drill.focus === 'individual' ? 'Individual' : 'Goalkeeping'}</span>}
    </span>
    {also.length > 0 && <span className="text-sm text-ink-3">Also called: {also.join(', ')}</span>}
  </span>
}

function DrillBody({ drill, start, squadName }: { drill: LibraryDrill; start: Squad; squadName: string | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const kept = (location.state as { drillPage?: Kept } | null)?.drillPage
  const was = kept?.drill === drill.id ? kept : null
  const [players, setPlayers] = useState(was?.players ?? start.players)
  const [level, setLevel] = useState(was?.level ?? start.level)
  const [changed, setChanged] = useState<Changed | null>(was?.changed ?? null)
  const keep = (next: Omit<Kept, 'drill'>) => {
    setPlayers(next.players); setLevel(next.level); setChanged(next.changed)
    navigate(location.pathname + location.search, { replace: true, state: { ...(location.state as object | null), drillPage: { drill: drill.id, ...next } } })
  }
  const fitted = fit(drill, players, level)
  const another = anotherDrill(drill)

  const press = (by: -1 | 1) => {
    const next = step(drill, players, level, by)
    if (!next) return
    keep({ players, level: next.level, changed: changedBy(by, next.changes) })
  }
  const count = (by: -1 | 1) => {
    const to = Math.min(PLAYERS_TODAY.max, Math.max(PLAYERS_TODAY.min, players + by))
    if (to === players) return
    keep({ players: to, level, changed: { title: `${to} players today. Trak refitted the drill:`, items: refit(drill, players, to, level) } })
  }

  return <div className="grid items-start gap-4 laptop:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
    <div className="grid gap-3.5 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-end gap-2.5" role="group" aria-label="Players today">
        <span className="text-sm text-ink-2">Players today</span>
        <button type="button" className={STEPPER_BUTTON} aria-label="One player fewer" disabled={players <= PLAYERS_TODAY.min} onClick={() => count(-1)}><Minus aria-hidden size={18} /></button>
        <span className="min-w-[30px] text-center text-[22px] font-medium tabular-nums text-ink" aria-live="polite">{players}</span>
        <button type="button" className={STEPPER_BUTTON} aria-label="One player more" disabled={players >= PLAYERS_TODAY.max} onClick={() => count(1)}><Plus aria-hidden size={18} /></button>
      </div>
      <DrillPitch drill={drill} players={players} level={level} />
      <PitchKey legend={fitted.legend} />
      <div className="arc grid grid-cols-2 gap-2 tablet:grid-cols-3">
        <Button variant="secondary" disabled={nextLevel(drill, players, level, -1) === null} onClick={() => press(-1)}><ArrowDown aria-hidden size={16} />Easier</Button>
        <Button variant="secondary" disabled={nextLevel(drill, players, level, 1) === null} onClick={() => press(1)}><ArrowUp aria-hidden size={16} />Harder</Button>
        {another && <span className="col-span-2 grid tablet:col-span-1"><Button variant="secondary" onClick={() => navigate(drillPath(another.id))}><Repeat aria-hidden size={16} />Another drill</Button></span>}
      </div>
      <ChangeNote changed={changed} idle={`Set for ${squadName ? `your ${squadName}s` : 'your squad'}. Press Easier or Harder and Trak shows what it changed and why.`} />
      <DetailList details={fitted.details} changed={changed} />
    </div>
    <div className="grid gap-5 rounded-2xl border border-line bg-surface p-4">
      <AboutDrill drill={drill} />
      <div className="grid gap-2.5">
        <AddToTraining drill={drill} players={players} level={level} />
        <PageBookmark drill={drill} />
      </div>
    </div>
  </div>
}

/* ── Change any practice ────────────────────────────────────────────────── */

const PRACTICE_INTRO = 'Five things shape every practice. Change one and you change what players learn, so you can fit any drill to the players in front of you.'

/** TRAK-394 (from the 8 Nov mockup): Steve's five things, each with his example. Pick a set-up and the picture and
 *  what changes follow it; Conditions shows his three rules. The thing and the set-up live in the address, so Back
 *  returns to them. The answers are Trak's own; Steve checks them after the pilot (Kostas, 9 Nov). */
export function ChangePractice() {
  const [params, setParams] = useSearchParams()
  const shown = characteristic(params.get('part')) ?? CHARACTERISTICS[0]
  const examples = shown.examples ?? []
  const asked = Number(params.get('eg') ?? 0)
  const eg = Number.isInteger(asked) && examples[asked] ? asked : 0
  const go = (part: string, example: number) => setParams(() => {
    const p = new URLSearchParams()
    if (part !== CHARACTERISTICS[0].key) p.set('part', part)
    if (example) p.set('eg', String(example))
    return p
  }, { replace: true })

  return (
    <SubPage title="Change any practice" intro={PRACTICE_INTRO}>
      <div className="arc mb-4">
        <ChipGroup label="Five things that shape a practice" multiple={false} value={[shown.key]}
          options={CHARACTERISTICS.map(c => ({ value: c.key, label: c.name }))}
          onValueChange={next => { if (next[0]) go(next[0], 0) }} />
      </div>
      <section aria-labelledby="practice-question" className="grid gap-4 rounded-2xl border border-line bg-surface p-4">
        <h2 id="practice-question" className="max-w-[60ch] text-xl font-medium leading-snug text-ink">{shown.question}</h2>
        {shown.rules
          ? <ul className="grid gap-3 tablet:grid-cols-3" aria-label="Three rules">
            {shown.rules.map(rule => <li key={rule.title} className="grid content-start gap-1 rounded-xl bg-raised px-3.5 py-3">
              <span className="text-[17px] font-medium leading-tight text-ink">{rule.title}</span>
              <span className="text-[15px] text-ink-2">{rule.text}</span>
            </li>)}
          </ul>
          : <div className="grid items-start gap-4 tablet:grid-cols-2">
            <PitchPicture shapes={practiceLayout(shown.key, eg)} label={`${shown.name} example: ${examples[eg].label}`} />
            <div className="grid content-start gap-3">
              <div className="arc">
                <ChipGroup label="Pick an example" multiple={false} value={[String(eg)]}
                  options={examples.map((x, i) => ({ value: String(i), label: x.label }))}
                  onValueChange={next => { if (next[0]) go(shown.key, Number(next[0])) }} />
              </div>
              <p className="text-[17px] leading-snug text-ink" aria-live="polite">{examples[eg].answer}</p>
              <PitchKey legend={practiceKey(shown.key, eg)} />
            </div>
          </div>}
      </section>
    </SubPage>
  )
}
