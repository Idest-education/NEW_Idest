"""Divergence between the AI's feedback and the teacher's final feedback.

Token-level Jaccard and normalized Levenshtein on the summary, plus set
overlap on the strengths and improvements lists.

This runs over all historical data. Both texts were already persisted
append-only, in `scoring_results.feedback` and `score_revisions.final_feedback`,
so nothing had to be captured for it.

Every measure returns None rather than 0.0 when there is nothing to compare.
A Jaccard of 0.0 says the teacher rewrote the summary completely; an absent
summary says nothing at all, and the two must not be averaged together.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass

import pandas as pd
from rapidfuzz.distance import Levenshtein

FEEDBACK_COLUMNS: tuple[str, ...] = (
    "ai_summary",
    "teacher_summary",
    "ai_strengths",
    "teacher_strengths",
    "ai_improvements",
    "teacher_improvements",
)

_TOKEN_PATTERN = re.compile(r"[a-z0-9']+")


class MissingFeedbackColumnsError(ValueError):
    """The frame does not carry the AI and teacher feedback text."""


def _as_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def tokenize(text: object) -> tuple[str, ...]:
    """Lowercase word tokens, punctuation discarded."""
    return tuple(_TOKEN_PATTERN.findall(_as_text(text).lower()))


def jaccard(left: object, right: object) -> float | None:
    """Token-level Jaccard similarity: |intersection| / |union|."""
    left_tokens = set(tokenize(left))
    right_tokens = set(tokenize(right))
    if not left_tokens or not right_tokens:
        return None
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def normalized_levenshtein(left: object, right: object) -> float | None:
    """Edit distance divided by the length of the longer string.

    0.0 means the teacher kept the AI text verbatim; 1.0 means they share no
    characters in common positions at all.
    """
    left_text = _as_text(left)
    right_text = _as_text(right)
    longest = max(len(left_text), len(right_text))
    if longest == 0:
        return None
    return Levenshtein.distance(left_text, right_text) / longest


def parse_items(value: object) -> tuple[str, ...] | None:
    """Read a strengths or improvements list from JSON, a PostgreSQL array, or
    an already-parsed sequence. None means the list was absent."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (list, tuple)):
        items = tuple(str(item).strip() for item in value if str(item).strip())
        return items or None
    text = _as_text(value)
    if not text or text in {"{}", "[]"}:
        return None
    if text.startswith("["):
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            decoded = []
        if isinstance(decoded, list):
            items = tuple(str(item).strip() for item in decoded if str(item).strip())
            return items or None
    stripped = text.strip("{}")
    items = tuple(part.strip().strip('"') for part in stripped.split(",") if part.strip())
    return items or None


def set_overlap(left: object, right: object) -> float | None:
    """Jaccard over list items, compared case-insensitively after trimming."""
    left_items = parse_items(left)
    right_items = parse_items(right)
    if not left_items or not right_items:
        return None
    left_set = {item.lower() for item in left_items}
    right_set = {item.lower() for item in right_items}
    return len(left_set & right_set) / len(left_set | right_set)


@dataclass(frozen=True)
class FeedbackDivergence:
    submission_id: str
    summary_jaccard: float | None
    summary_levenshtein: float | None
    strengths_overlap: float | None
    improvements_overlap: float | None


def divergence_for_row(row: pd.Series) -> FeedbackDivergence:
    return FeedbackDivergence(
        submission_id=str(row["submission_id"]),
        summary_jaccard=jaccard(row.get("ai_summary"), row.get("teacher_summary")),
        summary_levenshtein=normalized_levenshtein(
            row.get("ai_summary"), row.get("teacher_summary")
        ),
        strengths_overlap=set_overlap(row.get("ai_strengths"), row.get("teacher_strengths")),
        improvements_overlap=set_overlap(
            row.get("ai_improvements"), row.get("teacher_improvements")
        ),
    )


def divergence_table(frame: pd.DataFrame) -> pd.DataFrame:
    """One divergence row per submission.

    Accepts either an export frame taken with the feedback columns present or
    the frame returned by `analysis.load.load_feedback_pairs_db`.
    """
    missing = [column for column in FEEDBACK_COLUMNS if column not in frame.columns]
    if missing:
        raise MissingFeedbackColumnsError(
            "feedback divergence needs the columns "
            f"{', '.join(missing)}, which this frame does not carry. "
            "Export with include_essays=true, or read them from the database "
            "with analysis.load.load_feedback_pairs_db(database_url)."
        )
    rows = [asdict(divergence_for_row(row)) for _, row in frame.iterrows()]
    return pd.DataFrame(
        rows,
        columns=[
            "submission_id",
            "summary_jaccard",
            "summary_levenshtein",
            "strengths_overlap",
            "improvements_overlap",
        ],
    )


def divergence_summary(table: pd.DataFrame) -> dict[str, float | int | None]:
    """Means across the rows that had something to compare."""
    measures = (
        "summary_jaccard",
        "summary_levenshtein",
        "strengths_overlap",
        "improvements_overlap",
    )
    compared = int(table["summary_jaccard"].notna().sum())
    summary: dict[str, float | int | None] = {
        "rows": int(len(table)),
        "compared": compared,
    }
    for measure in measures:
        values = pd.to_numeric(table[measure], errors="coerce").dropna()
        summary[f"mean_{measure}"] = float(values.mean()) if len(values) else None
    return summary
