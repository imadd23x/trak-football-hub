import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParentChildrenProvider } from "@/contexts/ParentChildrenContext";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { PlayerConsentWatcher } from "@/components/player/PlayerConsentWatcher";
import { PlayerSessionWatcher } from "@/components/player/PlayerSessionWatcher";
import { ParentConsentWatcher } from "@/components/parent/ParentConsentWatcher";
import { CoachLayout } from "@/components/coach/CoachLayout";
import { CoachFrame } from "@/components/coach/CoachFrame";
import { ErrorBoundary } from "@/components/trak/ErrorBoundary";
import { ParkedScreen } from "@/components/trak/ParkedScreen";

// Landing eagerly loaded so the first paint is instant
import LandingPage from "./pages/LandingPage";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

// Lazy-loaded routes — split bundles so navigating between sections is fast
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const ParentInfoPage = lazy(() => import("./pages/ParentInfoPage"));
const ParentOnboarding = lazy(() => import("./pages/ParentOnboarding"));
const AuthConfirm = lazy(() => import("./pages/AuthConfirm"));
const AuthCode = lazy(() => import("./pages/AuthCode"));
const EventLink = lazy(() => import("./pages/EventLink"));
const Settings = lazy(() => import("./pages/Settings"));
// The import itself is conditional, not just the route. A bare
// lazy(() => import(...)) is a static reference Rollup always emits, so the
// chunk shipped even though the route never registered.
const DevSetupPage = import.meta.env.DEV
  ? lazy(() => import("./pages/DevSetupPage"))
  : null;
// Was a static import, so it sat in the ENTRY bundle for every visitor with
// only its render guarded. Same treatment.
const DevSwitcher = import.meta.env.DEV
  ? lazy(() => import("@/components/trak/DevSwitcher").then(m => ({ default: m.DevSwitcher })))
  : null;

/** TRAK-315: /coach/games… is now /coach/matches…, with the same tab and step. */
function OldGamesLink() {
  const { pathname, search } = useLocation();
  return <Navigate replace to={pathname.replace(/^\/coach\/games/, "/coach/matches") + search} />;
}

const PlayerHome = lazy(() => import("./pages/player/PlayerHome"));
const PlayerMatches = lazy(() => import("./pages/player/PlayerMatches"));
const PlayerMatchDetail = lazy(() => import("./pages/player/PlayerMatchDetail"));
const PlayerEvent = lazy(() => import("./pages/player/PlayerEvent"));
const PlayerCalendar = lazy(() => import("./pages/player/PlayerCalendar"));
const PlayerProfilePage = lazy(() => import("./pages/player/PlayerProfilePage"));
const PlayerFeedback = lazy(() => import("./pages/player/PlayerFeedback"));
const HowTrakWorks = lazy(() => import("./pages/HowTrakWorks"));

const CoachHomePage = lazy(() => import("./pages/coach/CoachHomePage"));
const CoachSquadPage = lazy(() => import("./pages/coach/CoachSquadPage"));
const CoachFeedbackPage = lazy(() => import("./pages/coach/CoachFeedbackPage"));
const CoachAssessPage = lazy(() => import("./pages/coach/CoachAssessPage"));
const CoachSessionsPage = lazy(() => import("./pages/coach/CoachSessionsPage"));
const CoachAddSession = lazy(() => import("./pages/coach/CoachAddSession"));
const CoachSessionsChooser = lazy(() => import("./pages/coach/CoachSessionsChooser"));
const CoachSessionEdit = lazy(() => import("./pages/coach/CoachSessionEdit"));
const CoachProfilePage = lazy(() => import("./pages/coach/CoachProfilePage"));
const CoachManual = lazy(() => import("./pages/coach/CoachManual"));
const CoachPlayerProfilePage = lazy(() => import("./pages/coach/CoachPlayerProfilePage"));
const TrainingsPage = lazy(() => import("./pages/TrainingsPage"));
const CoachLibrary = lazy(() => import("./pages/coach/library/CoachLibrary"));

