"""The one record every source is normalised into."""
from __future__ import annotations

from dataclasses import dataclass, field

# One label per paper, first match wins (spec: Marks and labels).
_STUDY_TYPES = [
    ("Meta-analysis", {"Meta-Analysis"}),
    ("Systematic review", {"Systematic Review"}),
    ("Randomised trial", {"Randomized Controlled Trial"}),
    ("Clinical trial", {"Clinical Trial", "Controlled Clinical Trial", "Clinical Trial, Phase I",
                        "Clinical Trial, Phase II", "Clinical Trial, Phase III", "Clinical Trial, Phase IV"}),
    ("Cohort study", {"Cohort Studies", "Prospective Studies", "Retrospective Studies", "Longitudinal Studies"}),
    ("Case-control study", {"Case-Control Studies"}),
    ("Case report", {"Case Reports"}),
    ("Review", {"Review"}),
]


@dataclass
class Paper:
    """A paper as Snowball knows it.

    `id` is `pmid:<n>` when PubMed has the paper, else `doi:<doi>` (preprints).
    Optional fields stay empty when no source supplied them; nothing is guessed.
    """
    id: str
    title: str
    abstract: str = ""
    year: int | None = None
    date: str | None = None             # ISO 8601, as precise as the source gives
    journal: str = ""
    authors: list[str] = field(default_factory=list)   # "Surname AB"
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    pub_types: list[str] = field(default_factory=list)
    mesh: list[str] = field(default_factory=list)
    nct_ids: list[str] = field(default_factory=list)
    is_preprint: bool = False
    is_retracted: bool = False
    preprint_of: str | None = None      # on a published paper: the DOI of its preprint
    cited_by: int | None = None
    rcr: float | None = None            # NIH relative citation ratio, field-normalised
    hac: dict[str, float] | None = None  # iCite human / animal / cell shares
    is_clinical: bool | None = None
    clinical_citations: int | None = None

    @property
    def study_type(self) -> str:
        labels = set(self.pub_types) | set(self.mesh)
        for name, markers in _STUDY_TYPES:
            if labels & markers:
                return name
        if self.hac and self.hac["animal"] >= 0.5:
            return "Animal study"
        if self.hac and self.hac["cell"] >= 0.5:
            return "Cell or molecular study"
        return "Other"

    @property
    def text(self) -> str:
        """What gets embedded (spec: title + the first 1,500 characters of the abstract)."""
        return f"{self.title}. {self.abstract[:1500]}".strip()

    @property
    def links(self) -> dict[str, str]:
        out = {}
        if self.pmid:
            out["pubmed"] = f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"
        if self.doi:
            out["doi"] = f"https://doi.org/{self.doi}"
        if self.pmcid:
            out["pmc"] = f"https://pmc.ncbi.nlm.nih.gov/articles/{self.pmcid}/"
        for nct in self.nct_ids:
            out[nct] = f"https://clinicaltrials.gov/study/{nct}"
        return out

    def to_json(self) -> dict:
        return {
            "id": self.id, "pmid": self.pmid, "doi": self.doi, "pmcid": self.pmcid,
            "title": self.title, "abstract": self.abstract, "year": self.year, "date": self.date,
            "journal": self.journal, "authors": self.authors, "pubTypes": self.pub_types,
            "studyType": self.study_type, "isPreprint": self.is_preprint, "isRetracted": self.is_retracted,
            "preprintOf": self.preprint_of, "oaUrl": self.links.get("pmc"), "citedBy": self.cited_by,
            "rcr": self.rcr, "hac": self.hac, "isClinical": self.is_clinical,
            "clinicalCitations": self.clinical_citations, "mesh": self.mesh, "nctIds": self.nct_ids,
            "links": self.links,
        }


def paper_id(*, pmid: str | None = None, doi: str | None = None) -> str:
    if pmid:
        return f"pmid:{pmid}"
    if doi:
        return f"doi:{doi.lower()}"
    raise ValueError("paper needs a pmid or a doi")
