import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useIsMobile } from './hooks/useIsMobile';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ViewDropdown from './components/ViewDropdown';
import ErrorBoundary from './components/ErrorBoundary';
import { API_URL } from './lib/apiUrl';

// The Silk background is a decorative full-screen WebGL shader that pulls in
// three.js. Lazy-load it so the 1.4 MB three chunk streams in AFTER first paint
// instead of blocking the initial render of every page.
const Silk = lazy(() => import('./components/Silk'));

// Pages are route-split so heavy dependencies (three.js, the FPV circuit) only
// download when their page is actually visited — the Home/Events/Board pages no
// longer pay for the 3D bundle on first load.
const Home = lazy(() => import('./pages/Home'));
const Achievements = lazy(() => import('./pages/Achievements'));
const Events = lazy(() => import('./pages/Events'));
const Drones = lazy(() => import('./pages/Drones'));
const Admin = lazy(() => import('./pages/Admin'));
const Gallery = lazy(() => import('./pages/Gallery'));
const Board = lazy(() => import('./pages/Board'));
const SponsorUs = lazy(() => import('./pages/SponsorUs'));
const FormalAchievements = lazy(() => import('./pages/FormalAchievements'));

// The contact form moved to the home page. Keep old /contact links working by
// redirecting to home and scrolling to the contact section.
function ContactRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/', { replace: true });
    const t = setTimeout(() => {
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    }, 350);
    return () => clearTimeout(t);
  }, [navigate]);
  return null;
}

// The interactive FPV experience is desktop-only — on phones it's heavy and the
// scroll-driven flight doesn't translate to touch, so we fall back to the formal
// achievements page (the default achievements view on mobile).
function InteractiveAchievementsRoute() {
  const isMobile = useIsMobile();
  if (isMobile) return <Navigate to="/achievements" replace />;
  return <Achievements />;
}

function AppContent() {
  const location = useLocation();
  const isInteractiveAchievementsPage = location.pathname === '/interactive-achievements';

  // Record a page view on every route change. Fire-and-forget: failures never
  // affect the page. The admin dashboard is excluded so staff visits aren't
  // counted as traffic. The backend resolves the real IP + geolocation.
  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return;
    fetch(`${API_URL}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [location.pathname]);

  return (
    <>
      <div className="app-background">
        <Suspense fallback={null}>
          <Silk
            speed={3.7}
            scale={1}
            color="#022e5223"
            noiseIntensity={1.3}
            rotation={0}
          />
        </Suspense>
      </div>
      <Navbar />
      <ViewDropdown />
      <main>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Home />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/achievements" element={<FormalAchievements />} />
            <Route path="/interactive-achievements" element={<InteractiveAchievementsRoute />} />
            <Route path="/board" element={<Board />} />
            <Route path="/sponsor-us" element={<SponsorUs />} />
            <Route path="/events" element={<Events />} />
            <Route path="/drones" element={<Drones />} />
            <Route path="/contact" element={<ContactRedirect />} />
            <Route path="/admin" element={<Admin />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isInteractiveAchievementsPage && <Footer />}
    </>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
