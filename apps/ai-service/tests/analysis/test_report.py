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
