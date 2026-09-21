# Python Research and Analysis Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/ai-service/analysis/` — an offline research folder that turns the `v_assessment_outcomes` export into the agreement statistics, feedback-divergence measures, CatBoost comparison, and thesis tables the project needs, without adding a single byte to the deployed scoring image.

**Architecture:** Five small modules with one responsibility each. `load.py` owns the input contract and every data-quality rule from spec section 9, so no downstream module can reconstruct a filter wrongly. `agreement.py`, `feedback_divergence.py`, and `catboost_eval.py` each consume an already-loaded `pandas.DataFrame` and return plain dataclasses. `report.py` renders those dataclasses as Markdown tables and is the only module with a CLI. Nothing in the running service imports any of it, and its dependencies live in a second requirements file that the Docker image never installs.

**Tech Stack:** Python 3.12+, pandas, scikit-learn (`cohen_kappa_score`), CatBoost, RapidFuzz (Levenshtein), pytest

**Spec:** `docs/superpowers/specs/2026-09-21-assessment-analytics-design.md` — sections 8 (Python analysis) and 9 (data quality caveats). Section 6.1 defines the input column contract.

## Global Constraints

- **The export column contract is fixed and is an assumption of this plan.** `v_assessment_outcomes` is built by a separate plan. This plan is written against the column list in spec section 6.1 and treats it as settled. The exact column names this code requires are declared once, in `analysis/load.py`, as `REQUIRED_COLUMNS`. If the view ships different names, `load.py` is the only file that changes.
- **The pytest setup already exists.** A parallel plan (`docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`, Task 1) creates `apps/ai-service/pytest.ini` with `pythonpath = .`, `testpaths = tests`, `asyncio_mode = auto`, and adds `"test": "pytest"` to `apps/ai-service/package.json`. Assume both exist. Do not recreate them.
- **The analysis folder is not part of the running service.** `main.py`, `worker.py`, `scorer.py`, `schemas.py`, and `config.py` must never import from `analysis`. Task 1 adds a test that enforces this by AST parse.
- **Analysis dependencies never enter the deployed image.** They live in `apps/ai-service/requirements-analysis.txt`. The Dockerfile installs only `requirements.txt`. `analysis/`, `tests/`, and `requirements-analysis.txt` are excluded by `.dockerignore`.
- **IELTS bands are half-band values in `[0.0, 9.0]`.** They map to integer classes by multiplying by two, giving the fixed class space `0..18`. That full class space is passed to `cohen_kappa_score` as `labels` on every call. Never let scikit-learn infer labels from the data — see Task 3, Step 3 for why this changes the answer.
- **Agreement metrics read only rows where `has_ai_baseline` is true.** A teacher-first revision has no AI score to compare against. Including those rows silently corrupts kappa. The filter lives in `load.py` and is applied inside `agreement.py`, not left to the caller.
- **An empty reason tag means the reason was not captured, not that there was no reason** (spec section 9). Untagged rows are counted and reported separately and never form a reason bucket.
- **`pre_provenance` rows are excluded from per-model comparison** (spec section 9), and the count of excluded rows is reported rather than dropped silently.
- **Agreement computed on `has_ai_baseline` rows is agreement under anchoring** (spec section 9). Every result carries `anchored = True` and the report prints the limitation.
- **Train/test splits are by assignment, never by row.** A student may submit several attempts of the same essay on the same prompt; a random row split leaks near-duplicate text across the boundary and inflates the CatBoost result.
- **Determinism.** Every random operation takes an explicit seed. The project seed is `20260921`.
- **No network calls and no database writes.** The database path is read-only by construction: `load.py` issues `SELECT` statements only.
- **Interpreter note.** The service `venv/` in the repository is Python 3.14; the Dockerfile base image is `python:3.12-slim`. CatBoost wheel availability on 3.14 is not guaranteed. If `pip install -r requirements-analysis.txt` fails to find a CatBoost wheel, create a dedicated analysis environment on 3.12 — `python3.12 -m venv .venv-analysis && .venv-analysis/bin/pip install -r requirements-analysis.txt -r requirements.txt` — and run the analysis tests from it. This never affects the service environment.

---

### Task 1: Dependency and deployment isolation

This task creates nothing that computes. It establishes the boundary first, so that every later task adds code on the correct side of it, and it proves the boundary with tests that run without any analysis dependency installed.

**Files:**
- Create: `apps/ai-service/requirements-analysis.txt`
- Create: `apps/ai-service/analysis/__init__.py`
- Create: `apps/ai-service/tests/analysis/__init__.py`
- Create: `apps/ai-service/tests/analysis/conftest.py`
- Create: `apps/ai-service/tests/test_analysis_isolation.py`
- Modify: `apps/ai-service/.dockerignore`
- Modify: `apps/ai-service/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the package `analysis` (importable as `analysis.load`, `analysis.agreement`, and so on, because `pytest.ini` sets `pythonpath = .`). The file `apps/ai-service/requirements-analysis.txt`. The pytest collection guard in `tests/analysis/conftest.py` that skips the whole analysis test directory when pandas is absent. The npm scripts `test` (service tests only) and `test:analysis`.

- [ ] **Step 1: Write the isolation test**

This test imports nothing from `analysis` and needs no third-party package, so it runs in the plain service environment. It parses the service modules with `ast` rather than grepping, so a string containing the word "analysis" cannot produce a false positive and an `import analysis as x` alias cannot produce a false negative.

Create `apps/ai-service/tests/test_analysis_isolation.py`:

```python
"""The analysis folder is a research tool. It must not reach the running service
or the deployed image. These tests need no analysis dependency and always run."""

import ast
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
SERVICE_MODULES = ("main.py", "worker.py", "scorer.py", "schemas.py", "config.py")


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


def test_service_modules_do_not_import_analysis():
    for name in SERVICE_MODULES:
        path = SERVICE_ROOT / name
        assert path.exists(), f"expected service module {name} to exist"
        assert "analysis" not in _imported_roots(path), (
            f"{name} imports the analysis package; the research layer must stay "
            "out of the running service"
        )


def test_analysis_requirements_file_is_separate():
    base = (SERVICE_ROOT / "requirements.txt").read_text(encoding="utf-8")
    extra = (SERVICE_ROOT / "requirements-analysis.txt").read_text(encoding="utf-8")
    for package in ("pandas", "scikit-learn", "catboost", "rapidfuzz"):
        assert package not in base, f"{package} must not be in requirements.txt"
        assert package in extra, f"{package} must be in requirements-analysis.txt"


