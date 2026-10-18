"use strict";
// Paper Discovery UI: one POST /discover, rendered as ranked, traceable cards. No build step.

const CHANNELS = {
  similar: ["PubMed similar", "PubMed's own nearest neighbours of a seed"],
  cites: ["Cites a seed", "Newer work that cites your seeds"],
  refs: ["Cited by a seed", "Earlier work your seeds build on"],
  cocited: ["Co-cited", "Cited together with your seeds by the same papers"],
  query: ["PubMed search", "LLM-written PubMed queries"],
  preprint: ["Preprint", "bioRxiv / medRxiv via Europe PMC"],
  web: ["Web (Tavily)", "Found by the web search agent, resolved to a PubMed or Europe PMC record"],
};
const GRADES = { 4: "Direct", 3: "High", 2: "Partial", 1: "Tangent", 0: "No" };
// Rough per-stage durations (s) from typical runs; the API reports the real ones at the end.
const STAGES = [
  ["resolve", "Resolving seeds in PubMed", 2],
  ["plan", "Planning criteria and queries", 6],
  ["graph", "Mapping the seeds' citations", 5],
  ["candidates", "Searching 7 channels, web agent included", 12],
  ["hydrate", "Fetching records and metrics", 5],
  ["first_stage", "Embedding and fusing signals", 5],
  ["judge", "LLM grading candidates", 30],
  ["context", "Web context and the results map", 5],
];
const EXAMPLE = {
  question: "Which incretin-based drugs reduce body weight in adults with obesity?",
  seeds: "33567185\nTirzepatide Once Weekly for the Treatment of Obesity",
};

const state = {
  data: null, sample: false, channels: new Set(), themes: new Set(), controller: null,
  view: "list", selected: null,
};

// --- small helpers ------------------------------------------------------------

function authors(list) {
  if (!list || !list.length) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} et al.` : list.join(", ");
}

function firstLink(p) {
  const links = p.links || {};
  return links.pubmed || links.doi || links.europepmc || "#";
}

// Hrefs that came from a search engine: only plain web links are rendered as links.
function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "#";
}

function gradeClass(g) {
  return g === 4 ? "g4" : g === 3 ? "g3" : g === 2 ? "g2" : "";
}

// --- form ---------------------------------------------------------------------

function restoreForm() {
  const last = store("pd:last");
  if (!last) return;
  $("question").value = last.question || "";
  $("seeds").value = last.seeds || "";
  if (last.limit) $("limit").value = String(last.limit);
}

$("example").addEventListener("click", () => {
  $("question").value = EXAMPLE.question;
  $("seeds").value = EXAMPLE.seeds;
  $("question").focus();
});

$("sample").addEventListener("click", async () => {
  hideError();
  try {
    const resp = await fetch("sample.json");
    if (!resp.ok) throw new Error(`sample.json: HTTP ${resp.status}`);
    show(await resp.json(), true);
  } catch (err) {
    showError(`Could not load the sample: ${err.message}`);
  }
});

// --- collection import ----------------------------------------------------------

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (file) importCollection(file);
});
const seedsBox = $("seeds");
seedsBox.addEventListener("dragover", (event) => {
  if (![...event.dataTransfer.types].includes("Files")) return;
  event.preventDefault();
  seedsBox.classList.add("drop");
});
seedsBox.addEventListener("dragleave", () => seedsBox.classList.remove("drop"));
seedsBox.addEventListener("drop", (event) => {
  seedsBox.classList.remove("drop");
  const [file] = event.dataTransfer.files;
  if (!file) return;
  event.preventDefault();
  importCollection(file);
});

async function importCollection(file) {
  hideError();
  const note = $("import-note");
  note.hidden = true;
  if (file.size > 5e6) {
    showError(`${file.name} is over 5 MB. Export only the papers you want as seeds.`);
    return;
  }
  try {
    const resp = await fetch(`${API_BASE}/collection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: await file.text() }),
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(errorDetail(payload) || `HTTP ${resp.status}`);
    const kept = payload.refs.slice(0, payload.max_seeds);
    $("seeds").value = kept.join("\n");
    const parts = [`Imported ${kept.length} paper${kept.length === 1 ? "" : "s"} from ${file.name} (${payload.format}).`];
    if (payload.refs.length > kept.length) {
      parts.push(`A search takes up to ${payload.max_seeds} seeds, so the first ${payload.max_seeds} of ${
        payload.refs.length} are in the box; edit it to choose others.`);
    }
    if (payload.without_id) {
      parts.push(`${payload.without_id} entr${payload.without_id === 1 ? "y has" : "ies have"} no PMID, DOI or title and ${
        payload.without_id === 1 ? "was" : "were"} skipped.`);
    }
    note.textContent = parts.join(" ");
    note.hidden = false;
  } catch (err) {
    if (err instanceof TypeError) showError(`Could not reach the API at ${API_BASE || location.origin}. Is it running?`);
    else showError(`Could not import ${file.name}: ${err.message}`);
  }
}

