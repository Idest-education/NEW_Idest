"""Input contract for the assessment analytics export.

This module is the single place that knows the column names of
`v_assessment_outcomes` and the data-quality rules from section 9 of
`docs/superpowers/specs/2026-09-21-assessment-analytics-design.md`.

ASSUMPTION: the export carries the columns listed in section 6.1 of that spec.
The view is built by a separate plan. If it ships different names, change
REQUIRED_COLUMNS and the coercion table below — nothing else in this package
refers to a raw column name.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

CRITERIA: tuple[str, ...] = (
    "task_response",
    "coherence_cohesion",
    "lexical_resource",
    "grammatical_range_accuracy",
)
SCORE_FIELDS: tuple[str, ...] = CRITERIA + ("overall",)

#: Marker written by the view for AI results created before the provenance fix
#: in spec section 4.1. Those rows cannot be attributed to a model version.
PRE_PROVENANCE = "pre_provenance"

IDENTITY_COLUMNS: tuple[str, ...] = (
    "submission_id",
    "assignment_id",
    "student_id",
    "teacher_id",
    "task_type",
    "word_count",
)

AI_SCORE_COLUMNS: tuple[str, ...] = tuple(f"ai_{field}" for field in SCORE_FIELDS)
TEACHER_SCORE_COLUMNS: tuple[str, ...] = tuple(f"teacher_{field}" for field in SCORE_FIELDS)

QUALITY_COLUMNS: tuple[str, ...] = (
    "has_ai_baseline",
    "revision_count",
    "reason_codes",
    "reason_source",
    "tag_latency_seconds",
    "model_name",
    "model_version",
    "is_published",
)

REQUIRED_COLUMNS: frozenset[str] = frozenset(
    IDENTITY_COLUMNS + AI_SCORE_COLUMNS + TEACHER_SCORE_COLUMNS + QUALITY_COLUMNS
)

#: Present only when the export was taken with include_essays=true, or read
#: from the database. Optional everywhere in this package.
OPTIONAL_COLUMNS: tuple[str, ...] = (
    "essay_text",
    "ai_summary",
    "ai_strengths",
    "ai_improvements",
    "teacher_summary",
    "teacher_strengths",
    "teacher_improvements",
)

_NUMERIC_COLUMNS: tuple[str, ...] = (
    AI_SCORE_COLUMNS + TEACHER_SCORE_COLUMNS + ("word_count", "revision_count", "tag_latency_seconds")
)
_BOOLEAN_COLUMNS: tuple[str, ...] = ("has_ai_baseline", "is_published")

_TRUE_TOKENS = {"t", "true", "y", "yes", "1"}
_FALSE_TOKENS = {"f", "false", "n", "no", "0", ""}


class MissingColumnsError(ValueError):
    """The export does not carry the columns this package needs."""


def _require_columns(frame: pd.DataFrame, source: str) -> None:
    missing = sorted(REQUIRED_COLUMNS - set(frame.columns))
    if missing:
        raise MissingColumnsError(
            f"{source} is missing required columns: {', '.join(missing)}. "
            "Expected the column contract from section 6.1 of the assessment "
            "analytics design."
        )


def _to_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return False
    token = str(value).strip().lower()
    if token in _TRUE_TOKENS:
        return True
    if token in _FALSE_TOKENS:
        return False
    raise ValueError(f"cannot read {value!r} as a boolean")


def _to_reason_codes(value: object) -> tuple[str, ...] | None:
    """Parse a PostgreSQL array literal into a tuple, or None when untagged.

    None means "no reason was captured". It is never the empty tuple, because
    an empty reason set and an absent reason set are different facts
    (spec section 9).
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (list, tuple)):
        codes = tuple(str(item).strip() for item in value if str(item).strip())
        return codes or None
    text = str(value).strip()
    if not text or text in {"{}", "[]"}:
        return None
    text = text.strip("{}[]")
    codes = tuple(part.strip().strip('"') for part in text.split(",") if part.strip())
    return codes or None


