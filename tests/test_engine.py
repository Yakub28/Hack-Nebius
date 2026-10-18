from engine import web
from engine.discover import rrf, verified_quote
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
    assert web.identify("https://example.com/blog/obesity") is None
