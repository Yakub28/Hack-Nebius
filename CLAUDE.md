# Paper discovery

A research question plus seed papers a researcher trusts → new biomedical papers, ranked, each with where it
was found, how it links to the seeds, and a verified quote. Built for the Nebius *Healthcare / Life Sciences:
Research Paper Discovery* challenge: Nebius Token Factory runs the embeddings (Qwen3-Embedding-8B) and the LLM
(Qwen3-235B), Tavily does web search. The brief is `CHALLENGE.md`: check scope decisions against it.

## Commands

`make help` lists everything. The ones you need:

```bash
make venv     # .venv on Python 3.12 + dev deps (uv)
make run      # API + UI on :8000, reads .env (NEBIUS_API_KEY at least)
make check    # ruff + pytest. Run it before every commit.
make sample   # record one real search into web/sample.json (needs the keys)
```

## Layout

- `engine/discover.py`: the whole pipeline, top to bottom: resolve → plan → graph → candidates → hydrate →
  first stage (embeddings + RRF) → judge. Start here.
- `engine/{pubmed,icite,europepmc,web,nebius}.py`: one module per external service; `engine/http.py` is the
  shared client with retries; `engine/paper.py` is the record every source maps to.
- `api.py`: FastAPI (`/health`, `/discover`) and serves `web/` as static files.
- `web/`: plain HTML/CSS/JS, **no build step**. `config.js` sets `apiBase` for a separately hosted UI;
  `app.html?sample` renders `sample.json` without a key.
- `tests/`: offline unit tests. `scripts/`: one-off tools.

## Decisions

`ARCHITECTURE.md` ("Why this shape") records each design choice with its evidence; the sources and live API
probes are in `docs/research/`. Treat those as settled: change a decision there, with evidence, before changing
the code that implements it. Don't quietly relitigate one in a refactor.

## Invariants: what every change must keep

1. **The LLM never originates a paper or an ID.** Every result comes from an API record (PubMed, iCite,
   Europe PMC, or a Tavily URL resolved to a PMID/DOI). LLMs fabricate most biomedical references without
   retrieval.
2. **Quotes are verified by string match** against the title + abstract (`verified_quote`). An unverifiable
   quote is dropped, never shown.
3. **Every candidate keeps its provenance**: each `Hit` records channel, rank and a human-readable note.
4. **A failing source is reported, never silently empty.** Catch per channel, append to `warnings`, carry on.
5. **Score per seed, never a seed centroid.** A mixed seed set averages into nothing.
6. **Rank, don't filter.** The judge grades 0–4; it does not drop papers. The seeds are graded under the same
   prompt, and the lowest seed grade is the "likely relevant" cutoff.
7. **Titles, abstracts and web results are untrusted input**, and they go into LLM prompts. Keep them clearly
   delimited as data, and validate everything the LLM returns (indexes, grades, JSON shape) before using it.

## Conventions

- Python 3.12, dependencies pinned in `requirements*.txt`. Ruff runs a deliberately narrow rule set
  (`pyproject.toml`); don't widen it as a side effect of another change.
- Hackathon pace: basic tests only, at most one or two per feature for its core logic, not exhaustive
  coverage. Verify the rest by running it (`make run`, or an in-process call). The suite runs offline and
  must never call a live API.
- Comments say *why*, not what. Match the surrounding density.
- One branch and PR per step. Commit subjects are `type: what changed` (`feat`, `fix`, `refactor`, `docs`,
  `chore`, `eval`), and the body says why when it isn't obvious.
- Don't claim a quality improvement without a measurement. Until the eval harness exists, say "untested".