def _coerce(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    for column in _NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in _BOOLEAN_COLUMNS:
        frame[column] = frame[column].map(_to_bool).astype(bool)
    frame["reason_codes"] = frame["reason_codes"].map(_to_reason_codes)
    frame["is_tagged"] = frame["reason_codes"].map(lambda codes: codes is not None)
    frame["reason_source"] = frame["reason_source"].where(frame["is_tagged"], other=None)
    # A missing model_name means one of two different things, and the view keeps
    # them apart: it writes the literal "pre_provenance" when an AI baseline
    # exists but predates the provenance fix, and NULL when there is no AI
    # baseline at all. Filling both would count a teacher-first revision as a
    # pre-provenance row and overstate how much data the model comparison lost.
    missing_model = frame["model_name"].isna() | (frame["model_name"] == "")
    frame.loc[missing_model & frame["has_ai_baseline"], "model_name"] = PRE_PROVENANCE
    frame.loc[missing_model & ~frame["has_ai_baseline"], "model_name"] = None
    return frame.reset_index(drop=True)


def load_outcomes_csv(path: str | Path) -> pd.DataFrame:
    """Read a `GET /analytics/export?format=csv` file into a typed frame."""
    path = Path(path)
    frame = pd.read_csv(path, dtype=str, keep_default_na=True)
    _require_columns(frame, str(path))
    return _coerce(frame)


def load_outcomes_db(
    database_url: str,
    *,
    since: str | None = None,
    until: str | None = None,
) -> pd.DataFrame:
    """Read `v_assessment_outcomes` directly. SELECT only — never writes."""
    import sqlalchemy

    clauses: list[str] = []
    params: dict[str, str] = {}
    if since is not None:
        clauses.append("revision_created_at >= :since")
        params["since"] = since
    if until is not None:
        clauses.append("revision_created_at < :until")
        params["until"] = until
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""

    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.connect() as connection:
            frame = pd.read_sql(
                sqlalchemy.text(f"SELECT * FROM v_assessment_outcomes{where}"),
                connection,
                params=params,
            )
    finally:
        engine.dispose()

    _require_columns(frame, "v_assessment_outcomes")
    return _coerce(frame)


def load_feedback_pairs_db(database_url: str) -> pd.DataFrame:
    """Read the AI and teacher feedback text for every revised submission.

    ASSUMPTION: spec section 6.1 lists score columns but not the feedback JSON.
    Section 8 nevertheless requires divergence over all historical data, and
    section 5 notes both texts are already persisted append-only. This function
    is the path that does not depend on the view exporting them: it reads
    `scoring_results.feedback` and `score_revisions.final_feedback` directly.
    The returned columns match the optional CSV columns exactly, so
    `feedback_divergence` accepts either source.
    """
    import sqlalchemy

    query = sqlalchemy.text(
        """
        SELECT o.submission_id,
               sr.feedback->>'summary'              AS ai_summary,
               sr.feedback->'strengths'             AS ai_strengths,
               sr.feedback->'improvements'          AS ai_improvements,
               rev.final_feedback->>'summary'       AS teacher_summary,
               rev.final_feedback->'strengths'      AS teacher_strengths,
               rev.final_feedback->'improvements'   AS teacher_improvements
        FROM v_assessment_outcomes o
        JOIN score_revisions rev ON rev.submission_id = o.submission_id
        JOIN scoring_results sr  ON sr.id = rev.base_result_id
        """
    )
    engine = sqlalchemy.create_engine(database_url)
    try:
        with engine.connect() as connection:
            return pd.read_sql(query, connection)
    finally:
        engine.dispose()


def with_ai_baseline(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep only rows that have an AI score to compare against.

    Spec section 6.1: when `chosen_revision.base_result_id` is null the teacher
    graded before the AI did, or after it failed. Comparing a teacher-authored
    score against nothing silently corrupts kappa.
    """
    return frame[frame["has_ai_baseline"]].reset_index(drop=True)


def tagged_only(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep only revisions that carry a reason tag."""
    return frame[frame["is_tagged"]].reset_index(drop=True)


def with_model_provenance(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep only rows that can be attributed to a named model version.

    Two different kinds of row are dropped, for two different reasons
    (spec section 9). A `pre_provenance` row has an AI result written before
    the provenance fix in spec section 4.1 and cannot be attributed
    retroactively. A row with no model at all has no AI baseline, so there is
    no model output to compare in the first place. Grouping by model requires
    a model, so neither belongs in a per-model comparison.
    """
    named = frame["model_name"].notna() & (frame["model_name"] != PRE_PROVENANCE)
    return frame[named].reset_index(drop=True)


def caveat_summary(frame: pd.DataFrame) -> dict[str, int]:
    """Count every data-quality caveat from spec section 9.

    The report prints these so the thesis states its limitations instead of
    hiding them.
    """
    with_baseline = int(frame["has_ai_baseline"].sum())
    tagged = frame["is_tagged"]
    return {
        "rows": int(len(frame)),
        "with_ai_baseline": with_baseline,
        "without_ai_baseline": int(len(frame) - with_baseline),
        # Anchoring: every row with a baseline is a row where the teacher saw
        # the AI score first. Agreement on those rows is agreement under
        # anchoring, not independent agreement.
        "anchored": with_baseline,
        "tagged": int(tagged.sum()),
        "untagged": int((~tagged).sum()),
        "tagged_inline": int((frame["reason_source"] == "inline").sum()),
        "tagged_batch": int((frame["reason_source"] == "batch").sum()),
        "pre_provenance": int((frame["model_name"] == PRE_PROVENANCE).sum()),
        "published": int(frame["is_published"].sum()),
    }
