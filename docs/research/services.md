# External services for seed-based biomedical paper discovery

Verified 2026-10-18 from this machine. No keys for Nebius, Tavily, S2, OpenAlex or NCBI.

**Legend.** **LIVE** = probed today. **DOCS-ONLY** = official docs only (needs a key, or blocked today). **UNVERIFIED** = claimed somewhere, not confirmed.

**Seeds.**
- PMID 32015507 (Zhou, *Nature* 2020)
- PMID 31978945 (Zhu, *NEJM* 2020)
- PMID 29385370 (Maude, *NEJM* 2018, tisagenlecleucel CAR-T)
- PMID 33567185 (Wilding, *NEJM* 2021, STEP-1 semaglutide)

Scripts and raw outputs are in `research/probes/`. Downloaded docs are in `research/{nebius,tavily,cookbook}_dl/`.

---

## Top findings (assumption breakers)

1. **OpenAlex keyless is not a viable backend.** The keyless budget is $0.10/day per IP address, shared by everyone behind that IP. It was already spent on this IP. Every list, filter and search call returned `429` with `Retry-After: 46575` (about 13 h, until 00:00 UTC). Single-record lookups stay free. A free key gives $1/day.
2. **OpenAlex `related_works` is junk for biomedicine.** For the CAR-T trial it returned a choral concert, a university quality-of-education paper and Brazilian heart-transplant papers. Never use it.
3. **OpenAlex has no abstracts for Elsevier papers.** It had 0 of 5 (Lancet ×4, Cell), while S2 had 5 of 5. For Sep–Oct 2026 PubMed papers it had 7 of 12.
4. **S2 keyless is unusable in practice, but its recommendations endpoint is the best seed-to-new-papers tool.** At 1 req/s, 18 of 20 calls returned 429. `POST /recommendations/v1/papers` accepts `PMID:` IDs and returns up to 500 papers. Those are almost all from the current year: 2026-01-01 to 2026-10-31.
5. **PubMed "similar articles" is precise but skews old.** Of 174 neighbours for the CAR-T seed, 1 was from 2025 and none from 2026. It complements S2, it does not replace it.
6. **Nebius Token Factory has one embedding model (Qwen3-Embedding-8B, $0.01/M) and no listed reranker.** `/v1/rerank` exists, but its example model is not in the catalog. Llama is gone. The docs' example baseline rate limit is 60 RPM / 400K TPM.
7. **Tavily keyless works** for `/search` and `/extract` via the header `X-Tavily-Access-Mode: keyless`. Nebius agreed to acquire Tavily (announced 2026-02-10), which explains the required stack.
8. **The starter notebook `research-paper-discovery.ipynb` was not found anywhere public.** Ask the challenge owner (search details in §1.4).
9. **axiom has two real bugs:**
   - Its uncapped `Retry-After` handling would make it sleep about 13 h on OpenAlex's budget 429.
   - Its PubMed parser truncates 33% of abstracts.

---

## 1. Nebius Token Factory

### 1.1 Capabilities

