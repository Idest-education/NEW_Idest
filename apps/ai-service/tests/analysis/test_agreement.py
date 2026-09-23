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