// --- search -----------------------------------------------------------------------

$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("question").value.trim();
  const seedsText = $("seeds").value;
  const seeds = seedsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const limit = Number($("limit").value);
  if (question.length < 3 || !seeds.length) {
    showError("Enter a question and at least one seed paper.");
    return;
  }
  store("pd:last", { question, seeds: seedsText, limit });
  await run({ question, seeds, limit });
});

$("cancel").addEventListener("click", () => state.controller && state.controller.abort());

async function run(body) {
  hideError();
  const controller = new AbortController();
  state.controller = controller;
  $("submit").disabled = true;
  $("submit").textContent = "Searching…";
  const stopProgress = startProgress();
  try {
    const resp = await fetch(`${API_BASE}/discover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(errorDetail(payload) || `HTTP ${resp.status}`);
    show(payload, false);
  } catch (err) {
    if (err.name === "AbortError") showError("Search cancelled.");
    else if (err instanceof TypeError) showError(`Could not reach the API at ${API_BASE || location.origin}. Is it running?`);
    else showError(err.message);
  } finally {
    stopProgress();
    state.controller = null;
    $("submit").disabled = false;
    $("submit").textContent = "Discover";
  }
}

function errorDetail(payload) {
  const detail = payload && payload.detail;
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; ");
  return JSON.stringify(detail);
}

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

function hideError() {
  $("error").hidden = true;
}

// --- progress -----------------------------------------------------------------

function startProgress() {
  const list = $("stages");
  list.innerHTML = STAGES.map(([key, label]) => `<li data-stage="${key}">${esc(label)}</li>`).join("");
  $("progress").hidden = false;
  const started = performance.now();
  const ends = [];
  STAGES.reduce((total, stage) => { ends.push(total + stage[2]); return total + stage[2]; }, 0);
  const tick = () => {
    const s = (performance.now() - started) / 1000;
    $("elapsed").textContent = `${Math.floor(s)} s`;
    // The last stage stays active until the response arrives, however long it takes.
    const next = ends.findIndex((end) => s < end);
    const current = next === -1 ? STAGES.length - 1 : next;
    [...list.children].forEach((li, i) => {
      li.className = i < current ? "done" : i === current ? "active" : "";
    });
  };
  tick();
  const timer = setInterval(tick, 250);
  return () => {
    clearInterval(timer);
    $("progress").hidden = true;
  };
}

// --- results ------------------------------------------------------------------

function show(data, sample) {
  state.data = data;
  state.sample = sample;
  state.channels = new Set();
  state.themes = new Set();
  state.selected = null;
  $("empty").hidden = true;
  $("results").hidden = false;
  $("sample-banner").hidden = !sample;
  $("sample-banner").innerHTML = data.recorded
    ? `<strong>Recorded run</strong> from ${esc(data.recorded)}: real engine output, saved so this page opens instantly
      and without an API key. Run a search for live results.`
    : `<strong>Sample data</strong>: placeholder grades and reasons, to preview the layout. Run a search for live results.`;
  $("filter-text").value = "";
  $("sort").value = "relevance";
  $("only-relevant").checked = false;
  renderContext(data);
  renderSummary(data);
  renderWarnings(data.warnings || []);
  renderChannelFilter(data.results);
  renderThemeFilter(data);
  setView(data.map ? state.view : "list");
  // On narrow screens the results sit below the form: bring them into view.
  if ($("main").getBoundingClientRect().top > innerHeight * 0.6) {
    $("main").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderContext(data) {
  $("context").hidden = false;
  $("seed-list").innerHTML = data.seeds.map((s) => `
    <li>
      <span class="lbl">${esc(s.label)}</span>
      <a class="t" href="${esc(firstLink(s))}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title)}</a>
      ${gradeChip(s.grade)}
    </li>`).join("");
  $("cutoff-note").textContent = data.cutoff == null
    ? "The seeds could not be graded, so there is no relevance line for this search."
    : `Your seeds graded ${data.cutoff} or higher under the same prompt. Results at or above ${data.cutoff} are marked "likely relevant".`;
  $("criteria").innerHTML = (data.criteria || []).map((c) => `<li>${esc(c)}</li>`).join("");
  const trail = data.web_trail || [];
  const groups = { pubmed_queries: "PubMed", preprint_queries: "Preprints" };
  if (!trail.length) groups.web_queries = "Web";
  $("queries").innerHTML = Object.entries(groups)
    .filter(([key]) => (data.queries || {})[key] && data.queries[key].length)
    .map(([key, title]) => `<div class="qgroup"><h3>${title}</h3>${
      data.queries[key].map((q) => `<code>${esc(q)}</code>`).join("")}</div>`).join("")
    + trail.map((t) => `<div class="qgroup"><h3>Web agent · round ${t.round}</h3>${
      t.searches.map((q) => `<code>${esc(q)}</code>`).join("")}${
      t.why ? `<p class="qwhy">${esc(t.why)}</p>` : ""}${
      t.searches.length ? `<p class="qwhy">${t.pages} pages read · ${t.papers} tied to a paper record</p>` : ""}</div>`).join("");
}

function gradeChip(grade) {
  if (grade == null) return `<span class="chip">ungraded</span>`;
  const cls = grade >= 3 ? "ok" : grade === 2 ? "warn" : "";
  return `<span class="chip ${cls}">${grade} · ${GRADES[grade]}</span>`;
}

function renderSummary(data) {
  const results = data.results;
  const relevant = results.filter((r) => r.likely_relevant).length;
  const stats = data.stats || {};
  const total = Object.values(data.timings || {}).reduce((a, b) => a + b, 0);
  const pills = [
    `<strong>${results.length}</strong> results`,
    data.cutoff == null ? null : `<strong>${relevant}</strong> likely relevant`,
    stats.pool == null ? null : `<strong>${stats.pool.toLocaleString()}</strong> candidates screened`,
    stats.judged == null ? null : `<strong>${stats.judged}</strong> graded by LLM`,
    total ? `<strong>${Math.round(total)} s</strong>` : null,
  ].filter(Boolean);
  $("summary").innerHTML = pills.map((p) => `<span class="pill">${p}</span>`).join("");
}

function renderWarnings(warnings) {
  const box = $("warnings");
  box.hidden = !warnings.length;
  if (!warnings.length) return;
  box.querySelector("summary").textContent =
    `${warnings.length} warning${warnings.length > 1 ? "s" : ""}: some sources were incomplete`;
  box.querySelector("ul").innerHTML = warnings.map((w) => `<li>${esc(w)}</li>`).join("");
}

function renderChannelFilter(results) {
  const counts = {};
  results.forEach((r) => r.channels.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
  $("channel-filter").innerHTML = `<span class="row-label">Found via</span>` + Object.keys(CHANNELS)
    .filter((c) => counts[c])
    .map((c) => `<button type="button" data-channel="${c}" aria-pressed="false" title="${esc(CHANNELS[c][1])}">${
      esc(CHANNELS[c][0])}<span class="n">${counts[c]}</span></button>`).join("");
}

function themeDot(id) {
  return `<span class="dot" style="background: var(--t${Number(id)})"></span>`;
}

function themeName(id) {
  const theme = ((state.data.map || {}).themes || []).find((t) => t.id === id);
  return theme ? theme.name : "";
}

function renderThemeFilter(data) {
  const themes = (data.map && data.map.themes) || [];
  $("theme-filter").hidden = !themes.length;
  $("theme-filter").innerHTML = `<span class="row-label">Themes</span>` + themes.map((t) =>
    `<button type="button" data-theme="${t.id}" aria-pressed="false" title="Named by ${esc(t.named_by)}">${
      themeDot(t.id)}${esc(t.name)}<span class="n">${t.size}</span></button>`).join("");
}

$("theme-filter").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-theme]");
  if (!button) return;
  const theme = Number(button.dataset.theme);
  const on = !state.themes.has(theme);
  if (on) state.themes.add(theme); else state.themes.delete(theme);
  button.setAttribute("aria-pressed", String(on));
  render();
});

$("channel-filter").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  if (!button) return;
  const channel = button.dataset.channel;
  const on = !state.channels.has(channel);
  if (on) state.channels.add(channel); else state.channels.delete(channel);
  button.setAttribute("aria-pressed", String(on));
  render();
});
function togglePanel(event) {
  const button = event.target.closest("button.toggle");
  if (!button) return;
  const panel = button.closest(".card").querySelector(`.panel-${button.dataset.panel}`);
  panel.hidden = !panel.hidden;
  button.setAttribute("aria-expanded", String(!panel.hidden));
}
$("cards").addEventListener("click", togglePanel);
$("map-detail").addEventListener("click", togglePanel);
["filter-text", "sort", "only-relevant"].forEach((id) =>
  $(id).addEventListener(id === "filter-text" ? "input" : "change", render));

function visibleResults() {
  if (!state.data) return [];
  const text = $("filter-text").value.trim().toLowerCase();
  const onlyRelevant = $("only-relevant").checked;
  const list = state.data.results.filter((r) => {
    if (onlyRelevant && !r.likely_relevant) return false;
    if (state.channels.size && !r.channels.some((c) => state.channels.has(c))) return false;
    if (state.themes.size && !state.themes.has(r.theme)) return false;
    if (!text) return true;
    return [r.title, r.venue, r.authors.join(" "), r.abstract].join(" ").toLowerCase().includes(text);
  });
  const sort = $("sort").value;
  if (sort === "newest") list.sort((a, b) => (b.year || 0) - (a.year || 0));
  if (sort === "cited") list.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  return list;
}

function renderCards() {
  const data = state.data;
  const list = visibleResults();
  const cards = $("cards");
  if (!list.length) {
    cards.innerHTML = `<li class="none">No results match these filters.</li>`;
    return;
  }
  const byRelevance = $("sort").value === "relevance" && data.cutoff != null;
  const parts = [];
  let lineDrawn = false;
  list.forEach((r, i) => {
    if (byRelevance && !lineDrawn && !r.likely_relevant) {
      lineDrawn = true;
      parts.push(`<li class="cutline">${i === 0
        ? "No result reached your seeds' grade"
        : `Below: graded lower than your weakest seed (${data.cutoff})`}</li>`);
    }
    parts.push(card(r, data));
  });
  cards.innerHTML = parts.join("");
}

function card(r, data) {
  const g = r.grade;
  const sources = r.sources || [];
  const relevantLabel = r.likely_relevant ? `<span class="chip ok">Likely relevant</span>` : "";
  const seedLinks = [
    r.cites_seeds.length ? `<span class="chip accent"><span class="k">cites</span> ${r.cites_seeds.join(", ")}</span>` : "",
    r.cited_by_seeds.length ? `<span class="chip accent"><span class="k">cited by</span> ${r.cited_by_seeds.join(", ")}</span>` : "",
    r.nearest_seed ? `<span class="chip" title="Cosine similarity of the embeddings"><span class="k">closest to</span> ${
      esc(r.nearest_seed.label)} · ${r.nearest_seed.similarity.toFixed(2)}</span>` : "",
  ].join("");
  const channels = r.channels.map((c) =>
    `<span class="chip" title="${esc((CHANNELS[c] || [c, ""])[1])}">${esc((CHANNELS[c] || [c])[0])}</span>`).join("");
  const facts = [
    r.preprint ? `<span class="chip warn">Preprint</span>` : "",
    ...(r.types || []).filter((t) => t !== "Journal Article").slice(0, 2).map((t) => `<span class="chip">${esc(t)}</span>`),
    r.citations != null ? `<span class="chip"><span class="k">citations</span> ${r.citations}</span>` : "",
    r.rcr != null ? `<span class="chip" title="NIH Relative Citation Ratio: 1.0 is the field average"><span class="k">RCR</span> ${r.rcr.toFixed(1)}</span>` : "",
    ...sources.filter((x) => x.via === "abstract").map((x) =>
      `<span class="chip" title="Trial registration quoted in the abstract"><span class="k">trial</span> ${esc(x.title)}</span>`),
  ].join("");
  const links = Object.entries(r.links || {}).map(([name, url]) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener">${esc({ pubmed: "PubMed", doi: "DOI", europepmc: "Europe PMC" }[name] || name)}</a>`).join("");
  const s = r.scores || {};
  const meta = [authors(r.authors), r.venue ? `<span class="venue">${esc(r.venue)}</span>` : "", r.year || ""]
    .filter(Boolean).map((x, i) => (i === 1 ? x : esc(x))).join(" · ");

  return `<li class="card${data.cutoff != null && !r.likely_relevant ? " below" : ""}">
    <div class="grade ${gradeClass(g)}" title="${g == null ? "Not graded: ranked by retrieval signals only" : `LLM grade ${g} of 4`}">
      <b>${g == null ? "–" : g}</b><small>${g == null ? "unjudged" : GRADES[g]}</small>
    </div>
    <div>
      <h3><a href="${esc(firstLink(r))}" target="_blank" rel="noopener">${esc(r.title)}</a></h3>
      <div class="meta">${meta}</div>
      ${r.reason ? `<p class="reason">${esc(r.reason)}</p>` : ""}
      ${r.quote ? `<blockquote class="quote">“${esc(r.quote)}”<span class="tag">✓ Verbatim from the abstract</span></blockquote>` : ""}
      <div class="chips">${relevantLabel}${r.theme != null && themeName(r.theme)
        ? `<span class="chip" title="Theme on the map">${themeDot(r.theme)}${esc(themeName(r.theme))}</span>` : ""}${seedLinks}${facts}</div>
      <div class="chips">${channels}</div>
      <div class="card-foot">
        <div class="links">${links}</div>
        <button type="button" class="toggle" data-panel="why" aria-expanded="false">Why it was found</button>
        ${sources.length ? `<button type="button" class="toggle" data-panel="context" aria-expanded="false">Web context · ${sources.length}</button>` : ""}
        ${r.abstract ? `<button type="button" class="toggle" data-panel="abstract" aria-expanded="false">Abstract</button>` : ""}
      </div>
      <div class="panel-why" hidden>
        <ul class="why">${r.found_via.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <div class="scores">
          <span class="chip"><span class="k">fused</span> ${(s.fused ?? 0).toFixed(4)}</span>
          <span class="chip"><span class="k">seed sim</span> ${(s.seed_similarity ?? 0).toFixed(2)}</span>
          <span class="chip"><span class="k">question sim</span> ${(s.question_similarity ?? 0).toFixed(2)}</span>
          ${s.cocited ? `<span class="chip"><span class="k">co-cited</span> ${s.cocited}</span>` : ""}
          ${s.shared_references ? `<span class="chip"><span class="k">shared refs</span> ${s.shared_references}</span>` : ""}
        </div>
      </div>
      ${sources.length ? `<div class="panel-context" hidden>
        <ul class="sources">${sources.map((x) => `<li>
          <span class="chip">${esc(x.kind)}</span>
          <a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener nofollow">${esc(x.title)}</a><span class="dom">${esc(x.domain)}</span>
          ${x.snippet ? `<p>${esc(x.snippet)}</p>` : ""}
        </li>`).join("")}</ul>
        <p class="note">Pages about this paper, found by web search on its title, plus trial numbers its abstract quotes. Links to read, not claims about the paper.</p>
      </div>` : ""}
      ${r.abstract ? `<p class="abstract panel-abstract" hidden>${esc(r.abstract)}</p>` : ""}
    </div>
  </li>`;
}

// --- views: list and map ------------------------------------------------------------

$("view-switch").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button && !button.disabled) setView(button.dataset.view);
});