| Capability | Status | Measured / limit | Notes |
|---|---|---|---|
| Base URL `https://api.tokenfactory.nebius.com/v1/` | LIVE | 401 without token, about 110 ms | Legacy `api.studio.nebius.com/v1` and `api.studio.nebius.ai/v1` also still answer 401. Use the new one. |
| OpenAI compatibility | DOCS-ONLY | spec version `20261015-7bb7e70f5` | Endpoints: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/responses`, `/v1/rerank` (vLLM-style), `/v1/models`, `/v1/files`, `/v1/fine_tuning/jobs`, `/v0/dedicated_endpoints`. |
| Public model catalog | LIVE, keyless | `GET https://tokenfactory.nebius.com/api/public/models_info`, 320 ms | 28 models: 19 text, 8 vision, 1 embedding, 0 rerankers. Authoritative per their README. |
| `logprobs` / `top_logprobs` | DOCS-ONLY | in the `ChatCompletionRequest` schema | Per-model support untested. On reasoning models, scores come after the thinking tokens unless `reasoning_effort` disables thinking. |
| Structured output | DOCS-ONLY, **docs conflict** | — | The JSON guide says `json_schema` and `json_object` work. The OpenAPI spec says only `json_object` or `text`. 8 models carry the "JSON mode" tag, but newer models have empty tags, so the tag is not conclusive. |
| Tool calling | DOCS-ONLY | — | 25 of 28 models have the `function_calling` use case. |
| Other request params | DOCS-ONLY | — | `reasoning_effort` (`none`…`max`). `n` ≤ 128. `service_tier`: `auto`, `default`, or `flex` (flex uses no rate-limit credit, runs at lower priority, may still 429). |
| Batch inference | `/v1/batches` LIVE (route exists) | `/v1/batches` gives 401; a fake path gives 404 | **Not in `openapi.json`.** The cookbook `batch.ipynb` uses `client.batches.create(..., completion_window="24h")`. The spec also has dataset-based `POST /v1/operations` (`batch_inference`, processed in eu-north1). The batch doc page the cookbook links returns 404. Batch price is UNVERIFIED. |
| Rate limits | DOCS-ONLY | example baseline **60 RPM / 400K TPM** | Dynamic: ×1.2 per 15-min window at ≥80% use, up to 20× base. Real defaults are shown in the console. Headers: `x-ratelimit-*`, `x-ratelimit-over-limit`. |
| Trial credit | DOCS-ONLY | $1, valid 30 days | Hackathon promo codes are the norm. |
| Region | DOCS-ONLY | public serverless region = "Global" and can change | Do not hard-code regional base URLs. Dedicated endpoints pin a region. |
| Deprecations | DOCS-ONLY | — | **2026-06-22:** Kimi-K2.5, DeepSeek-V3.2, GLM-5 and every `-fast` flavor removed. **2026-08-31:** Llama-3.3-70B, Qwen3-32B, DeepSeek-V4-Flash (→ `-0731`), Hermes-4-70B and others removed. The older embedding models (bge, e5) are no longer in the catalog. |

### 1.2 Model catalog (live, prices in USD per 1M tokens)

| Model ID | In / Out | Context | Catalog tok/s | Type | Tags |
|---|---|---|---|---|---|
| **Qwen/Qwen3-Embedding-8B** | 0.01 / – | 40,960 (tag says "32K") | – | embedding | retrieval, reranking, clustering. eu-north1 |
| Qwen/Qwen3-235B-A22B-Instruct-2507 | 0.20 / 0.60 | 262K | 27 | instruct (no thinking) | JSON mode |
| Qwen/Qwen3-30B-A3B-Instruct-2507 | 0.10 / 0.30 | 262K | 70 | instruct (no thinking) | JSON mode |
| deepseek-ai/DeepSeek-V4-Flash-0731 | 0.14 / 0.28 | 1.02M | 351 | reasoning | JSON mode, tools |
| nvidia/Nemotron-3_5-Lightning | 0.06 / 0.24 | 1.05M | 314 | reasoning | tools |
| nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B | 0.06 / 0.24 | 262K | 60 | reasoning | tools |
| nvidia/nemotron-3-super-120b-a12b | 0.30 / 0.90 | 262K | 127 | reasoning | tools |
| nvidia/Nemotron-3-Ultra-550b-a55b | 1.00 / 3.00 | 1.05M | 523 | reasoning | tools |
| openai/gpt-oss-120b | 0.15 / 0.60 | 131K | 40 | reasoning | JSON mode |
| Qwen/Qwen3.5-397B-A17B | 0.60 / 3.60 | 262K | 80 | reasoning | tools |
| MiniMaxAI/MiniMax-M3 | 0.30 / 1.20 | 1.05M | 248 | reasoning | tools |
| reflection/beam | 0.25 / 1.00 | 1.05M | 389 | reasoning | tools |
| zai-org/GLM-5.3 | 1.40 / 4.40 | 1.02M | 455 | reasoning | tools |
| zai-org/GLM-5.3-Flash (vision) | 0.15 / 0.50 | 1.02M | 349 | reasoning | tools |
| moonshotai/Kimi-K2.6 (vision) / Kimi-K3 (vision) | 0.95 / 4.00 · 3 / 15 | 262K · 1.02M | 60 · 264 | reasoning | tools |
| deepseek-ai/DeepSeek-V4-Pro / -0813 | 1.75 / 3.50 · 1.32 / 3.96 | about 1M | 24 · 37 | reasoning | tools |
| google/gemma-3-27b-it · NousResearch/Hermes-4-405B | 0.10 / 0.30 · 1 / 3 | 110K · 131K | 20 · 20 | instruct · hybrid reasoning | — · JSON mode |

