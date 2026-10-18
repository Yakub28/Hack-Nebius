# Snowball: from the papers you trust to the ones you missed

**Nebius Build Week · Healthcare / Life Sciences: Research Paper Discovery**

Snowball takes a research question and a few seed papers a researcher already trusts, and returns new
biomedical papers, ranked. Every result shows where it was found, how it links to the seeds, and a quote from
its abstract that was checked word for word. Above the list, a research brief says what the strongest papers
show together, and every claim in it is checked against the abstracts it cites.

- **Live app (on Nebius):** https://port8000-c7z6ce6wcrakj61.tunnel.applications.uk-south2.nebius.cloud
- **Recorded run (opens instantly, no key needed):** `/recorded` on the live app
- **Code:** https://github.com/Yakub28/Hack-Nebius · design decisions and their evidence: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## The problem, and our answer

> Researchers often have a collection of papers relevant to their topic but struggle to find more through
> keyword searches alone.

Snowball starts from the collection, not from keywords. It follows the seeds' citations in both directions,
finds papers cited together with them, asks PubMed for its own nearest neighbours, writes keyword searches per
seed, and sends a web agent to read what it finds. Then it ranks everything against **each** seed and the
question, has an LLM grade the strongest candidates, and shows its work for every paper.

**What keyword search alone misses, measured:** in the recorded run, **25 of the 50 results were returned by
none of the run's PubMed or preprint keyword queries.** They came only from citations, co-citation, PubMed
similar articles or the web agent. Each of them carries a **Beyond keywords** badge in the UI.

## How we cover the brief

| The challenge asks for | What Snowball does |
|---|---|
| Accept a research question and a collection of seed papers | Question plus up to 30 seeds: PMIDs, DOIs, PubMed links or exact titles, preprints included. Import a Zotero, EndNote, Mendeley or PubMed export (RIS, BibTeX, .nbib, CSV). |
| Follow citation and reference networks | Papers that cite the seeds, papers the seeds cite, and papers **co-cited** with the seeds by the same citing papers (NIH iCite + Europe PMC). |
| Embeddings for semantic retrieval | **Qwen3-Embedding-8B on Nebius Token Factory**: cosine similarity to *each* seed and to the question, never a seed average (a mixed seed set averages into nothing). |
| LLMs to assess relevance, rank, expand the question, explain | **NVIDIA Nemotron 3.5 Lightning on Token Factory**: plans inclusion criteria and searches, grades candidates 0–4 with a reason and a verified quote, names the map's themes, writes the research brief. |
| Agentic search for web context and enrichment | **Tavily web agent**: runs the planner's searches, reads the pages, and the LLM chooses the next round from what it read. Every hit is resolved to a PubMed or Europe PMC record. Tavily also finds registries, commentary and news about the top results, shown as links. |
| Retrieval + ranking + human review, interactive | Live results streamed while the search runs; keep / set aside / add as seed on every paper (keyboard: J K S X A); a shortlist page; re-run with new seeds. |
| A ranked list with metadata, source links, relevance explanations | Grade, title, authors, journal, year, study design, citations, PubMed / DOI / Europe PMC links, the judge's reason, a verified quote, and "found via" for every result. Export RIS or CSV. |
| Make clear why each paper is relevant and where the information came from | Every result records each channel that found it, with its rank and a readable note ("Cited by S2", "PubMed: similar to S1 (#4)"). Its links to the seeds are citations or similarity scores you can check. |
| Graphs, clusters, filters | A theme map (2D projection of the embeddings, themes named by the LLM), a 3D citation graph, filters by channel, theme and relevance. |
| Deploy on Nebius, app separate from the model endpoint | One Docker image (FastAPI + the built React UI) on Nebius, published to GHCR on every push to `main`. The models stay on Token Factory, so app and model endpoint are hosted separately. |

## How it works

```
question + seeds
 1. Resolve      seeds to PubMed records (Europe PMC for preprints)
 2. Plan         Nemotron: inclusion criteria, PubMed / preprint / web searches
 3. Graph        the seeds' citation neighbourhood: citing, cited, co-cited (iCite + Europe PMC)
 4. Candidates   seven channels, each hit keeps its provenance:
                 PubMed similar · cites a seed · cited by a seed · co-cited · PubMed search · preprints · web agent
 5. Hydrate      full PubMed records and citation metrics for every candidate
 6. First stage  Qwen3 embeddings (similarity to each seed and to the question) + citation signals, fused with RRF
 7. Judge        Nemotron grades the strongest ~150 candidates 0–4 against the criteria; the seeds are graded too
 8. Context      trial registrations, web pages about the top results, the theme map and the citation graph
 9. Brief        Nemotron: an answer and 3–5 findings from the top 15 abstracts, every claim checked
```

A search takes about 60–80 seconds and streams to the screen: the first ranking appears after about a minute,
then grades arrive in batches and the list re-ranks as they do.

## Trust, by construction

LLMs fabricate most biomedical references when they answer from memory. Snowball is built so that cannot reach
the screen:

1. **The LLM never originates a paper or an ID.** Every result is an API record from PubMed, iCite or Europe
   PMC, or a Tavily URL resolved to one. The LLM only grades, plans searches, and writes text about papers we hold.
2. **Quotes are verified by string match** against the title and abstract. An unverifiable quote is dropped,
   never shown.
