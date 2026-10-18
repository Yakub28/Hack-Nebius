# Seeds + question → ranked new papers (biomedicine): evidence review

Decision document · compiled 2026-10-18 · scope: what the published evidence says about each stage of the pipeline.

**Tags.** `[P]` peer-reviewed · `[PP]` preprint · `[V]` vendor or self-reported · `[OP]` my own API probe (small n, today) · `UNVERIFIED` means I could not open the primary source, or the number is second-hand.
**Main caveat.** Almost no evaluation matches this exact task: biomedical domain, 3–30 seeds plus a question, output of *new* papers. The closest proxies are systematic-review (SR) replication studies (seeds = included studies), RELISH (doc→doc), and the BEIR biomedical subsets (question→doc). The agentic-search benchmarks are almost all computer science.

---

## 0. Verdicts at a glance

| Stage | Best-supported choice |
|---|---|
| 1. Candidates | **Union of three channels**: (a) the seeds' citation neighbourhood (backward, forward, co-citation, bibliographic coupling), plus a second hop from high-confidence hits; (b) PubMed Similar Articles for each seed; (c) LLM seed-guided multi-query search. Citation expansion drives recall the most. Neither citation nor text alone is enough. |
| 2. Representation | **Qwen3-Embedding-8B** (hosted on Nebius), title+abstract, with an instruction on the query side. Score each candidate against each seed separately, then fuse. Do not average the seeds into one centroid. |
| 3. Reranking | **LLM pointwise graded relevance (0–4) with logprobs**, judged against explicit criteria taken from the question and seeds. Use it on the top ~150 candidates. Set the cut-off by scoring the seeds themselves. Rank by the score; do not hard-filter. |
| 4. Fusion | **RRF to start**, then a tuned convex combination once there are labels (a few labels are enough). Citation and text fused together beat either one alone in every study found. |
| 5. Feedback | **Thumbs-up → treat as a new seed** (rerun citation expansion and Rocchio). Positive feedback is well supported. The value of negative feedback is barely tested. |
| 6. Explanations | **Deterministic provenance** (which channel found it, which seed it links to, the shared references by name, counts), plus a short LLM rationale that must quote a sentence from the abstract, checked by string match. The LLM never originates a reference or an ID. |
| 7. Evaluation | **SYNERGY plus the CLEF TAR seed collection** (held-out included studies), and **RELISH** for the doc→doc component. Report Recall@k, nDCG@k and WSS@95. Audit unjudged documents. |

---

## 1. Candidate generation

**Verdict:** take the union of the seeds' citation neighbourhood (backward, forward, co-citation and bibliographic coupling, one hop, then a second hop from accepted or high-confidence papers), PubMed Similar Articles per seed, and LLM-generated seed-guided queries (PubMed, Europe PMC and OpenAlex search; Tavily restricted to scholarly domains for preprints, very recent work and grey literature). Keep the provenance of every candidate. Citation search alone and query search alone each miss 25–60% of what the union finds.

