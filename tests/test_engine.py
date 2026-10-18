import asyncio
import json

import numpy as np

from engine import europepmc, landscape, nebius, pubmed, web
from engine.discover import Candidate, checked_brief, judge, make_plan, pubmed_query, resolve_seeds, rrf, verified_quote
from engine.paper import Paper
from engine.pubmed import parse_efetch

EFETCH = """<PubmedArticleSet><PubmedArticle>
<MedlineCitation><PMID>1</PMID><Article>
  <Journal><Title>N Engl J Med</Title><JournalIssue><PubDate><Year>2021</Year></PubDate></JournalIssue></Journal>
  <ArticleTitle>Semaglutide in <i>adults</i> with obesity</ArticleTitle>
  <Abstract>
    <AbstractText Label="BACKGROUND">Weight loss with GLP-1 <sup>1</sup> agonists is large.</AbstractText>
    <AbstractText Label="RESULTS">Mean change was -14.9%.</AbstractText>
  </Abstract>
  <PublicationTypeList><PublicationType>Randomized Controlled Trial</PublicationType></PublicationTypeList>
</Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1056/NEJMoa2032183</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle></PubmedArticleSet>"""


def test_efetch_keeps_text_after_inline_markup():
    [paper] = parse_efetch(EFETCH)
    assert paper.id == "pmid:1"
    assert paper.title == "Semaglutide in adults with obesity"
    assert paper.abstract == "Weight loss with GLP-1 1 agonists is large. Mean change was -14.9%."
    assert paper.doi == "10.1056/nejmoa2032183"
    assert paper.year == 2021
    assert paper.types == ["Randomized Controlled Trial"]


def test_rrf_rewards_agreement_over_a_single_top_rank():
    fused = rrf([["a", "b"], ["b", "c"], ["b"]])
    assert max(fused, key=fused.get) == "b"


def test_quote_must_appear_in_the_source():
    source = "Background.  Weight loss with\nsemaglutide was 14.9% at week 68."
    assert verified_quote('"weight loss with semaglutide was 14.9% at week 68."', source)
    assert verified_quote("Semaglutide cured obesity in every participant.", source) is None


def test_web_urls_resolve_to_paper_ids():
    assert web.identify("https://pubmed.ncbi.nlm.nih.gov/33567185/") == ("pmid", "33567185")
    assert web.identify("https://www.medrxiv.org/content/10.1101/2024.01.02.24300712v2.full") == \
        ("doi", "10.1101/2024.01.02.24300712")
    assert web.identify("https://pmc.ncbi.nlm.nih.gov/articles/PMC9272494/") == ("pmcid", "PMC9272494")
    assert web.identify("https://www.nature.com/articles/s41591-021-01234-5") == ("doi", "10.1038/s41591-021-01234-5")
    assert web.identify("https://example.com/blog/obesity") is None


def test_seeds_missing_from_pubmed_fall_back_to_europe_pmc(monkeypatch):
    preprint = Paper(id="doi:10.1101/2024.01.02.24300712", title="A preprint", doi="10.1101/2024.01.02.24300712",
                     preprint=True, epmc="PPR/PPR123")

    async def resolve(ref):
        return ref if ref.isdigit() else None

    async def fetch(pmids):
        return [Paper(id=f"pmid:{p}", pmid=p, title="In PubMed") for p in pmids if p == "33567185"]

    async def by_doi(doi):
        return preprint if doi == preprint.doi else None

    async def by_title(title):
        return None

    monkeypatch.setattr(pubmed, "resolve", resolve)
    monkeypatch.setattr(pubmed, "fetch", fetch)
    monkeypatch.setattr(europepmc, "by_doi", by_doi)
    monkeypatch.setattr(europepmc, "by_title", by_title)
    warnings = []
    seeds = asyncio.run(resolve_seeds(["33567185", preprint.doi, "No such title", "99999999", "33567185"], warnings))
    assert [s.id for s in seeds] == ["pmid:33567185", preprint.id]
    assert [w.split(":")[0] for w in warnings] == [
        "Seed not in PubMed, so its Europe PMC preprint is used",
        "Seed not found in PubMed or Europe PMC",
        "Seed not found in PubMed",
    ]
    assert preprint.links["europepmc"] == "https://europepmc.org/article/PPR/PPR123"


def test_themes_split_two_clear_groups_the_same_way_every_time():
    rng = np.random.default_rng(1)
    a, b = np.eye(8)[0], np.eye(8)[1]
    vectors = np.vstack([a + rng.normal(0, 0.05, (8, 8)), b + rng.normal(0, 0.05, (6, 8))])
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    labels = landscape.kmeans(vectors, 2)
    assert labels.tolist() == [0] * 8 + [1] * 6     # the larger theme is numbered first
    assert (landscape.kmeans(vectors, 2) == labels).all()


