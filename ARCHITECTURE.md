# Search engine architecture

Question + seed papers → ranked, traceable list of new biomedical papers.
Evidence and live probes behind every choice: [`docs/research/literature.md`](docs/research/literature.md), [`docs/research/services.md`](docs/research/services.md).

## Pipeline

```
seeds (PMID / DOI / title) + question
        │
 1. Resolve      PubMed ESearch/EFetch → PMID, title, abstract, MeSH
        │        iCite → year, citations, RCR, cited_by, references
        │
 2. Candidates   union of channels, each hit keeps its provenance
        │        ├─ similar   PubMed "Similar articles" per seed (ELink neighbor_score)
        │        ├─ cites     papers citing ≥1 seed (iCite cited_by), ranked by #seeds cited
        │        ├─ refs      papers the seeds cite (Europe PMC references)
        │        ├─ cocited   papers co-cited with the seeds by their citers (CoCites)
        │        ├─ query     LLM-written PubMed queries: 1 per seed + facets of the question
        │        ├─ preprint  same queries on Europe PMC SRC:PPR (bioRxiv, medRxiv…)
        │        └─ web       Tavily on preprint/PubMed domains, URLs resolved to PMID/DOI
        │
 3. First stage  Qwen3-Embedding-8B (Nebius): cosine to each seed (max, top-2 mean) and to the question
        │        + citation links to seeds + PubMed similarity rank → RRF fusion
        │
 4. Judge        top ~150 → Qwen3-235B-A22B-Instruct (Nebius) grades 0–4 against explicit
        │        criteria extracted from question + seeds; quotes the abstract as evidence.
        │        Seeds are graded too: the lowest seed grade is the "likely relevant" line.
        │
 5. Output       sorted by grade, then fused score. Each card: metadata, links,
                 "found via" provenance, links to seeds, nearest seed, verified quote.
```

## Why this shape

| Decision | Evidence |
|---|---|
| Union of citation + text channels, not either alone | Citation + PubMed-similarity best at every cut-off over 3,000 biomedical SRs (Sjögårde 2024). Citation chasing after PubMed search: sensitivity 75% → 97% (BibliZap). Removing citation expansion halved PaSa's recall (0.61 → 0.29). |
| Co-citation channel | CoCites: median recall 75% across 250 SRs. |
| One LLM query per seed, OR'ed | Single LLM Boolean query recall 0.58–0.65 vs manual 0.72–0.84; per-seed queries match manual (Wang 2025). |
| Score per seed, never a seed centroid | Incoherent seed sets cut CoCites recall 83% → 34%; MAX beats SUM in group fusion. |
| Qwen3-Embedding-8B | Only embedding model on Nebius ($0.01/M tokens); NFCorpus 0.415, SciFact 0.785. |
| No HyDE / query2doc | Gains vanish or turn negative on strong embedders. |
| Graded 0–4 judge with criteria, rank don't filter | Graded > binary (0.502 vs 0.477 nDCG@10). Criteria prompts: 97.7% vs 49% sensitivity zero-shot. Hard LLM filters lose recall. |
| RRF fusion | Robust with no labels; citation + text fused beat either alone in every study (e.g. P@10 0.533 vs 0.315 / 0.226). |
| Deterministic provenance + string-verified quote | LLMs fabricate 94.8% of biomedical references without retrieval. Every paper comes from an API record; the LLM never originates an ID. |
| Thumbs-up → new seed | Rocchio with 1–3 good positives +0.05–0.09 nDCG@10. |

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
