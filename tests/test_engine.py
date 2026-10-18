from engine.language import clip, verify_quote
from engine.pubmed import parse_efetch
from engine.run import _rrf
from engine.web import clean_doi

EFETCH = """<PubmedArticleSet><PubmedArticle>
<MedlineCitation><PMID>1</PMID><Article>
  <Journal><ISOAbbreviation>N Engl J Med</ISOAbbreviation>
    <JournalIssue><PubDate><Year>2021</Year><Month>Mar</Month></PubDate></JournalIssue></Journal>
  <ArticleTitle>Semaglutide in <i>adults</i> with obesity.</ArticleTitle>
  <Abstract>
    <AbstractText Label="BACKGROUND">Weight loss with GLP-1 <sup>1</sup> agonists is large.</AbstractText>
    <AbstractText Label="RESULTS">Mean change was -14.9%.</AbstractText>
  </Abstract>
  <AuthorList><Author><LastName>Wilding</LastName><Initials>JPH</Initials></Author></AuthorList>
  <PublicationTypeList><PublicationType>Randomized Controlled Trial</PublicationType></PublicationTypeList>
  <DataBankList><DataBank><DataBankName>ClinicalTrials.gov</DataBankName>
    <AccessionNumberList><AccessionNumber>NCT03548935</AccessionNumber></AccessionNumberList></DataBank></DataBankList>
</Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1056/NEJMoa2032183</ArticleId>
  <ArticleId IdType="pmc">PMC123</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle></PubmedArticleSet>"""


def test_efetch_keeps_text_after_inline_markup():
    [paper] = parse_efetch(EFETCH)
    assert paper.title == "Semaglutide in adults with obesity"
    assert paper.abstract == "Weight loss with GLP-1 1 agonists is large. Mean change was -14.9%."
    assert (paper.doi, paper.pmcid, paper.date) == ("10.1056/nejmoa2032183", "PMC123", "2021-03")
    assert paper.authors == ["Wilding JPH"]
    assert paper.nct_ids == ["NCT03548935"]
    assert paper.study_type == "Randomised trial"


def test_quote_is_the_abstracts_own_sentence_or_nothing():
    abstract = "Background matters. Mean weight change was -14.9% with semaglutide at week 68. More text."
    assert verify_quote("mean weight change was −14.9% with semaglutide at week 68", abstract) == \
        "Mean weight change was -14.9% with semaglutide at week 68."
    assert verify_quote("Semaglutide cured obesity in every single participant.", abstract) is None


def test_reason_is_clipped_at_a_word_boundary():
    assert clip("one two three four", 3) == "one two three…"
    assert clip("short reason", 15) == "short reason"


def test_rrf_rewards_agreement_over_a_single_top_rank():
    fused = _rrf([["a", "b"], ["b", "c"], ["b"]])
    assert max(fused, key=fused.get) == "b"


def test_preprint_dois_lose_version_and_view_suffixes():
    assert clean_doi("10.1101/2024.01.02.24300712v2.full") == "10.1101/2024.01.02.24300712"
    assert clean_doi("10.1056/NEJMoa2032183).") == "10.1056/nejmoa2032183"
