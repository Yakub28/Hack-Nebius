"""All language work: the rubric, screening and explaining. Each call sees only the facts passed in."""
from __future__ import annotations

import asyncio
import difflib
import json
import re
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, Field

from engine import nebius
from engine.paper import Paper

SCREEN_BATCH, SCREEN_CONCURRENCY = 10, 8
EXPLAIN_BATCH, EXPLAIN_CONCURRENCY = 5, 5
SEED_ABSTRACT_CHARS = 1200
PAPER_ABSTRACT_CHARS = 1500
QUOTE_MIN_RATIO = 0.9

MatchValue = Literal["matches", "doesn't match", "unclear"]
Relation = Literal["Supports", "Contradicts", "Extends", "Reviews", "Method", "Background"]


class KeyTerm(BaseModel):
    term: str
    synonyms: list[str] = []
    mesh: list[str] = []


class Rubric(BaseModel):
    question: str
    population: str
    intervention_or_exposure: str
    comparison: str = ""
    outcomes: list[str]
    key_terms: list[KeyTerm]
    queries: list[str] = Field(min_length=3, max_length=5)


class Match(BaseModel):
    population: MatchValue
    intervention: MatchValue
    comparison: MatchValue
    outcome: MatchValue


class Screened(BaseModel):
    id: int
    grade: int = Field(ge=0, le=3)
    match: Match
    quote: str = ""
    reason: str


class Explained(BaseModel):
    id: int
    grade: int = Field(ge=0, le=3)
    relation: Relation
    reason: str
    abstain: bool = False


class _ScreenReply(BaseModel):
    papers: list[Screened]


class _ExplainReply(BaseModel):
    papers: list[Explained]


# --- rubric -------------------------------------------------------------------

RUBRIC_SYSTEM = """You help biomedical researchers define what they are looking for.
Use only the question and seed papers below. Reply in JSON matching the schema:
{"question": "string", "population": "string", "intervention_or_exposure": "string",
 "comparison": "string", "outcomes": ["string"],
 "key_terms": [{"term": "string", "synonyms": ["string"], "mesh": ["string"]}],
 "queries": ["string", "string", "string"]}"""


async def draft_rubric(question: str | None, seeds: list[Paper]) -> Rubric:
    seed_text = "\n".join(f"S{i}: {s.title}. {s.abstract[:SEED_ABSTRACT_CHARS]}" for i, s in enumerate(seeds, 1))
    user = f"""Question: {question or "none: draft one from the seeds"}
Seeds:
{seed_text}
Return: the question (keep the user's wording if given); population;
intervention_or_exposure; comparison (empty if none); outcomes; key_terms,
each with synonyms and MeSH headings; and 3 to 5 PubMed queries that cover the
topic from different angles, together reaching every seed, using plain terms
and OR-groups, no field tags."""
    return await nebius.chat_json(Rubric, model=nebius.MODEL_RUBRIC, system=RUBRIC_SYSTEM, user=user,
                                  thinking="low", temperature=1.0, max_tokens=1500)


# --- screen -------------------------------------------------------------------

SCREEN_SYSTEM = """You screen paper abstracts for a biomedical researcher against their rubric.
Judge only from the text given; never add facts. For the quote, copy one
sentence from that paper's abstract character for character, or leave it empty.
Reply in JSON: {"papers": [{"id": 1, "grade": 2, "match": {"population": "matches",
"intervention": "matches", "comparison": "unclear", "outcome": "doesn't match"},
"quote": "string", "reason": "string"}]}"""

GRADES = """Grades: 3 directly relevant (population, intervention or exposure, and outcome
match, or a review of exactly this question); 2 relevant (same intervention or
outcome, close population or setting); 1 related (background, method, adjacent
question); 0 not relevant. With no abstract, grade at most 1."""


async def screen(rubric: Rubric, seeds: list[Paper], papers: list[Paper],
                 on_batch: Callable[[int], None]) -> dict[str, Screened]:
    """Grades by paper id. Papers in a batch that failed twice are missing from the result."""
    header = f"Rubric: {_rubric_json(rubric)}\nSeeds, for context: {_seed_titles(seeds)}\n{GRADES}"

    async def batch(group: list[Paper]) -> dict[str, Screened]:
        papers_text = "\n".join(_entry(i, p, full=False) for i, p in enumerate(group, 1))
        user = f"{header}\nPapers:\n{papers_text}\nFor each paper return: id, grade, match for " \
               "population, intervention, comparison and outcome, quote, and a reason of at most 15 plain words."
        reply = await nebius.chat_json(_ScreenReply, model=nebius.MODEL_SCREEN, system=SCREEN_SYSTEM, user=user,
                                       thinking="off", temperature=0.2, max_tokens=2000)
        out = {}
        for item in reply.papers:
            if not 1 <= item.id <= len(group):
                continue
            paper = group[item.id - 1]
            item.grade = item.grade if paper.abstract else min(item.grade, 1)
            item.reason = clip(item.reason, 15)
            out[paper.id] = item
        on_batch(len(group))
        return out

    return await _batched(batch, papers, SCREEN_BATCH, SCREEN_CONCURRENCY)


