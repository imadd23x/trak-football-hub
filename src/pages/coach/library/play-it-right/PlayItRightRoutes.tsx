import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { MobileShell } from '@/components/trak'
import { useSideMenuScreen } from '@/lib/side-menu-screen'
import { ON_COLOUR_TRAIL, ON_LIBRARY, ON_LIBRARY_RING } from '@/lib/fixed-colours'
import {
  MOMENTS, PARTS, PIR_PATH, agesFrom, momentById, momentsOf, partById, partPath, seniorOf, type Ages, type Part,
} from '@/lib/library/play-it-right'
import { BY_AGE, HOW_IT_WORKS, NO_SCORES, RESEARCH } from '@/lib/library/play-it-right-notes'
import { BesideList, ChevronRight, Chip } from '../parts'
import { MomentRow, MomentView, SeniorStory } from './pir-parts'

/* TRAK-268 (Kostas, 23 Oct): Play It Right in Trak's look, laid out like the Library's
   Browse drills. Its first page is the code's six parts as tiles; a part opens its
   match moments (ages 13–16) or its story (ages 17–20); a moment opens on its own page,
   or beside the list on a laptop. The age group is ?ages=17-20, kept as the coach moves. */
export default function PlayItRightRoutes() {
  return (
    <Routes>
      <Route index element={<PlayItRightHome />} />
      <Route path="notes" element={<CoachNotes />} />
      <Route path="moment/:id" element={<MomentPage />} />
      <Route path=":part" element={<PartPage />} />
      <Route path="*" element={<Navigate to={PIR_PATH} replace />} />
    </Routes>
  )
}

const title = 'text-[28px] font-bold tracking-[-0.01em] text-ink tablet:text-[34px] laptop:text-[36px]'
const section = 'mb-3 text-[20px] font-bold text-ink tablet:mb-3.5 tablet:text-[24px] laptop:text-[26px]'

function AgeChips({ ages }: { ages: Ages }) {
  const [params, setParams] = useSearchParams()
  const pick = (next: Ages) => {
    const p = new URLSearchParams(params)
    if (next === '17-20') p.set('ages', next)
    else p.delete('ages')
    p.delete('moment')
    setParams(p, { replace: true })
  }
  return (
    <div role="group" aria-label="Age group" className="flex gap-2">
      <Chip pressed={ages === '13-16'} onClick={() => pick('13-16')}>Ages 13–16</Chip>
      <Chip pressed={ages === '17-20'} onClick={() => pick('17-20')}>Ages 17–20</Chip>
    </div>
  )
}

