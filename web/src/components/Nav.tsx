import { useEffect, useRef, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../lib/session";
import { StarIcon } from "./Icons";

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M10 21L16 10L23 19" stroke="var(--surface)" strokeOpacity=".55" strokeWidth="2" fill="none" />
      <circle cx="10" cy="21" r="3.2" fill="var(--surface)" />
      <circle cx="16" cy="10" r="3.2" fill="var(--surface)" />
      <circle cx="23" cy="19" r="3.2" fill="#62aef0" />
    </svg>
  );
}

type Status = { kind: "" | "ok" | "warn" | "off"; text: string; hint: string };

function ApiStatus() {
  const [status, setStatus] = useState<Status>({ kind: "", text: "Checking API…", hint: "" });
  useEffect(() => {
    api.health()
      .then((h) => setStatus(
        !h.nebius ? { kind: "off", text: "No Nebius key", hint: "Set NEBIUS_API_KEY on the server to search. The recorded run still works." }
          : !h.web ? { kind: "warn", text: "Web search off", hint: "Set TAVILY_API_KEY on the server for the web search agent and web context." }
            : { kind: "ok", text: "API connected", hint: "Search, web agent and web context are available." }))
      .catch(() => setStatus({ kind: "off", text: "API offline", hint: "The recorded run still works." }));
  }, []);
  return (
    <span className={`badge status ${status.kind}`} title={status.hint || status.text}>
      <span className="dot" /><span className="label-text">{status.text}</span>
    </span>
  );
}

function ThemeToggle() {
  const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
  const [theme, setTheme] = useState<string | null>(() => document.documentElement.dataset.theme ?? null);
  const dark = theme ? theme === "dark" : prefersDark();

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pd:theme", JSON.stringify(next)); } catch { /* still switches */ }
    setTheme(next);
  }

  const label = dark ? "Switch to the light theme" : "Switch to the dark theme";
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {dark ? (
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.3A6.8 6.8 0 0 1 7.7 3.5a6.8 6.8 0 1 0 8.8 8.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}

/** A small live indicator in the nav while a search runs, so it can be found from any page. */
function RunPill() {
  const { run } = useSession();
  if (!run || run.status !== "running") return null;
  return <Link to="/search" className="badge run-pill"><span className="pulse" />Searching…</Link>;
}

/** The shortlist's count rides along in the nav; on a phone the star stands in for the word. */
function ShortlistLink() {
  const { kept } = useSession();
  const n = Object.keys(kept).length;
  return (
    <NavLink to="/shortlist" className="nav-shortlist" aria-label={n ? `Shortlist, ${n} kept` : "Shortlist"}>
      <StarIcon filled={n > 0} /><span className="nav-word">Shortlist</span>{n > 0 && <span className="nav-count">{n}</span>}
    </NavLink>
  );
}

export function Nav() {
  // The paper drawer hangs just below the nav. Publish the nav's real height, which changes with width and
  // wrapping, so the drawer never starts underneath it.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty("--nav-h", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header className="nav" ref={bar}>
      <div className="nav-inner">
        <Link className="brand" to="/" aria-label="TUMor, overview">
          <BrandMark /><span>TUMor</span>
        </Link>
        <nav className="nav-links" aria-label="Sections">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/recorded">Recorded run</NavLink>
          <ShortlistLink />
        </nav>
        <div className="nav-right">
          <RunPill />
          <ApiStatus />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