- **Reranker:** none listed. The `/v1/rerank` spec example uses `Qwen/Qwen3-Reranker-8B` (UNVERIFIED that it is served).
- **Embedding dims:** the `dimensions` request parameter exists (spec examples 4096 and 8192). Qwen3-Embedding-8B is natively 4096-d, with Matryoshka down to 32 (model card, DOCS-ONLY).

### 1.3 Deploying on Nebius AI Cloud (DOCS-ONLY)

| Option | Effort | Cost | Notes |
|---|---|---|---|
| **Serverless AI endpoint** (recommended) | lowest | `cpu-d3` `4vcpu-16gb` ≈ $0.13/h at post-2026-10-01 prices (4×$0.015 + 16×$0.0045), billed per second, nothing while stopped | `nebius ai endpoint create --image <img> --platform cpu-d3 --preset 4vcpu-16gb --container-port 8000`. Managed HTTPS URL per HTTP port. `--auth` defaults to none (public UI); `--auth token` adds a bearer token. Images come from a public registry or Nebius Container Registry in the same project (no credentials needed). |
| Compute VM + Docker | low–medium | same vCPU/RAM rates | axiom already has `Dockerfile`, `Caddyfile` and `docker-compose.prod.yml`. You handle TLS and DNS. |
| Managed Kubernetes + Container Registry | high | cluster + nodes | Overkill for a hackathon. |

"UI/backend hosted separately from the model endpoint" is satisfied by Serverless endpoint (app) → Token Factory serverless API (models).

### 1.4 Starter notebook `research-paper-discovery.ipynb`: NOT FOUND

Where I searched:
- `nebius/token-factory-cookbook`: branches main, dev and incoming, plus 78 PRs. It has `batch.ipynb`, `rag/` and `integrations/tavily`, but nothing on paper discovery.
- All 60 recently pushed nebius-org repos (cookbooks, solutions-library, serverless-ai-cookbook, partner-cookbook).
- GitHub code search by filename.
- "Nebius hackathon" repos created this week.
- Web search.
- The event pages: Nebius Build Week Berlin is today (2026-10-18; briefing 10:00, submission 18:30). ODSC AI x Nebius is on 10-28.

It is almost certainly handed out at the challenge briefing or on the event Discord. **Ask the challenge owner for it; nothing in it can be summarized from here.**

---

## 2. Tavily

| Capability | Status | Measured / limit | Notes |
|---|---|---|---|
| Keyless mode | LIVE | 6 calls, no 429, no rate-limit headers | Header `X-Tavily-Access-Mode: keyless`. `/search` and `/extract` only. The cap is undocumented ("rate-limited"). |
| `POST /search` basic | LIVE | 1.4–1.8 s. With `include_domains`: 3.1–3.3 s | 1 credit. `max_results` 0–20 (default 10). |
| `POST /search` advanced | LIVE | 5.7 s | 2 credits. Multiple ~800-char chunks per source (`chunks_per_source`). |
| Other search params | DOCS + partly LIVE | — | `search_depth`: basic, advanced, fast, ultra-fast. `topic`: general, news, finance. `time_range`: day, week, month, year. `start_date` / `end_date`. **`filter_by_published_date`** (off by default, so undated results pass). `include_domains` (≤300) with `include_domains_mode`: restrict (default) or prefer. `exclude_domains` (≤150). `include_raw_content`: markdown or text. `include_answer`, `exact_match`, `country`, `auto_parameters`, `include_usage`. |
| `POST /extract` | LIVE | 0.5 s | 1 credit per 5 successful URLs; failures are free. PubMed page worked. **medRxiv and NEJM: "Failed to fetch url".** |
| `/map`, `/crawl` | DOCS-ONLY (key) | crawl: 100 RPM | Map: 1 credit per 10 pages. Crawl = map + extract cost. |
| `/research` | DOCS-ONLY (key) | 20 RPM | Async or streaming, takes `output_schema`. `mini`: 4–110 credits. `pro`: 15–250 credits. |
| Pricing | DOCS-ONLY | — | Free: 1,000 credits/month. Pay-as-you-go: $0.008/credit. Plans: $0.005–0.0075/credit. |
| Rate limits (keyed) | DOCS-ONLY | dev key 100 RPM, prod key 1,000 RPM | A prod key needs a paid plan or pay-as-you-go. |