### 1a. Citation-based

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| Snowballing (refs of refs) | 1 complex-evidence SR, 495 sources | share of sources found | 51% snowballing vs **30%** protocol database search; 24% personal contacts | [P] [Greenhalgh & Peacock 2005](https://pmc.ncbi.nlm.nih.gov/articles/PMC1283190) |
| Checking reference lists | 12 method studies | additional unique yield | 2.5%–42.7%; studies at high risk of bias | [P] [Horsley 2011 Cochrane MR000026](https://doi.org/10.1002/14651858.MR000026.pub2) |
| Citation tracking (scoping review) | 47 method studies | studies showing added value | 45/47 (96%) | [P] [TARCiS, BMJ 2024 (AAM)](https://eprints.whiterose.ac.uk/id/eprint/214348) |
| Same review's own search | its included studies | share found by method | backward 28%, forward 12%, database 52% | [P] [TARCiS](https://doi.org/10.1136/bmj-2023-078384) |
| **CoCites** (co-citation + direct, 2 most-cited included studies as seeds) | 250 SRs/MAs | median recall (IQR) | **75% (50–90)** at a median of 873 titles screened; co-citation top-100 only 37.5%; direct citation only 50% | [P] [Janssens 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7006380/) |
| CoCites, by condition | same | recall | seed-pair similarity <0.1 → 34.4% vs ≥0.5 → **83.3%**; seeds with <20 citers 37.5% vs >200 citers 77.6%; target 0–1 y old 52.4% vs >10 y 73.9% | [P] same |
| CoCites, single most-cited seed | 101 favourable reviews (seeds cited >20×, similarity >0.2, all in PubMed) | combined recall | 86.7% (IQR 62.6–100) vs 87.5% with two seeds | [P] same |
| Citation search (Belter: DC+BC+CC) | 14 SRs | recall | 74% of included studies; 90% of reachable ones | [P] [Belter 2016](https://doi.org/10.1002/asi.23605) (abstract) |
| **DC vs BC vs CC vs pmra, 5 random seeds** | 3,000 biomedical SRs (2022) in NIH OCC | Recall@50, P@50 | CC ≈15% > pmra ≈12% > DC≈BC; **DC+BC+CC+pmra highest at every k ≤100**; P@50 ≈0.17 combined vs ≈0.10 pmra vs ≈0.08 DC/BC; DC+BC+CC ≈50% recall at k=1000 | [PP] [Sjögårde & Ahlgren 2024](https://arxiv.org/abs/2403.09295) |
| **BibliZap** (multi-level forward+backward, ranked), after a PubMed search | 66 SRs | mean sensitivity | **75% → 97%**; top-500 only: >90% of reviews reach ≥80% recall; cost: median +6,450 records | [P] [BibliZap, RSM 2026](https://doi.org/10.1017/rsm.2026.10079) |
| Citation clusters vs Boolean | 25 SRs | qualitative | "highly variable and unpredictable"; complements Boolean and finds new relevant papers | [PP] [Bascur 2023](https://arxiv.org/abs/2207.03299) |
| Stand-alone citation search | SR replications | guidance | "mostly missed literature" → TARCiS rec. 9: never stand-alone when completeness matters | [P] [TARCiS](https://doi.org/10.1136/bmj-2023-078384) |
| Connected Papers / Litmaps / ResearchRabbit / Inciteful | — | recall | **No peer-reviewed recall evaluation found** (Europe PMC search, 2026-10-18). Connected Papers = co-citation + bibliographic coupling similarity; Inciteful = PageRank + Adamic-Adar | [V] [Connected Papers about](https://www.connectedpapers.com/about), [HKUST guide](https://library.hkust.edu.hk/sc/inciteful/) |
| Personalized PageRank / random walk | — | — | No biomedical head-to-head against simple counts found. Global PageRank favours older papers (same guide) | — |

### 1b. Seed-driven ranking and query-by-document

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| SDR (Lee & Sun 2018), reproduction | CLEF TAR 2017 / 2018 / 2019 | MAP (initial ranking) | SDR-BOC-AES 0.198 vs BM25 0.181 (2017); 0.250 (2018); 0.283 vs QLM 0.261 (2019); few differences significant; exact original numbers not reproduced | [P] [Wang 2022 repro](https://arxiv.org/abs/2112.04090) |
| **Multi-seed vs best single seed** | same | MAP | 0.312→0.455, 0.335→0.478, 0.390→0.534 (**+37 to +48%**); multi-seed variance 53% lower than random single seed | [P] same |
| PubMed Similar Articles (pmra) vs BM25 | TREC 2005 Genomics | precision | "small but statistically significant" gain | [P] [Lin & Wilbur 2007](https://pmc.ncbi.nlm.nih.gov/articles/PMC2212667) |
| pmra vs embeddings (doc→doc) | RELISH | MAP@5 | random **79.3**, BM25 88.9, pmra 90.3, SPECTER 92.3, SciNCL 94.7, MedCPT 95.6 | [P] [MedCPT](https://arxiv.org/abs/2307.00589) |
| Semantic Scholar Recommendations API | — | — | No published evaluation. Internals: 2 linear SVMs (TF-IDF + SPECTER) on positive/negative papers; candidates from papers published in the last 60 days | [V] [S2 ODP paper](https://arxiv.org/abs/2301.10140) |
| S2 Recs: what comes back | 1 seed | publication dates | default pool: 19/20 results from 2026 (a "recent" feed only); `from=all-cs` pool returned library-guide pages | [OP] `api.semanticscholar.org/recommendations/v1/papers/forpaper/…` |
| OpenAlex `related_works` | — | — | "recent papers sharing the most topics"; no evaluation | [V] [OpenAlex docs](https://help.openalex.org/api-entities/works/work-object) |

### 1c. LLM-generated queries

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| ChatGPT Boolean (2023) | CLEF TAR (72 topics) / Seed collection (40) | recall | best prompt 0.50 vs manual 0.83 (CLEF); 0.13 vs 0.74 (Seed); recall varies 12% of its mean across reruns | [PP] [Wang 2023](https://arxiv.org/abs/2302.03495) |
| 10 LLMs incl. o1 (2025) | 71 CLEF / 40 Seed topics | recall | best unguided ≈0.58–0.65 vs manual 0.84 / 0.72 (gap ≈15%) | [PP] [Wang 2025 reassess](https://arxiv.org/abs/2505.07155) |
| **Seed-guided query per seed, then OR** | 40 Seed topics | recall / precision | **0.50–0.74 recall (no significant difference from manual 0.72)** at precision 0.0002–0.017 | [PP] same |
| Reproduction without query validation | CLEF / Seed | recall | much lower (invalid queries retrieve nothing) → **always validate the syntax and hit count** | [P] [Staudinger 2024](https://arxiv.org/abs/2411.14914) |
| Seed word-frequency query building (PubReMiner) | 12 reviews | sensitivity | below librarian searches (p=0.0065); inconsistent across librarians | [P] [Cochrane ESM 2026](https://doi.org/10.1002/cesm.70074) |
| HyDE | BEIR TREC-COVID / SciFact | nDCG@10 | Contriever 27.3→59.3 (BM25 59.5); SciFact 64.9→69.1 | [P] [Gao 2022](https://arxiv.org/abs/2212.10496) |
| query2doc | BEIR | nDCG@10 | BM25: TREC-COVID 65.6→72.2, SciFact 66.5→68.6; **strong dense E5+KD: SciFact 70.4→67.5 (−2.9)**, TREC-COVID 74.1→75.1 | [P] [Wang 2023](https://arxiv.org/abs/2303.07678) |
| Expansion vs retriever strength | 12 datasets × 24 retrievers | correlation | **strong negative correlation**: helps weak retrievers, hurts strong ones | [P] [Weller, EACL 2024](https://arxiv.org/abs/2309.08541) |

### 1d. Agentic systems: what drives recall

| System | Benchmark | Metric | Number | What drives it / source |
|---|---|---|---|---|
| **PaSa-7B** (RL crawler + selector) | RealScholarQuery (50 AI queries) | Recall@20 | **0.58** vs Google 0.18, Google Scholar 0.15, Google+GPT-4o 0.20 | [P] [He 2025](https://arxiv.org/abs/2501.10120) |
| PaSa ablation | same | final recall | full 0.611; **without citation [Expand] 0.289**; without RL 0.412 → citation expansion is the main recall driver, RL second | [P] same |
| PaSa selector (LLM yes/no) | 200 query–paper pairs | P / R | GPT-4o 0.96 / **0.69**; tuned 7B 0.95 / 0.78 → binary LLM filters drop 20–30% of relevant papers | [P] same |
| ScholarQuest (PaSa, SPAR, PaperScout) | 1,000+ CS topics | Recall@100 | best agent 0.312 vs best single-shot retriever 0.212; PaSa 0.280, SPAR 0.269; more planner tokens ≠ more recall | [PP] [Pan 2026](https://arxiv.org/abs/2606.20235) |
| SPAR (multi-agent, RefChain) | AutoScholar / SPARBench | F1 | 0.384 / 0.302 | [PP] [Shi 2025](https://arxiv.org/abs/2507.15245) |
| PaperQA2 (biology) | LitQA2 | precision / accuracy | 85.2% / 66.0% vs PhD researchers 73.8% / 67.7%; **removing citation traversal significantly lowered DOI recall (p=0.022)**; ranks candidates cited by ≥2 relevant papers first | [PP] [Skarlinski 2024](https://arxiv.org/abs/2409.13740) |
| OpenScholar | ScholarQA-CS | citation F1 | removing the reranker: **47.9 → 28.2** | [P] [Asai 2024/Nature](https://arxiv.org/abs/2411.14199) |
| Undermind | ~300 user queries, arXiv only | relevant hits vs Google Scholar | "~10×" more; discovery curve f = 1−e^(−n/τ), median τ ≈ 80 papers read; 150 read → ~85% found. **Circular**: its own GPT-4 classifier judged the Google Scholar results | [V] [whitepaper](https://www.undermind.ai/whitepaper.pdf) |
| Elicit | vendor: 994 reviews / independent: 4 syntheses | sensitivity | vendor **95.0%** vs independent **39.5%** (25.5–69.2) [original reviews 94.5%]; 33.3% in 3 other SRs | [V] [Elicit blog](https://elicit.com/blog/evaluating-elicit-slr) · [P] [Cochrane ESM 2025](https://doi.org/10.1002/cesm.70050) · [PP] [OSF 2026](https://doi.org/10.31222/osf.io/cyu3m_v1) |
| Search engines on specific queries | LitSearch (ML/NLP), n=80 | Recall@5, inline-citation questions | Google 23.1, Google Scholar 20.5, Elicit 23.1 vs dense GritLM 67.7 | [P] [Ajith 2024](https://arxiv.org/abs/2407.18940) |

**What is reproducible in 2 days:** multi-query generation, 1–2 hop citation expansion from high-confidence papers, an LLM relevance judge, and iteration until the yield of new relevant papers flattens (the Undermind-style curve). **Not reproducible:** RL-trained crawlers (PaSa), or custom-trained retrievers and rerankers (OpenScholar).

**Caveats.**
- The citation-method numbers come from SR replications. Reviewers often found studies by citation chasing in the first place, so citation methods look better than they would otherwise (Sjögårde notes this).
- Co-citation **cannot reach papers that nobody has cited yet**, and recall drops for papers 0–1 years old (CoCites: 52%). For "new" papers you need forward citations, bibliographic coupling and text.
- PaSa, ScholarQuest and LitSearch are CS/ML benchmarks, so they do not test biomedical domain transfer.
- Tavily has no published scholarly-recall evaluation (UNVERIFIED). Web engines score low on specific scholarly queries (rows above), so treat Tavily as a supplementary channel. Use `include_domains` (up to 300) and date filters ([Tavily docs](https://docs.tavily.com/documentation/api-reference/endpoint/search)).

---

## 2. Representation and first-stage ranking

**Verdict:** **Qwen3-Embedding-8B via Nebius** on title+abstract. Prefix the instruction on the query side only (this is how MTEB runs it). Use it for question→paper and for seed→paper. Score each candidate against each seed separately and fuse with RRF/max, adding the question as one extra "seed". **Do not use a single seed centroid.** SPECTER2 is fine for doc→doc but weak for question→doc. MedCPT is a good local cross-check but is not hosted on Nebius.

| Model | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| **Qwen3-Embedding-8B** | BEIR TREC-COVID / NFCorpus / SciFact / SCIDOCS | nDCG@10 | **0.950*** / 0.415 / 0.785 / 0.327 | [V] [MTEB results repo](https://github.com/embeddings-benchmark/results/tree/main/results/Qwen__Qwen3-Embedding-8B) |
| Qwen3-Embedding-4B / 0.6B | same | nDCG@10 | 0.929 / 0.411 / 0.783 / 0.314 · 0.905 / 0.367 / 0.697 / 0.244 | [V] same repo |
| NV-Embed-v2 (non-commercial licence) | same | nDCG@10 | 0.889 / 0.450 / 0.801 / 0.219 | [V] same repo |
| e5-mistral-7b-instruct | same | nDCG@10 | 0.870 / 0.386 / 0.764 / 0.163 | [V] same repo |
| bge-multilingual-gemma2 | same | nDCG@10 | 0.643 / 0.381 / 0.720 / 0.269 | [V] same repo |
| bge-m3 (dense) | same | nDCG@10 | 0.547 / 0.314 / 0.644 / 0.163 | [V] same repo |
| BMRetriever-7B (biomedical) | same | nDCG@10 | 0.861 / 0.364 / 0.778 / 0.201 | [P] [Xu 2024](https://arxiv.org/abs/2404.18443) |
| MedCPT retriever / + cross-encoder | same (+BioASQ) | nDCG@10 | 0.697 / 0.340 / 0.724 / 0.123 → **0.709 / 0.355 / 0.761 / 0.172**; BioASQ 0.332 → 0.553 | [P] [Jin 2023](https://arxiv.org/abs/2307.00589) |
| SPECTER2 (question→doc) | TREC-COVID / NFCorpus / SciFact | nDCG@10 | 0.584 / 0.228 / 0.671 (below BM25 0.656 / 0.325 / 0.665) | [P] [Xu 2024 Table 2](https://arxiv.org/abs/2404.18443) |
| Overall (MTEB English v2 mean) | 41 tasks | mean | Qwen3-8B 75.22, 4B 74.60, 0.6B 70.70; gte-Qwen2-7B 70.72; NV-Embed-v2 69.81 | [V] [Qwen3 report](https://arxiv.org/abs/2506.05176) |
| **Doc→doc, RELISH** (SciRepEval-style) | 3.2k seed articles | MAP / nDCG | MedCPT 83.6 / 89.7; E5-large-v2 84.9 / 91.0; e5-mistral 85.2 / 90.8; BMRetriever-7B 86.7 / 92.2 | [P] [Xu 2024 Table 3](https://arxiv.org/abs/2404.18443) |
| Doc→doc, RELISH (Zhang 2022 split) | same | MAP@5 | random 79.3 · BM25 88.9 · SPECTER 92.3 · SciNCL 94.7 · MedCPT 95.6 | [P] [Jin 2023](https://arxiv.org/abs/2307.00589) |
| SPECTER2 adapters (proximity) | SciRepEval | average | 71.1 vs SPECTER 67.5, SciNCL 68.8 | [P] [model card](https://huggingface.co/allenai/specter2) |
| Full text vs title+abstract | LitSearch | Recall@5 | no consistent gain (GritLM 67.7 → 63.4 with full text) | [P] [Ajith 2024](https://arxiv.org/abs/2407.18940) |
| MeSH-augmented embeddings | RELISH | P@5 | +0.016 on doc2vec; still 0.068 below fine-tuned BioBERT | [P] [J Biomed Sem 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC13476922/) |

**Hosted on Nebius:**
- Confirmed: Qwen3-Embedding-8B (4,096-dim) ([LangChain/Nebius](https://docs.langchain.com/oss/python/integrations/embeddings/nebius)).
- Listed earlier but not re-confirmed: e5-mistral-7b-instruct and bge-multilingual-gemma2 ([Nebius blog](https://nebius.com/blog/posts/studio-embeddings-vision-and-language-models)).
- bge-en-icl is reported retired.
- No rerank endpoint: [feature request still "In Review"](https://ideas.nebius.com/p/feature-request-add-cross-encoder-reranking-support-via-rerank-or).
- **Check `GET /v1/models` before building.**

### Multi-seed aggregation

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| Multi-seed (concatenated) vs best single seed | CLEF TAR | MAP | +37 to +48% | [P] [Wang 2022](https://arxiv.org/abs/2112.04090) |
| Incoherent vs coherent seed sets | 250 SRs | recall | 34.4% vs 83.3% (CoCites similarity index) | [P] [Janssens 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7006380/) |
| Group fusion over multiple actives (analogue domain) | virtual screening | — | **MAX rule beats SUM rule** | [P] [Whittle 2006 JCIM](https://doi.org/10.1021/ci0496144) (abstract) |
| Sum of per-seed citation counts | 3,000 SRs | Recall@k | works (no comparison against max) | [PP] [Sjögårde 2024](https://arxiv.org/abs/2403.09295) |
| Dense Rocchio with 1–3 strongly relevant examples | TREC DL19 (MS MARCO) | nDCG@10 | ANCE 0.677 → **0.751**; with *non-relevant* examples 0.677 → 0.648 | [P] [Li 2022](https://arxiv.org/abs/2205.05888) |

**Caveats.**
- *Qwen3-8B's TREC-COVID score of 0.950 is an outlier: the next best are 0.87–0.89. TREC-COVID is not among Qwen3's declared training sets ([MTEB model meta](https://github.com/embeddings-benchmark/mteb/blob/main/mteb/models/model_implementations/qwen3_models.py)), but its synthetic training data is not auditable. Treat it as UNVERIFIED and possibly contaminated. MTEB scores are self-submitted.
- **No published RELISH number exists for Qwen3-Embedding.** Run the check yourselves (about 30 minutes).
- No biomedical head-to-head of centroid vs max-sim vs per-seed RRF was found, so the aggregation verdict is an inference (UNVERIFIED). It rests on the seed-coherence effect and on the MAX>SUM analogue.
- RELISH scores are compressed (random already gets 79%), so a 1–3 point gap between models matters.

---

## 3. Reranking and relevance assessment

**Verdict:** an LLM on Nebius scores each of the top ~150 fused candidates on a **0–4 graded scale**. The score is the **expected relevance from token logprobs**, judged against **explicit criteria** that the LLM extracts from the question and seeds and the user can edit. Score the seeds with the same prompt and use them as calibration anchors for the cut-off. Use the score for ranking; never hard-exclude on a binary yes/no. Use listwise reranking only with permutation self-consistency. Few-shot seed abstracts have weak evidence: use the seeds to derive criteria and calibrate, not as raw examples.

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| RankGPT GPT-4 listwise (on BM25 top-100) | TREC-COVID / NFCorpus / SciFact | nDCG@10 | 85.5 / 38.5 / 75.0 vs BM25 59.5 / 30.8 / 67.9; monoT5-3B 80.7 / 39.0 / 76.6; Cohere-v2 81.8 / 36.4 / 74.4 | [P] [Sun 2023](https://arxiv.org/abs/2304.09542) |
| **Graded 0–4 pointwise vs yes/no** (FLAN-PaLM2) | 8 BEIR sets | mean nDCG@10 | **0.502 vs 0.477**; TREC-COVID 0.805 vs 0.790; SciFact 0.752 vs 0.696 | [P] [Zhuang 2023](https://arxiv.org/abs/2310.14122) |
| Pointwise yes/no vs setwise (Flan-T5) | BEIR | mean nDCG@10 | yes/no 0.386–0.420 vs setwise 0.483–0.505 (small models; pointwise is the cheapest) | [P] [Zhuang 2024](https://arxiv.org/abs/2310.09497) |
| Position bias fix (permutation self-consistency) | 5 list-ranking sets | relative gain | +7–18% (GPT-3.5), +8–16% (Llama-2-70B) | [P] [Tang, NAACL 2024](https://arxiv.org/abs/2310.07712) |
| LLM rerank over a strong dense retriever | LitSearch | Recall@5 | +4.4 (GPT-4o over GritLM) | [P] [Ajith 2024](https://arxiv.org/abs/2407.18940) |
| Qwen3-Reranker vs bge-reranker-v2-m3 (on Qwen3-0.6B top-100) | MTEB-R English | nDCG | 0.6B 65.80, 4B 69.76, 8B 69.02; bge-v2-m3 **57.03, below the first stage alone (61.82)** | [V] [Qwen3 report](https://arxiv.org/abs/2506.05176) |
| **Criteria-framework prompts (GPT-4)** | 10 SRs, 48,425 citations | weighted sensitivity / specificity | **97.7% / 85.2%** (abstracts); **zero-shot prompt sensitivity only 49.0%**; full text 96.5% / 91.2%; $157 per 10k citations vs >83 h of human work | [P] [Cao, Ann Intern Med 2025](https://doi.org/10.7326/ANNALS-24-02189) |
| Six LLMs, zero-shot plus criteria | 23 Cochrane SRs, 119,695 records | sensitivity / specificity / **precision** | GPT-4o 0.904 / 0.949 / **0.038**; Sonnet-3.5 0.823 / 0.982 / 0.096; Gemini-1.5 0.756 / 0.976 / 0.068; more inclusive prompts raise recall and lower precision (R=−0.47) | [P] [Sanghera, JAMIA 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12012331/) |
| Meta-analysis, 18 studies | title/abstract screening | pooled sensitivity / specificity | 0.92 / 0.94; examples or CoT "significantly improved sensitivity" (no effect sizes given) | [PP] [medRxiv 2026](https://www.medrxiv.org/content/10.64898/2026.03.17.26348656v1) |
| **Seed-calibrated threshold** (yes/no logit, LLaMA2-7B) | CLEF TAR + Seed collection | recall at target 0.95 | 0.90–0.94; WSS 0.41–0.46; ensemble WSS 0.45–0.54 | [P] [Wang, ECIR 2024](https://arxiv.org/abs/2401.06320) |
| Random few-shot vs criteria prompt | Cao preprint | sensitivity | few-shot 56% vs framework CoT 86.5% (**UNVERIFIED**, search snippet only) | [PP] [medRxiv 2024](https://www.medrxiv.org/content/10.1101/2024.06.01.24308323v1) |
| Llama-3.1-8B zero-shot vs TF-IDF classifiers | 6 SRs | qualitative | LLM matches human recall (0.86) but has lower specificity | [P] [Syst Rev 2026](https://doi.org/10.1186/s13643-026-03199-6) |

**Caveats.**
- The screening studies label against SR inclusion after full-text review. That is stricter than "relevant to my question", so sensitivity and specificity transfer only loosely.
- Precision collapses when relevant papers are rare (≈2–10% at a 1–2% base rate). Keep the candidate pool enriched before LLM judging.
- Pointwise logprobs need `logprobs`. Nebius documents it on the completions endpoint ([docs](https://docs.tokenfactory.nebius.com/api-reference/inference/create-completion.md)); chat support is UNVERIFIED.
- Cost estimate (my arithmetic, not sourced): 150 candidates × ~1.2k tokens ≈ 0.18M input tokens per query. All calls can run in parallel.

---

## 4. Fusion of signals

**Verdict:** RRF (k≈60) over the per-signal rankings to start: citation counts, pmra, max-seed cosine, question cosine and the channel lists. Once 20–50 labels exist (SYNERGY dev or user thumbs), switch to a tuned convex combination. In the final ordering the LLM grade dominates and the fused first-stage score acts as a prior or tie-breaker. **Combining citation and text beat either alone in every study found.**

| Evidence | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| Convex combination vs RRF | BEIR + MS MARCO | nDCG | CC beats RRF in-domain and out-of-domain; RRF is **sensitive to k**; CC is tunable from a small sample | [P] [Bruch, TOIS 2023](https://arxiv.org/abs/2210.11934) |
| Rank fusion of many runs | TREC-COVID round 5 | NDCG@20 | top run was a reciprocal-rank-fusion ensemble (UPrrf93-wt-r5), **0.850**; the team's round-2 system fused 102 lexical, dense, reranker and feedback runs; no automatic (no-feedback) run in the round-5 top 25 | [P] [Roberts 2021](https://arxiv.org/abs/2104.09632) |
| Citation (DC+BC+CC) + text (pmra) | 3,000 biomedical SRs | Recall@k, P@50 | combined best at k = 1–100; P@50 ≈0.17 vs ≈0.10 text-only | [PP] [Sjögårde 2024](https://arxiv.org/abs/2403.09295) |
| Co-citation + content (Microsoft Academic) | user study, 40 people, 2,400 pairs | P@10 (score ≥3) / nDCG | combined **0.533** / 0.891 vs co-citation 0.315 / 0.851 vs content 0.226 / 0.789 | [P] [Kanakia, WWW 2019](https://arxiv.org/abs/1905.08880) |
| Search + citation expansion vs search only | RealScholarQuery | recall | 0.611 vs 0.289 | [P] [PaSa](https://arxiv.org/abs/2501.10120) |
| Database search + citation search | 66 SRs | sensitivity | 75% → 97% | [P] [BibliZap](https://doi.org/10.1017/rsm.2026.10079) |
| BM25 / TF-IDF / pmra on RELISH | RELISH | overlap | similar scores but **distinct recommendation sets** → a hybrid is needed | [P] [Brown 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC7291946) |

**Caveats.**
- Sjögårde's weights (DC/1 + BC/10 + CC/10) were "somewhat arbitrary". Raw bibliographic-coupling counts explode for hub references: weight them by 1/log(degree) (Adamic-Adar, as Inciteful does) or by overlap bins (as PaperQA2 does).
- No learned-to-rank (LTR) evidence specific to this task. Do not train LTR in two days.

---

## 5. Relevance feedback and human-in-the-loop

**Verdict:** treat a thumbs-up as a new seed. Rerun citation expansion around it (TARCiS rec. 8 recommends iterative citation searching) and update the embedding with Rocchio. Treat a thumbs-down as a negative: lower the scores of its close neighbours and add it to the criteria as an "exclude like this" note. Wrong positives actively hurt. Add an active-learning classifier (ASReview-style) only if users screen more than ~100 items.

| Method | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| ASReview active learning (prior: 1 relevant + 1 irrelevant) | 4 SRs | WSS@95 / RRF@10% | mean **83% (67–92%)** / 70–100% | [P] [van de Schoot 2021](https://arxiv.org/abs/2006.12166) |
| Active learning: NB/LR/SVM/RF × TF-IDF/doc2vec | 6 SRs | WSS@95 / recall@10% / ATD | 63.9–91.7% / 53.6–99.8% / 1.4–11.7%; NB+TF-IDF best | [P] [Ferdinands 2023](https://doi.org/10.1186/s13643-023-02257-7) |
| Dense Rocchio, k=1–3 judged examples | TREC DL19/20 | nDCG@10 | strong positives +0.05 to +0.09 (e.g. ANCE 0.677 → 0.751 on DL19); non-relevant examples hurt (0.677 → 0.648) | [P] [Li 2022](https://arxiv.org/abs/2205.05888) |
| Feedback vs automatic runs | TREC-COVID rounds 2–5 | rank | by round 3 no automatic run in the top 10; by round 5 the best automatic run ranked 33rd | [P] [Roberts 2021](https://arxiv.org/abs/2104.09632) |
| Iterative citation searching | method studies | qualitative | finds more eligible records; stop when an iteration adds nothing | [P] [TARCiS rec. 8](https://doi.org/10.1136/bmj-2023-078384) |

**Caveats.**
- The TREC-COVID feedback runs had hundreds of judgments per topic, not a handful.
- Dense Rocchio evidence comes from MS MARCO, not biomedicine.
- No evaluation of using negatives in dense Rocchio for this task was found (UNVERIFIED value).

---

## 6. Explanations and traceability

**Verdict:** every card shows deterministic evidence:
- the channel(s) that found the paper;
- the seed(s) it links to and how (cites, cited by, *n* shared references with names, co-cited *n* times);
- its nearest seed and the cosine;
- shared PubTator entities.

On top of that comes a 1–2 sentence LLM rationale that must quote a sentence from the candidate's abstract, verified by exact string match before display. Every ID and link comes from an API record, never from LLM text. Show S2 citation contexts when they exist.

| Evidence | Benchmark | Metric | Number | Source |
|---|---|---|---|---|
| LLM-cited papers without retrieval (biomedicine) | ScholarQA-Bio | fabricated references | GPT-4o **94.8%**, Llama-3.1-70B 96.6%; OpenScholar with retrieval 0% | [P] [Asai 2024](https://arxiv.org/abs/2411.14199) |
| Deep-research agents | DRBench, 10 systems | hallucinated / non-resolving URLs | 3–13% / 5–18%; URL checking cuts it to <1% | [PP] [2604.03173](https://arxiv.org/abs/2604.03173) |
| Free LLM platforms retrieving medical references | 2,000 references | complete miss | 47.8% | [PP] [2603.22344](https://arxiv.org/abs/2603.22344) |
| Attributed generation | ALCE (ELI5) | full citation support missing | 50% even for the best models | [P] [Gao, EMNLP 2023](https://arxiv.org/abs/2305.14627) |
| Unfaithful CoT rationales | BIG-Bench Hard | accuracy drop from unmentioned bias | up to 36% | [P] [Turpin, NeurIPS 2023](https://arxiv.org/abs/2305.04388) |
| scite intent labels | 324 citations, independent | F-measure | only 98 of 324 classified; F 0.0–0.58 | [P] [Bakker 2023](https://journals.indianapolis.iu.edu/index.php/hypothesis/article/view/26528) |
| scite (developer figures) | — | per-class accuracy | mentioning 97%, supporting 64%, contrasting 59% (**UNVERIFIED**, second-hand) | [V] [HKUST guide](https://library.hkust.edu.hk/sc/trial-scite/) |
| Citation-intent model (SciCite) | SciCite | macro-F1 | 84.0 (**UNVERIFIED**, second-hand) | [P] [Cohan 2019](https://arxiv.org/abs/1904.01608) |
| S2 citation contexts coverage | 2 papers, 164 citing papers | share with contexts / intents | 62% and 50% / 0% and 28% | [OP] `graph/v1/paper/{id}/citations?fields=contexts,intents` |
| PubTator3 | 36M abstracts | entity/relation annotations | >1B; precision of top-20 entity-pair searches above PubMed and Google Scholar | [P] [Wei 2024 NAR](https://doi.org/10.1093/nar/gkae235) |

**Caveats.**
- LLM rationales are plausible summaries, not proof of *why* a paper ranked high. Show the raw signals next to them.
- Citation intents are too sparse and noisy to rank on. Show them as context only.

---

## 7. Evaluation

**Verdict:**
- **Setup.** Simulate the task on **SYNERGY** and the **CLEF TAR seed collection**. Seeds are *k* ∈ {3, 5, 10} included studies, either sampled or the real seeds. The question is the SR title or objective. Positives are the held-out included studies. Cut the graph off at the review's search date and remove the SR itself and any later reviews.
- **Doc→doc component.** Check it on **RELISH**.
- **Metrics.** Recall@20/50/100, nDCG@20, WSS@95 (for a full ranking) and the per-channel unique contribution.
- **Holes audit.** LLM-judge a sample of unjudged top-20 papers and report it separately.

### Benchmarks

| Benchmark | Fit to this task | Size | Labels | Source |
|---|---|---|---|---|
| **SYNERGY** | high: seeds = included studies; OpenAlex IDs give the citation graph | 26 SRs, 169,288 records, 2,834 inclusions (1.67%); mostly medicine | SR inclusion | [GitHub](https://github.com/asreview/synergy-dataset) |
| **CLEF TAR 2017–19 + Seed collection** | high: real seed studies | 72 CLEF topics (2017+18); 2019 adds 38 intervention reviews; Seed collection 40 topics | abstract- and content-level qrels | [Wang 2023](https://arxiv.org/abs/2302.03495), [Wang 2022](https://arxiv.org/abs/2204.03096) |
| CSMeD | medium: more SRs, mixed quality | 325 SRs from 9 collections | SR inclusion | [NeurIPS D&B 2023](https://proceedings.neurips.cc/paper_files/paper/2023/hash/4962a23916103301b27bde29a27642e8-Abstract.html) |
| **RELISH** | doc→doc only | 3.2k seed articles, 196k pairs, ~60 candidates per seed | 3-level, mostly seed authors | [Brown 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC7291946), [SciRepEval](https://arxiv.org/abs/2211.13308) |
| TREC-COVID / NFCorpus / SciFact | question→doc only | 50 topics / 171k docs (TREC-COVID) | pooled, graded | [BEIR](https://arxiv.org/abs/2104.08663) |
| LitSearch, CSFCube, DORIS-MAE, RealScholarQuery, ScholarQuest | **domain mismatch (CS)** | 597 queries / 50 query papers / 100 queries (LLM-annotated) / 50 / 1,000+ topics | various | [LitSearch](https://arxiv.org/abs/2407.18940), [CSFCube](https://arxiv.org/abs/2103.12906), [DORIS-MAE](https://arxiv.org/abs/2310.04678) |

### Pitfalls

| Pitfall | Evidence | Source |
|---|---|---|
| **Unlabeled ≠ irrelevant** | TREC-COVID Hole@10: BM25 6.4% vs TAS-B 31.8%; after filling the holes ANCE went 0.654 → 0.735 (from below BM25 to +6.7 above it) | [BEIR](https://arxiv.org/abs/2104.08663) |
| Pool bias in RELISH | candidates generated by BM25, TF-IDF and pmra; random MAP@5 = 79% | [Brown 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC7291946), [MedCPT](https://arxiv.org/abs/2307.00589) |
| SR gold = inclusion after full text, not "relevant" | topically relevant papers excluded on design count as false positives; LLM screening precision is 0.004–0.096 at a ~1% base rate | [Sanghera 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12012331/) |
| Citation-method advantage inflated | SR authors used citation tools; the SR's own reference list includes background papers | [Sjögårde 2024](https://arxiv.org/abs/2403.09295) |
| Seeds counted in recall | CoCites included its seed articles in recall → overestimate | [Janssens 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7006380/) |
| Temporal leakage | citations after the review date (including later reviews and updates) leak the answer set; recent papers are under-cited (recall 52% for papers 0–1 y old) → cut the graph at the search date | same, plus my analysis |
| LLM contamination | published SRs and their included lists are likely in LLM pretraining; no measured rate found (UNVERIFIED risk) | — |
| LLM-as-judge circularity | LLM judges inflate systems that use LLM rerankers | [Clarke & Dietz 2024](https://arxiv.org/abs/2412.17156) |
| Run-to-run variance | LLM Boolean recall varies 12% of its mean across reruns; report the mean over ≥3 runs | [Wang 2023](https://arxiv.org/abs/2302.03495) |

---

## Recommended pipeline (evidence-weighted)

1. **Resolve the seeds.** DOI/PMID/title → OpenAlex + PubMed + S2 IDs; fetch title, abstract, references and citers (OpenAlex `referenced_works` / `cited_by`; iCite for PMIDs). Flag seeds that resolve poorly.
2. **Candidates (union, each with provenance):**
   - **Citation:** backward and forward for every seed. Co-citation: count, over the seeds' citers, how often each paper is co-cited with a seed. Bibliographic coupling: shared references, weighted by Adamic-Adar to damp hub references. Keep per-seed counts. Evidence: Sjögårde, CoCites, BibliZap.
   - **PubMed Similar Articles** for each seed (ELink `pubmed_pubmed`, keep `score`). Evidence: Sjögårde shows pmra adds value on top of citation signals.
   - **Seed-guided queries:** the LLM writes 1 query per seed plus 2–4 facet queries from the question, all OR'ed. Validate the syntax and hit count. Run them on PubMed ESearch, Europe PMC and OpenAlex search. Add Tavily (`include_domains` = PubMed, Europe PMC, bioRxiv, medRxiv, journals) for preprints and very recent work. Evidence: Wang 2025.
   - **Second hop:** expand backward and forward from candidates the LLM grades ≥3 or the user approves. Prefer papers linked to ≥2 relevant papers (PaperQA2 bins). Stop when an iteration's share of new ≥3 papers is small (Undermind curve; TARCiS rec. 8).
   - Cap the pool at ~2–5k after dedup (my choice, not sourced).
3. **First stage.**
   - Embed with Qwen3-Embedding-8B (verify the instruction format with the model card).
   - Features: max and top-2 mean cosine to the seeds, cosine to the question, per-seed DC/BC/CC counts, pmra score, number of channels that hit.
   - Fuse with **RRF**. Later, tune **CC weights** on SYNERGY dev.
4. **Rerank the top ~150.** The LLM on Nebius grades 0–4 with logprobs and returns the expected grade. The prompt holds the question, editable criteria (PICO/concepts extracted from the question and seeds), 2–3 one-line seed summaries and the candidate's title and abstract. Output JSON: grade, criteria met, verbatim evidence quote. **Score the seeds too**: the minimum seed grade sets the "likely relevant" line. Optionally run a two-model ensemble for robustness (Sanghera).
5. **Final rank.** Sort by LLM expected grade, then the fused score; dedupe; show grade bands instead of a hard cut.
6. **Feedback.** Thumbs-up → new seed, rerun steps 2–5 incrementally. Thumbs-down → lower the scores of near neighbours and add an exclusion note to the criteria.
7. **Card UX (traceability).** Metadata (year, venue, type, citation count/RCR) and links (DOI, PubMed, OpenAlex, S2). "Found via" chips. "Linked to seed X: cites it / shares *n* refs [names] / co-cited *n*×". Nearest seed plus similarity. LLM rationale with the quote highlighted and string-verified. S2 citation context if present.
8. **Offline check before the demo** (half a day). Pick 5–8 SYNERGY reviews, use 5 seeds and the question, and report Recall@50/100 per channel and fused, plus nDCG@20. Run a 200-seed RELISH spot-check of Qwen3 against MedCPT.

## Things that sound good but evidence says skip

- **LLM proposing papers or references from memory**: 94.8% fabricated in biomedicine ([OpenScholar](https://arxiv.org/abs/2411.14199)). Every paper must come from an API record.
- **HyDE / query2doc on top of a strong embedder**: gains vanish or turn negative (E5 SciFact −2.9; [Weller](https://arxiv.org/abs/2309.08541)). Use LLM queries for *lexical* search channels only.
- **LLM Boolean query as the main channel**: unguided recall ≈0.58–0.65 vs manual 0.72–0.84 ([Wang 2025](https://arxiv.org/abs/2505.07155)).
- **A single seed centroid**: incoherent seed sets cut recall from 83% to 34% (CoCites). Use per-seed max or fusion (MAX>SUM in group fusion).
- **Co-citation only or PageRank-style "important papers"**: they cannot reach uncited new papers and favour older ones ([Sjögårde](https://arxiv.org/abs/2403.09295); Inciteful guide).
- **S2 Recommendations API or OpenAlex `related_works` as the core recommender**: S2's pool is the last ~60 days ([S2 ODP](https://arxiv.org/abs/2301.10140), own probe); `related_works` is a topic-overlap heuristic with no evaluation. Use them as minor channels at most.
- **Commercial agent outputs as ground truth or a channel** (Elicit, Undermind): independent sensitivity is 39.5% vs the vendor's 95% ([Cochrane ESM 2025](https://doi.org/10.1002/cesm.70050)).
- **Hard binary LLM filtering**: GPT-4o selector recall is 0.69 at 0.96 precision ([PaSa](https://arxiv.org/abs/2501.10120)); zero-shot sensitivity is 49% ([Cao](https://doi.org/10.7326/ANNALS-24-02189)). Grade and rank instead.
- **Long listwise LLM reranking without permutation**: position bias costs 7–18% ([Tang](https://arxiv.org/abs/2310.07712)). Pointwise graded scoring is parallel and calibratable.
- **A weak cross-encoder after a strong embedder**: bge-reranker-v2-m3 scored below its Qwen3 first stage (57.0 vs 61.8, [V]).
- **Full-text embeddings, MeSH feature engineering**: no consistent gain ([LitSearch](https://arxiv.org/abs/2407.18940); +0.016 P@5 [MeSH](https://pmc.ncbi.nlm.nih.gov/articles/PMC13476922/)).
- **Ranking on citation-intent labels (scite / S2 intents)**: F 0.0–0.58 and sparse coverage. Display them only.
- **RL-trained crawlers or learned LTR in two days**: PaSa's RL adds +6–20% recall, but its citation expansion adds more and needs no training.
- **Trusting "superhuman" or "10×" claims**: they rest on vendor-built, circular or CS-only evaluations.
