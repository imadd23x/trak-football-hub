import { Navigate, useParams } from 'react-router-dom'
import { CoachTrail } from '@/components/coach/CoachTrail'
import { MobileShell } from '@/components/trak'
import { PitchArt, ProgrammeArt } from '@/components/library/LibraryArt'
import { LIBRARY_PATH, agesLabel, libraryOf, libraryPath, sessionById, sessionPath, titleParts } from '@/lib/library/library'
import { SessionDetail, SessionHeading, WeekList } from './parts'

/* TRAK-264: a session's own page, and a six-week programme's. The picture sits
   on a pale wash of the library's colour; on a tablet or laptop it moves to the
   left of the name. Back returns to where the coach came from. */

const header = '-mx-5 px-5 pt-3.5 pb-6 tablet:mx-0 tablet:mt-7 tablet:rounded-[12px] tablet:px-7 tablet:pt-6'
const picture = 'mt-2 flex flex-col items-center gap-5 tablet:mt-4 tablet:flex-row tablet:items-end tablet:gap-7'

export default function SessionPage() {
  const { id } = useParams()
  const session = sessionById(id)
  if (!session) return <Navigate to={LIBRARY_PATH} replace />
  if (session.is_programme) return <Navigate to={sessionPath(session)} replace />
  const library = libraryOf(session)
  return (
    <MobileShell width="wide">
      <div className="pb-36">
        <header className={header} style={{ background: library.tint }}>
          {/* TRAK-334: the trail, in place of Back; opened from a link, it sits under its library. */}
          <CoachTrail current={titleParts(session).title} parents={[{ label: library.label, href: libraryPath(library.key) }]} />
          <div className={picture}>
            <PitchArt seed={session.id} colour={library.colour} className="w-[232px] flex-none shadow-[0_16px_32px_-14px_rgb(26_36_33/0.55)] tablet:w-[260px]" />
            <SessionHeading session={session} />
          </div>
        </header>
        <div className="mt-5 tablet:mt-7"><SessionDetail session={session} /></div>
      </div>
    </MobileShell>
  )
}

export function ProgrammePage() {
  const { id } = useParams()
  const programme = sessionById(id)
  if (!programme) return <Navigate to={LIBRARY_PATH} replace />
  if (!programme.is_programme) return <Navigate to={sessionPath(programme)} replace />
  const library = libraryOf(programme)
  return (
    <MobileShell width="wide">
      <div className="pb-36">
        <header className={header} style={{ background: library.tint }}>
          {/* TRAK-334: the trail, in place of Back; opened from a link, it sits under Programmes. */}
          <CoachTrail current={titleParts(programme).title} parents={[{ label: 'Programmes', href: `${LIBRARY_PATH}/programmes` }]} />
          <div className={picture}>
            <ProgrammeArt colour={library.colour} size={210} label={library.label} />
            <div className="w-full min-w-0 flex-1">
              <p className="text-[13px] text-ink-2 tablet:text-[14px]">Six-week programme</p>
              <h1 className="mt-0.5 text-[30px] font-bold leading-[1.08] tracking-[-0.01em] text-ink tablet:text-[42px]">{titleParts(programme).title}</h1>
              <p className="mt-2 flex items-center gap-2 text-[14px] font-medium text-ink">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: library.colour }} />
                {library.label} · {agesLabel(programme.ages)}
              </p>
              <p className="mt-2 text-[15px] leading-snug text-ink-2">{programme.summary}</p>
            </div>
          </div>
        </header>
        <div className="mt-5 grid gap-6 tablet:mt-7 tablet:grid-cols-2 tablet:gap-x-8">
          <section>
            <h2 className="mb-1 text-[20px] font-bold text-ink tablet:text-[22px]">The six weeks</h2>
            <WeekList programme={programme} />
          </section>
          <SessionDetail session={programme} compact />
        </div>
      </div>
    </MobileShell>
  )
}
