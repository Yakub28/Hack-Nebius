"use strict";
// Snowball UI: resolve the seeds, start a run, follow its events, render evidence cards. No build step.

const STAGE_LABELS = {
  resolve: "Reading your papers",
  rubric: "Nemotron 3 Super: what we're looking for",
  citations: "Citations",
  cocited: "Co-cited",
  similar: "PubMed similar",
  search: "Search",
  web: "Web",
  keyword_check: "Keyword check",
  merge: "Combining",
  enrich: "Records, metrics and retraction checks",
  embed: "Measuring meaning",
  screen: "Nemotron 3.5 Lightning screening",
  explain: "Nemotron 3 Super explaining",
};
const LEFT_OUT = {
  seed: "Already one of your papers",
  duplicate: "Duplicate version",
  retracted: "Retracted",
  not_article: "Not a research article",
  outside_dates: "Outside your dates",
  excluded_preprint: "Preprint (you excluded preprints)",
  below_cutoff: "Ranked below the top 150",
  graded_0: "Graded not relevant",
  no_record: "No retrievable record",
};
const GRADE_NAMES = { 3: "Direct", 2: "Relevant", 1: "Related", 0: "Not relevant" };
const EXAMPLE = {
  seeds: "33567185\n10.1056/NEJMoa2206038\nOnce-Weekly Semaglutide in Adolescents with Obesity",
  question: "Do incretin-based drugs reduce body weight in people with obesity?",
};

const state = { run: null, source: null, timer: null, types: new Set() };

// --- start a run ---------------------------------------------------------------

$("example").addEventListener("click", () => {
  $("seeds").value = EXAMPLE.seeds;
  $("question").value = EXAMPLE.question;
  $("seeds").focus();
});

$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const lines = $("seeds").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return showError("Paste at least one paper: a PMID, DOI, link or title.");
  store("snowball:last", { seeds: $("seeds").value, question: $("question").value });
  $("submit").disabled = true;
  try {
    const checked = await api("/api/seeds/resolve", { lines });
    renderSeedCheck(checked);
    if (checked.some((r) => r.status === "choose")) return;
    const seeds = checked.filter((r) => r.status === "found" && !r.note).map((r) => r.seed.id);
    if (!seeds.length) return showError("None of your papers could be found. Check the DOIs or PMIDs, or paste the titles.");
    const { runId } = await api("/api/runs", { seeds, question: $("question").value.trim() || null, options: options() });
    follow(runId);
  } catch (err) {
    showError(err.message);
  } finally {
    $("submit").disabled = false;
  }
});

function options() {
  const year = (id) => ($(id).value ? Number($(id).value) : null);
  return { yearFrom: year("year-from"), yearTo: year("year-to"),
           includePreprints: $("preprints").checked, before: $("before").value || null };
}