function setView(view) {
  state.view = view;
  const hasMap = !!(state.data && state.data.map);
  $("view-switch").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
    if (b.dataset.view === "map") {
      b.disabled = !hasMap;
      b.title = hasMap ? "" : "Too few results for a map";
    }
  });
  $("map").hidden = view !== "map";
  $("cards").hidden = view === "map";
  render();
}

function render() {
  if (state.view === "map") renderMap(); else renderCards();
}

const MAP_W = 1000;
const MAP_H = 560;
const MAP_PAD = 40;

function renderMap() {
  const data = state.data;
  const map = data.map;
  const at = (id) => {
    const p = map.points[id];
    return p && [MAP_PAD + p[0] * (MAP_W - 2 * MAP_PAD), MAP_PAD + (1 - p[1]) * (MAP_H - 2 * MAP_PAD)];
  };
  const visible = visibleResults().filter((r) => at(r.id));
  const seedIds = new Set(data.seeds.map((s) => s.id));
  const shown = new Set([...seedIds, ...visible.map((r) => r.id)]);

  // Every citation at once is a hairball: show the links to the seeds, and all of a paper's once it is selected.
  const edges = map.edges.filter((e) => shown.has(e.from) && shown.has(e.to)).map((e) => {
    const focus = state.selected && (e.from === state.selected || e.to === state.selected);
    if (!focus && !seedIds.has(e.from) && !seedIds.has(e.to)) return "";
    const [x1, y1] = at(e.from);
    const [x2, y2] = at(e.to);
    return `<line class="edge${focus ? " focus" : ""}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join("");

  const labels = (map.themes || []).map((t) => {
    const members = visible.filter((r) => r.theme === t.id).map((r) => at(r.id));
    if (!members.length) return "";
    const x = members.reduce((sum, p) => sum + p[0], 0) / members.length;
    const y = members.reduce((sum, p) => sum + p[1], 0) / members.length;
    return `<text class="theme-label" x="${x.toFixed(1)}" y="${(y - 14).toFixed(1)}" text-anchor="middle" style="fill: var(--t${t.id})">${esc(t.name)}</text>`;
  }).join("");

  const nodes = visible.map((r) => {
    const [x, y] = at(r.id);
    const radius = 4.5 + 1.8 * (r.grade ?? 0);
    const fill = r.theme == null ? "var(--g1)" : `var(--t${r.theme})`;
    const below = data.cutoff != null && !r.likely_relevant;
    const grade = r.grade == null ? "not graded" : `grade ${r.grade} · ${GRADES[r.grade]}`;
    return `<circle class="node${below ? " below" : ""}${r.id === state.selected ? " selected" : ""}" data-id="${esc(r.id)}"
      cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" style="fill: ${fill}" tabindex="0" role="button"
      aria-label="${esc(r.title)}, ${grade}"><title>${esc(r.title)} (${grade})</title></circle>`;
  }).join("");

  const seeds = data.seeds.filter((s) => at(s.id)).map((s) => {
    const [x, y] = at(s.id);
    return `<g class="seed"><path d="M${x} ${y - 9}L${x + 9} ${y}L${x} ${y + 9}L${x - 9} ${y}Z"><title>${esc(s.label)}: ${
      esc(s.title)}</title></path><text x="${x + 12}" y="${y + 5}">${esc(s.label)}</text></g>`;
  }).join("");

  $("map-svg").innerHTML = `<g>${edges}</g><g>${nodes}</g><g>${seeds}</g><g>${labels}</g>`;
  const namedBy = ((map.themes || [])[0] || {}).named_by;
  $("map-caption").textContent = [
    "Nearby papers have similar content (2D projection of the Qwen3 embeddings).",
    namedBy ? `Colour is the theme, named by ${namedBy === "llm" ? "the LLM from the titles" : "the most distinctive title words"}.` : "",
    "Size is the LLM grade, faded dots are below your seeds' grade, ◆ are your seeds, lines are citations of them.",
    visible.length ? "Click a paper to see its card and all its citations." : "No results match these filters.",
  ].filter(Boolean).join(" ");
  renderMapDetail();
}

function renderMapDetail() {
  const r = state.selected && visibleResults().find((x) => x.id === state.selected);
  $("map-detail").innerHTML = r ? card(r, state.data) : "";
}

function selectNode(target) {
  const node = target.closest("circle.node");
  if (!node) return;
  state.selected = node.dataset.id;
  renderMap();
  const again = $("map-svg").querySelector(`circle.node[data-id="${CSS.escape(state.selected)}"]`);
  if (again) again.focus({ preventScroll: true });
}

$("map-svg").addEventListener("click", (event) => selectNode(event.target));
$("map-svg").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  selectNode(event.target);
});

// --- export -------------------------------------------------------------------

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export-ris").addEventListener("click", () => {
  const records = visibleResults().map((r) => [
    `TY  - ${r.preprint ? "UNPB" : "JOUR"}`,
    `TI  - ${r.title}`,
    ...r.authors.map((a) => `AU  - ${a}`),
    r.year ? `PY  - ${r.year}` : "",
    r.venue ? `JO  - ${r.venue}` : "",
    r.doi ? `DO  - ${r.doi}` : "",
    r.pmid ? `AN  - PMID:${r.pmid}` : "",
    r.abstract ? `AB  - ${r.abstract.replace(/\s+/g, " ")}` : "",
    `UR  - ${firstLink(r)}`,
    r.grade != null ? `N1  - Grade ${r.grade}/4. ${r.reason || ""}` : "",
    "ER  - ",
  ].filter(Boolean).join("\r\n"));
  download("papers.ris", records.join("\r\n\r\n") + "\r\n", "application/x-research-info-systems");
});

$("export-csv").addEventListener("click", () => {
  const cols = ["rank", "grade", "likely_relevant", "title", "year", "venue", "authors", "doi", "pmid",
    "citations", "channels", "reason", "quote", "url"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = visibleResults().map((r, i) => [i + 1, r.grade, r.likely_relevant, r.title, r.year, r.venue,
    r.authors.join("; "), r.doi, r.pmid, r.citations, r.channels.join("; "), r.reason, r.quote, firstLink(r)]
    .map(cell).join(","));
  download("papers.csv", [cols.join(","), ...rows].join("\r\n"), "text/csv");
});

// --- start --------------------------------------------------------------------

$("legend").innerHTML = Object.values(CHANNELS)
  .map(([name, desc]) => `<span class="chip" title="${esc(desc)}">${esc(name)}</span>`).join("");
restoreForm();
// ?sample opens straight into the sample results: a fallback link for demos.
if (new URLSearchParams(location.search).has("sample")) {
  $("tab-search").removeAttribute("aria-current");
  $("tab-sample").setAttribute("aria-current", "page");
  $("sample").click();
}
