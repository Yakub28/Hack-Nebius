"use strict";
// The landing page's "One recorded run" comes from sample.json, so it can never drift from the run it describes.
// The numbers in the HTML are a fallback for when the file cannot be read.

const LANDING_GRADES = { 4: "Direct", 3: "High", 2: "Partial", 1: "Tangent", 0: "No" };

(async () => {
  let data;
  try {
    const resp = await fetch("sample.json");
    if (!resp.ok) return;
    data = await resp.json();
  } catch {
    return;
  }
  const results = data.results || [];
  const stats = data.stats || {};
  const total = Object.values(data.timings || {}).reduce((a, b) => a + b, 0);
  const top = results.slice(0, 10);
  if (stats.pool != null) $("m-pool").textContent = stats.pool.toLocaleString();
  if (stats.judged != null) $("m-judged").textContent = stats.judged;
  $("m-top").textContent = `${top.filter((r) => r.grade === 4).length} / ${top.length}`;
  if (total) $("m-time").textContent = `${Math.round(total)} s`;
  if (data.recorded) $("run-date").textContent = `Recorded on ${data.recorded}, with ${results.length} results.`;

  const webOnly = results.filter((r) => r.channels.length === 1 && r.channels[0] === "web").length;
  $("top-list").innerHTML = results.slice(0, 3).map((r) => `<li>
      <span class="g">${r.grade ?? "–"} · ${esc(LANDING_GRADES[r.grade] || "Unjudged")}</span>
      <div><a href="app.html?sample">${esc(r.title)}</a>
        <p class="why">${esc([r.venue, r.year].filter(Boolean).join(" · "))}${
          r.found_via.length ? ` · found ${r.found_via.length} ways` : ""}</p></div>
    </li>`).join("") + (webOnly ? `<li><span class="g" style="visibility: hidden">0</span>
      <p class="why">…and ${webOnly} of the ${results.length} were found only by the web search agent.</p></li>` : "");
})();