async function api(path, body) {
  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach the API at ${API_BASE || location.origin}. Is it running?`);
  }
  const payload = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(errorDetail(payload) || `HTTP ${resp.status}`);
  return payload;
}

function errorDetail(payload) {
  const detail = payload && payload.detail;
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  return detail.map((d) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; ");
}

function renderSeedCheck(checked) {
  const list = $("seed-check");
  list.hidden = false;
  let n = 0;
  list.innerHTML = checked.map((r, i) => {
    if (r.status === "found") {
      const label = r.note ? "" : `<span class="lbl">S${++n}</span>`;
      return `<li class="found">${label}<span>${esc(seedLine(r.seed))}</span>${r.note ? `<small>${esc(r.note)}</small>` : ""}</li>`;
    }
    if (r.status === "choose") {
      return `<li class="choose"><small>! ${esc(r.note)}</small>${r.options.map((p) =>
        `<button type="button" class="link" data-line="${i}" data-pick="${esc(p.pmid || p.doi)}">${esc(seedLine(p))}: ${esc(p.title)}</button>`).join("")}</li>`;
    }
    return `<li class="missing"><small>${esc(r.line)}: ${esc(r.note)}</small>
      <button type="button" class="link" data-line="${i}" data-remove>Remove</button></li>`;
  }).join("");
}

$("seed-check").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-line]");
  if (!button) return;
  const lines = $("seeds").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const i = Number(button.dataset.line);
  if (button.hasAttribute("data-remove")) lines.splice(i, 1);
  else lines[i] = button.dataset.pick;
  $("seeds").value = lines.join("\n");
  $("seed-check").hidden = true;
});

function seedLine(p) {
  const author = (p.authors && p.authors[0] || "").split(" ")[0];
  return [author, p.year, p.journal].filter(Boolean).join(" · ");
}

// --- follow a run --------------------------------------------------------------

function follow(runId) {
  if (state.source) state.source.close();
  state.run = { id: runId, seeds: [], stages: {}, rubric: null, results: [], funnel: null, leftOut: [] };
  state.types = new Set();
  history.replaceState(null, "", `?run=${runId}`);
  $("empty").hidden = true;
  $("results").hidden = true;
  $("context").hidden = true;
  $("progress").hidden = false;
  $("stages").innerHTML = "";
  startClock();

  const source = new EventSource(`${API_BASE}/api/runs/${runId}/events`);
  state.source = source;
  const on = (name, handler) => source.addEventListener(name, (e) => handler(JSON.parse(e.data)));
  on("seeds", (d) => { state.run.seeds = d.seeds; renderContext(); });
  on("stage", (d) => { state.run.stages[d.name] = d; renderStages(); });
  on("rubric", (d) => { state.run.rubric = d; renderContext(); });
  on("results", (d) => { Object.assign(state.run, d); renderResults(); });
  on("explained", (d) => {
    const r = state.run.results.find((x) => x.id === d.id);
    if (r) Object.assign(r, { grade: d.grade, relation: d.relation, reason: d.reason, abstain: d.abstain, gradedBy: "super" });
    renderResults();
  });
  on("done", () => { finish(); $("progress").hidden = true; renderResults(); });
  on("error", (d) => { finish(); showError(d.message); });
  source.onerror = async () => {
    // The stream dropped (proxy timeout, reload): fall back to the run's snapshot.
    if (source.readyState !== EventSource.CLOSED) return;
    finish();
    await loadSnapshot(runId);
  };
}

async function loadSnapshot(runId) {
  try {
    const resp = await fetch(`${API_BASE}/api/runs/${runId}`);
    if (!resp.ok) throw new Error((await resp.json()).detail);
    const snap = await resp.json();
    if (snap.status === "running") return follow(runId);
    state.run = { ...snap, stages: Object.fromEntries(snap.stages.map((s) => [s.name, s])) };
    $("empty").hidden = true;
    renderContext();
    renderResults();
  } catch (err) {
    showError(err.message);
  }
}

function finish() {
  if (state.source) state.source.close();
  state.source = null;
  clearInterval(state.timer);
}

function startClock() {
  clearInterval(state.timer);
  const started = performance.now();
  state.timer = setInterval(() => {
    $("elapsed").textContent = `${Math.floor((performance.now() - started) / 1000)} s`;
  }, 250);
}

function renderStages() {
  $("progress").hidden = false;
  $("stages").innerHTML = Object.keys(STAGE_LABELS).filter((name) => state.run.stages[name]).map((name) => {
    const s = state.run.stages[name];
    const count = s.count == null ? "" : s.note && s.note.startsWith("of ") ? `${s.count} ${s.note.replace("of", "/")}` : s.count;
    const time = s.ms == null ? "" : `${(s.ms / 1000).toFixed(1)} s`;
    const note = s.status === "unavailable" ? `<small>${esc(s.note || "Unavailable: results use the other channels")}</small>` : "";
    const cls = { done: "done", running: "active", unavailable: "off" }[s.status] || "";
    return `<li class="${cls}"><span>${esc(STAGE_LABELS[name])}</span><span class="mono">${esc(String(count))}</span>
      <span class="mono muted">${time}</span>${note}</li>`;
  }).join("");
}

function renderContext() {
  const run = state.run;
  if (!run.seeds.length) return;
  $("context").hidden = false;
  $("seed-list").innerHTML = run.seeds.map((s) => `
    <li><span class="lbl">${esc(s.label)}</span>
      <a class="t" href="${esc(firstLink(s))}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title)}</a></li>`).join("");
  const r = run.rubric;
  $("rubric").hidden = !r;
  if (!r) return;
  $("rubric-line").textContent = [r.population, r.intervention_or_exposure, r.comparison, (r.outcomes || []).join(", ")]
    .filter(Boolean).join(" · ");
  $("key-terms").innerHTML = (r.key_terms || []).map((t) =>
    `<li><b>${esc(t.term)}</b>${t.synonyms.length ? `: ${esc(t.synonyms.join(", "))}` : ""}</li>`).join("");
  $("queries").innerHTML = `<div class="qgroup"><h3>Searches</h3>${(r.queries || []).map((q) => `<code>${esc(q)}</code>`).join("")}</div>`;
}