function PlayItRightHome() {
  const [params] = useSearchParams()
  const ages = agesFrom(params.get('ages'))
  return (
    <MobileShell width="wide">
      <div className="pt-3.5 pb-36 tablet:pt-7 laptop:pt-8">
        {/* TRAK-334: the trail, in place of Back. */}
        <div className="grid gap-3">
          <CoachTrail current="Play It Right" />
          <h1 className={title}>Play It Right</h1>
        </div>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-snug text-ink-2">
          Match moments from the player code of conduct. A player makes the call, then sees what the coach saw.
        </p>
        <div className="mt-4"><AgeChips ages={ages} /></div>

        <h2 className={`mt-6 tablet:mt-8 ${section}`}>The code, in six parts</h2>
        <ul className="grid grid-cols-2 gap-2.5 tablet:grid-cols-3 tablet:gap-3 laptop:gap-4">
          {PARTS.map(part => (
            <li key={part.id}>
              <Link to={partPath(part, ages)}
                className="relative flex h-24 flex-col justify-between overflow-hidden rounded-[8px] p-3 tablet:h-[132px] tablet:rounded-[10px] tablet:p-4 laptop:h-[150px] laptop:p-[18px]"
                style={{ background: part.colour, color: ON_LIBRARY }}>
                <span>
                  <span className="block text-[12px] font-semibold tracking-[0.08em]">PART {part.n}</span>
                  <span className="block text-[17px] font-bold leading-[1.15] tablet:text-[18px] laptop:text-[24px]">{part.name}</span>
                </span>
                <span className="text-[12px] font-medium">{ages === '13-16' ? `${momentsOf(part).length} match moments` : 'A story and 3 calls'}</span>
                <span aria-hidden className="absolute -right-3.5 -bottom-3.5 h-16 w-16 rounded-full border-2 tablet:-right-5 tablet:-bottom-5 tablet:h-[92px] tablet:w-[92px] laptop:-right-6 laptop:-bottom-6 laptop:h-[110px] laptop:w-[110px]"
                  style={{ borderColor: ON_LIBRARY_RING }} />
              </Link>
            </li>
          ))}
        </ul>

        <h2 className={`mt-6 tablet:mt-8 ${section}`}>For coaches</h2>
        <Link to={`${PIR_PATH}/notes`} className="flex h-16 items-center gap-3 overflow-hidden rounded-[8px] bg-raised pr-3.5 tablet:h-20 tablet:gap-4">
          <span aria-hidden className="flex h-16 w-16 flex-none items-center justify-center text-on-brand tablet:h-20 tablet:w-20" style={{ background: 'rgb(var(--t-brand))' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3" /><path d="M8 7h7M8 10.5h5" /></svg>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[16px] font-semibold text-ink tablet:text-[18px]">Coach notes</span>
            <span className="text-[13px] text-ink-2 tablet:text-[15px]">How to use it with your squad, and the research behind it</span>
          </span>
          <span className="text-ink-3"><ChevronRight /></span>
        </Link>
        <p className="mt-6 text-[12px] text-ink-3">{MOMENTS.length} match moments for ages 13–16 and six stories for ages 17–20, from the six sections of the player code of conduct. Scenarios and names are fictional.</p>
      </div>
    </MobileShell>
  )
}

function PartHeader({ part, count }: { part: Part; count: string }) {
  return (
    <header className="relative -mx-5 overflow-hidden px-5 pt-3.5 pb-6 tablet:mx-0 tablet:mt-7 tablet:rounded-[12px] tablet:px-7 tablet:pt-6"
      style={{ background: part.colour, color: ON_LIBRARY }}>
      <span aria-hidden className="absolute -right-10 -bottom-16 h-52 w-52 rounded-full border-2 tablet:-right-16 tablet:-bottom-24 tablet:h-[300px] tablet:w-[300px]" style={{ borderColor: ON_LIBRARY_RING }} />
      {/* TRAK-334: the trail, in place of Back, white on the part's colour; opened from a link, under Play It Right. */}
      <CoachTrail current={part.name} parents={[{ label: 'Play It Right', href: PIR_PATH }]} style={ON_COLOUR_TRAIL} />
      <p className="mt-10 text-[12px] font-semibold tracking-[0.1em] tablet:mt-12">PLAY IT RIGHT · PART {part.n}</p>
      <h1 className="mt-0.5 text-[36px] font-bold leading-[1.05] tracking-[-0.01em] tablet:text-[50px]">{part.name}</h1>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-snug">{part.line}</p>
      <p className="mt-2 text-[14px] font-medium">{count}</p>
    </header>
  )
}

function PartPage() {
  const part = partById(useParams().part)
  const [params, setParams] = useSearchParams()
  const wide = useSideMenuScreen()
  if (!part) return <Navigate to={PIR_PATH} replace />
  const ages = agesFrom(params.get('ages'))
  const moments = momentsOf(part)
  const open = wide ? moments.find(m => m.id === params.get('moment')) : undefined
  const select = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('moment', id)
    else p.delete('moment')
    setParams(p, { replace: true })
  }

  return (
    <MobileShell width="wide">
      <div className="pb-36">
        <PartHeader part={part} count={ages === '13-16' ? `${moments.length} match moments for ages 13–16` : 'A story and three quick calls for ages 17–20'} />
        <div className="mt-4"><AgeChips ages={ages} /></div>
        {ages === '17-20'
          ? <div className="mt-6"><SeniorStory part={part} story={seniorOf(part)} /></div>
          : <section className="mt-6">
              <h2 className="mb-2 text-[20px] font-bold text-ink">Match moments</h2>
              {wide
                ? <BesideList label="Match moments" items={moments} open={open}
                    row={(m, selected) => <MomentRow moment={m} part={part} selected={selected} onSelect={() => select(m.id)} />}
                    view={m => <MomentView key={m.id} moment={m} pane onClose={() => select(null)} />}
                    empty={{ title: 'No moment open', hint: 'Pick a match moment to see it here.' }} />
                : <ul aria-label="Match moments" className="grid gap-1 tablet:grid-cols-2 tablet:gap-x-2">
                    {moments.map(m => <li key={m.id} className="min-w-0"><MomentRow moment={m} part={part} /></li>)}
                  </ul>}
            </section>}
      </div>
    </MobileShell>
  )
}

function MomentPage() {
  const moment = momentById(useParams().id)
  if (!moment) return <Navigate to={PIR_PATH} replace />
  return (
    <MobileShell width="wide">
      <div className="pb-36"><MomentView key={moment.id} moment={moment} /></div>
    </MobileShell>
  )
}

function CoachNotes() {
  const h2 = 'mb-3 text-[20px] font-bold text-ink tablet:text-[22px]'
  return (
    <MobileShell width="wide">
      <div className="grid max-w-[880px] gap-8 pt-3.5 pb-36 tablet:pt-7 laptop:pt-8">
        <div className="grid gap-3">
          <CoachTrail current="Coach notes" parents={[{ label: 'Play It Right', href: PIR_PATH }]} />
          <h1 className={title}>Coach notes</h1>
        </div>
        <section>
          <h2 className={h2}>How to use it with your squad</h2>
          <ol className="grid gap-2">
            {HOW_IT_WORKS.map(([when, what]) => (
              <li key={when} className="grid gap-1 rounded-[10px] bg-raised p-3.5 tablet:grid-cols-[110px_1fr] tablet:gap-4">
                <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand">{when}</span>
                <span className="text-[15px] leading-snug text-ink">{what}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[15px] leading-snug text-ink-2">{NO_SCORES}</p>
        </section>
        <section>
          <h2 className={h2}>What the research says</h2>
          <ul className="grid gap-2.5">
            {RESEARCH.map(r => (
              <li key={r.finding} className="rounded-[10px] border border-line bg-surface p-4">
                <p className="text-[16px] font-semibold leading-snug text-ink">{r.finding}</p>
                <p className="mt-1 text-[15px] leading-snug text-ink-2">{r.detail}</p>
                <p className="mt-1.5 text-[12px] text-ink-3">{r.source}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className={h2}>By age</h2>
          <div className="grid gap-2 tablet:grid-cols-2">
            {(['Ages 13–16', 'Ages 17–20'] as const).map((ages, col) => (
              <div key={ages} className="rounded-[10px] bg-raised p-4">
                <h3 className="text-[16px] font-bold text-ink">{ages}</h3>
                {BY_AGE.map(([what, young, older]) => (
                  <p key={what} className="mt-2 text-[15px] leading-snug text-ink">
                    <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{what}</span>{col === 0 ? young : older}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </MobileShell>
  )
}