def test_dockerfile_installs_only_the_service_requirements():
    dockerfile = (SERVICE_ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "pip install --no-cache-dir -r requirements.txt" in dockerfile
    assert "requirements-analysis" not in dockerfile


def test_dockerignore_excludes_the_research_layer():
    entries = {
        line.strip()
        for line in (SERVICE_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }
    for excluded in ("analysis", "tests", "requirements-analysis.txt"):
        assert excluded in entries, f".dockerignore must exclude {excluded}"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ai-service && python -m pytest tests/test_analysis_isolation.py -v`

Expected: FAIL. `test_analysis_requirements_file_is_separate` raises `FileNotFoundError` for `requirements-analysis.txt`, and `test_dockerignore_excludes_the_research_layer` fails its assertion on `analysis`.

- [ ] **Step 3: Create the analysis requirements file**

Create `apps/ai-service/requirements-analysis.txt`:

```
# Offline research dependencies for apps/ai-service/analysis/.
# NOT installed in the deployed image — the Dockerfile installs requirements.txt only.
# Install alongside the service requirements to run the analysis tests:
#   pip install -r requirements.txt -r requirements-analysis.txt
pandas>=2.2.0
scikit-learn>=1.4.0
catboost>=1.2.5
rapidfuzz>=3.6.0
```

`rapidfuzz` is the Levenshtein implementation. It ships prebuilt wheels, needs no compiler, and exposes the exact primitive needed as `rapidfuzz.distance.Levenshtein.distance`. `pytest` is not repeated here; it already comes from `requirements.txt`.

- [ ] **Step 4: Exclude the research layer from the image**

Replace the contents of `apps/ai-service/.dockerignore`:

```
venv
__pycache__
*.pyc
.pytest_cache
scripts
analysis
tests
requirements-analysis.txt
pytest.ini
```

The Dockerfile's `COPY . .` would otherwise copy `analysis/` and `requirements-analysis.txt` into the image. The dependencies would still not be installed — `RUN pip install --no-cache-dir -r requirements.txt` names only the service file — but the source would ship, and a future `COPY`-then-install change would silently start pulling CatBoost into a 512 MB Fly machine. Excluding the paths removes the possibility. The Dockerfile itself needs no change.

- [ ] **Step 5: Create the analysis package**

Create `apps/ai-service/analysis/__init__.py`:

```python
"""Offline research and analysis for the IELTS assessment benchmark.

This package is a thesis research tool. It is deliberately NOT part of the
running service: nothing in main.py or worker.py imports it, and its
dependencies live in requirements-analysis.txt, which the deployed image
never installs.

Entry point:  python -m analysis.report --csv <export.csv>
"""

__all__ = ["load", "agreement", "feedback_divergence", "catboost_eval", "report"]
```

- [ ] **Step 6: Create the analysis test package and its collection guard**

Create `apps/ai-service/tests/analysis/__init__.py` as an empty file.

Create `apps/ai-service/tests/analysis/conftest.py`:

```python
"""Skip the analysis test directory when the research dependencies are absent.

`pytest.ini` sets `testpaths = tests`, so a plain `pytest` run in the service
environment would try to collect these files and fail at import on `pandas`.
`collect_ignore_glob` is the supported pytest mechanism for conditional
collection: it runs before any test module is imported.
"""

import importlib.util
import warnings

collect_ignore_glob: list[str] = []

if importlib.util.find_spec("pandas") is None:
    collect_ignore_glob = ["test_*.py"]
    warnings.warn(
        "Skipping apps/ai-service/tests/analysis: the research dependencies are "
        "not installed. Run `pip install -r requirements-analysis.txt` and then "
        "`pnpm test:analysis` to execute them.",
        stacklevel=1,
    )
```

- [ ] **Step 7: Add the analysis test script**

In `apps/ai-service/package.json`, add `test:analysis` beside the existing `dev` and `test` scripts. `test` keeps running the whole suite; `test:analysis` targets the research directory so a developer gets a hard failure, not a silent skip, when the extras are missing:

```json
{
  "name": "ai-service",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bash scripts/dev.sh",
    "test": "pytest",
    "test:analysis": "pytest tests/analysis -v"
  }
}
```

- [ ] **Step 8: Run the isolation tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/test_analysis_isolation.py -v`

Expected: PASS, 4 passed.

- [ ] **Step 9: Run the whole suite to verify the guard works without the extras**

Run: `cd apps/ai-service && python -m pytest -v`

Expected: PASS. The analysis directory is skipped with the warning from Step 6 if pandas is not installed, and no collection error occurs.

- [ ] **Step 10: Install the research dependencies**

Run: `cd apps/ai-service && pip install -r requirements-analysis.txt`

Expected: pandas, scikit-learn, catboost, and rapidfuzz install. If pip reports no matching CatBoost distribution, the interpreter is too new — follow the interpreter note in Global Constraints and create a 3.12 environment for the analysis work.

- [ ] **Step 11: Commit**

```bash
git add apps/ai-service/requirements-analysis.txt apps/ai-service/.dockerignore \
        apps/ai-service/package.json apps/ai-service/analysis/__init__.py \
        apps/ai-service/tests/analysis/__init__.py apps/ai-service/tests/analysis/conftest.py \
        apps/ai-service/tests/test_analysis_isolation.py
git commit -m "chore(ai-service): isolate the analysis research layer from the deployed image"
```

---

### Task 2: Export loading and the data-quality contract

`load.py` is the only module that knows what a column is called, what a raw CSV cell looks like, and what spec section 9 requires. Every caveat from that section becomes a named function here so no downstream module can reimplement it differently.

**Files:**
- Create: `apps/ai-service/analysis/load.py`
- Create: `apps/ai-service/tests/analysis/fixtures/outcomes_small.csv`
- Create: `apps/ai-service/tests/analysis/test_load.py`

**Interfaces:**
- Consumes: the `analysis` package from Task 1.
- Produces:
  - `CRITERIA: tuple[str, ...]` — `("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")`
  - `SCORE_FIELDS: tuple[str, ...]` — `CRITERIA + ("overall",)`
  - `REQUIRED_COLUMNS: frozenset[str]`
  - `PRE_PROVENANCE: str` — the literal `"pre_provenance"`
  - `load_outcomes_csv(path: str | Path) -> pd.DataFrame`
  - `load_outcomes_db(database_url: str, *, since: str | None = None, until: str | None = None) -> pd.DataFrame`
  - `load_feedback_pairs_db(database_url: str) -> pd.DataFrame`
  - `with_ai_baseline(frame: pd.DataFrame) -> pd.DataFrame`
  - `tagged_only(frame: pd.DataFrame) -> pd.DataFrame`
  - `with_model_provenance(frame: pd.DataFrame) -> pd.DataFrame`
  - `caveat_summary(frame: pd.DataFrame) -> dict[str, int]`
  - `MissingColumnsError(ValueError)`

- [ ] **Step 1: Write the CSV fixture**

This one fixture is reused by Tasks 2, 3, 4, 5, and 6, so its numbers are chosen deliberately and the arithmetic they produce is written out in Task 3.

It carries 24 of the columns from spec section 6.1 — every column this code actually reads. The remaining view columns (timestamps, latencies, token counts, `publish_count`) are exported too but are not required by the analysis modules, and `load_outcomes_csv` therefore does not demand them.

Five submissions across three assignments and two teachers:

- Rows 1–4 have an AI baseline. On `overall`, `task_response`, `coherence_cohesion`, and `grammatical_range_accuracy` the AI gave `6.5, 7.0, 6.0, 7.5` and the teacher gave `6.0, 7.0, 6.5, 8.5`.
- On `lexical_resource` the AI and the teacher agree exactly on all four rows. This catches a module that reads the wrong column: perfect agreement on one criterion and partial agreement on the others cannot be produced by a mis-wired lookup.
- Row 2 is untagged. Row 3 is `inline`. Rows 1 and 4 are `batch`.
- Row 4 is a `pre_provenance` row — an AI result written before the provenance fix in spec section 4.1.
- Row 5 has `has_ai_baseline = false`: the teacher graded first, so the AI columns are empty. Its teacher score of 9.0 is deliberately extreme, so that any code which fails to exclude it produces a visibly different number instead of a plausible one.

Create `apps/ai-service/tests/analysis/fixtures/outcomes_small.csv`:

```csv
submission_id,assignment_id,student_id,teacher_id,task_type,word_count,ai_task_response,ai_coherence_cohesion,ai_lexical_resource,ai_grammatical_range_accuracy,ai_overall,teacher_task_response,teacher_coherence_cohesion,teacher_lexical_resource,teacher_grammatical_range_accuracy,teacher_overall,has_ai_baseline,revision_count,reason_codes,reason_source,tag_latency_seconds,model_name,model_version,is_published
s-0001,a-0001,stu-0001,tea-0001,task_2,268,6.5,6.5,6.5,6.5,6.5,6.0,6.0,6.5,6.0,6.0,true,1,{ai_too_generous},batch,5400,gemini-3.6-flash,2026-08-01,true
s-0002,a-0001,stu-0002,tea-0001,task_2,301,7.0,7.0,7.0,7.0,7.0,7.0,7.0,7.0,7.0,7.0,true,1,,,,gemini-3.6-flash,2026-08-01,true
s-0003,a-0002,stu-0003,tea-0001,task_1,182,6.0,6.0,6.0,6.0,6.0,6.5,6.5,6.0,6.5,6.5,true,2,{ai_too_harsh},inline,12,gemini-3.6-flash,2026-08-01,true
s-0004,a-0002,stu-0004,tea-0002,task_2,412,7.5,7.5,7.5,7.5,7.5,8.5,8.5,7.5,8.5,8.5,true,1,"{ai_too_harsh,ai_wrong_criterion}",batch,7200,pre_provenance,,true
s-0005,a-0003,stu-0005,tea-0002,task_2,255,,,,,,9.0,9.0,9.0,9.0,9.0,false,1,,,,,,false
```

- [ ] **Step 2: Write the failing loader tests**

Create `apps/ai-service/tests/analysis/test_load.py`:

```python
from pathlib import Path

import pandas as pd
import pytest

from analysis.load import (
    CRITERIA,
    PRE_PROVENANCE,
    REQUIRED_COLUMNS,
    SCORE_FIELDS,
    MissingColumnsError,
    caveat_summary,
    load_outcomes_csv,
    tagged_only,
    with_ai_baseline,
    with_model_provenance,
)

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


def test_criteria_are_the_four_ielts_bands():
    assert CRITERIA == (
        "task_response",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
    )
    assert SCORE_FIELDS == CRITERIA + ("overall",)


def test_loads_every_exported_row():
    frame = load_outcomes_csv(FIXTURE)
    assert len(frame) == 5
    assert REQUIRED_COLUMNS.issubset(frame.columns)


def test_scores_are_numeric_and_missing_ai_scores_stay_missing():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0001", "ai_overall"] == pytest.approx(6.5)
    assert frame.loc["s-0004", "teacher_overall"] == pytest.approx(8.5)
    assert pd.isna(frame.loc["s-0005", "ai_overall"])


def test_has_ai_baseline_is_a_real_boolean_not_a_string():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame["has_ai_baseline"].dtype == bool
    assert frame.loc["s-0001", "has_ai_baseline"] is True or frame.loc["s-0001", "has_ai_baseline"]
    assert not frame.loc["s-0005", "has_ai_baseline"]


def test_with_ai_baseline_drops_the_teacher_first_row():
    frame = with_ai_baseline(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0002", "s-0003", "s-0004"]


def test_reason_codes_parse_to_tuples_and_untagged_stays_none():
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0001", "reason_codes"] == ("ai_too_generous",)
    assert frame.loc["s-0004", "reason_codes"] == ("ai_too_harsh", "ai_wrong_criterion")
    assert frame.loc["s-0002", "reason_codes"] is None
    assert frame.loc["s-0002", "is_tagged"] is False or not frame.loc["s-0002", "is_tagged"]


def test_untagged_is_never_an_empty_reason_set():
    """Spec section 9: an empty tag set means the reason was not captured, not
    that there was no reason. The two must never be conflated."""
    frame = load_outcomes_csv(FIXTURE).set_index("submission_id")
    assert frame.loc["s-0002", "reason_codes"] is not ()
    assert frame.loc["s-0002", "reason_codes"] is None


def test_tagged_only_keeps_inline_and_batch_and_drops_untagged():
    frame = tagged_only(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0003", "s-0004"]
    assert set(frame["reason_source"]) == {"batch", "inline"}


def test_with_model_provenance_drops_pre_provenance_rows():
    frame = with_model_provenance(load_outcomes_csv(FIXTURE))
    assert list(frame["submission_id"]) == ["s-0001", "s-0002", "s-0003"]
    assert PRE_PROVENANCE not in set(frame["model_name"])


def test_caveat_summary_counts_every_section_nine_caveat():
    summary = caveat_summary(load_outcomes_csv(FIXTURE))
    assert summary == {
        "rows": 5,
        "with_ai_baseline": 4,
        "without_ai_baseline": 1,
        "anchored": 4,
        "tagged": 3,
        "untagged": 2,
        "tagged_inline": 1,
        "tagged_batch": 2,
        "pre_provenance": 1,
        "published": 4,
    }


def test_missing_columns_fail_loudly(tmp_path):
    truncated = tmp_path / "truncated.csv"
    truncated.write_text("submission_id,ai_overall\ns-0001,6.5\n", encoding="utf-8")
    with pytest.raises(MissingColumnsError) as excinfo:
        load_outcomes_csv(truncated)
    assert "teacher_overall" in str(excinfo.value)
    assert "has_ai_baseline" in str(excinfo.value)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_load.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'analysis.load'`.

- [ ] **Step 4: Implement the loader**

Create `apps/ai-service/analysis/load.py`:

```python
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
    frame["model_name"] = frame["model_name"].fillna(PRE_PROVENANCE).replace("", PRE_PROVENANCE)
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
    """Drop rows written before the provenance fix (spec section 4.1).

    Those results carry no model version and cannot be attributed
    retroactively, so they are excluded from per-model comparison.
    """
    return frame[frame["model_name"] != PRE_PROVENANCE].reset_index(drop=True)


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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_load.py -v`

Expected: PASS, 11 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/analysis/load.py apps/ai-service/tests/analysis/test_load.py \
        apps/ai-service/tests/analysis/fixtures/outcomes_small.csv
git commit -m "feat(analysis): load the assessment outcomes export with section 9 caveats"
```

---

### Task 3: Agreement metrics

This is the core thesis result. The tests here are the ones that must be verifiable by hand, because a wrong kappa is not an error that surfaces at runtime — it surfaces in a defended thesis.

**Files:**
- Create: `apps/ai-service/analysis/agreement.py`
- Create: `apps/ai-service/tests/analysis/test_agreement.py`

**Interfaces:**
- Consumes: `analysis.load.CRITERIA`, `analysis.load.SCORE_FIELDS`, `analysis.load.PRE_PROVENANCE`, `analysis.load.with_ai_baseline`, `analysis.load.with_model_provenance`, `analysis.load.load_outcomes_csv`.
- Produces:
  - `CLASS_LABELS: list[int]` — `list(range(0, 19))`
  - `band_to_classes(values: pd.Series) -> pd.Series`
  - `AgreementResult` — a frozen dataclass with fields `field: str`, `n: int`, `n_excluded_no_baseline: int`, `quadratic_kappa: float | None`, `exact_agreement: float | None`, `within_half_band: float | None`, `mean_absolute_error: float | None`, `spearman_rho: float | None`, `anchored: bool`, and a method `as_row() -> dict[str, object]`
  - `agreement_for(frame: pd.DataFrame, field: str) -> AgreementResult`
  - `agreement_table(frame: pd.DataFrame) -> list[AgreementResult]`
  - `agreement_by_reason_source(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]`
  - `agreement_by_model(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]`

- [ ] **Step 1: Work through the hand-computed kappa before writing anything**

Read this before writing the test. The expected number in the test is `0.7`, and this is why.

Quadratic weighted kappa on a confusion matrix `O`, with weights `w[i][j] = (i - j)²`, marginals `r` (rows) and `c` (columns), and `n` observations is

```
kappa = 1 - (sum over i,j of w[i][j] * O[i][j]) / (sum over i,j of w[i][j] * r[i] * c[j] / n)
```

Because `w[i][j] = (i - j)²` is the squared difference of the class values, that reduces to a form with no matrix in it at all:

```
kappa = 1 - ( n * sum over k of (a[k] - t[k])² ) / ( sum over every ordered pair (k, l) of (a[k] - t[l])² )
```

where `a` is the AI class vector and `t` is the teacher class vector. The numerator is the observed squared disagreement scaled by `n`; the denominator is the squared disagreement expected if AI and teacher scores were paired at random.

Apply it to the four `has_ai_baseline` rows of the fixture, on `overall`.

AI bands `6.5, 7.0, 6.0, 7.5` double to classes `a = [13, 14, 12, 15]`.
Teacher bands `6.0, 7.0, 6.5, 8.5` double to classes `t = [12, 14, 13, 17]`.

Observed, term by term:

```
(13 - 12)² = 1
(14 - 14)² = 0
(12 - 13)² = 1
(15 - 17)² = 4
sum        = 6        n = 4     numerator = 4 * 6 = 24
```

Expected, all sixteen ordered pairs, one row of the AI vector at a time against the whole teacher vector `[12, 14, 13, 17]`:

```
a = 13 :  1 +  1 +  0 + 16 = 18
a = 14 :  4 +  0 +  1 +  9 = 14
a = 12 :  0 +  4 +  1 + 25 = 30
a = 15 :  9 +  1 +  4 +  4 = 18
denominator                 = 18 + 14 + 30 + 18 = 80
```

```
kappa = 1 - 24 / 80 = 1 - 0.3 = 0.7
```

**Expected value: exactly 0.7.**

Now the second thing this fixture proves. The class values present are `{12, 13, 14, 15, 17}` — `16` is missing, because no one scored 8.0. `sklearn.metrics.cohen_kappa_score` builds its weight matrix from the *positions* of the labels in the sorted label list, not from the label values. Left to infer labels from the data, it maps `12→0, 13→1, 14→2, 15→3, 17→4`, and then treats `15` and `17` as one step apart instead of two. Recomputing with `a = [1, 2, 0, 3]` and `t = [0, 2, 1, 4]`:

```
observed    : 1 + 0 + 1 + 1 = 3     numerator = 4 * 3 = 12
a = 1 :  1 +  1 +  0 +  9 = 11
a = 2 :  4 +  0 +  1 +  4 =  9
a = 0 :  0 +  4 +  1 + 16 = 21
a = 3 :  9 +  1 +  4 +  1 = 15
denominator                 = 56
kappa       = 1 - 12 / 56 = 1 - 3/14 = 0.785714...
```

`0.785714` against a true `0.7` — a gap of more than eight points of kappa, produced silently, with no warning and no exception. The fix is to pass the full half-band class space `labels=list(range(0, 19))` on every call. Since indices `0..18` equal the class values `0..18`, index distance becomes value distance again. Empty rows and columns have zero marginals, so they contribute nothing to either sum and do not change the result.

- [ ] **Step 2: Write the failing agreement tests**

Create `apps/ai-service/tests/analysis/test_agreement.py`:

```python
from pathlib import Path

import pandas as pd
import pytest
from sklearn.metrics import cohen_kappa_score

from analysis.agreement import (
    CLASS_LABELS,
    AgreementResult,
    agreement_by_model,
    agreement_by_reason_source,
    agreement_for,
    agreement_table,
    band_to_classes,
)
from analysis.load import load_outcomes_csv

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


@pytest.fixture
def outcomes() -> pd.DataFrame:
    return load_outcomes_csv(FIXTURE)


def test_class_space_covers_every_half_band_from_zero_to_nine():
    assert CLASS_LABELS == list(range(0, 19))


def test_band_to_classes_doubles_half_bands():
    bands = pd.Series([0.0, 5.5, 6.0, 6.5, 9.0])
    assert list(band_to_classes(bands)) == [0, 11, 12, 13, 18]


def test_band_to_classes_rejects_a_band_outside_the_scale():
    with pytest.raises(ValueError, match="outside the IELTS band scale"):
        band_to_classes(pd.Series([9.5]))


def test_quadratic_kappa_matches_the_hand_computation(outcomes):
    """AI classes [13, 14, 12, 15] against teacher classes [12, 14, 13, 17].

    observed    = 1 + 0 + 1 + 4 = 6,  numerator = 4 * 6 = 24
    expected    = 18 + 14 + 30 + 18  = 80
    kappa       = 1 - 24 / 80        = 0.7
    """
    result = agreement_for(outcomes, "overall")
    assert result.n == 4
    assert result.quadratic_kappa == pytest.approx(0.7)


def test_kappa_uses_the_full_band_label_space_not_the_observed_labels(outcomes):
    """The fixture has no 8.0, so class 16 is absent and the present classes
    {12, 13, 14, 15, 17} are not consecutive. Letting scikit-learn infer labels
    collapses the gap between 15 and 17 and returns 11/14, not 0.7."""
    ai = [13, 14, 12, 15]
    teacher = [12, 14, 13, 17]

    inferred = cohen_kappa_score(ai, teacher, weights="quadratic")
    explicit = cohen_kappa_score(ai, teacher, weights="quadratic", labels=CLASS_LABELS)

    assert inferred == pytest.approx(11 / 14)
    assert explicit == pytest.approx(0.7)
    assert agreement_for(outcomes, "overall").quadratic_kappa == pytest.approx(0.7)


def test_secondary_metrics_on_the_same_four_rows(outcomes):
    """Band differences are 0.5, 0.0, 0.5, 1.0.

    exact            = 1 of 4                       = 0.25
    within half band = 3 of 4                       = 0.75
    mean absolute    = (0.5 + 0 + 0.5 + 1.0) / 4    = 0.5
    spearman         : AI ranks [2, 3, 1, 4], teacher ranks [1, 3, 2, 4]
                       1 - 6 * 2 / (4 * 15)         = 0.8
    """
    result = agreement_for(outcomes, "overall")
    assert result.exact_agreement == pytest.approx(0.25)
    assert result.within_half_band == pytest.approx(0.75)
    assert result.mean_absolute_error == pytest.approx(0.5)
    assert result.spearman_rho == pytest.approx(0.8)


def test_rows_without_an_ai_baseline_are_excluded(outcomes):
    """s-0005 has has_ai_baseline = false and a teacher overall of 9.0. It must
    not reach any metric: the teacher graded before the AI did, so there is no
    AI score to compare against."""
    result = agreement_for(outcomes, "overall")
    assert result.n == 4
    assert result.n_excluded_no_baseline == 1
    assert result.quadratic_kappa == pytest.approx(0.7)


def test_every_row_filtered_out_returns_an_empty_result_not_a_zero(outcomes):
    """A kappa of 0.0 reads as "no agreement" in a thesis. With no comparable
    rows the honest answer is None, and n must say so."""
    teacher_first_only = outcomes[~outcomes["has_ai_baseline"]].reset_index(drop=True)
    assert len(teacher_first_only) == 1

    result = agreement_for(teacher_first_only, "overall")

    assert isinstance(result, AgreementResult)
    assert result.n == 0
    assert result.n_excluded_no_baseline == 1
    assert result.quadratic_kappa is None
    assert result.exact_agreement is None
    assert result.within_half_band is None
    assert result.mean_absolute_error is None
    assert result.spearman_rho is None


def test_agreement_table_covers_four_criteria_plus_overall(outcomes):
    results = {result.field: result for result in agreement_table(outcomes)}
    assert set(results) == {
        "task_response",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
        "overall",
    }
    # lexical_resource is the one criterion where AI and teacher agree exactly
    # on all four rows, so a mis-wired column lookup cannot pass this.
    assert results["lexical_resource"].quadratic_kappa == pytest.approx(1.0)
    assert results["lexical_resource"].mean_absolute_error == pytest.approx(0.0)
    assert results["task_response"].quadratic_kappa == pytest.approx(0.7)


def test_every_result_records_that_it_is_measured_under_anchoring(outcomes):
    """Spec section 9: when base_result_id is not null the teacher saw the AI
    score first. The number is agreement under anchoring and says so."""
    assert all(result.anchored for result in agreement_table(outcomes))


def test_agreement_by_model_excludes_pre_provenance(outcomes):
    """s-0004 predates the provenance fix, so only s-0001..s-0003 remain:
    AI classes [13, 14, 12] against teacher classes [12, 14, 13].

    observed    = 1 + 0 + 1 = 2,  numerator = 3 * 2 = 6
    expected    = (1 + 1 + 0) + (4 + 0 + 1) + (0 + 4 + 1) = 2 + 5 + 5 = 12
    kappa       = 1 - 6 / 12 = 0.5
    """
    by_model = agreement_by_model(outcomes)
    assert set(by_model) == {"gemini-3.6-flash"}

    overall = {r.field: r for r in by_model["gemini-3.6-flash"]}["overall"]
    assert overall.n == 3
    assert overall.quadratic_kappa == pytest.approx(0.5)


def test_agreement_by_reason_source_never_makes_untagged_a_reason_bucket(outcomes):
    """Spec section 9: an empty tag set means the reason was not captured."""
    by_source = agreement_by_reason_source(outcomes)
    assert set(by_source) == {"batch", "inline"}

    batch_overall = {r.field: r for r in by_source["batch"]}["overall"]
    inline_overall = {r.field: r for r in by_source["inline"]}["overall"]
    assert batch_overall.n == 2
    assert inline_overall.n == 1


def test_as_row_is_flat_and_serialisable(outcomes):
    row = agreement_for(outcomes, "overall").as_row()
    assert row["field"] == "overall"
    assert row["n"] == 4
    assert row["quadratic_kappa"] == pytest.approx(0.7)
    assert row["anchored"] is True
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_agreement.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'analysis.agreement'`.

- [ ] **Step 4: Implement the agreement module**

Create `apps/ai-service/analysis/agreement.py`:

```python
"""Agreement between the LLM baseline and the teacher's final score.

Quadratic weighted kappa, exact agreement, agreement within half a band, mean
absolute error, and Spearman rank correlation, per criterion and overall.

Two rules are enforced here rather than left to the caller, because getting
either of them wrong produces a plausible number instead of an error:

1. Only rows with `has_ai_baseline` are compared. A teacher-first revision has
   no AI score to compare against (spec section 6.1).
2. `cohen_kappa_score` always receives the full half-band class space as
   `labels`. It builds its weight matrix from label POSITIONS, so inferring
   labels from data with a gap in it silently shrinks the distance across that
   gap.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import pandas as pd
from sklearn.metrics import cohen_kappa_score

from .load import (
    PRE_PROVENANCE,
    SCORE_FIELDS,
    with_ai_baseline,
    with_model_provenance,
)

#: IELTS bands run 0.0 to 9.0 in half-band steps. Doubling maps them onto the
#: integer classes 0..18. Index i in this list equals class value i, so the
#: quadratic weight (i - j)**2 is the squared band distance, doubled.
CLASS_LABELS: list[int] = list(range(0, 19))

BAND_MIN = 0.0
BAND_MAX = 9.0
HALF_BAND = 0.5


def band_to_classes(values: pd.Series) -> pd.Series:
    """Map IELTS half-band scores onto the integer classes 0..18."""
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.isna().any():
        raise ValueError("band_to_classes received a missing or non-numeric band")
    if ((numeric < BAND_MIN) | (numeric > BAND_MAX)).any():
        raise ValueError(
            f"band value outside the IELTS band scale [{BAND_MIN}, {BAND_MAX}]"
        )
    return (numeric * 2).round().astype(int)


@dataclass(frozen=True)
class AgreementResult:
    """Agreement on one score field. Every metric is None when n is 0.

    None is used rather than 0.0 on purpose: a kappa of 0.0 reads as "the LLM
    and the teacher agreed no better than chance", which is a claim. No
    comparable rows is the absence of a claim.
    """

    field: str
    n: int
    n_excluded_no_baseline: int
    quadratic_kappa: float | None
    exact_agreement: float | None
    within_half_band: float | None
    mean_absolute_error: float | None
    spearman_rho: float | None
    #: Spec section 9. When base_result_id is not null the teacher saw the AI
    #: score before entering their own, so this is agreement under anchoring,
    #: not independent agreement.
    anchored: bool = True

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def _empty(field: str, n_excluded: int) -> AgreementResult:
    return AgreementResult(
        field=field,
        n=0,
        n_excluded_no_baseline=n_excluded,
        quadratic_kappa=None,
        exact_agreement=None,
        within_half_band=None,
        mean_absolute_error=None,
        spearman_rho=None,
    )


def _spearman(left: pd.Series, right: pd.Series) -> float | None:
    """Spearman rho as the Pearson correlation of average ranks.

    Computed with pandas alone so this package does not depend on SciPy being
    pulled in transitively by scikit-learn.
    """
    left_ranks = left.rank()
    right_ranks = right.rank()
    if left_ranks.nunique() < 2 or right_ranks.nunique() < 2:
        return None
    value = left_ranks.corr(right_ranks)
    return None if pd.isna(value) else float(value)


def agreement_for(frame: pd.DataFrame, field: str) -> AgreementResult:
    """Compute every agreement metric for one score field."""
    if field not in SCORE_FIELDS:
        raise ValueError(f"{field!r} is not one of {SCORE_FIELDS}")

    comparable = with_ai_baseline(frame)
    n_excluded = int(len(frame) - len(comparable))

    ai_column = f"ai_{field}"
    teacher_column = f"teacher_{field}"
    comparable = comparable.dropna(subset=[ai_column, teacher_column])
    if comparable.empty:
        return _empty(field, n_excluded)

    ai_bands = comparable[ai_column].astype(float)
    teacher_bands = comparable[teacher_column].astype(float)
    ai_classes = band_to_classes(ai_bands)
    teacher_classes = band_to_classes(teacher_bands)

    kappa = cohen_kappa_score(
        ai_classes.tolist(),
        teacher_classes.tolist(),
        weights="quadratic",
        labels=CLASS_LABELS,
    )

    difference = (ai_bands - teacher_bands).abs()

    return AgreementResult(
        field=field,
        n=int(len(comparable)),
        n_excluded_no_baseline=n_excluded,
        # A degenerate table — every score identical on both sides — gives a
        # zero expected disagreement and kappa comes back as NaN. That is not
        # a measurement either.
        quadratic_kappa=None if pd.isna(kappa) else float(kappa),
        exact_agreement=float((difference == 0).mean()),
        within_half_band=float((difference <= HALF_BAND).mean()),
        mean_absolute_error=float(difference.mean()),
        spearman_rho=_spearman(ai_bands, teacher_bands),
    )


def agreement_table(frame: pd.DataFrame) -> list[AgreementResult]:
    """Agreement for each of the four criteria and for the overall band."""
    return [agreement_for(frame, field) for field in SCORE_FIELDS]


def agreement_by_reason_source(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]:
    """Agreement split by how the override reason was captured.

    Spec section 9: batch-tagged reasons are given after the fact and are
    weaker evidence than reasons given at the moment of the decision, so the
    analysis must be able to separate them. Untagged revisions never form a
    bucket — an absent reason is not a reason.
    """
    tagged = frame[frame["is_tagged"]]
    return {
        str(source): agreement_table(group.reset_index(drop=True))
        for source, group in tagged.groupby("reason_source", dropna=True)
    }


def agreement_by_model(frame: pd.DataFrame) -> dict[str, list[AgreementResult]]:
    """Agreement split by AI model version.

    Spec section 9: results written before the provenance fix carry no model
    version and cannot be attributed retroactively, so they are excluded here.
    The count of excluded rows is available from `load.caveat_summary`.
    """
    attributable = with_model_provenance(frame)
    return {
        str(model): agreement_table(group.reset_index(drop=True))
        for model, group in attributable.groupby("model_name", dropna=True)
        if str(model) != PRE_PROVENANCE
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_agreement.py -v`

Expected: PASS, 13 passed. If `test_quadratic_kappa_matches_the_hand_computation` reports `0.785714` instead of `0.7`, the `labels=CLASS_LABELS` argument is missing from the `cohen_kappa_score` call.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/analysis/agreement.py apps/ai-service/tests/analysis/test_agreement.py
git commit -m "feat(analysis): quadratic weighted kappa and agreement metrics per criterion"
```

---

### Task 4: Feedback divergence

Scores are one half of what the LLM produced; the feedback text is the other. Both texts are already persisted append-only, so this runs over all historical data with no capture work.

**Files:**
- Create: `apps/ai-service/analysis/feedback_divergence.py`
- Create: `apps/ai-service/tests/analysis/test_feedback_divergence.py`

**Interfaces:**
- Consumes: nothing from earlier tasks at import time; `divergence_table` accepts the frame produced by `analysis.load.load_outcomes_csv` (with essays and feedback included) or by `analysis.load.load_feedback_pairs_db`.
- Produces:
  - `FEEDBACK_COLUMNS: tuple[str, ...]`
  - `tokenize(text: object) -> tuple[str, ...]`
  - `jaccard(left: object, right: object) -> float | None`
  - `normalized_levenshtein(left: object, right: object) -> float | None`
  - `parse_items(value: object) -> tuple[str, ...] | None`
  - `set_overlap(left: object, right: object) -> float | None`
  - `FeedbackDivergence` — a frozen dataclass with fields `submission_id: str`, `summary_jaccard: float | None`, `summary_levenshtein: float | None`, `strengths_overlap: float | None`, `improvements_overlap: float | None`
  - `divergence_for_row(row: pd.Series) -> FeedbackDivergence`
  - `divergence_table(frame: pd.DataFrame) -> pd.DataFrame`
  - `divergence_summary(table: pd.DataFrame) -> dict[str, float | int | None]`
  - `MissingFeedbackColumnsError(ValueError)`

- [ ] **Step 1: Write the failing divergence tests**

Create `apps/ai-service/tests/analysis/test_feedback_divergence.py`:

```python
import json

import pandas as pd
import pytest

from analysis.feedback_divergence import (
    FeedbackDivergence,
    MissingFeedbackColumnsError,
    divergence_for_row,
    divergence_summary,
    divergence_table,
    jaccard,
    normalized_levenshtein,
    parse_items,
    set_overlap,
    tokenize,
)


def test_tokenize_lowercases_and_drops_punctuation():
    assert tokenize("The essay, overall, is Clear!") == (
        "the",
        "essay",
        "overall",
        "is",
        "clear",
    )


def test_tokenize_of_nothing_is_empty():
    assert tokenize("") == ()
    assert tokenize(None) == ()
    assert tokenize(float("nan")) == ()


def test_jaccard_is_intersection_over_union():
    # tokens {a, b, c} and {b, c, d}: intersection 2, union 4
    assert jaccard("a b c", "b c d") == pytest.approx(0.5)


def test_jaccard_of_identical_text_is_one():
    assert jaccard("clear position, good structure", "clear position good structure") == 1.0


def test_jaccard_is_none_when_either_side_is_empty():
    assert jaccard("", "b c d") is None
    assert jaccard("a b c", None) is None


def test_normalized_levenshtein_is_distance_over_the_longer_string():
    # "kitten" -> "sitting" is 3 edits over a longest length of 7
    assert normalized_levenshtein("kitten", "sitting") == pytest.approx(3 / 7)


def test_normalized_levenshtein_of_identical_text_is_zero():
    assert normalized_levenshtein("same text", "same text") == 0.0


def test_normalized_levenshtein_is_none_when_both_sides_are_empty():
    assert normalized_levenshtein("", "") is None


def test_parse_items_reads_json_arrays_and_postgres_arrays():
    assert parse_items('["one", "two"]') == ("one", "two")
    assert parse_items("{one,two}") == ("one", "two")
    assert parse_items(["one", "two"]) == ("one", "two")
    assert parse_items("") is None
    assert parse_items(None) is None


def test_set_overlap_is_jaccard_over_normalised_items():
    left = json.dumps(["Clear position presented", "Logical organization"])
    right = json.dumps(["clear position presented", "Varied vocabulary"])
    # one shared item, three distinct items overall
    assert set_overlap(left, right) == pytest.approx(1 / 3)


def test_set_overlap_is_none_when_either_list_is_absent():
    assert set_overlap(None, json.dumps(["a"])) is None
    assert set_overlap(json.dumps([]), json.dumps(["a"])) is None


def test_divergence_for_row_fills_every_measure():
    row = pd.Series(
        {
            "submission_id": "s-0001",
            "ai_summary": "a b c",
            "teacher_summary": "b c d",
            "ai_strengths": json.dumps(["one", "two"]),
            "teacher_strengths": json.dumps(["one"]),
            "ai_improvements": json.dumps(["three"]),
            "teacher_improvements": json.dumps(["three"]),
        }
    )
    result = divergence_for_row(row)
    assert isinstance(result, FeedbackDivergence)
    assert result.submission_id == "s-0001"
    assert result.summary_jaccard == pytest.approx(0.5)
    assert result.strengths_overlap == pytest.approx(0.5)
    assert result.improvements_overlap == pytest.approx(1.0)
    assert result.summary_levenshtein is not None


def test_divergence_table_keeps_a_row_with_no_teacher_feedback():
    frame = pd.DataFrame(
        [
            {
                "submission_id": "s-0001",
                "ai_summary": "a b c",
                "teacher_summary": "b c d",
                "ai_strengths": json.dumps(["one"]),
                "teacher_strengths": json.dumps(["one"]),
                "ai_improvements": json.dumps(["two"]),
                "teacher_improvements": json.dumps(["two"]),
            },
            {
                "submission_id": "s-0002",
                "ai_summary": "a b c",
                "teacher_summary": "",
                "ai_strengths": json.dumps(["one"]),
                "teacher_strengths": None,
                "ai_improvements": json.dumps(["two"]),
                "teacher_improvements": None,
            },
        ]
    )
    table = divergence_table(frame)
    assert list(table["submission_id"]) == ["s-0001", "s-0002"]
    assert pd.isna(table.loc[1, "summary_jaccard"])
    assert table.loc[0, "summary_jaccard"] == pytest.approx(0.5)


def test_divergence_table_reports_missing_columns_by_name():
    frame = pd.DataFrame([{"submission_id": "s-0001", "ai_summary": "a"}])
    with pytest.raises(MissingFeedbackColumnsError) as excinfo:
        divergence_table(frame)
    message = str(excinfo.value)
    assert "teacher_summary" in message
    assert "load_feedback_pairs_db" in message


def test_divergence_summary_ignores_rows_with_nothing_to_compare():
    table = pd.DataFrame(
        {
            "submission_id": ["s-0001", "s-0002"],
            "summary_jaccard": [0.5, None],
            "summary_levenshtein": [0.4, None],
            "strengths_overlap": [1.0, None],
            "improvements_overlap": [0.0, None],
        }
    )
    summary = divergence_summary(table)
    assert summary["rows"] == 2
    assert summary["compared"] == 1
    assert summary["mean_summary_jaccard"] == pytest.approx(0.5)
    assert summary["mean_improvements_overlap"] == pytest.approx(0.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_feedback_divergence.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'analysis.feedback_divergence'`.

- [ ] **Step 3: Implement the divergence module**

Create `apps/ai-service/analysis/feedback_divergence.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_feedback_divergence.py -v`

Expected: PASS, 14 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/analysis/feedback_divergence.py \
        apps/ai-service/tests/analysis/test_feedback_divergence.py
git commit -m "feat(analysis): measure AI versus teacher feedback divergence"
```

---

### Task 5: CatBoost evaluation with an assignment-level split

The split is the part of this task that decides whether the thesis number is honest. A random row split puts attempt 1 and attempt 2 of the same essay on opposite sides of the boundary; the model then sees nearly the same text in training and in test, and its error drops for a reason that has nothing to do with learning.

**Files:**
- Create: `apps/ai-service/analysis/catboost_eval.py`
- Create: `apps/ai-service/tests/analysis/test_catboost_eval.py`

**Interfaces:**
- Consumes: `analysis.load.CRITERIA`, `analysis.load.SCORE_FIELDS`, `analysis.load.with_ai_baseline`; `analysis.agreement.CLASS_LABELS`, `analysis.agreement.band_to_classes`.
- Produces:
  - `DEFAULT_SEED: int` — `20260921`
  - `NUMERIC_FEATURES: tuple[str, ...]`, `CATEGORICAL_FEATURES: tuple[str, ...]`, `TEXT_FEATURES: tuple[str, ...]`
  - `Split` — a frozen dataclass with fields `train: pd.DataFrame`, `test: pd.DataFrame`, `train_assignments: tuple[str, ...]`, `test_assignments: tuple[str, ...]`
  - `split_by_assignment(frame: pd.DataFrame, *, test_size: float = 0.25, seed: int = DEFAULT_SEED) -> Split`
  - `feature_columns(frame: pd.DataFrame) -> tuple[list[str], list[str], list[str]]`
  - `CriterionComparison` — a frozen dataclass with fields `criterion: str`, `n_train: int`, `n_test: int`, `n_train_assignments: int`, `n_test_assignments: int`, `llm_mae: float`, `catboost_mae: float`, `llm_kappa: float | None`, `catboost_kappa: float | None`, `mae_improvement: float`, and a method `as_row() -> dict[str, object]`
  - `evaluate_criterion(split: Split, criterion: str, *, iterations: int = 400, seed: int = DEFAULT_SEED) -> CriterionComparison`
  - `evaluate_all(frame: pd.DataFrame, *, test_size: float = 0.25, iterations: int = 400, seed: int = DEFAULT_SEED) -> list[CriterionComparison]`
  - `InsufficientAssignmentsError(ValueError)`

- [ ] **Step 1: Write the failing split and evaluation tests**

Create `apps/ai-service/tests/analysis/test_catboost_eval.py`:

```python
from pathlib import Path

import pandas as pd
import pytest

from analysis.catboost_eval import (
    DEFAULT_SEED,
    CriterionComparison,
    InsufficientAssignmentsError,
    Split,
    evaluate_all,
    evaluate_criterion,
    feature_columns,
    split_by_assignment,
)
from analysis.load import load_outcomes_csv

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


def _synthetic(n_assignments: int = 12, attempts: int = 3) -> pd.DataFrame:
    """Several assignments, each with repeat attempts by the same student.

    Repeat attempts are exactly the situation an assignment-level split has to
    protect against: near-duplicate essays that must not straddle the boundary.
    """
    rows = []
    for a in range(n_assignments):
        for k in range(attempts):
            ai_band = 5.0 + (a % 7) * 0.5
            rows.append(
                {
                    "submission_id": f"s-{a:03d}-{k}",
                    "assignment_id": f"a-{a:03d}",
                    "student_id": f"stu-{a:03d}",
                    "teacher_id": "tea-0001",
                    "task_type": "task_2" if a % 2 == 0 else "task_1",
                    "word_count": 250 + a * 7 + k,
                    "ai_task_response": ai_band,
                    "ai_coherence_cohesion": ai_band,
                    "ai_lexical_resource": ai_band,
                    "ai_grammatical_range_accuracy": ai_band,
                    "ai_overall": ai_band,
                    "teacher_task_response": min(9.0, ai_band + 0.5),
                    "teacher_coherence_cohesion": min(9.0, ai_band + 0.5),
                    "teacher_lexical_resource": ai_band,
                    "teacher_grammatical_range_accuracy": min(9.0, ai_band + 0.5),
                    "teacher_overall": min(9.0, ai_band + 0.5),
                    "has_ai_baseline": True,
                    "is_tagged": False,
                    "reason_codes": None,
                    "reason_source": None,
                    "model_name": "gemini-3.6-flash",
                    "is_published": True,
                }
            )
    return pd.DataFrame(rows)


def test_split_puts_no_assignment_on_both_sides():
    """This is the whole point of the task. A student may submit several
    attempts of the same essay on the same prompt, so a random ROW split leaks
    near-duplicate text across the boundary and inflates the result."""
    split = split_by_assignment(_synthetic())

    train_assignments = set(split.train["assignment_id"])
    test_assignments = set(split.test["assignment_id"])

    assert train_assignments & test_assignments == set()
    assert set(split.train_assignments) == train_assignments
    assert set(split.test_assignments) == test_assignments


def test_split_keeps_every_attempt_of_an_assignment_together():
    frame = _synthetic()
    split = split_by_assignment(frame)

    for assignment, group in frame.groupby("assignment_id"):
        in_train = split.train["submission_id"].isin(group["submission_id"]).sum()
        in_test = split.test["submission_id"].isin(group["submission_id"]).sum()
        assert in_train == 0 or in_test == 0, (
            f"assignment {assignment} was split across the train/test boundary"
        )
        assert in_train + in_test == len(group)


def test_split_loses_no_row():
    frame = _synthetic()
    split = split_by_assignment(frame)
    assert len(split.train) + len(split.test) == len(frame)


def test_split_is_deterministic_for_a_seed():
    frame = _synthetic()
    first = split_by_assignment(frame, seed=DEFAULT_SEED)
    second = split_by_assignment(frame, seed=DEFAULT_SEED)
    assert first.test_assignments == second.test_assignments


def test_a_different_seed_selects_a_different_holdout():
    frame = _synthetic(n_assignments=20)
    assert (
        split_by_assignment(frame, seed=1).test_assignments
        != split_by_assignment(frame, seed=2).test_assignments
    )


def test_split_holds_out_roughly_the_requested_share_of_assignments():
    frame = _synthetic(n_assignments=20)
    split = split_by_assignment(frame, test_size=0.25)
    assert len(split.test_assignments) == 5
    assert len(split.train_assignments) == 15


def test_split_returns_a_split_dataclass():
    assert isinstance(split_by_assignment(_synthetic()), Split)


def test_split_refuses_a_dataset_with_one_assignment():
    frame = _synthetic(n_assignments=1)
    with pytest.raises(InsufficientAssignmentsError, match="assignment"):
        split_by_assignment(frame)


def test_split_excludes_rows_without_an_ai_baseline():
    frame = load_outcomes_csv(FIXTURE)
    split = split_by_assignment(frame, test_size=0.5)
    kept = set(split.train["submission_id"]) | set(split.test["submission_id"])
    assert "s-0005" not in kept


def test_feature_columns_omit_the_target_and_the_identifiers():
    numeric, categorical, text = feature_columns(_synthetic())
    assert "word_count" in numeric
    assert "ai_overall" in numeric
    assert "task_type" in categorical
    assert text == []
    for leak in ("teacher_overall", "submission_id", "assignment_id", "student_id"):
        assert leak not in numeric + categorical + text


def test_feature_columns_use_essay_text_when_the_export_included_it():
    frame = _synthetic()
    frame["essay_text"] = "some essay body"
    _, _, text = feature_columns(frame)
    assert text == ["essay_text"]


def test_evaluate_criterion_compares_catboost_against_the_llm_baseline():
    split = split_by_assignment(_synthetic(n_assignments=16))
    comparison = evaluate_criterion(split, "overall", iterations=60)

    assert isinstance(comparison, CriterionComparison)
    assert comparison.criterion == "overall"
    assert comparison.n_train > 0
    assert comparison.n_test > 0
    assert comparison.n_train_assignments + comparison.n_test_assignments == 16
    assert comparison.llm_mae == pytest.approx(0.5)
    assert comparison.catboost_mae >= 0.0
    assert comparison.mae_improvement == pytest.approx(
        comparison.llm_mae - comparison.catboost_mae
    )


def test_evaluate_all_covers_four_criteria_plus_overall():
    comparisons = evaluate_all(_synthetic(n_assignments=16), iterations=60)
    assert [c.criterion for c in comparisons] == [
        "task_response",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range_accuracy",
        "overall",
    ]


def test_comparison_as_row_is_flat():
    split = split_by_assignment(_synthetic(n_assignments=16))
    row = evaluate_criterion(split, "overall", iterations=60).as_row()
    assert row["criterion"] == "overall"
    assert "llm_mae" in row and "catboost_mae" in row
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_catboost_eval.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'analysis.catboost_eval'`.

- [ ] **Step 3: Implement the CatBoost evaluation module**

Create `apps/ai-service/analysis/catboost_eval.py`:

```python
"""Train CatBoost per criterion and compare it against the LLM baseline.

ADR 003 decides the LLM grader is the initial baseline and that a CatBoost
model is trained on teacher-graded data afterwards and compared against it.
This module produces that comparison on a single held-out set, so the two
numbers in the thesis are measured on exactly the same essays.

THE SPLIT IS BY ASSIGNMENT, NEVER BY ROW. A student may submit several
attempts of the same essay on the same prompt. A random row split puts attempt
1 in training and attempt 2 in test, the model sees nearly the same text twice,
and the reported error falls for a reason that is not learning. Holding out
whole assignments removes that path entirely.

The feature set deliberately includes the AI criterion scores. The question
ADR 003 asks is not "can a model grade an essay from scratch" but "can a model
learn where the LLM is wrong and correct it", so the LLM's own output is an
input. `essay_text` is used as a CatBoost text feature when the export was
taken with include_essays=true, and omitted otherwise.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor, Pool

from .agreement import CLASS_LABELS, band_to_classes
from .load import CRITERIA, SCORE_FIELDS, with_ai_baseline

DEFAULT_SEED = 20260921

NUMERIC_FEATURES: tuple[str, ...] = ("word_count",) + tuple(
    f"ai_{field}" for field in SCORE_FIELDS
)
CATEGORICAL_FEATURES: tuple[str, ...] = ("task_type",)
TEXT_FEATURES: tuple[str, ...] = ("essay_text",)


class InsufficientAssignmentsError(ValueError):
    """Fewer than two assignments, so no assignment-level split is possible."""


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    test: pd.DataFrame
    train_assignments: tuple[str, ...]
    test_assignments: tuple[str, ...]


def split_by_assignment(
    frame: pd.DataFrame,
    *,
    test_size: float = 0.25,
    seed: int = DEFAULT_SEED,
) -> Split:
    """Hold out whole assignments, never individual rows.

    Every attempt on a held-out assignment goes to the test side together, so
    no near-duplicate essay can appear on both sides of the boundary.
    """
    comparable = with_ai_baseline(frame)
    assignments = np.sort(comparable["assignment_id"].astype(str).unique())
    if len(assignments) < 2:
        raise InsufficientAssignmentsError(
            f"an assignment-level split needs at least 2 assignments, got "
            f"{len(assignments)}. Splitting by row instead would leak repeat "
            "attempts of the same essay across the train/test boundary."
        )

    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(assignments)
    n_test = max(1, min(len(assignments) - 1, round(len(assignments) * test_size)))
    test_assignments = tuple(sorted(str(a) for a in shuffled[:n_test]))
    train_assignments = tuple(sorted(str(a) for a in shuffled[n_test:]))

    key = comparable["assignment_id"].astype(str)
    return Split(
        train=comparable[key.isin(train_assignments)].reset_index(drop=True),
        test=comparable[key.isin(test_assignments)].reset_index(drop=True),
        train_assignments=train_assignments,
        test_assignments=test_assignments,
    )


def feature_columns(frame: pd.DataFrame) -> tuple[list[str], list[str], list[str]]:
    """Numeric, categorical, and text feature names present in this frame.

    Identifiers and every `teacher_*` column are excluded: the identifiers
    carry no signal and would let the model memorise a student, and the
    teacher columns are the target.
    """
    numeric = [column for column in NUMERIC_FEATURES if column in frame.columns]
    categorical = [column for column in CATEGORICAL_FEATURES if column in frame.columns]
    text = [
        column
        for column in TEXT_FEATURES
        if column in frame.columns and frame[column].notna().any()
    ]
    return numeric, categorical, text


def _build_pool(
    frame: pd.DataFrame,
    criterion: str,
    numeric: list[str],
    categorical: list[str],
    text: list[str],
) -> Pool:
    features = frame[numeric + categorical + text].copy()
    for column in categorical:
        features[column] = features[column].fillna("unknown").astype(str)
    for column in text:
        features[column] = features[column].fillna("").astype(str)
    return Pool(
        data=features,
        label=frame[f"teacher_{criterion}"].astype(float),
        cat_features=categorical or None,
        text_features=text or None,
    )


def _kappa(predicted: pd.Series, actual: pd.Series) -> float | None:
    from sklearn.metrics import cohen_kappa_score

    # Predictions are continuous. Snap them to the nearest half band before
    # scoring, which is the scale a teacher actually writes on.
    snapped = (predicted.astype(float) * 2).round().clip(0, 18) / 2
    value = cohen_kappa_score(
        band_to_classes(snapped).tolist(),
        band_to_classes(actual.astype(float)).tolist(),
        weights="quadratic",
        labels=CLASS_LABELS,
    )
    return None if pd.isna(value) else float(value)


@dataclass(frozen=True)
class CriterionComparison:
    criterion: str
    n_train: int
    n_test: int
    n_train_assignments: int
    n_test_assignments: int
    llm_mae: float
    catboost_mae: float
    llm_kappa: float | None
    catboost_kappa: float | None
    mae_improvement: float

    def as_row(self) -> dict[str, object]:
        return asdict(self)


def evaluate_criterion(
    split: Split,
    criterion: str,
    *,
    iterations: int = 400,
    seed: int = DEFAULT_SEED,
) -> CriterionComparison:
    """Train on the training assignments and score both models on the holdout."""
    if criterion not in SCORE_FIELDS:
        raise ValueError(f"{criterion!r} is not one of {SCORE_FIELDS}")

    numeric, categorical, text = feature_columns(split.train)
    train_pool = _build_pool(split.train, criterion, numeric, categorical, text)
    test_pool = _build_pool(split.test, criterion, numeric, categorical, text)

    model = CatBoostRegressor(
        iterations=iterations,
        depth=6,
        learning_rate=0.05,
        loss_function="RMSE",
        random_seed=seed,
        verbose=False,
        allow_writing_files=False,
    )
    model.fit(train_pool)

    actual = split.test[f"teacher_{criterion}"].astype(float)
    llm = split.test[f"ai_{criterion}"].astype(float)
    predicted = pd.Series(model.predict(test_pool), index=actual.index)

    llm_mae = float((llm - actual).abs().mean())
    catboost_mae = float((predicted - actual).abs().mean())

    return CriterionComparison(
        criterion=criterion,
        n_train=int(len(split.train)),
        n_test=int(len(split.test)),
        n_train_assignments=len(split.train_assignments),
        n_test_assignments=len(split.test_assignments),
        llm_mae=llm_mae,
        catboost_mae=catboost_mae,
        llm_kappa=_kappa(llm, actual),
        catboost_kappa=_kappa(predicted, actual),
        mae_improvement=llm_mae - catboost_mae,
    )


def evaluate_all(
    frame: pd.DataFrame,
    *,
    test_size: float = 0.25,
    iterations: int = 400,
    seed: int = DEFAULT_SEED,
) -> list[CriterionComparison]:
    """Compare CatBoost against the LLM on one shared held-out set.

    The split is computed once, so every criterion is measured on exactly the
    same essays and the rows of the thesis table are comparable.
    """
    split = split_by_assignment(frame, test_size=test_size, seed=seed)
    return [
        evaluate_criterion(split, criterion, iterations=iterations, seed=seed)
        for criterion in CRITERIA + ("overall",)
    ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_catboost_eval.py -v`

Expected: PASS, 14 passed. CatBoost training on a 48-row synthetic frame at 60 iterations takes a couple of seconds per criterion.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/analysis/catboost_eval.py apps/ai-service/tests/analysis/test_catboost_eval.py
git commit -m "feat(analysis): CatBoost versus LLM comparison on an assignment-level split"
```

---

### Task 6: Thesis report

The last module turns the dataclasses from Tasks 3 to 5 into the Markdown tables that go into the thesis, and prints the section 9 caveats next to every number so the limitations travel with the result instead of being remembered separately.

**Files:**
- Create: `apps/ai-service/analysis/report.py`
- Create: `apps/ai-service/tests/analysis/test_report.py`

**Interfaces:**
- Consumes: `analysis.load.load_outcomes_csv`, `analysis.load.load_outcomes_db`, `analysis.load.caveat_summary`; `analysis.agreement.AgreementResult`, `analysis.agreement.agreement_table`, `analysis.agreement.agreement_by_model`, `analysis.agreement.agreement_by_reason_source`; `analysis.feedback_divergence.divergence_table`, `analysis.feedback_divergence.divergence_summary`, `analysis.feedback_divergence.MissingFeedbackColumnsError`; `analysis.catboost_eval.evaluate_all`, `analysis.catboost_eval.InsufficientAssignmentsError`.
- Produces:
  - `format_value(value: object) -> str`
  - `markdown_table(headers: list[str], rows: list[list[object]]) -> str`
  - `render_caveats(frame: pd.DataFrame) -> str`
  - `render_agreement(results: list[AgreementResult], title: str) -> str`
  - `render_agreement_by_model(frame: pd.DataFrame) -> str`
  - `render_agreement_by_reason_source(frame: pd.DataFrame) -> str`
  - `render_divergence(frame: pd.DataFrame) -> str`
  - `render_catboost(frame: pd.DataFrame, *, iterations: int, seed: int) -> str`
  - `build_report(frame: pd.DataFrame, *, with_catboost: bool = True, iterations: int = 400, seed: int = DEFAULT_SEED) -> str`
  - `main(argv: list[str] | None = None) -> int`

- [ ] **Step 1: Write the failing report tests**

Create `apps/ai-service/tests/analysis/test_report.py`:

```python
from pathlib import Path

import pytest

from analysis.load import load_outcomes_csv
from analysis.report import (
    build_report,
    format_value,
    main,
    markdown_table,
    render_agreement,
    render_agreement_by_model,
    render_caveats,
    render_catboost,
    render_divergence,
)
from analysis.agreement import agreement_table

FIXTURE = Path(__file__).parent / "fixtures" / "outcomes_small.csv"


def test_format_value_renders_none_as_an_explicit_dash():
    assert format_value(None) == "—"
    assert format_value(0.7) == "0.700"
    assert format_value(4) == "4"
    assert format_value(True) == "yes"
    assert format_value("overall") == "overall"


def test_markdown_table_has_a_header_rule():
    table = markdown_table(["a", "b"], [[1, 2], [3, 4]])
    lines = table.splitlines()
    assert lines[0] == "| a | b |"
    assert lines[1] == "| --- | --- |"
    assert lines[2] == "| 1 | 2 |"


def test_render_agreement_lists_every_field_and_the_kappa():
    frame = load_outcomes_csv(FIXTURE)
    section = render_agreement(agreement_table(frame), "Agreement")
    assert "## Agreement" in section
    assert "task_response" in section
    assert "overall" in section
    assert "0.700" in section


def test_render_caveats_states_every_section_nine_limitation():
    section = render_caveats(load_outcomes_csv(FIXTURE))
    assert "anchoring" in section.lower()
    assert "pre_provenance" in section
    assert "untagged" in section.lower()
    assert "retrospective" in section.lower() or "after the fact" in section.lower()
    # the counts from the fixture
    assert "| without an AI baseline | 1 |" in section
    assert "| untagged | 2 |" in section


def test_render_agreement_by_model_names_the_model():
    section = render_agreement_by_model(load_outcomes_csv(FIXTURE))
    assert "gemini-3.6-flash" in section
    assert "0.500" in section


def test_render_divergence_explains_itself_when_the_columns_are_absent():
    section = render_divergence(load_outcomes_csv(FIXTURE))
    assert "## Feedback divergence" in section
    assert "load_feedback_pairs_db" in section


def test_render_catboost_explains_itself_when_there_is_too_little_data():
    section = render_catboost(load_outcomes_csv(FIXTURE), iterations=10, seed=1)
    assert "## CatBoost versus the LLM baseline" in section
    assert "assignment" in section


def test_build_report_contains_every_section():
    report = build_report(load_outcomes_csv(FIXTURE), with_catboost=False)
    assert "# IELTS assessment analysis" in report
    assert "## Agreement (LLM versus teacher)" in report
    assert "## Agreement by model version" in report
    assert "## Agreement by reason source" in report
    assert "## Feedback divergence" in report
    assert "## Data quality caveats" in report


def test_main_writes_a_report_to_a_file(tmp_path, capsys):
    destination = tmp_path / "report.md"
    exit_code = main(["--csv", str(FIXTURE), "--out", str(destination), "--no-catboost"])
    assert exit_code == 0
    assert "# IELTS assessment analysis" in destination.read_text(encoding="utf-8")


def test_main_prints_to_stdout_when_no_destination_is_given(capsys):
    exit_code = main(["--csv", str(FIXTURE), "--no-catboost"])
    assert exit_code == 0
    assert "# IELTS assessment analysis" in capsys.readouterr().out


def test_main_requires_a_source():
    with pytest.raises(SystemExit):
        main([])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_report.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'analysis.report'`.

- [ ] **Step 3: Implement the report module**

Create `apps/ai-service/analysis/report.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/ai-service && python -m pytest tests/analysis/test_report.py -v`

Expected: PASS, 11 passed.

- [ ] **Step 5: Run the whole suite**

Run: `cd apps/ai-service && python -m pytest -v`

Expected: PASS. The service tests, the isolation tests, and all five analysis test modules.

- [ ] **Step 6: Run the report by hand against the fixture**

Run: `cd apps/ai-service && python -m analysis.report --csv tests/analysis/fixtures/outcomes_small.csv --no-catboost`

Expected: a Markdown document on stdout whose first agreement table shows `overall` with `n` 4 and a quadratic kappa of `0.700`, and whose caveats table shows 1 row without an AI baseline, 2 untagged, and 1 `pre_provenance`.

- [ ] **Step 7: Confirm the research layer is still out of the image**

Run: `cd apps/ai-service && docker build -t idest-ai-service:isolation-check . && docker run --rm idest-ai-service:isolation-check python -c "import pathlib, importlib.util; print('analysis dir:', pathlib.Path('/app/analysis').exists()); print('pandas:', importlib.util.find_spec('pandas') is not None); print('catboost:', importlib.util.find_spec('catboost') is not None)"`

Expected: `analysis dir: False`, `pandas: None` reported as `False`, `catboost: False`. If Docker is not available locally, `tests/test_analysis_isolation.py` already asserts the same thing statically against the Dockerfile and `.dockerignore`, and that test is the gate.

- [ ] **Step 8: Commit**

```bash
git add apps/ai-service/analysis/report.py apps/ai-service/tests/analysis/test_report.py
git commit -m "feat(analysis): render the thesis agreement and comparison tables"
```

---

## Assumptions this plan makes

Stated here rather than buried in the tasks, because each one is a place where this plan could be wrong through no fault of its own.

1. **The `v_assessment_outcomes` column contract.** The view is built by a separate plan. This plan is written against the column list in spec section 6.1 and treats it as fixed. The concrete names are declared once, in `analysis/load.py`'s `REQUIRED_COLUMNS`. A name mismatch surfaces as a `MissingColumnsError` naming the missing columns, not as a wrong number, and is fixed in that one file.

2. **The pytest setup already exists.** `apps/ai-service/pytest.ini` (`pythonpath = .`, `testpaths = tests`, `asyncio_mode = auto`) and the `"test": "pytest"` script in `apps/ai-service/package.json` come from Task 1 of `docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`. This plan adds `"test:analysis"` beside them and does not touch `pytest.ini`.

3. **Feedback text is not in the section 6.1 column list.** Section 6.1 enumerates scores, timings, and tags but not the feedback JSON, while section 8 requires divergence between the AI summary and the teacher summary over all historical data. This plan resolves that by treating the feedback columns as optional in the export and providing `load_feedback_pairs_db`, which reads `scoring_results.feedback` and `score_revisions.final_feedback` directly. When neither source carries them, `render_divergence` prints why the section is empty instead of omitting it.

4. **`pre_provenance` is written into `model_name`.** Section 6.1 says the view exports "model name and version, or the `pre_provenance` marker" without saying which column carries it. `load.py` normalises a null or empty `model_name` to the same marker, so either encoding works.

5. **CatBoost wheel availability.** The repository `venv/` is Python 3.14; the Docker base image is 3.12. If CatBoost has no wheel for the local interpreter, create a separate 3.12 environment for the analysis work as described in Global Constraints. The service environment is unaffected either way.

6. **The AI score is a CatBoost input.** ADR 003 asks whether a trained model can beat the LLM on teacher-graded data, so the LLM's own criterion scores are features rather than something to be reproduced from scratch. `feature_columns` makes the set explicit and easy to change.

## Out of scope

This plan builds `apps/ai-service/analysis/` and nothing else. Specifically not in it:

- **The SQL views** — `v_assessment_outcomes`, `v_scoring_health`, and `v_teacher_activity` (spec section 6). This plan consumes the first one's output and assumes the column contract.
- **The NestJS analytics module** — `src/analytics/`, `GET /analytics/overview`, `GET /analytics/scoring-health`, `GET /analytics/export` (spec section 7).
- **The admin web pages** — `apps/web/app/admin/page.tsx`, `apps/web/app/admin/scoring/page.tsx`, and the `recharts` dependency (spec section 7).
- **Every capture-side change** — model provenance in the worker and the server (4.1), `elapsed_ms` and token counts in `scorer.py` (4.2), the admin promotion script (4.3), the `review-session` endpoint (5.2), and the `RevisionReasonTag` table with its batch endpoints and modal (5.1). Those belong to `docs/superpowers/plans/2026-09-21-provenance-and-capture-backend.md`.
- **Any change to `main.py`, `worker.py`, `scorer.py`, `schemas.py`, or `config.py`.** Task 1 adds a test that fails if the research layer ever reaches them.

## Self-review

**Spec coverage — section 8, item by item.**

| Spec requirement | Task |
| --- | --- |
| `apps/ai-service/analysis/` is a research folder, not part of the running service | Task 1 (`test_service_modules_do_not_import_analysis`) |
| `load.py` reads the exported CSV or a read-only database URL | Task 2 (`load_outcomes_csv`, `load_outcomes_db`) |
| Quadratic weighted kappa via `cohen_kappa_score(weights='quadratic')` | Task 3 (`agreement_for`) |
| Half-band scores mapped to integer classes by multiplying by two | Task 3 (`band_to_classes`, `CLASS_LABELS`) |
| Exact agreement, agreement within half a band, MAE, Spearman | Task 3 (`AgreementResult`) |
| Per criterion and overall | Task 3 (`agreement_table` over `SCORE_FIELDS`) |
| Reads only rows where `has_ai_baseline` is true | Task 2 (`with_ai_baseline`), enforced in Task 3 |
| `feedback_divergence.py`: token Jaccard and normalized Levenshtein on `summary` | Task 4 (`jaccard`, `normalized_levenshtein`) |
| Set overlap on `strengths` and `improvements` | Task 4 (`set_overlap`) |
| Runs over all historical data | Task 4 plus `load_feedback_pairs_db` in Task 2 |
| `catboost_eval.py` trains per criterion, compares on the same held-out set | Task 5 (`evaluate_all` — one split, every criterion) |
| Split by assignment, not by row | Task 5 (`split_by_assignment` and four tests on it) |
| `report.py` emits the thesis tables | Task 6 |
| `requirements-analysis.txt` with pandas, scikit-learn, catboost, Levenshtein | Task 1 |
| The deployed worker image installs only `requirements.txt` | Task 1 (Dockerfile verified unchanged; `.dockerignore` extended) |
| Pytest: kappa against a hand-computed fixture | Task 3, Step 1 arithmetic and `test_quadratic_kappa_matches_the_hand_computation` |
| Pytest: the case where every `has_ai_baseline` row is filtered out | Task 3 (`test_every_row_filtered_out_returns_an_empty_result_not_a_zero`) |

**Spec coverage — section 9, honoured in code rather than only mentioned.**

| Caveat | Where the code honours it |
| --- | --- |
| Retrospective reasons are weaker evidence | `reason_source` and `tag_latency_seconds` loaded and typed; `agreement_by_reason_source` splits inline from batch; `render_agreement_by_reason_source` prints both |
| Anchoring is uncontrolled | `AgreementResult.anchored` is on every result; `caveat_summary["anchored"]`; `render_caveats` states the limitation |
| Pre-provenance rows | `PRE_PROVENANCE`, `with_model_provenance`, `agreement_by_model` excludes them, `render_agreement_by_model` prints the excluded count |
| Untagged is not an empty reason set | `_to_reason_codes` returns `None`, never `()`; `is_tagged`; `agreement_by_reason_source` forms no untagged bucket; two dedicated tests |

**Placeholder scan.** No TBD, TODO, "implement later", "add appropriate error handling", "write tests for the above", or "similar to Task N". Every code step contains complete, runnable code. Every error path names its own condition: `MissingColumnsError` lists the columns, `MissingFeedbackColumnsError` names the fallback function, `InsufficientAssignmentsError` says why a row split is not an acceptable substitute.

**Type consistency.** `CRITERIA` and `SCORE_FIELDS` are defined once in `load.py` and imported by `agreement.py` and `catboost_eval.py`. `CLASS_LABELS` and `band_to_classes` are defined once in `agreement.py` and imported by `catboost_eval.py`. `PRE_PROVENANCE` is defined once in `load.py` and imported by `agreement.py` and `report.py`. `DEFAULT_SEED` is defined once in `catboost_eval.py` and imported by `report.py`. `AgreementResult.as_row` and `CriterionComparison.as_row` have matching names and both return `dict[str, object]`. Every name used in a test is in the Interfaces block of the task that creates it: `load` exports 12 names, `agreement` 8, `feedback_divergence` 11, `catboost_eval` 11, `report` 10, and every import in every test file resolves to one of them.