# --- explain ------------------------------------------------------------------

EXPLAIN_SYSTEM = """You tell a biomedical researcher why a paper is worth their time.
Use only the facts given: the rubric, the seeds, the paper's abstract, and
its listed connections. Mention nothing else. If the abstract is too thin
to judge, set abstain to true.
Reply in JSON: {"papers": [{"id": 1, "grade": 3, "relation": "Extends", "reason": "string", "abstain": false}]}"""

RELATIONS = """Relations: Supports (finds the same effect as the seeds); Contradicts (finds
no effect or the opposite); Extends (new population, setting or outcome);
Reviews (a review or meta-analysis of this question); Method (mainly a method,
tool or measure); Background (mechanism or context)."""


async def explain(rubric: Rubric, seeds: list[Paper], papers: list[tuple[Paper, str]],
                  on_paper: Callable[[str, Explained], None]) -> dict[str, Explained]:
    """`papers` pairs each paper with its connections sentence. Each result is also reported as it lands."""
    header = f"Rubric: {_rubric_json(rubric)}\nSeeds: {_seed_titles(seeds)}\n{RELATIONS}"
    connections = {p.id: c for p, c in papers}

    async def batch(group: list[Paper]) -> dict[str, Explained]:
        block = "\n".join(f"{_entry(i, p, full=True)}\nConnections: {connections[p.id]}"
                          for i, p in enumerate(group, 1))
        user = f"{header}\nPapers:\n{block}\nFor each paper return: id, grade (same scale), relation, a reason of " \
               "at most 40 words that starts with what the paper did and names seeds as S1, S2..., and abstain."
        reply = await nebius.chat_json(_ExplainReply, model=nebius.MODEL_EXPLAIN, system=EXPLAIN_SYSTEM, user=user,
                                       thinking="low", temperature=1.0, max_tokens=2500)
        out = {}
        for item in reply.papers:
            if 1 <= item.id <= len(group):
                paper = group[item.id - 1]
                item.grade = item.grade if paper.abstract else min(item.grade, 1)
                item.reason = clip(item.reason, 40)
                out[paper.id] = item
                on_paper(paper.id, item)
        return out

    return await _batched(batch, [p for p, _ in papers], EXPLAIN_BATCH, EXPLAIN_CONCURRENCY)


# --- shared -------------------------------------------------------------------

def verify_quote(quote: str, abstract: str) -> str | None:
    """The abstract's own sentence that the quote matches, or None. Never the model's text."""
    wanted = _squash(quote)
    if len(wanted) < 20:
        return None
    best, best_ratio = None, 0.0
    for sentence in re.split(r"(?<=[.!?])\s+", abstract):
        ratio = difflib.SequenceMatcher(None, wanted, _squash(sentence)).ratio()
        if ratio > best_ratio:
            best, best_ratio = sentence, ratio
    return best if best_ratio >= QUOTE_MIN_RATIO else None


def clip(text: str, words: int) -> str:
    parts = text.split()
    return text.strip() if len(parts) <= words else " ".join(parts[:words]) + "…"


async def _batched(run, papers: list[Paper], size: int, concurrency: int) -> dict:
    gate = asyncio.Semaphore(concurrency)

    async def guarded(group):
        async with gate:
            return await run(group)

    groups = [papers[i:i + size] for i in range(0, len(papers), size)]
    results = await asyncio.gather(*(guarded(g) for g in groups), return_exceptions=True)
    failures = [r for r in results if isinstance(r, Exception)]
    if failures and len(failures) == len(results):
        raise failures[0]
    # A failed batch leaves its papers ungraded; the caller sees them missing and labels them.
    return {k: v for r in results if not isinstance(r, Exception) for k, v in r.items()}


def _entry(number: int, p: Paper, *, full: bool) -> str:
    abstract = p.abstract if full else p.abstract[:PAPER_ABSTRACT_CHARS]
    types = "; ".join(p.pub_types[:3]) or p.study_type
    return f"[{number}] {p.title} ({p.year or 'n.d.'}; {types})\n{abstract or '(no abstract)'}"


def _rubric_json(rubric: Rubric) -> str:
    return json.dumps(rubric.model_dump(exclude={"queries"}), ensure_ascii=False)


def _seed_titles(seeds: list[Paper]) -> str:
    return " ".join(f"S{i}: {s.title}." for i, s in enumerate(seeds, 1))


def _squash(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s%.-]", " ", text.lower()).split())