const ParentHome = lazy(() => import("./pages/parent/ParentHome"));
const ParentMatches = lazy(() => import("./pages/parent/ParentMatches"));
const ParentAssessments = lazy(() => import("./pages/parent/ParentAssessments"));
const ParentAssessment = lazy(() => import("./pages/parent/ParentAssessment"));
const ParentMatchDetail = lazy(() => import("./pages/parent/ParentMatchDetail"));
const ParentEvent = lazy(() => import("./pages/parent/ParentEvent"));
const ParentProfilePage = lazy(() => import("./pages/parent/ParentProfilePage"));
const ParentConsent = lazy(() => import("./pages/parent/ParentConsent"));

// TRAK-85: parked screens show as designed, inside ParkedScreen ("Coming soon"
// pill; actions say so and send nothing). Their backend writes stay closed (G7).
const PlayerPassport = lazy(() => import("./pages/player/PlayerPassport"));
const PlayerEvolutionCard = lazy(() => import("./pages/player/PlayerEvolutionCard"));
const CoachReviewFeedback = lazy(() => import("./pages/coach/CoachReviewFeedback"));
const CoachAssistant = lazy(() => import("./pages/coach/CoachAssistant"));
const CoachSchedule = lazy(() => import("./pages/coach/CoachSchedule"));
// TRAK-283: Games, parked until the academy's games switch is on.
const CoachGames = lazy(() => import("./pages/coach/CoachGames"));
const CoachGame = lazy(() => import("./pages/coach/CoachGame"));
const CoachTraining = lazy(() => import("./pages/coach/training/CoachTraining"));
const CoachRecognition = lazy(() => import("./pages/coach/CoachRecognition"));
const CoachAwardPlayer = lazy(() => import("./pages/coach/CoachAwardPlayer"));
const ParentAlerts = lazy(() => import("./pages/parent/ParentAlerts"));
const ClubHome = lazy(() => import("./pages/club/ClubHome"));
const ClubSquads = lazy(() => import("./pages/club/ClubSquads"));
const ClubCoaches = lazy(() => import("./pages/club/ClubCoaches"));
const ClubProfile = lazy(() => import("./pages/club/ClubProfile"));
const ClubRadar = lazy(() => import("./pages/club/ClubRadar"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => <div className="min-h-screen bg-ground" />;

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ParentChildrenProvider>
          {/* G6: an open player or guardian session drops coach content on withdrawal (TRAK-13, TRAK-88). */}
          <PlayerConsentWatcher />
          {/* TRAK-104: signs out an open app whose session a password reset ended. */}
          <PlayerSessionWatcher />
          <ParentConsentWatcher />
          {/* TRAK-199: a coach's screens use a tablet's or laptop's width. */}
          <CoachLayout />
          {DevSwitcher && <DevSwitcher />}
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/confirm" element={<AuthConfirm />} />
            <Route path="/auth/code" element={<AuthCode />} />
            {/* TRAK-168: a shared event link; routes each person to that event. */}
            <Route path="/event/:id" element={<EventLink />} />
            <Route path="/onboarding/:role" element={<OnboardingPage />} />
            <Route path="/parent-info" element={<ParentInfoPage />} />
            <Route path="/parent-invite" element={<ParentOnboarding />} />
            {DevSetupPage && <Route path="/dev-setup" element={<DevSetupPage />} />}

            {/* Player routes */}
            <Route path="/player/home" element={<RouteGuard allowedRole="player"><PlayerHome /></RouteGuard>} />
            <Route path="/player/matches" element={<RouteGuard allowedRole="player"><PlayerMatches /></RouteGuard>} />
            <Route path="/player/match/:id" element={<RouteGuard allowedRole="player"><PlayerMatchDetail /></RouteGuard>} />
            <Route path="/player/event/:id" element={<RouteGuard allowedRole="player"><PlayerEvent /></RouteGuard>} />
            <Route path="/player/calendar" element={<RouteGuard allowedRole="player"><PlayerCalendar /></RouteGuard>} />
            <Route path="/player/profile" element={<RouteGuard allowedRole="player"><PlayerProfilePage /></RouteGuard>} />
            <Route path="/player/passport" element={<RouteGuard allowedRole="player"><ParkedScreen><PlayerPassport /></ParkedScreen></RouteGuard>} />
            <Route path="/player/evolution" element={<RouteGuard allowedRole="player"><ParkedScreen><PlayerEvolutionCard /></ParkedScreen></RouteGuard>} />
            <Route path="/player/feedback/:assessmentId" element={<RouteGuard allowedRole="player"><PlayerFeedback /></RouteGuard>} />
            <Route path="/player/trainings" element={<RouteGuard allowedRole="player"><TrainingsPage role="player" /></RouteGuard>} />

            {/* Coach routes. TRAK-259: inside the coach's frame (the sidebar on a laptop, the glass tab bar on a phone).
                Settings and How Trak works are shared; the frame shows only for a coach. */}
            <Route element={<CoachFrame />}>
            <Route path="/settings" element={<Settings />} />
            <Route path="/how-it-works" element={<HowTrakWorks />} />
            <Route path="/coach/home" element={<RouteGuard allowedRole="coach"><CoachHomePage /></RouteGuard>} />
            <Route path="/coach/squad" element={<RouteGuard allowedRole="coach"><CoachSquadPage /></RouteGuard>} />
            <Route path="/coach/squad/add" element={<RouteGuard allowedRole="coach"><Navigate to="/coach/squad" replace /></RouteGuard>} />
            <Route path="/coach/assess" element={<RouteGuard allowedRole="coach"><CoachAssessPage /></RouteGuard>} />
            <Route path="/coach/feedback" element={<RouteGuard allowedRole="coach"><CoachFeedbackPage /></RouteGuard>} />
            <Route path="/coach/feedback/:assessmentId" element={<RouteGuard allowedRole="coach"><ParkedScreen><CoachReviewFeedback /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/sessions" element={<RouteGuard allowedRole="coach"><CoachSessionsChooser /></RouteGuard>} />
            <Route path="/coach/sessions/list" element={<RouteGuard allowedRole="coach"><CoachSessionsPage /></RouteGuard>} />
            {/* Quick match log now resolves to the full session screen, preset to Match.
                 It wrote identical inputs for every attending player — 90 minutes, no
                 goals, no assists — so a squad's computed bands varied only by position.
                 CoachAddSession asks for exactly the same required fields and defaults
                 each player the same way, with per-player detail available where it
                 matters. CoachQuickMatchLog.tsx is left in the repo, unrouted. */}
            <Route path="/coach/sessions/quick" element={<RouteGuard allowedRole="coach"><CoachAddSession /></RouteGuard>} />
            <Route path="/coach/sessions/add" element={<RouteGuard allowedRole="coach"><CoachAddSession /></RouteGuard>} />
            {/* TRAK-102: a history row opens its session; training and other are editable. */}
            <Route path="/coach/sessions/:id" element={<RouteGuard allowedRole="coach"><CoachSessionEdit /></RouteGuard>} />
            <Route path="/coach/profile" element={<RouteGuard allowedRole="coach"><CoachProfilePage /></RouteGuard>} />
            {/* TRAK-264: the coach's Library (the frame's Library tab) and the pages it opens. */}
            <Route path="/coach/trainings/*" element={<RouteGuard allowedRole="coach"><CoachLibrary /></RouteGuard>} />
            <Route path="/coach/manual" element={<CoachManual />} />
            <Route path="/coach/quick-assess" element={<RouteGuard allowedRole="coach"><Navigate to="/coach/assess" replace /></RouteGuard>} />
            <Route path="/coach/player/:id" element={<RouteGuard allowedRole="coach"><CoachPlayerProfilePage /></RouteGuard>} />
            <Route path="/coach/recognition" element={<RouteGuard allowedRole="coach"><ParkedScreen><CoachRecognition /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/award" element={<RouteGuard allowedRole="coach"><ParkedScreen><CoachAwardPlayer /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/schedule" element={<RouteGuard allowedRole="coach"><ParkedScreen unless="events"><CoachSchedule /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/matches" element={<RouteGuard allowedRole="coach"><ParkedScreen unless="games"><CoachGames /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/matches/:eventId" element={<RouteGuard allowedRole="coach"><ParkedScreen unless="games"><CoachGame /></ParkedScreen></RouteGuard>} />
            {/* TRAK-315: Games became Matches; an old link or bookmark still opens the same match. */}
            <Route path="/coach/games/*" element={<OldGamesLink />} />
            {/* TRAK-294: the Training tab (TRAK-293), behind the academy's training switch. */}
            <Route path="/coach/training/*" element={<RouteGuard allowedRole="coach"><ParkedScreen unless="training"><CoachTraining /></ParkedScreen></RouteGuard>} />
            <Route path="/coach/assistant" element={<RouteGuard allowedRole="coach"><ParkedScreen><CoachAssistant /></ParkedScreen></RouteGuard>} />
            </Route>

            {/* Parent routes */}
            <Route path="/parent/home" element={<RouteGuard allowedRole="parent"><ParentHome /></RouteGuard>} />
            <Route path="/parent/matches" element={<RouteGuard allowedRole="parent"><ParentMatches /></RouteGuard>} />
            {/* TRAK-171 (live run 3): one Events page for parents, the tab's; old links land there. */}
            <Route path="/parent/events" element={<Navigate to="/parent/matches" replace />} />
            <Route path="/parent/assessments" element={<RouteGuard allowedRole="parent"><ParentAssessments /></RouteGuard>} />
            <Route path="/parent/assessment/:id" element={<RouteGuard allowedRole="parent"><ParentAssessment /></RouteGuard>} />
            <Route path="/parent/session/:sessionId/assessment" element={<RouteGuard allowedRole="parent"><ParentAssessment /></RouteGuard>} />
            <Route path="/parent/match/:id" element={<RouteGuard allowedRole="parent"><ParentMatchDetail /></RouteGuard>} />
            <Route path="/parent/event/:id" element={<RouteGuard allowedRole="parent"><ParentEvent /></RouteGuard>} />
            <Route path="/parent/alerts" element={<RouteGuard allowedRole="parent"><ParkedScreen><ParentAlerts /></ParkedScreen></RouteGuard>} />
            <Route path="/parent/profile" element={<RouteGuard allowedRole="parent"><ParentProfilePage /></RouteGuard>} />
            <Route path="/parent/consent" element={<RouteGuard allowedRole="parent"><ParentConsent /></RouteGuard>} />

            {/* Club admin routes */}
            <Route path="/club/home" element={<RouteGuard allowedRole="club"><ParkedScreen><ClubHome /></ParkedScreen></RouteGuard>} />
            <Route path="/club/squads" element={<RouteGuard allowedRole="club"><ParkedScreen><ClubSquads /></ParkedScreen></RouteGuard>} />
            <Route path="/club/coaches" element={<RouteGuard allowedRole="club"><ParkedScreen><ClubCoaches /></ParkedScreen></RouteGuard>} />
            <Route path="/club/profile" element={<RouteGuard allowedRole="club"><ParkedScreen><ClubProfile /></ParkedScreen></RouteGuard>} />
            <Route path="/club/radar" element={<RouteGuard allowedRole="club"><ParkedScreen><ClubRadar /></ParkedScreen></RouteGuard>} />

            {/* Legacy redirects */}
            <Route path="/dashboard" element={<RouteGuard allowedRole="player"><PlayerHome /></RouteGuard>} />
            <Route path="/profile" element={<RouteGuard allowedRole="player"><PlayerProfilePage /></RouteGuard>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ParentChildrenProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
