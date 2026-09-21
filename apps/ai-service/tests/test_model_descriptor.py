import hashlib

from scorer import GeminiIELTSScorer, IELTS_SYSTEM_PROMPT


def test_descriptor_identifies_the_real_model():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")
    scorer.client = object()  # pretend the SDK initialised

    d = scorer.descriptor()

    assert d["modelName"] == "gemini-3.6-flash"
    assert d["provider"] == "google"
    assert d["taskType"] == "both"
    assert d["modelVersion"]


def test_descriptor_marks_stub_results_separately():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")

    d = scorer.descriptor()

    assert d["modelName"] == "stub-gemini-model"
    assert d["provider"] == "google-stub"


def test_configuration_pins_the_prompt_by_hash():
    scorer = GeminiIELTSScorer(api_key="", model_name="gemini-3.6-flash")

    digest = scorer.descriptor()["configuration"]["system_prompt_sha256"]

    assert digest == hashlib.sha256(IELTS_SYSTEM_PROMPT.encode()).hexdigest()
