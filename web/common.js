"use strict";
// Shared by the landing page and the search tool: API location, theme toggle, API status, toasts.

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) ||
  (location.protocol === "file:" ? "http://localhost:8000" : "");

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode or blocked storage: the page works without it */ }
  return null;
}

// --- theme --------------------------------------------------------------------

const ICONS = {
  moon: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.3A6.8 6.8 0 0 1 7.7 3.5a6.8 6.8 0 1 0 8.8 8.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  sun: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
};

function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = isDark();
  const button = $("theme-toggle");
  button.innerHTML = dark ? ICONS.sun : ICONS.moon;
  button.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
  button.title = button.getAttribute("aria-label");
}

$("theme-toggle").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  store("pd:theme", next);
  applyTheme(next);
});
applyTheme(store("pd:theme"));

// --- API status ---------------------------------------------------------------

function setStatus(kind, text, hint) {
  const badge = $("api-status");
  badge.className = `badge status ${kind}`;
  badge.querySelector(".label-text").textContent = text;
  badge.title = hint || text;
}

async function checkHealth() {
  try {
    const resp = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(resp.status);
    const health = await resp.json();
    if (health.nebius === false) {
      setStatus("off", "No Nebius key", "Set NEBIUS_API_KEY on the server to search. The recorded run still works.");
    } else if (!health.web) {
      setStatus("warn", "Web search off", "Set TAVILY_API_KEY on the server for the web search agent and web context.");
    } else {
      setStatus("ok", "API connected", "Search, web agent and web context are available.");
    }
  } catch {
    setStatus("off", "API offline", `No API at ${API_BASE || location.origin}. The recorded run still works.`);
  }
}

checkHealth();

// --- toasts ---------------------------------------------------------------------

let toastTimer = null;

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
