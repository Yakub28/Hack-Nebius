# Snowball

Give it a research question and the papers you already trust. It returns new papers, ranked, each with where it was found, how it links to your seeds, and a verified quote showing why it is relevant.

Built for the Nebius *Healthcare / Life Sciences: Research Paper Discovery* challenge. Nebius Token Factory runs the embeddings and the LLM, and Tavily does the web search.

**Hackathon submission:** how Snowball answers the challenge, the use of NVIDIA Nemotron, and what we measured are in [HACKATHON.md](HACKATHON.md).

## How it works

1. **Resolve** your seeds in PubMed. A seed can be a PMID, a DOI, a PubMed URL or an exact title.
2. **Plan.** The LLM turns the question and seeds into inclusion criteria and search queries.
3. **Collect candidates** from 7 channels:
   - PubMed similar articles
   - papers citing the seeds
   - papers the seeds cite
   - papers co-cited with the seeds
   - PubMed queries
   - Europe PMC preprints
   - Tavily web search
4. **Rank** by fusing Qwen3-Embedding-8B similarity (to each seed and to the question) with citation signals, using reciprocal rank fusion (RRF).
5. **Judge.** NVIDIA Nemotron 3.5 Lightning grades the strongest ~180 candidates 0–4 against the criteria. It grades your seeds too, so you see where "as relevant as my seeds" begins.
6. **Brief.** Above the list, a short answer and 3-5 findings from the top 15 abstracts. Each finding links its papers and quotes one of them word for word; anything that doesn't check out is left out.

The reasoning and evidence behind each choice are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run

```bash
make venv                         # .venv on Python 3.12, via uv
make node                         # Node.js LTS into .tools/ (skip if you have Node 20+)
cp .env.example .env              # set NEBIUS_API_KEY at least
make run                          # builds the UI if needed; http://localhost:8000
```

`make help` lists the other commands.

```bash
curl -s localhost:8000/discover -H 'content-type: application/json' -d '{
  "question": "Which incretin-based drugs reduce body weight in adults with obesity?",
  "seeds": ["33567185", "Tirzepatide Once Weekly for the Treatment of Obesity"],
  "limit": 20
}'
```

A query takes about 30–60 s, most of it judging.

`TAVILY_API_KEY` turns on web search, and `NCBI_API_KEY` makes PubMed 3× faster. When a channel fails, the response's `warnings` names it; it is never silently empty.

## UI

A React app (Vite + TypeScript, in `web/`), served by the API from `web/dist`. Search is **live**: `POST /discover/stream` streams the pipeline as server-sent events, so you watch the seeds resolve, each channel's haul, the web agent's rounds and reasons, a first ranking, and then grades arriving batch by batch while the list re-ranks. Closing the page cancels the search.

- `/search`: the form (type seeds, or import a Zotero/EndNote/PubMed export), the live run, then the results as a **list**, a **theme map** or a **3D citation graph**. Any paper opens in a side panel with its abstract, why it was found, its web context and its citations among the results, which you can walk; **J/K** step through the list. **Add as seed** on any result feeds the next run.
- `/recorded`: a real search, saved, that opens instantly and needs no key. Record a new one with `make sample`.
- `/`: the overview.

`make web` runs the dev server with hot reload on :5173 (with `make run` alongside for the API). To host the UI separately, build with `VITE_API_BASE=https://<api>` and serve `web/dist` from any static host.

## Deploy

The `Dockerfile` serves the API on port 8000. Run it as a Nebius Serverless AI endpoint (CPU preset). The models stay on Token Factory, so the app and the model endpoint are hosted separately.

## Test

```bash
make check    # ruff + pytest
```

The tests are offline and need no keys.