def test_theme_names_also_read_from_group_keys(monkeypatch):
    async def chat_json(system, user, **_):
        return {"Group 1": "Semaglutide trials", "Group 2": "Tirzepatide trials"}

    monkeypatch.setattr(nebius, "chat_json", chat_json)
    names = asyncio.run(landscape.name_themes([["A semaglutide trial"], ["A tirzepatide trial"]]))
    assert names == ["Semaglutide trials", "Tirzepatide trials"]


def test_a_malformed_plan_is_retried_once(monkeypatch):
    replies = [{"criteria": ["Adults"]},
               {"criteria": ["Adults"], "pubmed_queries": ["q"], "preprint_queries": [], "web_queries": []}]

    async def chat_json(system, user, **_):
        return replies.pop(0)

    monkeypatch.setattr(nebius, "chat_json", chat_json)
    plan = asyncio.run(make_plan("Which drugs?", [Paper(id="pmid:1", title="Seed")]))
    assert plan["pubmed_queries"] == ["q"] and not replies


def test_pubmed_queries_lose_field_tags_that_stand_alone():
    written = '("semaglutide" OR "tirzepatide") AND ("obesity") AND [tiab] AND ("body weight"[tiab] OR "BMI")'
    assert pubmed_query(written) == '("semaglutide" OR "tirzepatide") AND ("obesity") AND ("body weight"[tiab] OR "BMI")'
    assert pubmed_query('[tiab] AND ("weight loss")') == '("weight loss")'


def test_the_brief_keeps_only_claims_it_can_check():
    abstracts = ["Semaglutide cut body weight by 14.9% at 68 weeks.", "Tirzepatide reduced weight by 20.9% over 72 weeks.",
                 "Liraglutide was compared with placebo."]
    papers = [Candidate(f"pmid:{i}", paper=Paper(id=f"pmid:{i}", title=f"Trial {i}", abstract=a))
              for i, a in enumerate(abstracts, 1)]
    findings = [
        {"text": "Semaglutide cut weight by 14.9%.", "papers": [1], "quote": abstracts[0]},
        {"text": "Tirzepatide reduced weight by 20.9%.", "papers": [2, 9], "quote": abstracts[1]},   # 9: no such paper
        {"text": "Liraglutide beat placebo.", "papers": [3], "quote": "Liraglutide beat placebo in every trial."},
        {"text": "Weight fell by 25% on semaglutide.", "papers": [1], "quote": abstracts[0]},   # 25 is in no abstract
    ]
    reply = {"answer": {"text": "Incretin drugs cut weight by up to 30%.", "papers": [1, 2]}, "findings": findings}
    brief = checked_brief(reply, papers)
    assert [f["papers"] for f in brief["findings"]] == [["pmid:1"], ["pmid:2"]]
    assert brief["answer"] is None and brief["dropped"] == 2
    assert checked_brief({"findings": findings[:1]}, papers) is None     # one finding that checks out is too few


def test_repeated_json_keys_join_their_lists():
    reply = '{"grades": [{"paper": 1}], "grades": [{"paper": 2}, {"paper": 3}], "note": "a", "note": "b"}'
    parsed = json.loads(reply, object_pairs_hook=nebius.merge_repeated_keys)
    assert [g["paper"] for g in parsed["grades"]] == [1, 2, 3] and parsed["note"] == "b"


def test_judge_reports_every_batch_even_one_that_fails(monkeypatch):
    calls = 0

    async def chat_json(system, user, **_):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("invalid JSON")
        return {"grades": [{"paper": 1, "grade": 4, "reason": "Meets the criteria", "quote": ""}]}

    monkeypatch.setattr(nebius, "chat_json", chat_json)
    candidates = [Candidate(f"pmid:{i}", paper=Paper(id=f"pmid:{i}", title=f"Paper {i}"), seed_sims=[0.5], fused=1 / i)
                  for i in range(1, 12)]       # 11 candidates + 1 seed: two batches of up to 8
    events, warnings = [], []
    asyncio.run(judge("Which drugs?", ["Adults"], [Paper(id="pmid:100", title="Seed")], candidates, warnings,
                      lambda event, **data: events.append(data)))
    assert [(e["done"], e["total"]) for e in events] == [(1, 2), (2, 2)]
    assert warnings[0].startswith("1 of 2 judge batches failed")
