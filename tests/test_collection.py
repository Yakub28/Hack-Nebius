from engine.collection import parse

RIS = """TY  - JOUR
TI  - Once-Weekly Semaglutide in Adults with Overweight or Obesity
AU  - Wilding, John P H
DO  - 10.1056/NEJMoa2032183
AN  - 33567185
DB  - PubMed
ER  -

TY  - JOUR
T1  - Tirzepatide Once Weekly for the Treatment of Obesity
UR  - https://doi.org/10.1056/NEJMoa2206038
ER  -

TY  - UNPB
TI  - A preprint known only by its title
N1  - PMID: 12345678
ER  -
"""

MEDLINE = """PMID- 33567185
OWN - NLM
TI  - Once-Weekly Semaglutide in Adults with Overweight or Obesity.
LID - 10.1056/NEJMoa2032183 [doi]

PMID- 35658024
TI  - Tirzepatide Once Weekly for the Treatment of Obesity: a very long title that
      wraps onto a second line.
AID - 10.1056/NEJMoa2206038 [doi]
AID - NEJMoa2206038 [pii]
"""

BIBTEX = r"""@comment{jabref-meta: databaseType:bibtex;}
@article{wilding2021,
  title = {Once-Weekly {Semaglutide} in Adults with Overweight or Obesity},
  author = {Wilding, John P. H. and Batterham, Rachel L.},
  journal = {New England Journal of Medicine},
  doi = {10.1056/NEJMoa2032183},
  pmid = {33567185},
}
@Article{jastreboff2022,
  Title = "Tirzepatide Once Weekly for the Treatment of Obesity",
  Year = 2022,
  Note = {PMID: 35658024},
}
@misc{preprint, title={Weight loss with \textit{retatrutide}}, url={https://www.medrxiv.org/content/10.1101/2024.01.02.24300712v2}}
"""

ZOTERO_CSV = '''"Key","Item Type","Publication Year","Author","Title","DOI","Url","Extra"
"ABCD1234","journalArticle","2021","Wilding, John","Once-Weekly Semaglutide, in Adults","10.1056/NEJMoa2032183","","PMID: 33567185"
"EFGH5678","journalArticle","2022","Jastreboff, Ania","Tirzepatide Once Weekly","","https://doi.org/10.1056/NEJMoa2206038",""
"IJKL9012","journalArticle","2023","","","","",""
'''


def refs(text):
    return [e.ref for e in parse(text).entries]


def test_ris_takes_pmid_over_doi_over_title():
    parsed = parse(RIS)
    assert parsed.format == "RIS"
    assert refs(RIS) == ["33567185", "10.1056/nejmoa2206038", "12345678"]
    assert parsed.entries[1].title == "Tirzepatide Once Weekly for the Treatment of Obesity"


def test_medline_joins_wrapped_titles_and_reads_doi_ids():
    parsed = parse(MEDLINE)
    assert parsed.format == "MEDLINE"
    assert refs(MEDLINE) == ["33567185", "35658024"]
    assert parsed.entries[1].doi == "10.1056/nejmoa2206038"
    assert parsed.entries[1].title.endswith("wraps onto a second line.")


def test_bibtex_handles_braces_quotes_notes_and_latex():
    parsed = parse(BIBTEX)
    assert parsed.format == "BibTeX"
    assert [e.title for e in parsed.entries] == [
        "Once-Weekly Semaglutide in Adults with Overweight or Obesity",
        "Tirzepatide Once Weekly for the Treatment of Obesity",
        "Weight loss with retatrutide",
    ]
    # The version suffix medRxiv adds to the URL is not part of the DOI.
    assert refs(BIBTEX) == ["33567185", "35658024", "10.1101/2024.01.02.24300712"]


def test_csv_reads_zotero_columns_and_counts_empty_rows():
    parsed = parse(ZOTERO_CSV)
    assert parsed.format == "CSV"
    assert refs(ZOTERO_CSV) == ["33567185", "10.1056/nejmoa2206038", None]


def test_a_plain_list_keeps_each_line_as_a_reference():
    text = "33567185\nhttps://pubmed.ncbi.nlm.nih.gov/35658024/\n\n10.1101/2024.01.02.24300712\nAn exact title\n"
    assert parse(text).format == "list"
    assert refs(text) == ["33567185", "35658024", "10.1101/2024.01.02.24300712", "An exact title"]


def test_windows_line_endings_and_bom():
    assert refs("﻿" + RIS.replace("\n", "\r\n")) == refs(RIS)
