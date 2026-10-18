# Search engine architecture

Question + seed papers → ranked, traceable list of new biomedical papers.
Evidence and live probes behind every choice: [`docs/research/literature.md`](docs/research/literature.md), [`docs/research/services.md`](docs/research/services.md).

## Pipeline

```
seeds (PMID / DOI / title) + question
        │
 1. Resolve      PubMed ESearch/EFetch → PMID, title, abstract, MeSH; Europe PMC for seeds PubMed lacks
        │        (preprints): their references and citers come from Europe PMC
        │        iCite → year, citations, RCR, cited_by, references
        │        Seeds can be imported from a RIS / BibTeX / MEDLINE / CSV export (POST /collection)
        │
 2. Candidates   union of channels, each hit keeps its provenance
        │        ├─ similar   PubMed "Similar articles" per seed (ELink neighbor_score)
        │        ├─ cites     papers citing ≥1 seed (iCite cited_by), ranked by #seeds cited
        │        ├─ refs      papers the seeds cite (Europe PMC references)
        │        ├─ cocited   papers co-cited with the seeds by their citers (CoCites)
        │        ├─ query     LLM-written PubMed queries: 1 per seed + facets of the question
        │        ├─ preprint  same queries on Europe PMC SRC:PPR (bioRxiv, medRxiv…)
        │        └─ web       Tavily agent: planner's searches, then a round the LLM picks from the pages it
        │                     read; pages tied to a record by URL (PMID/DOI/PMCID) or exact title
        │
 3. First stage  Qwen3-Embedding-8B (Nebius): cosine to each seed (max, top-2 mean) and to the question
        │        + citation links to seeds + PubMed similarity rank → RRF fusion
        │
 4. Judge        top ~150 → Nemotron 3.5 Lightning (Nebius, thinking off) grades 0–4 against explicit
        │        criteria extracted from question + seeds; quotes the abstract as evidence.
        │        Seeds are graded too: the lowest seed grade is the "likely relevant" line.
        │
 5. Context      trial IDs quoted in each abstract; Tavily pages about the top 8 (registries, commentary,
        │        news, code), shown as links. Map: PCA of the ranking embeddings + spherical k-means
        │        themes named by the LLM (title-word fallback), with the citation links.
        │        Brief, alongside: the LLM reads the top 15 graded abstracts and writes an answer and
        │        3-5 findings; only claims that check out against those abstracts are kept.
        │
 6. Output       sorted by grade, then fused score, under the research brief. Each card: metadata, links,
                 "found via" provenance, links to seeds, nearest seed, verified quote, web context.
```

## Why this shape

| Decision | Evidence |
|---|---|
| Union of citation + text channels, not either alone | Citation + PubMed-similarity best at every cut-off over 3,000 biomedical SRs (Sjögårde 2024). Citation chasing after PubMed search: sensitivity 75% → 97% (BibliZap). Removing citation expansion halved PaSa's recall (0.61 → 0.29). |
| Co-citation channel | CoCites: median recall 75% across 250 SRs. |
| One LLM query per seed, OR'ed | Single LLM Boolean query recall 0.58–0.65 vs manual 0.72–0.84; per-seed queries match manual (Wang 2025). |
| Score per seed, never a seed centroid | Incoherent seed sets cut CoCites recall 83% → 34%; MAX beats SUM in group fusion. |
| Qwen3-Embedding-8B | Only embedding model on Nebius ($0.01/M tokens); NFCorpus 0.415, SciFact 0.785. |
| Nemotron 3.5 Lightning as the LLM, thinking off | NVIDIA partner model, $0.06/$0.24 per M tokens (Qwen3-235B: $0.20/$0.60). Thinking on spent the planner's whole 2,000-token budget and returned nothing; off, 2 s. Same search, one run each: 44–70 s end to end vs 110 s, but 29–31 of the top 50 keep a verified quote vs 43 (untested beyond that). Its JSON drifts (repeated keys, `Group N` keys, the odd malformed plan, PubMed tags standing alone that match nothing), so the plan and brief have a server-enforced shape, replies are merged and re-read, and queries are cleaned. Qwen stays a `NEBIUS_LLM_MODEL` away. |
| Research brief: every claim checked, or left out | A summary is where an LLM states things no paper says. So the model cites papers only by their number in the list it read; each finding must carry a quote found word for word in a cited abstract, and every number in a claim must appear in a cited abstract (it catches invented and rounded figures, not a real number misapplied). Fewer than 2 surviving findings and the brief is dropped with a note. The server enforces the JSON shape: unenforced, Nemotron broke every list of objects. Patterns (designs, years, the most-cited result, what keyword search missed) are counted in code, not written. In probes 1–2 of 5 offered findings fail the checks; one retry. Untested beyond that. |
| No HyDE / query2doc | Gains vanish or turn negative on strong embedders. |
| Graded 0–4 judge with criteria, rank don't filter | Graded > binary (0.502 vs 0.477 nDCG@10). Criteria prompts: 97.7% vs 49% sensitivity zero-shot. Hard LLM filters lose recall. |
| RRF fusion | Robust with no labels; citation + text fused beat either alone in every study (e.g. P@10 0.533 vs 0.315 / 0.226). |
| Deterministic provenance + string-verified quote | LLMs fabricate 94.8% of biomedical references without retrieval. Every paper comes from an API record; the LLM never originates an ID. |
| Thumbs-up → new seed | Rocchio with 1–3 good positives +0.05–0.09 nDCG@10. |
| Web channel as an agent, every hit tied to a record | The brief asks for agentic search; the LLM only chooses *searches*, never papers, so the no-fabrication rule above still holds. Untested for recall. |
| Web context is links, not claims | Pages about a paper (registries, commentary, news) help a reader judge it, but are unvetted; they are shown with their domain and never summarised into the result. |
| Map reuses the ranking embeddings | No extra model or call except naming the themes; deterministic k-means seeds, so a result set always draws the same map. |
| Live results over server-sent events | A search takes ~2 minutes, most of it grading. Streaming shows the first ranking after ~1 minute and every grade as it lands, keeps proxies from timing out (keep-alives), and lets a closed tab cancel the run instead of spending tokens. |
| Preprint seeds via Europe PMC | Fast-moving fields cite preprints before PubMed has them; dropping them lost the seed entirely. |

## Sources: what works today (probed 2026-10-18)

| Source | Status | Use |
|---|---|---|
| PubMed E-utilities | ✅ keyless 3 rps, 10 with `NCBI_API_KEY` | resolve, abstracts, similar articles, queries |
| NIH iCite | ✅ keyless | metadata, `cited_by`, references, RCR |
| Europe PMC | ✅ keyless | references (fills NEJM/PMC gaps), preprints |
| Tavily | ✅ key | web/preprint recall, find a paper by description |
| Semantic Scholar | ❌ not used | its recommendations are a competing black box: untraceable, last ~60 days only, ~90% 429 keyless |
| OpenAlex | ❌ keyless budget exhausted per IP | skip; `related_works` is off-topic for biomedicine |

## Skip list

LLM-proposed references · HyDE · seed centroid · co-citation or PageRank alone · OpenAlex `related_works` · Semantic Scholar recommendations · hard LLM filtering · long listwise reranking · weak cross-encoder after Qwen3 · full-text embeddings.

## Evaluation

SYNERGY (26 systematic reviews, labelled includes): hold out includes, use 5 as seeds and the review title as the question, report Recall@50/100 per channel and fused, nDCG@20. Unjudged ≠ irrelevant: precision is a lower bound.
