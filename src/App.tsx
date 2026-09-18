import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParentChildrenProvider } from "@/contexts/ParentChildrenContext";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { ErrorBoundary } from "@/components/trak/ErrorBoundary";
import { DevSwitcher } from "@/components/trak/DevSwitcher";

// Landing eagerly loaded so the first paint is instant
import LandingPage from "./pages/LandingPage";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

// Lazy-loaded routes — split bundles so navigating between sections is fast
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const ParentInfoPage = lazy(() => import("./pages/ParentInfoPage"));
const ParentOnboarding = lazy(() => import("./pages/ParentOnboarding"));
const AuthConfirm = lazy(() => import("./pages/AuthConfirm"));
const Settings = lazy(() => import("./pages/Settings"));
const DevSetupPage = lazy(() => import("./pages/DevSetupPage"));

const PlayerHome = lazy(() => import("./pages/player/PlayerHome"));
const PlayerMatches = lazy(() => import("./pages/player/PlayerMatches"));
const PlayerMatchDetail = lazy(() => import("./pages/player/PlayerMatchDetail"));
const PlayerProfilePage = lazy(() => import("./pages/player/PlayerProfilePage"));
const PlayerPassport = lazy(() => import("./pages/player/PlayerPassport"));
const PlayerEvolutionCard = lazy(() => import("./pages/player/PlayerEvolutionCard"));
const PlayerFeedback = lazy(() => import("./pages/player/PlayerFeedback"));
const HowTrakWorks = lazy(() => import("./pages/HowTrakWorks"));

const CoachHomePage = lazy(() => import("./pages/coach/CoachHomePage"));
const CoachSquadPage = lazy(() => import("./pages/coach/CoachSquadPage"));
const CoachAddPlayer = lazy(() => import("./pages/coach/CoachAddPlayer"));
const CoachAssessPage = lazy(() => import("./pages/coach/CoachAssessPage"));
const CoachSessionsPage = lazy(() => import("./pages/coach/CoachSessionsPage"));
const CoachAddSession = lazy(() => import("./pages/coach/CoachAddSession"));
const CoachSessionsChooser = lazy(() => import("./pages/coach/CoachSessionsChooser"));
const CoachProfilePage = lazy(() => import("./pages/coach/CoachProfilePage"));
const CoachManual = lazy(() => import("./pages/coach/CoachManual"));
const CoachPlayerProfilePage = lazy(() => import("./pages/coach/CoachPlayerProfilePage"));
const CoachRecognition = lazy(() => import("./pages/coach/CoachRecognition"));
const CoachAwardPlayer = lazy(() => import("./pages/coach/CoachAwardPlayer"));
const CoachQuickAssess = lazy(() => import("./pages/coach/CoachQuickAssess"));
const CoachSchedule = lazy(() => import("./pages/coach/CoachSchedule"));
const CoachAssistant = lazy(() => import("./pages/coach/CoachAssistant"));

const ParentHome = lazy(() => import("./pages/parent/ParentHome"));
const ParentMatches = lazy(() => import("./pages/parent/ParentMatches"));
const ParentAlerts = lazy(() => import("./pages/parent/ParentAlerts"));
const ParentProfilePage = lazy(() => import("./pages/parent/ParentProfilePage"));
const ParentConsent = lazy(() => import("./pages/parent/ParentConsent"));

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

