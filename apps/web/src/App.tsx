import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { ReactNode, Suspense, lazy } from "react";
import { Shimmer } from "./components/ui";
import { AppShell } from "./components/AppShell";
import { MotionConfig } from "framer-motion";

// Code-split routes so the initial bundle stays lean. Chart/atlas/synastry carry
// the heavy SVG + map rendering and load on demand.
const Signin = lazy(() => import("./routes/Signin"));
const Onboarding = lazy(() => import("./routes/Onboarding"));
const Home = lazy(() => import("./routes/Home"));
const Chart = lazy(() => import("./routes/Chart"));
const HumanDesign = lazy(() => import("./routes/HumanDesign"));
const GeneKeys = lazy(() => import("./routes/GeneKeys"));
const Enneagram = lazy(() => import("./routes/Enneagram"));
const Socionics = lazy(() => import("./routes/Socionics"));
const Convergence = lazy(() => import("./routes/Convergence"));
const Astrocartography = lazy(() => import("./routes/Astrocartography"));
const Journal = lazy(() => import("./routes/Journal"));
const Constellations = lazy(() => import("./routes/Constellations"));
const ConstellationDetail = lazy(() => import("./routes/ConstellationDetail"));
const Synastry = lazy(() => import("./routes/Synastry"));
const Join = lazy(() => import("./routes/Join"));

function FullPageShimmer() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-3">
        <Shimmer className="h-6 w-32 mx-auto" />
        <Shimmer className="h-32 w-full" />
        <Shimmer className="h-4 w-3/4" />
        <Shimmer className="h-4 w-1/2" />
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { isAuthed, loading, user } = useAuth();
  const loc = useLocation();
  if (loading) return <FullPageShimmer />;
  if (!isAuthed) return <Navigate to="/app/signin" replace state={{ from: loc.pathname }} />;
  // Force onboarding if no birth data, unless we're already on it.
  if (user && !user.has_birth_data && !loc.pathname.startsWith("/app/onboarding")) {
    return <Navigate to="/app/onboarding" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function RootRedirect() {
  const { isAuthed, loading } = useAuth();
  if (loading) return <FullPageShimmer />;
  return <Navigate to={isAuthed ? "/app/home" : "/app/signin"} replace />;
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <Suspense fallback={<FullPageShimmer />}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/app/signin" element={<Signin />} />
      <Route path="/join/:token" element={<Join />} />

      {/* Onboarding is auth-gated but no shell yet */}
      <Route path="/app/onboarding" element={<OnboardingGate />} />

      <Route path="/app/home" element={<Protected><Home /></Protected>} />
      <Route path="/app/chart" element={<Protected><Chart /></Protected>} />
      <Route path="/app/design" element={<Protected><HumanDesign /></Protected>} />
      <Route path="/app/keys" element={<Protected><GeneKeys /></Protected>} />
      <Route path="/app/enneagram" element={<Protected><Enneagram /></Protected>} />
      <Route path="/app/socionics" element={<Protected><Socionics /></Protected>} />
      <Route path="/app/convergence" element={<Protected><Convergence /></Protected>} />
      <Route path="/app/atlas" element={<Protected><Astrocartography /></Protected>} />
      <Route path="/app/journal" element={<Protected><Journal /></Protected>} />
      <Route path="/app/constellations" element={<Protected><Constellations /></Protected>} />
      <Route path="/app/constellation/:id" element={<Protected><ConstellationDetail /></Protected>} />
      <Route path="/app/synastry/:otherUserId" element={<Protected><Synastry /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </MotionConfig>
  );
}

function OnboardingGate() {
  const { isAuthed, loading } = useAuth();
  if (loading) return <FullPageShimmer />;
  if (!isAuthed) return <Navigate to="/app/signin" replace />;
  return <Onboarding />;
}