3. **Every candidate keeps its provenance**: channel, rank and a readable note.
4. **A failing source is reported, never silently empty.** Each channel is caught on its own, and what failed
   is shown above the results.
5. **Rank, don't filter.** The judge grades 0–4 and drops nothing. The seeds are graded under the same prompt,
   and the weakest seed's grade draws the line "as relevant as your seeds".
6. **Titles, abstracts and web pages are untrusted input.** They go into prompts delimited as data, and
   everything the LLM returns (indexes, grades, JSON shape) is validated before use.

### The research brief's guardrails

A summary is where an LLM states things no paper says. The brief keeps only what can be checked:

- The model cites papers by their number in the list it read; numbers outside the list are ignored.
- Each finding must carry a quote found **word for word** in an abstract it cites.
- Every number in a claim must appear in a cited abstract (this catches invented and rounded figures).
- Fewer than 2 findings that check out, and the brief is left out with a note. The box says what was checked
  and how many findings were dropped.
- The patterns under it (what keyword search missed, the most-cited result, study designs, years) are counted
  in code, not written by a model.

## Best use of Nemotron

**NVIDIA Nemotron 3.5 Lightning (`nvidia/Nemotron-3_5-Lightning`) on Nebius Token Factory runs every LLM step:**

| Step | What Nemotron does |
|---|---|
| Plan | Turns the question and seeds into inclusion criteria, PubMed queries (one per seed plus facets), preprint queries and web searches |
| Web agent | Reads the pages Tavily returns and chooses the next round of searches |
| Judge | Grades ~150 candidates and the seeds 0–4 against the criteria, with a reason and a quote, in parallel batches |
| Themes | Names the clusters on the result map |
| Brief | Writes the answer and findings over the top 15 abstracts |

**Why Nemotron:** it is NVIDIA's model on Token Factory at under a third of Qwen3-235B's price
($0.06 / $0.24 per million tokens vs $0.20 / $0.60), and fast: the same search took 44–79 s end to end
instead of 110 s with Qwen3-235B (one run each).

**Making it reliable** took engineering, each step found in a real run and measured:

- **Thinking off.** With reasoning on, the planner spent its whole 2,000-token budget thinking and returned
  nothing. Off, it answers in about 2 s.
- **Server-enforced JSON schemas** for the plan and the brief. Unenforced, Nemotron broke every list of objects
  (it wrote the literal key `"}, {"`) and now and then left out a key.
- **Tolerant, validated parsing.** Repeated keys are merged (it split the judge's grades over several `"grades"`
  keys, losing up to 47 papers), `{"Group N": ...}` answers are read as lists, malformed entries are skipped.
- **Retries where a failure would cost the whole search** (the plan; the brief).
- **Clean queries.** Nemotron wrote PubMed field tags standing alone (`... AND [tiab] AND ...`), which match
  nothing; they are removed, and a PubMed search that finds nothing is reported.

**What we measured honestly:** with Nemotron, 28–32 of the top 50 results keep a verified quote, against 43
with Qwen3-235B, and the judge skips a few papers per search (shown as a note; they keep their first-stage
rank). Qwen3-235B stays one environment variable away (`NEBIUS_LLM_MODEL`).

Embeddings stay on **Qwen3-Embedding-8B**: it is the only embedding model on Token Factory, and the Nemotron
models there are chat models.

## Services

| Service | Use |
|---|---|
| **Nebius Token Factory** | Nemotron 3.5 Lightning (LLM), Qwen3-Embedding-8B (embeddings) |
| **Nebius** | Hosts the app (Docker image from GHCR) |
| **Tavily** | Web search agent; web context for the top results |
| **PubMed E-utilities** | Seed lookup, abstracts, similar articles, keyword searches |
| **NIH iCite** | Citations, references, relative citation ratio |
| **Europe PMC** | Fuller reference lists, preprints (bioRxiv, medRxiv) |

## Run and deploy

```bash
cp .env.example .env      # NEBIUS_API_KEY (required), TAVILY_API_KEY, NCBI_API_KEY
make venv && make run     # API + UI on http://localhost:8000
make check                # ruff + offline tests
```

Every push to `main` builds the `Dockerfile` and publishes `ghcr.io/yakub28/hack-nebius:latest`. On Nebius:

```bash
docker run -p 8000:8000 -e NEBIUS_API_KEY=... -e TAVILY_API_KEY=... ghcr.io/yakub28/hack-nebius:latest
```

API: `POST /discover` (JSON), `POST /discover/stream` (server-sent events), `POST /collection` (import a
reference-manager file), `GET /health`, reference at `/docs`.

## Limits

- Biomedical literature only (PubMed and Europe PMC records).
- The brief's number check proves a number appears in a cited abstract, not that it is used correctly.
- No evaluation harness yet: comparisons above are single runs, not a benchmark.

## Hugging Face Community Award

Apply through https://huggingface.co/nebius-build-week. Summary to paste:

> **Snowball** turns a researcher's trusted papers into a ranked, traceable set of new ones. It follows
> citations and co-citations, PubMed's nearest neighbours, LLM-written searches and a Tavily web agent; ranks
> with Qwen3 embeddings per seed; and has NVIDIA Nemotron grade every strong candidate with a verified quote.
> A research brief answers the question with every claim checked against the abstracts. In our recorded run,
> half the results were found by no keyword search. Runs on Nebius Token Factory.
