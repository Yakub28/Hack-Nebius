import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "./components/Nav";
import { ToastProvider } from "./components/Toast";
import { SessionProvider } from "./lib/session";
import { Landing } from "./pages/Landing";
import { Search } from "./pages/Search";
import { Shortlist } from "./pages/Shortlist";

/** Links to the old static pages (app.html, app.html?sample) keep working. */
function LegacyApp() {
  const { search } = useLocation();
  return <Navigate to={new URLSearchParams(search).has("sample") ? "/recorded" : "/search"} replace />;
}

function NotFound() {
  return (
    <main className="page"><section className="empty">
      <h2>No page here</h2>
      <p className="empty-sub">The address may be from an older version of the app.</p>
      <div className="empty-actions"><a className="btn primary" href="/">Go to the overview</a></div>
    </section></main>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <SessionProvider>
          <Nav />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/search" element={<Search />} />
            <Route path="/recorded" element={<Search recorded />} />
            <Route path="/shortlist" element={<Shortlist />} />
            <Route path="/app.html" element={<LegacyApp />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
