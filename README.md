# Paper discovery

Give it a research question and the papers you already trust. It returns new papers, ranked, each with where it was found, how it links to your seeds, and a verified quote showing why it is relevant.

Built for the Nebius *Healthcare / Life Sciences: Research Paper Discovery* challenge. Nebius Token Factory runs the embeddings and the LLM, and Tavily does the web search.

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
5. **Judge.** Qwen3-235B grades the strongest ~180 candidates 0–4 against the criteria. It grades your seeds too, so you see where "as relevant as my seeds" begins.

The reasoning and evidence behind each choice are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run

```bash
uv venv -p 3.12 && uv pip install -r requirements-dev.txt
cp .env.example .env              # set NEBIUS_API_KEY at least
set -a; . ./.env; set +a
.venv/bin/uvicorn api:app --reload  # http://localhost:8000/docs
```

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

The API serves the web UI from `web/`: a landing page at http://localhost:8000 and the search tool at `/app.html`. It is plain HTML, CSS and JS with no build step. Each result card shows the LLM grade, the verified quote, how the paper links to your seeds, and which channels found it. A dashed line marks where results stop being as relevant as your seeds. You can filter by channel and export to RIS or CSV.

To host the UI separately from the API, serve `web/` from any static host and set `apiBase` in `web/config.js`.

`/app.html?sample` opens a sample result set that needs no Nebius key: real PubMed records with placeholder grades, labelled as such. Rebuild it with `.venv/bin/python scripts/make_sample.py`.

## Deploy

The `Dockerfile` serves the API on port 8000. Run it as a Nebius Serverless AI endpoint (CPU preset). The models stay on Token Factory, so the app and the model endpoint are hosted separately.

## Test

```bash
.venv/bin/python -m pytest -q
```