### What Tavily adds (live evidence)

- **Find a paper from a description.** The STEP-1 trial described in words returned its PubMed record at rank 1 (score 0.87), plus a repository copy.
- **Preprints.** `include_domains=[biorxiv.org, medrxiv.org]` + `time_range=year` returned 2025–2026 medRxiv preprints (e.g. CART22.19 in pediatric B-ALL).
  - A 2024 bioRxiv paper slipped through, so set `filter_by_published_date=true`.
  - The same preprint comes back as `v1`, `.full` and `.full-text` URLs. Deduplicate by DOI.
  - 2026 medRxiv DOIs use a new prefix, `10.64898/…`.
- **Grey literature.** FDA clinical review, package insert and approval-summary PDFs, with `raw_content` of 54K–226K chars (a token-cost risk; truncate).
- **Trials.** Returns ClinicalTrials.gov protocol PDFs (NCT IDs can be extracted). The CT.gov API itself is better.
- **News** (`topic=news`) carries `published_date`. Useful for "what's new" context, not as paper records.
- **Limits.** No structured DOI/PMID fields, so URLs must be resolved through PubMed, S2 or Crossref. Publisher pages often fail to extract.

---

## 3. OpenAlex

| Capability | Status | Measured / limit | Notes |
|---|---|---|---|
| Auth and budget | LIVE | keyless $0.10/day per IP, **shared**, resets 00:00 UTC. **Exhausted here.** Free key: $1/day | Get a key at openalex.org/settings/api, or `POST /api-keys {"email":…}` and activate via the emailed link (calls 403 `key_not_activated` until then). |
| Cost per call | LIVE headers + docs | 1 credit = $0.0001 | Singleton GET: **free (cost 0 even with the budget exhausted)**. List/filter: 1 credit. Search: 10. `search.semantic`: 10. `rerank=true`: +10. `/text`: 100. PDF download: 100. |
| Request rate | DOCS-ONLY | 10 rps keyless, 30 rps with key; semantic search 1 rps | — |
| Paging | DOCS-ONLY | `per_page` max **100** (200 is deprecated legacy) | Basic paging stops at 10,000 results. **Cursor paging past page 1 needs a key** (401 otherwise). Up to 100 OR values per filter. |
| PMID / DOI singleton | LIVE | median 173 ms, p90 254 ms (n=54) | `/works/pmid:…`, `/works/doi:…`. |
| `referenced_works` | LIVE | 19 / 15 / 24 / 40 for the 4 seeds | About the best count among sources (STEP-1: OpenAlex 40, Europe PMC 41, OpenCitations 36, S2 elided, PubMed 0). |
| `related_works` | LIVE | 10 per work | **Off-topic junk** (see Top finding 2). |
| `cited_by_count` | LIVE | 21,925 / 28,224 / 5,698 / 5,119 | Highest counts of all sources. |
| `cites:` filter (forward citations) | DOCS-ONLY today (429) | 1 credit per page of 100 | — |
| Abstracts (`abstract_inverted_index`) | LIVE | seeds 4/4. Referenced works 25/30. Sep–Oct 2026 PubMed papers 7/12. **Elsevier 0/5** | Do not rely on it for abstracts. |
| Batch lookup (`filter=openalex:W1\|W2`, `doi:`, `pmid:`) | DOCS-ONLY today (429) | 1 credit per 100 IDs | — |
| Semantic search | DOCS-ONLY (429; header says 10 credits) | ≤50 results, 1 rps | `?search.semantic=` uses GTE-large 1024-d over title + abstract, input ≤2,000 chars. `/find/works` takes POST input up to 10,000 chars. Beta. |
| Concepts | DOCS-ONLY | — | Deprecated (MAG-era, unmaintained). Use `topics`. |

---

## 4. Semantic Scholar (S2)