// --- results -------------------------------------------------------------------

function renderResults() {
  const run = state.run;
  if (!run.funnel) return;
  $("results").hidden = false;
  const f = run.funnel;
  const leftTotal = run.leftOut.reduce((n, l) => n + l.count, 0);
  $("funnel").innerHTML = [`<strong>${f.found}</strong> found`, `<strong>${f.new}</strong> new`,
    `<strong>${f.screened}</strong> screened`, `<strong>${f.relevant}</strong> relevant + <strong>${f.related}</strong> related`]
    .map((p) => `<span class="pill">${p}</span>`).join("<span class='arrow'>→</span>");

  const retracted = run.leftOut.find((l) => l.reason === "retracted");
  $("retracted-line").hidden = !retracted;
  if (retracted) {
    $("retracted-line").textContent = `${retracted.count} retracted paper${retracted.count > 1 ? "s" : ""} found and left out` +
      (retracted.titles && retracted.titles.length ? `: ${retracted.titles.join("; ")}` : "");
  }
  $("grades-off").hidden = !run.gradesUnavailable;
  // Once the run is over, the funnel replaces the progress list; only gaps stay visible.
  const gaps = Object.values(run.stages).filter((st) => st.status === "unavailable" && st.name !== "screen");
  $("gaps").hidden = !gaps.length;
  $("gaps").textContent = gaps.map((st) => `${STAGE_LABELS[st.name]}: ${st.note}`).join(" · ");

  renderTypeFilter();
  const visible = visibleResults();
  const main = run.gradesUnavailable ? visible : visible.filter((r) => (r.grade || 0) >= 2);
  const related = run.gradesUnavailable ? [] : visible.filter((r) => r.grade === 1);
  $("cards").innerHTML = main.length ? main.map((r, i) => card(r, i + 1)).join("")
    : `<li class="none">Nothing relevant passed screening. Try more papers, a sharper question, or open Related.</li>`;
  $("related-section").hidden = !related.length;
  $("related-summary").textContent = `Related (${related.length})`;
  $("related").innerHTML = related.map((r, i) => card(r, i + 1)).join("");

  $("left-out").hidden = !leftTotal;
  $("left-out-summary").textContent = `Left out (${leftTotal})`;
  $("left-out-list").innerHTML = run.leftOut.map((l) =>
    `<li><b>${l.count}</b> ${esc(LEFT_OUT[l.reason] || l.reason)}</li>`).join("");
}

function renderTypeFilter() {
  const counts = {};
  state.run.results.forEach((r) => { counts[r.studyType] = (counts[r.studyType] || 0) + 1; });
  $("type-filter").innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
    `<button type="button" data-type="${esc(t)}" aria-pressed="${state.types.has(t)}">${esc(t)}<span class="n">${n}</span></button>`).join("");
}