const RouteFallback = () => <div className="min-h-screen bg-[#0A0A0B]" />;

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ParentChildrenProvider>
          {import.meta.env.DEV && <DevSwitcher />}
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/confirm" element={<AuthConfirm />} />
            <Route path="/onboarding/:role" element={<OnboardingPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/parent-info" element={<ParentInfoPage />} />
            <Route path="/parent-invite" element={<ParentOnboarding />} />
            {import.meta.env.DEV && <Route path="/dev-setup" element={<DevSetupPage />} />}

            {/* Player routes */}
            <Route path="/player/home" element={<RouteGuard allowedRole="player"><PlayerHome /></RouteGuard>} />
            <Route path="/player/matches" element={<RouteGuard allowedRole="player"><PlayerMatches /></RouteGuard>} />
            <Route path="/player/match/:id" element={<RouteGuard allowedRole="player"><PlayerMatchDetail /></RouteGuard>} />
            <Route path="/player/profile" element={<RouteGuard allowedRole="player"><PlayerProfilePage /></RouteGuard>} />
            <Route path="/player/passport" element={<RouteGuard allowedRole="player"><PlayerPassport /></RouteGuard>} />
            <Route path="/player/evolution" element={<RouteGuard allowedRole="player"><PlayerEvolutionCard /></RouteGuard>} />
            <Route path="/player/feedback/:assessmentId" element={<RouteGuard allowedRole="player"><PlayerFeedback /></RouteGuard>} />
            <Route path="/how-it-works" element={<HowTrakWorks />} />

            {/* Coach routes */}
            <Route path="/coach/home" element={<RouteGuard allowedRole="coach"><CoachHomePage /></RouteGuard>} />
            <Route path="/coach/squad" element={<RouteGuard allowedRole="coach"><CoachSquadPage /></RouteGuard>} />
            <Route path="/coach/squad/add" element={<RouteGuard allowedRole="coach"><CoachAddPlayer /></RouteGuard>} />
            <Route path="/coach/assess" element={<RouteGuard allowedRole="coach"><CoachAssessPage /></RouteGuard>} />
            <Route path="/coach/feedback/:assessmentId" element={<RouteGuard allowedRole="coach"><CoachReviewFeedback /></RouteGuard>} />
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
            <Route path="/coach/profile" element={<RouteGuard allowedRole="coach"><CoachProfilePage /></RouteGuard>} />
            <Route path="/coach/manual" element={<CoachManual />} />
            <Route path="/coach/quick-assess" element={<RouteGuard allowedRole="coach"><CoachQuickAssess /></RouteGuard>} />
            <Route path="/coach/player/:id" element={<RouteGuard allowedRole="coach"><CoachPlayerProfilePage /></RouteGuard>} />
            <Route path="/coach/recognition" element={<RouteGuard allowedRole="coach"><CoachRecognition /></RouteGuard>} />
            <Route path="/coach/award" element={<RouteGuard allowedRole="coach"><CoachAwardPlayer /></RouteGuard>} />
            <Route path="/coach/schedule" element={<RouteGuard allowedRole="coach"><CoachSchedule /></RouteGuard>} />
            <Route path="/coach/assistant" element={<RouteGuard allowedRole="coach"><CoachAssistant /></RouteGuard>} />

            {/* Parent routes */}
            <Route path="/parent/home" element={<RouteGuard allowedRole="parent"><ParentHome /></RouteGuard>} />
            <Route path="/parent/matches" element={<RouteGuard allowedRole="parent"><ParentMatches /></RouteGuard>} />
            <Route path="/parent/alerts" element={<RouteGuard allowedRole="parent"><ParentAlerts /></RouteGuard>} />
            <Route path="/parent/profile" element={<RouteGuard allowedRole="parent"><ParentProfilePage /></RouteGuard>} />
            <Route path="/parent/consent" element={<RouteGuard allowedRole="parent"><ParentConsent /></RouteGuard>} />

            {/* Club admin routes */}
            <Route path="/club/home" element={<RouteGuard allowedRole="club"><ClubHome /></RouteGuard>} />
            <Route path="/club/squads" element={<RouteGuard allowedRole="club"><ClubSquads /></RouteGuard>} />
            <Route path="/club/coaches" element={<RouteGuard allowedRole="club"><ClubCoaches /></RouteGuard>} />
            <Route path="/club/profile" element={<RouteGuard allowedRole="club"><ClubProfile /></RouteGuard>} />
            <Route path="/club/radar" element={<RouteGuard allowedRole="club"><ClubRadar /></RouteGuard>} />

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
import CoachReviewFeedback from '@/pages/coach/CoachReviewFeedback'
