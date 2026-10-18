"""The one record every source is normalised into."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_URL_DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s?#]+)")
# bioRxiv/medRxiv URLs append a version and a view to the DOI: …/2024.01.02.123456v2.full
_URL_DOI_SUFFIX_RE = re.compile(r"(v\d+)?(\.(full|abstract|supplementary-material)(\.pdf|-text)?)?/?$")


@dataclass
class Paper:
    """A paper as the engine knows it.

    `id` is `pmid:<n>` when PubMed has the paper, else `doi:<doi>` (preprints).
    Optional fields stay empty when no source supplied them; nothing is guessed.
    """
    id: str
    title: str
    abstract: str = ""
    year: int | None = None
    venue: str = ""
    authors: list[str] = field(default_factory=list)
    doi: str | None = None
    pmid: str | None = None
    citations: int | None = None
    rcr: float | None = None          # NIH relative citation ratio, field-normalised
    preprint: bool = False
    types: list[str] = field(default_factory=list)    # PubMed publication types
    epmc: str | None = None           # Europe PMC "source/id", e.g. "PPR/PPR123456", for records PubMed lacks

    @property
    def links(self) -> dict[str, str]:
        out = {}
        if self.pmid:
            out["pubmed"] = f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"
        if self.doi:
            out["doi"] = f"https://doi.org/{self.doi}"
        if self.pmid:
            out["europepmc"] = f"https://europepmc.org/article/MED/{self.pmid}"
        elif self.epmc:
            out["europepmc"] = f"https://europepmc.org/article/{self.epmc}"
        return out

    @property
    def text(self) -> str:
        """What gets embedded and judged."""
        return f"{self.title}\n\n{self.abstract}".strip()


def paper_id(*, pmid: str | None = None, doi: str | None = None) -> str:
    if pmid:
        return f"pmid:{pmid}"
    if doi:
        return f"doi:{doi.lower()}"
    raise ValueError("paper needs a pmid or a doi")


def title_key(title: str) -> str:
    """A title reduced to what an exact-match lookup should compare: letters and digits, lowercased."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


def doi_in_url(url: str) -> str | None:
    """The DOI a URL embeds, without the version and view suffixes preprint servers add."""
    m = _URL_DOI_RE.search(url)
    return _URL_DOI_SUFFIX_RE.sub("", m.group(1)).lower() if m else None
