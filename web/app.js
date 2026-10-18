"use strict";
// Paper Discovery UI: one POST /discover, rendered as ranked, traceable cards. No build step.

const CHANNELS = {
  similar: ["PubMed similar", "PubMed's own nearest neighbours of a seed"],
  cites: ["Cites a seed", "Newer work that cites your seeds"],
  refs: ["Cited by a seed", "Earlier work your seeds build on"],
  cocited: ["Co-cited", "Cited together with your seeds by the same papers"],
  query: ["PubMed search", "LLM-written PubMed queries"],
  preprint: ["Preprint", "bioRxiv / medRxiv via Europe PMC"],
  web: ["Web (Tavily)", "Found on the web, resolved to a PubMed or DOI record"],
};
const GRADES = { 4: "Direct", 3: "High", 2: "Partial", 1: "Tangent", 0: "No" };
// Rough per-stage durations (s) from typical runs; the API reports the real ones at the end.
const STAGES = [
  ["resolve", "Resolving seeds in PubMed", 2],
  ["plan", "Planning criteria and queries", 6],
  ["graph", "Mapping the seeds' citations", 5],
  ["candidates", "Searching 7 channels", 8],
  ["hydrate", "Fetching records and metrics", 5],
  ["first_stage", "Embedding and fusing signals", 5],
  ["judge", "LLM grading candidates", 30],
];
const EXAMPLE = {
  question: "Which incretin-based drugs reduce body weight in adults with obesity?",
  seeds: "33567185\nTirzepatide Once Weekly for the Treatment of Obesity",
};

const state = { data: null, sample: false, channels: new Set(), controller: null };

// --- small helpers ------------------------------------------------------------

function authors(list) {
  if (!list || !list.length) return "";
  return list.length > 3 ? `${list.slice(0, 3).join(", ")} et al.` : list.join(", ");
}

function firstLink(p) {
  const links = p.links || {};
  return links.pubmed || links.doi || links.europepmc || "#";
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
  $("empty").hidden = true;
  $("results").hidden = false;
  $("sample-banner").hidden = !sample;
  $("filter-text").value = "";
  $("sort").value = "relevance";
  $("only-relevant").checked = false;
  renderContext(data);
  renderSummary(data);
  renderWarnings(data.warnings || []);
  renderChannelFilter(data.results);
  renderCards();
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
  const groups = { pubmed_queries: "PubMed", preprint_queries: "Preprints", web_queries: "Web" };
  $("queries").innerHTML = Object.entries(groups)
    .filter(([key]) => (data.queries || {})[key] && data.queries[key].length)
    .map(([key, title]) => `<div class="qgroup"><h3>${title}</h3>${
      data.queries[key].map((q) => `<code>${esc(q)}</code>`).join("")}</div>`).join("");
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
  $("channel-filter").innerHTML = Object.keys(CHANNELS)
    .filter((c) => counts[c])
    .map((c) => `<button type="button" data-channel="${c}" aria-pressed="false" title="${esc(CHANNELS[c][1])}">${
      esc(CHANNELS[c][0])}<span class="n">${counts[c]}</span></button>`).join("");
}

$("channel-filter").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  if (!button) return;
  const channel = button.dataset.channel;
  const on = !state.channels.has(channel);
  if (on) state.channels.add(channel); else state.channels.delete(channel);
  button.setAttribute("aria-pressed", String(on));
  renderCards();
});
$("cards").addEventListener("click", (event) => {
  const button = event.target.closest("button.toggle");
  if (!button) return;
  const panel = button.closest(".card").querySelector(`.panel-${button.dataset.panel}`);
  panel.hidden = !panel.hidden;
  button.setAttribute("aria-expanded", String(!panel.hidden));
});
["filter-text", "sort", "only-relevant"].forEach((id) =>
  $(id).addEventListener(id === "filter-text" ? "input" : "change", renderCards));

function visibleResults() {
  if (!state.data) return [];
  const text = $("filter-text").value.trim().toLowerCase();
  const onlyRelevant = $("only-relevant").checked;
  const list = state.data.results.filter((r) => {
    if (onlyRelevant && !r.likely_relevant) return false;
    if (state.channels.size && !r.channels.some((c) => state.channels.has(c))) return false;
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
      <div class="chips">${relevantLabel}${seedLinks}${facts}</div>
      <div class="chips">${channels}</div>
      <div class="card-foot">
        <div class="links">${links}</div>
        <button type="button" class="toggle" data-panel="why" aria-expanded="false">Why it was found</button>
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
      ${r.abstract ? `<p class="abstract panel-abstract" hidden>${esc(r.abstract)}</p>` : ""}
    </div>
  </li>`;
}

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
