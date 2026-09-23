"""Render the tables used in the thesis.

Run it against an export:

    python -m analysis.report --csv outcomes.csv --out analysis-report.md

or against the database directly:

    python -m analysis.report --database-url "$READONLY_DATABASE_URL"

Every section that cannot be produced says why in the report rather than being
omitted, so a missing table is never mistaken for a missing finding. The data
quality caveats from section 9 of the design are printed with the numbers, not
filed away somewhere else.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

from .agreement import (
    AgreementResult,
    agreement_by_model,
    agreement_by_reason_source,
    agreement_table,
)
from .catboost_eval import DEFAULT_SEED, InsufficientAssignmentsError, evaluate_all
from .feedback_divergence import (
    MissingFeedbackColumnsError,
    divergence_summary,
    divergence_table,
)
from .load import caveat_summary, load_outcomes_csv, load_outcomes_db

AGREEMENT_HEADERS = [
    "field",
    "n",
    "quadratic kappa",
    "exact",
    "within half band",
    "MAE",
    "Spearman",
]

CAVEAT_LABELS: list[tuple[str, str]] = [
    ("rows", "rows exported"),
    ("with_ai_baseline", "with an AI baseline"),
    ("without_ai_baseline", "without an AI baseline"),
    ("anchored", "measured under anchoring"),
    ("tagged", "revisions with a reason tag"),
    ("untagged", "untagged"),
    ("tagged_inline", "tagged inline"),
    ("tagged_batch", "tagged in a batch"),
    ("pre_provenance", "pre_provenance (no model version)"),
    ("published", "published"),
]


def format_value(value: object) -> str:
    """None becomes an em dash, never 0. An absent measurement is not a zero."""
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return "—" if pd.isna(value) else f"{value:.3f}"
    return str(value)


def markdown_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(format_value(cell) for cell in row) + " |")
    return "\n".join(lines)


def _agreement_rows(results: list[AgreementResult]) -> list[list[object]]:
    return [
        [
            result.field,
            result.n,
            result.quadratic_kappa,
            result.exact_agreement,
            result.within_half_band,
            result.mean_absolute_error,
            result.spearman_rho,
        ]
        for result in results
    ]


def render_agreement(results: list[AgreementResult], title: str) -> str:
    excluded = results[0].n_excluded_no_baseline if results else 0
    note = (
        f"\n\n{excluded} row(s) excluded: no AI baseline, so there is no AI score "
        "to compare against."
        if excluded
        else ""
    )
    return (
        f"## {title}\n\n"
        + markdown_table(AGREEMENT_HEADERS, _agreement_rows(results))
        + note
    )


def render_agreement_by_model(frame: pd.DataFrame) -> str:
    by_model = agreement_by_model(frame)
    if not by_model:
        return (
            "## Agreement by model version\n\n"
            "No attributable results. Every AI result in this export predates the "
            "model provenance fix and is marked pre_provenance."
        )
    sections = ["## Agreement by model version"]
    for model in sorted(by_model):
        sections.append(f"### {model}\n\n" + markdown_table(
            AGREEMENT_HEADERS, _agreement_rows(by_model[model])
        ))
    excluded = caveat_summary(frame)["pre_provenance"]
    if excluded:
        sections.append(
            f"{excluded} row(s) excluded as pre_provenance. Those results were "
            "written before the provenance fix, carry no model version, and "
            "cannot be attributed retroactively."
        )
    return "\n\n".join(sections)


def render_agreement_by_reason_source(frame: pd.DataFrame) -> str:
    by_source = agreement_by_reason_source(frame)
    counts = caveat_summary(frame)
    sections = ["## Agreement by reason source"]
    if not by_source:
        sections.append("No revision in this export carries a reason tag.")
    for source in sorted(by_source):
        sections.append(f"### {source}\n\n" + markdown_table(
            AGREEMENT_HEADERS, _agreement_rows(by_source[source])
        ))
    sections.append(
        f"{counts['untagged']} revision(s) are untagged and form no bucket above. "
        "An empty tag set means the reason was not captured, not that there was "
        "no reason."
    )
    return "\n\n".join(sections)


def render_divergence(frame: pd.DataFrame) -> str:
    try:
        table = divergence_table(frame)
    except MissingFeedbackColumnsError as error:
        return f"## Feedback divergence\n\nNot computed. {error}"
    summary = divergence_summary(table)
    rows = [
        ["summary Jaccard", summary["mean_summary_jaccard"]],
        ["summary normalized Levenshtein", summary["mean_summary_levenshtein"]],
        ["strengths set overlap", summary["mean_strengths_overlap"]],
        ["improvements set overlap", summary["mean_improvements_overlap"]],
    ]
    return (
        "## Feedback divergence\n\n"
        + markdown_table(["measure", "mean"], rows)
        + f"\n\nCompared {summary['compared']} of {summary['rows']} row(s). Both "
        "texts were already stored, so this covers all historical data."
    )


def render_catboost(frame: pd.DataFrame, *, iterations: int, seed: int) -> str:
    try:
        comparisons = evaluate_all(frame, iterations=iterations, seed=seed)
    except InsufficientAssignmentsError as error:
        return f"## CatBoost versus the LLM baseline\n\nNot computed. {error}"
    rows = [
        [
            comparison.criterion,
            comparison.n_train,
            comparison.n_test,
            comparison.llm_mae,
            comparison.catboost_mae,
            comparison.mae_improvement,
            comparison.llm_kappa,
            comparison.catboost_kappa,
        ]
        for comparison in comparisons
    ]
    headers = [
        "criterion",
        "n train",
        "n test",
        "LLM MAE",
        "CatBoost MAE",
        "MAE gain",
        "LLM kappa",
        "CatBoost kappa",
    ]
    first = comparisons[0]
    return (
        "## CatBoost versus the LLM baseline\n\n"
        + markdown_table(headers, rows)
        + f"\n\nSplit by assignment, not by row: {first.n_train_assignments} "
        f"assignment(s) for training and {first.n_test_assignments} held out, "
        f"seed {seed}. A random row split would put repeat attempts of the same "
        "essay on both sides of the boundary and inflate the result."
    )


def render_caveats(frame: pd.DataFrame) -> str:
    counts = caveat_summary(frame)
    rows = [[label, counts[key]] for key, label in CAVEAT_LABELS]
    notes = [
        "- **Retrospective reasons.** Batch-tagged reasons are given after the "
        "fact and are weaker evidence than reasons given at the moment of the "
        "decision. The agreement-by-reason-source section separates them.",
        "- **Anchoring is uncontrolled.** Every compared row is one where the "
        "teacher saw the AI score before entering their own. These figures are "
        "agreement under anchoring, not independent agreement.",
        "- **Pre-provenance rows.** AI results written before the provenance fix "
        "carry no model version and are excluded from per-model comparison.",
        "- **Untagged revisions.** An empty tag set means the reason was not "
        "captured, not that there was no reason.",
    ]
    return (
        "## Data quality caveats\n\n"
        + markdown_table(["measure", "count"], rows)
        + "\n\n"
        + "\n".join(notes)
    )


def build_report(
    frame: pd.DataFrame,
    *,
    with_catboost: bool = True,
    iterations: int = 400,
    seed: int = DEFAULT_SEED,
) -> str:
    sections = [
        "# IELTS assessment analysis",
        render_agreement(agreement_table(frame), "Agreement (LLM versus teacher)"),
        render_agreement_by_model(frame),
        render_agreement_by_reason_source(frame),
        render_divergence(frame),
    ]
    if with_catboost:
        sections.append(render_catboost(frame, iterations=iterations, seed=seed))
    sections.append(render_caveats(frame))
    return "\n\n".join(sections) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m analysis.report",
        description="Render the thesis tables from the assessment analytics export.",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", help="path to a GET /analytics/export CSV file")
    source.add_argument("--database-url", help="read-only PostgreSQL connection URL")
    parser.add_argument("--out", help="write the report here instead of stdout")
    parser.add_argument("--no-catboost", action="store_true", help="skip the CatBoost section")
    parser.add_argument("--iterations", type=int, default=400)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args(argv)

    frame = (
        load_outcomes_csv(args.csv)
        if args.csv
        else load_outcomes_db(args.database_url)
    )
    report = build_report(
        frame,
        with_catboost=not args.no_catboost,
        iterations=args.iterations,
        seed=args.seed,
    )
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