| Capability | Status | Measured / limit | Notes |
|---|---|---|---|
| Keyless limits | LIVE | **18/20 calls returned 429 at 1 req/s.** 8/17 in a mixed run. Two lookups still failed after 7 retries (about 70 s) | 429 has **no `Retry-After`** (`x-amzn-errortype: TooManyRequestsException`). The docs claim "1000 rps shared among unauthenticated users". Reality: unusable without a key. |
| API key | DOCS-ONLY | introductory limit 1 RPS on all endpoints | Request form at semanticscholar.org/product/api, key sent by email. **Approval time UNVERIFIED** (no published SLA). Apply today. |
| `GET /paper/PMID:…` | LIVE | about 0.95 s median when it succeeds | `tldr` and abstract present for the seeds. |
| `POST /paper/batch` (≤500 IDs, mixed `PMID:` / `DOI:`) | LIVE | 1 call | Unknown IDs come back as `null`. **`embedding.specter_v2` (768-d) present 5/5**, `tldr` 5/5. |
| **`POST /recommendations/v1/papers`** | LIVE | 448 / 499 / 498 results with `limit=500`, 4–6 s | Takes `positivePaperIds` and `negativePaperIds`, accepts `PMID:` IDs directly. About 90% have abstracts, 62–80% have PMIDs. **All from 2026** for single seeds; 470/498 from 2026 for the two COVID seeds. |
| `GET /recommendations/v1/papers/forpaper/{id}` | LIVE | 100 results | `from=recent` (default) or `all-cs`. `all-cs` is a computer-science-only pool, useless for biomedicine. |
| Citations with `contexts` / `intents` | LIVE | CAR-T: 39/100 have contexts. COVID: 430/1000 | **Intents empty on all citations.** References: CAR-T 23 refs, 11 with contexts, 6 with intents. |
| Reference elision | LIVE | STEP-1 (NEJM) references → `data: null`, "elided by the publisher" | The CAR-T NEJM paper was **not** elided, so elision is per paper and unpredictable. |
| Abstracts | LIVE | Elsevier 5/5. Sep–Oct 2026 papers 10/12 (11/12 found, 10 with tldr) | A *Blood* 2016 paper had no abstract but did have a tldr. |
| Search | LIVE | — | `/paper/search/match` (title → record including PMID), `/paper/search` and `/paper/search/bulk` (1,554 hits for "cytokine release syndrome" + tocilizumab) all work. |

---

## 5. PubMed E-utilities and the rest

### PubMed E-utilities

| Capability | Status | Measured / limit | Notes |
|---|---|---|---|
| ELink `pubmed_pubmed` + `cmd=neighbor_score` | LIVE | 153 / 86 / 174 / 313 neighbours with scores, in **one call** (repeated `id=` params give per-seed lists; a comma list gives the union) | Top 40 are on-topic and all have abstracts. **Skews old:** CAR-T neighbours 2025: 1, 2026: 0. GLP-1 2025: 8. |
| `pubmed_pubmed_citedin` | LIVE | 11,640 / 14,390 / 3,233 / 2,472 | Derived from PMC. |
| `pubmed_pubmed_refs` | LIVE | 13 / 14 / 11 / **0** | Only PMC-deposited reference lists, so incomplete. |
| ESearch / EFetch / ESummary | LIVE | paced median 514 ms, max 1.2 s. ESummary POST of 313 IDs: 2.7 s | Abstracts are complete (but see the axiom parsing bug in §6). |
| Rate limit | LIVE | **3 rps enforced**: a burst of 15 got 6×429; header `x-ratelimit-limit: 3` | 10 rps with a free NCBI key (DOCS-ONLY). |

### Other sources