$("type-filter").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-type]");
  if (!button) return;
  const t = button.dataset.type;
  if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
  renderResults();
});
["filter-text", "sort"].forEach((id) => $(id).addEventListener(id === "sort" ? "change" : "input", renderResults));

function visibleResults() {
  const text = $("filter-text").value.trim().toLowerCase();
  const list = state.run.results.filter((r) =>
    (!state.types.size || state.types.has(r.studyType)) &&
    (!text || [r.title, r.journal, r.authors.join(" ")].join(" ").toLowerCase().includes(text)));
  const sort = $("sort").value;
  if (sort === "newest") list.sort((a, b) => (b.date || String(b.year || "")).localeCompare(a.date || String(a.year || "")));
  if (sort === "links") list.sort((a, b) => seedLinks(b) - seedLinks(a) || b.score - a.score);
  return list;
}

function seedLinks(r) {
  return new Set(r.foundBy.filter((p) => ["citations", "cocited", "similar"].includes(p.channel)).map((p) => p.via)).size;
}

function card(r, rank) {
  const author = r.authors.length ? `${r.authors[0]}${r.authors.length > 1 ? " et al." : ""}` : "";
  const meta = [
    esc(author), r.journal ? `<span class="venue">${esc(r.journal)}</span>` : "",
    `<span class="chip">${esc(r.studyType)}</span>`,
    r.isPreprint ? `<span class="chip warn">Preprint</span>` : "",
    r.oaUrl ? `<a href="${esc(r.oaUrl)}" target="_blank" rel="noopener">PDF</a>` : "",
    gradeChip(r.grade),
  ].filter(Boolean).join(" · ");
  const why = r.abstain ? `<span class="muted">Too little to judge from the abstract</span>`
    : r.reason ? `<b>${esc(r.relation)}:</b> ${seedMarks(r.reason)}`
    : r.reasonShort ? esc(r.reasonShort) : "";
  const links = Object.entries(r.links || {}).map(([name, url]) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener">${esc({ pubmed: "PubMed", doi: "DOI", pmc: "PMC" }[name] || name)}</a>`).join("");
  return `<li class="card">
    <div class="grade ${gradeClass(r.grade)}" title="${r.grade == null ? "Not screened" : `Graded ${r.grade} of 3`}">
      <b>${rank}</b><small>${r.year || ""}</small>
    </div>
    <div>
      <h3><a href="${esc(firstLink(r))}" target="_blank" rel="noopener">${esc(r.title)}</a></h3>
      <div class="meta">${meta}</div>
      ${why ? `<p class="reason"><span class="k">Why it's here</span> ${why}</p>` : ""}
      ${r.quote ? `<blockquote class="quote">“${esc(r.quote.text)}”<span class="tag">✓ Verbatim from the abstract</span></blockquote>` : ""}
      <div class="chips">${r.chips.map((c) => `<span class="chip accent">${seedMarks(c)}</span>`).join("")}</div>
      <div class="card-foot">
        <div class="links">${links}</div>
        <button type="button" class="toggle" data-panel="detail" aria-expanded="false">Details</button>
      </div>
      <div class="panel-detail" hidden>${detail(r)}</div>
    </div>
  </li>`;
}

function detail(r) {
  const match = r.match ? `<ul class="why">${Object.entries(r.match).map(([k, v]) =>
    `<li>${esc(k[0].toUpperCase() + k.slice(1))}: <b>${esc(v)}</b></li>`).join("")}</ul>` : "";
  const parts = r.scoreParts.map((p) => `<li><span class="mono">${p.value.toFixed(2)}</span> <b>${esc(p.name)}</b>
    <span class="bar" style="--w:${Math.round((p.value / 0.35) * 100)}%"></span> ${seedMarks(p.sentence)}</li>`).join("");
  const facts = [
    r.citedBy != null ? `${r.citedBy} citations` : "",
    r.rcr != null ? `RCR ${r.rcr.toFixed(1)}` : "",
    r.hac ? `human ${Math.round(r.hac.human * 100)}% · animal ${Math.round(r.hac.animal * 100)}% · cell ${Math.round(r.hac.cell * 100)}%` : "",
    r.clinicalCitations ? `${r.clinicalCitations} clinical citations` : "",
    r.preprintOf ? `Also a preprint: ${r.preprintOf}` : "",
    r.mesh.length ? `MeSH: ${r.mesh.slice(0, 5).join(", ")}` : "",
  ].filter(Boolean).map((f) => `<span class="chip">${esc(f)}</span>`).join("");
  const web = r.foundBy.filter((p) => p.url).map((p) =>
    `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.urlTitle || p.url)}</a></li>`).join("");
  const searches = [...new Set(r.foundBy.filter((p) => p.channel === "search").map((p) => p.via))]
    .map((q) => `<li>Search: ${esc(q)}</li>`).join("");
  return `<p class="score"><b>Score ${r.score.toFixed(2)}</b></p><ul class="score-parts">${parts}</ul>
    ${match ? `<h4>Fit with what you're looking for</h4>${match}` : ""}
    <div class="chips">${facts}</div>
    ${web || searches ? `<h4>Found on</h4><ul class="why">${web}${searches}</ul>` : ""}
    ${r.abstract ? `<h4>Abstract</h4><p class="abstract">${highlight(r.abstract, r.quote && r.quote.text)}</p>` : "<p class='muted'>No abstract available: judged on the title.</p>"}`;
}

$("cards").addEventListener("click", toggleDetail);
$("related").addEventListener("click", toggleDetail);

function toggleDetail(event) {
  const button = event.target.closest("button.toggle");
  if (!button) return;
  const panel = button.closest(".card").querySelector(".panel-detail");
  panel.hidden = !panel.hidden;
  button.setAttribute("aria-expanded", String(!panel.hidden));
}

function highlight(abstract, quote) {
  const text = esc(abstract);
  if (!quote) return text;
  const q = esc(quote);
  return text.includes(q) ? text.replace(q, `<mark>${q}</mark>`) : text;
}

function seedMarks(text) {
  return esc(text).replace(/\bS(\d+)\b/g, (m, n) => {
    const seed = state.run.seeds.find((s) => s.label === m);
    return `<span class="lbl" title="${esc(seed ? seed.title : "")}">${m}</span>`;
  });
}

function gradeChip(grade) {
  if (grade == null) return "";
  return `<span class="chip ${grade === 3 ? "ok" : grade === 2 ? "accent" : ""}">${GRADE_NAMES[grade]}</span>`;
}

function gradeClass(g) {
  return g === 3 ? "g4" : g === 2 ? "g3" : g === 1 ? "g2" : "";
}

function firstLink(p) {
  const links = p.links || {};
  return links.pubmed || links.doi || links.pmc || "#";
}

function showError(message) {
  $("error").textContent = message;
  $("error").hidden = false;
}

function hideError() {
  $("error").hidden = true;
}

// --- export --------------------------------------------------------------------

async function exportAs(format) {
  try {
    const resp = await fetch(`${API_BASE}/api/export`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: state.run.id, ids: visibleResults().map((r) => r.id), format }),
    });
    if (!resp.ok) throw new Error(errorDetail(await resp.json().catch(() => null)) || `HTTP ${resp.status}`);
    const url = URL.createObjectURL(await resp.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `snowball-${state.run.id}.${format}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showError(`Export failed: ${err.message}`);
  }
}

$("export-ris").addEventListener("click", () => exportAs("ris"));
$("export-csv").addEventListener("click", () => exportAs("csv"));

// --- start ---------------------------------------------------------------------

const last = store("snowball:last");
if (last) {
  $("seeds").value = last.seeds || "";
  $("question").value = last.question || "";
}
const reopen = new URLSearchParams(location.search).get("run");
if (reopen) loadSnapshot(reopen);
