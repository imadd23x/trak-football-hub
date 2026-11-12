import { Suspense, lazy, useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import LibraryHome from './LibraryHome'
import LibraryPage from './LibraryPage'
import SessionPage, { ProgrammePage } from './SessionPage'
import ProgrammesPage from './ProgrammesPage'
import SearchPage from './SearchPage'
import { LIBRARY_PATH } from '@/lib/library/library'
import { useFeatureState } from '@/components/trak/parked'
import { drillsLink } from '@/lib/training-theme'

// TRAK-268: Play It Right's 180 moments load only when the coach opens it.
const PlayItRight = lazy(() => import('./play-it-right/PlayItRightRoutes'))

/* TRAK-264 (Kostas, 22 Oct): the coach's Library, at /coach/trainings (the
   frame's Library tab, TRAK-259). The player's Trainings tab is TrainingsPage. */
export default function CoachLibrary() {
  const { pathname } = useLocation()
  const navigation = useNavigationType()
  // A page the coach opens starts at its top, wherever they were on the last one. Back (POP) is left to the
  // browser, which returns them to their place. A filter, a topic or a laptop's open session isn't a new page.
  useLayoutEffect(() => {
    if (navigation !== 'POP') (document.scrollingElement ?? document.documentElement).scrollTo(0, 0)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps -- only a new page moves to the top

  // TRAK-419 (11 Nov review): where Training is on, Drills is the one library, so an old Library address (a bookmark,
  // an old link) opens Training › Drills; a theme's address opens that theme's drills. Nothing shows until the switch
  // answers, so the old Library never flashes up first. Where Training is off, the Library works as before. Play It
  // Right is not a drill library and Drills has no place for it, so its address keeps working.
  const training = useFeatureState('training')
  const first = pathname.slice(LIBRARY_PATH.length + 1).split('/')[0]
  if (first !== 'play-it-right') {
    if (!training.known) return null
    if (training.on) return <Navigate to={drillsLink(first)} replace />
  }

  return (
    <Routes>
      <Route index element={<LibraryHome />} />
      <Route path="search" element={<SearchPage />} />
      <Route path="programmes" element={<ProgrammesPage />} />
      <Route path="play-it-right/*" element={<Suspense fallback={null}><PlayItRight /></Suspense>} />
      <Route path="session/:id" element={<SessionPage />} />
      <Route path="programme/:id" element={<ProgrammePage />} />
      <Route path=":key" element={<LibraryPage />} />
      <Route path="*" element={<Navigate to={LIBRARY_PATH} replace />} />
    </Routes>
  )
}