| Service | Status | Measured | What it uniquely adds |
|---|---|---|---|
| **Europe PMC** search | LIVE | lookup 167 ms. OR-batch `EXT_ID:(a OR b …)`: 4 IDs in 394 ms | Abstract + MeSH (`resultType=core`). Sep–Oct 2026 abstracts 8/12. |
| Europe PMC `/MED/{id}/citations` · `/references` | LIVE | citations: 4,546 hits, 1,000 per page in 4.9 s. References: 11 (CAR-T) / **41 (STEP-1)** in 71–256 ms | Fills the S2 elision and PubMed gaps. Keyless edges that axiom says it lacks. |
| Europe PMC preprints (`SRC:PPR`) | LIVE | 132 ms | 450 CAR-T preprints in the last 12 months (bioRxiv, medRxiv, Research Square) with structured metadata. Better than Tavily for preprints. |
| Europe PMC Annotations API | LIVE | 68 ms | 89 text-mined entities from PMC *full text* (diseases, genes, drugs). |
| **NIH iCite** | LIVE | 0.5–1.0 s. GET with 400 PMIDs works; 1,000 in the URL gives 413 (use POST or chunks) | RCR (163 / 1064 / 825 / 281), APT, **clinical citations** (227 / 632 / 211 / 327), `is_clinical`, human/animal/molecular scores, and a full `cited_by` PMID list. References are PMC-only (14 / 14 / 13 / 1). **Lag:** only 4/12 Sep–Oct 2026 PMIDs present. |
| **OpenCitations Index v2** | LIVE, keyless | references 0.5–0.6 s. **citations 10 s** (5,098). citation-count 6.3 s | DOI-based open references (24 CAR-T, 36 STEP-1). Fine for references, slow for citations. |
| **PubTator3** | LIVE | biocjson export 370 ms. Search 450 ms | Entities with MeSH/NCBI IDs and relations (e.g. tocilizumab–CRS "Association"). Recent coverage 10/12. **Quality caveats below.** |
| **ClinicalTrials.gov v2** | LIVE | search 205 ms, study 142 ms | 19 tisagenlecleucel ALL trials. `referencesModule` lists DERIVED PMIDs. For ELIANA (NCT02435849): 8 PMIDs, including the seed and its follow-ups (newest PMID 42525896). Trial → results-paper recall no other source gives. Rate limit UNVERIFIED. |

PubTator3 quality caveats:
- "tisagenlecleucel" is typed as a Disease with no ID.
- Semaglutide is not tagged in the STEP-1 abstract.
- Entity autocomplete returns `[]` for both drugs.
- `@CHEMICAL_Semaglutide` search returns 0 hits.
- The relations endpoint returned `[]`.

Use it as evidence, not ground truth.

---

## 6. What axiom's adapters get right / wrong vs. reality

### Right
- **S2 batch** (`/paper/batch`, ≤500 mixed `PMID:` / `DOI:` IDs, null-tolerant) matches reality. `or []` handles elided references safely.
- **OpenAlex:** the field mask, `reconstruct_abstract`, `title_and_abstract.search` instead of a cited-by sort, and OR-batch lookups by ID (50 per call; the limit is 100) are all sound.
- **Europe PMC:** keyless with `resultType=core` does give abstracts + MeSH.
- **`_http`** converts non-JSON 200s into `SourceHTTPError`.
- The `config.py` comment "$0.10/day keyless → $1/day with key" is correct.

### Wrong / risky (verified)

1. **Uncapped `Retry-After` causes about 13-hour sleeps.**
   - Both `ingest.OpenAlexClient._get` and `sources/_http._request` do `delay = float(retry_after)` with no cap.
   - OpenAlex's budget 429 returns `Retry-After: 46575`.
   - One exhausted budget hangs a build for hours, times 4–6 retries.
   - **Fix:** if `Retry-After` > about 30 s, fail fast and fall back to another source.
2. **The PubMed parser truncates abstracts.**
   - `parse_efetch` joins `AbstractText.text`, which stops at the first inline tag (`<i>`, `<sup>`, `<sub>`).
   - Live test: **20 of 60** 2024 SARS-CoV-2 abstracts lost more than 5% (e.g. 271 vs 1,547 chars).
   - `findtext("ArticleTitle")` has the same flaw for titles.
   - **Fix:** `"".join(el.itertext())`.
3. **OpenAlex is assumed keyless-OK.** The `config.py` comment "No API key needed… polite pool" is out of date: there is no polite pool, only the budget.
   - The snowball runs a search (10 credits), then `cites:` calls per frontier paper (up to 300 per hop).
   - That can burn the whole keyless 1,000-credit/day budget in one build.
   - On a cloud VM the IP budget may be shared.
