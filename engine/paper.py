"""The one record every source is normalised into."""
from __future__ import annotations

from dataclasses import dataclass, field


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

    @property
    def links(self) -> dict[str, str]:
        out = {}
        if self.pmid:
            out["pubmed"] = f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"
        if self.doi:
            out["doi"] = f"https://doi.org/{self.doi}"
        if self.pmid:
            out["europepmc"] = f"https://europepmc.org/article/MED/{self.pmid}"
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
