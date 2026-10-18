"use strict";
// Shared by the landing page and the search page: API location, theme toggle, API status.

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

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("theme-toggle").textContent = dark ? "Light" : "Dark";
}

$("theme-toggle").addEventListener("click", () => {
  const dark = $("theme-toggle").textContent === "Light";
  const next = dark ? "light" : "dark";
  store("pd:theme", next);
  applyTheme(next);
});
applyTheme(store("pd:theme"));

// --- API status ---------------------------------------------------------------

async function checkHealth() {
  const pill = $("api-status");
  try {
    const resp = await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(resp.status);
    const status = await resp.json();
    if (!status.nebius) {
      pill.className = "pill off";
      pill.lastElementChild.textContent = "API up · no Nebius key";
      pill.title = "Set NEBIUS_API_KEY on the server: it runs the embeddings and Nemotron.";
      return;
    }
    pill.className = "pill ok";
    pill.lastElementChild.textContent = "API connected";
  } catch {
    pill.className = "pill off";
    pill.lastElementChild.textContent = "API offline";
  }
}

checkHealth();