4. **`per-page` is set up to 200** in `search_seeds` and `citers`. That is deprecated; 100 is the supported maximum.
5. **It uses `concepts`** (deprecated, MAG-era) for filters and concept edges. Switch to `topics`.
6. **S2 keyless is the default**, with 4 retries and ≤15 s of total backoff. With 18/20 calls returning 429 and no `Retry-After`, most calls end as a silent `[]`. It needs a key plus a client-side 1 rps throttle.
7. **PubMed adapter gaps:**
   - No pacing under 3 rps and no `tool` / `email` params.
   - Edges come from the EFetch `ReferenceList` (PMC-only: 0–14 refs against a real 24–41).
   - `cited_by_count` is hard-coded to 0, though iCite gives it for free.
8. **The Europe PMC adapter declares `provides_edges=False`**, but `/references` and `/citations` work keylessly and have the best coverage for NEJM.
9. **The design is topic-search-driven, not seed-driven.** None of the seed-native endpoints are used: ELink neighbours, S2 recommendations, iCite `cited_by`, OpenCitations, CT.gov, PubTator3.
10. **Stack mismatch with the hackathon rules.**
    - Embeddings are local SPECTER2 via torch. Nebius Qwen3-Embedding-8B is required, and S2 serves SPECTER2 vectors anyway.
    - The LLM providers are Ollama and Anthropic only. An OpenAI-compatible Nebius provider is needed.

---

## 7. Recommended source mix for seed-based biomedical discovery

| Stage | Source(s) | Why |
|---|---|---|
| **0. Resolve seeds** (3–30) | PMID → PubMed EFetch (abstract, MeSH, DOI) + S2 `/paper/batch` (S2 ID, tldr, SPECTER2) + OpenAlex singleton (free: W-ID, topics, counts). DOI → OpenAlex `/works/doi:` or ESearch `doi[doi]`. Title → S2 `/paper/search/match`, falling back to Tavily search → PubMed URL | All single-ID calls; no budget pressure. |
| **1a. Similar, established** | PubMed ELink `neighbor_score`, all seeds in one call | Highest precision, scored, has a biomedical prior. Skews old. |
| **1b. Similar, new** | S2 recommendations: all seeds as positives, user-rejected papers as negatives, `limit=500` | The only endpoint built for "seeds → new papers". Current-year pool, which matches the product's "NEW". |
| **1c. Forward citations** | iCite `cited_by` (full PMID list in one call) or Europe PMC `/citations`; rank by the number of seeds cited | Follow-up work. Co-citation across seeds is a strong relevance signal. |
| **1d. Backward / coupling** | Europe PMC `/references` + OpenCitations (fills elisions); keep refs shared by ≥2 seeds | Foundational papers the seeds share. |
| **1e. Agentic web** (Tavily, required) | The LLM writes 3–5 queries from the question + seed abstracts. Preprint domains with `filter_by_published_date=true`, plus a general description search. Resolve URLs to DOI/PMID | Preprints, grey literature, and papers findable only by description. |
| **1f. Preprints, structured** | Europe PMC `SRC:PPR` with an LLM-written boolean query and a date window | Abstracts + DOIs; more complete than Tavily for bioRxiv/medRxiv. |
| **1g. Trials** | ClinicalTrials.gov from seed interventions/conditions (MeSH/PubTator) + DERIVED PMIDs | Trial → results papers. |
| **1h. Optional** (OpenAlex key) | `search.semantic` on the research question (≤50 results, $0.001) | Cheap extra recall. Beta. |
| **Skip** | OpenAlex `related_works`, S2 `all-cs` pool, Tavily `/extract` on publisher pages | Junk, wrong domain, or blocked. |
| **2. Enrich** | Abstracts in fallback order PubMed EFetch (`itertext`) → Europe PMC → S2 → OpenAlex. S2 tldr. iCite RCR / clinical citations / `is_clinical`. PubTator3 entities + MeSH. S2 citation contexts | Grounded explanations: "shares entity X with seed Y", "seed Y is cited for Z". |
| **3. Rank** | Nebius embedding cosine to the question (instruct prefix) and to each seed (max + mean), plus graph features (co-citation count, coupling, PubMed neighbour score, S2 rec rank). Keep the top ~100 | Cheap and robust before the LLM step. |
| **4. Judge + explain** | Nebius LLM, listwise in batches of 10–20 candidates, with evidence fields | Stays inside the 60 RPM baseline. Explanations must quote evidence. |

**Per-query budget (about 15 seeds):**
- PubMed: about 6 calls, ~3 s at 3 rps.
- S2: 2–3 calls (key needed).
- Europe PMC: about 30 calls.
- iCite: 1–2 calls.
- Tavily: 3–8 credits.
- Embeddings: ~1,500 docs × 350 tokens ≈ 0.5M tokens ≈ **$0.005**.
- Judging: 100 candidates × 800 tokens ≈ 80K tokens ≈ **$0.02**.

**Keys to get now:**
- S2: unknown wait, so apply immediately.
- OpenAlex: instant after email activation.
- NCBI: free account (DOCS-ONLY).
- Tavily: free tier is 1,000 credits.

---

## 8. Nebius model picks

| Role | Pick | Price (in / out per 1M tokens) | Why | Fallback |
|---|---|---|---|---|
| **Embeddings** | `Qwen/Qwen3-Embedding-8B` | $0.01 / – | The only embedding model. 4096-d (try `dimensions=1024` to shrink storage). Instruction-aware queries (`Instruct: …\nQuery: …`). 32K–40K context, so full abstracts fit. | S2 SPECTER2 vectors (free, live) as a secondary signal only. |
| **Rerank** | `Qwen/Qwen3-Reranker-8B` via `/v1/rerank` *if it answers* | UNVERIFIED | A cross-encoder for top-300 → top-100. | Skip and rely on the LLM judge. |
| **Relevance judge** (scores, logprobs) | `Qwen/Qwen3-235B-A22B-Instruct-2507` | $0.20 / $0.60 | No thinking phase, so first-token yes/no logprobs are meaningful. JSON mode tag, 262K context. Slow (27 tok/s), but judge outputs are tiny. | `Qwen/Qwen3-30B-A3B-Instruct-2507` ($0.10 / $0.30, 70 tok/s). For the NVIDIA partner prize: `nvidia/Nemotron-3_5-Lightning` ($0.06 / $0.24); it is a reasoning model, so test `reasoning_effort` (UNVERIFIED). |
| **Explanations + agent** (Tavily tool calls) | `deepseek-ai/DeepSeek-V4-Flash-0731` | $0.14 / $0.28 | 1M context, 351 tok/s, JSON mode + tools, very cheap. | `zai-org/GLM-5.3` ($1.40 / $4.40, 455 tok/s) for higher quality. |
| **Avoid** | Llama-*, `-fast` flavors, Kimi-K2.5, Qwen3-32B, DeepSeek-V4-Flash (non-0731) | — | Removed in June/August 2026. The "Switch to Token Factory" doc still shows `moonshotai/Kimi-K2.5`. | — |

### Day-one checks once a Nebius key exists (≈10 min)

1. `GET /v1/models` and diff it against the public catalog.
2. `/v1/embeddings` with `dimensions=1024`, and find the maximum input-list size.
3. `/v1/rerank` with `Qwen/Qwen3-Reranker-8B`.
4. `logprobs=true, top_logprobs=5` on the judge and the explainer models.
5. `response_format: json_schema` on both (settles the docs conflict).
6. Read `x-ratelimit-limit-requests` / `-tokens` for the real baseline.
7. A `service_tier: flex` smoke test.

### Docs-vs-reality disagreements (summary)

- **Nebius:**
  - The "Switch" doc uses a removed model.
  - `json_schema` (guide) vs `json_object`-only (OpenAPI).
  - `/v1/batches` is live but not in the spec, and its doc page is 404.
  - The rerank example model is not in the catalog.
  - Embedding context: catalog 40,960 vs tag "32K".
  - JSON-guide examples use models that are no longer in the catalog.
- **S2:** the "1000 rps shared" claim vs 90% 429s at 1 rps. `intents` documented but empty on citations.
- **OpenAlex:** axiom's "polite pool / no key needed" vs the per-IP $0.10/day budget. `per_page` 200 deprecated.
- **Tavily:** `time_range` does not exclude undated results unless `filter_by_published_date=true`.
