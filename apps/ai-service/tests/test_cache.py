import json

import pytest
from cache import CACHE_FORMAT, CachedScorer, ScoringCache, cache_key

DESCRIPTOR = {
    "modelName": "gemini-3.6-flash",
    "modelVersion": "2026-09-21-v1",
    "provider": "google",
    "taskType": "both",
    "configuration": {"system_prompt_sha256": "abc", "max_retries": 3},
}

RESULT = {
    "status": "completed",
    "scores": {"overall": 7.0},
    "feedback": {"summary": "solid"},
    "raw_output": {"scores": {"overall": 7.0}},
    "processing_metadata": {
        "model_name": "gemini-3.6-flash",
        "provider": "google",
        "elapsed_ms": 4120,
        "prompt_tokens": 800,
        "completion_tokens": 200,
        "total_tokens": 1000,
    },
}


class CountingScorer:
    def __init__(self, descriptor=DESCRIPTOR, result=RESULT):
        self._descriptor = descriptor
        self._result = result
        self.calls = 0

    async def score_essay(self, task_prompt, task_type, essay_text):
        self.calls += 1
        return {**self._result}

    def descriptor(self):
        return self._descriptor


def key_for(descriptor=DESCRIPTOR, prompt="prompt", task_type="task_2", essay="essay"):
    return cache_key(descriptor, prompt, task_type, essay)


def test_the_same_input_and_grader_produce_the_same_key():
    assert key_for() == key_for()


def test_a_changed_essay_produces_a_different_key():
    assert key_for(essay="essay") != key_for(essay="essay ")


def test_a_changed_task_prompt_produces_a_different_key():
    assert key_for(prompt="one") != key_for(prompt="two")


def test_a_changed_task_type_produces_a_different_key():
    assert key_for(task_type="task_1") != key_for(task_type="task_2")


def test_a_bumped_scorer_revision_invalidates_the_key():
    bumped = {**DESCRIPTOR, "modelVersion": "2026-10-01-v2"}

    assert key_for(descriptor=bumped) != key_for()


def test_a_changed_prompt_hash_invalidates_the_key():
    edited = {
        **DESCRIPTOR,
        "configuration": {**DESCRIPTOR["configuration"], "system_prompt_sha256": "xyz"},
    }

    assert key_for(descriptor=edited) != key_for()


def test_a_different_provider_invalidates_the_key():
    local = {**DESCRIPTOR, "provider": "ollama", "modelName": "qwen2.5:7b-instruct"}

    assert key_for(descriptor=local) != key_for()


def test_a_miss_reads_as_none(tmp_path):
    assert ScoringCache(tmp_path).get(key_for()) is None


def test_a_stored_result_comes_back(tmp_path):
    cache = ScoringCache(tmp_path)
    key = key_for()

    assert cache.put(key, RESULT) is True
    assert cache.get(key) == RESULT


def test_a_failed_result_is_never_stored(tmp_path):
    cache = ScoringCache(tmp_path)
    key = key_for()
    failed = {"status": "failed", "scores": {}, "feedback": {"error": "429"}}

    assert cache.put(key, failed) is False
    assert cache.get(key) is None


def test_a_disabled_cache_stores_nothing_and_serves_nothing(tmp_path):
    cache = ScoringCache(tmp_path, enabled=False)
    key = key_for()

    assert cache.put(key, RESULT) is False
    assert cache.get(key) is None


def test_a_damaged_entry_reads_as_a_miss(tmp_path):
    cache = ScoringCache(tmp_path)
    key = key_for()
    cache.put(key, RESULT)
    (tmp_path / f"{key}.json").write_text("{not json", encoding="utf-8")

    assert cache.get(key) is None


def test_an_entry_from_an_older_format_is_ignored(tmp_path):
    cache = ScoringCache(tmp_path)
    key = key_for()
    (tmp_path / f"{key}.json").write_text(
        json.dumps({"format": "v0", "result": RESULT}), encoding="utf-8"
    )

    assert cache.get(key) is None


def test_no_half_written_temporary_file_is_left_behind(tmp_path):
    cache = ScoringCache(tmp_path)
    cache.put(key_for(), RESULT)

    assert list(tmp_path.glob("*.tmp")) == []


def test_the_stored_envelope_records_its_format(tmp_path):
    cache = ScoringCache(tmp_path)
    key = key_for()
    cache.put(key, RESULT)

    stored = json.loads((tmp_path / f"{key}.json").read_text(encoding="utf-8"))
    assert stored["format"] == CACHE_FORMAT


async def test_a_second_identical_essay_costs_no_provider_call(tmp_path):
    inner = CountingScorer()
    cached = CachedScorer(inner, ScoringCache(tmp_path))

    first = await cached.score_essay("prompt", "task_2", "essay")
    second = await cached.score_essay("prompt", "task_2", "essay")

    assert inner.calls == 1
    assert first["scores"] == second["scores"]
    assert first["feedback"] == second["feedback"]


async def test_a_served_result_is_marked_as_a_cache_hit(tmp_path):
    inner = CountingScorer()
    cached = CachedScorer(inner, ScoringCache(tmp_path))

    first = await cached.score_essay("prompt", "task_2", "essay")
    second = await cached.score_essay("prompt", "task_2", "essay")

    assert first["processing_metadata"]["cache_hit"] is False
    assert second["processing_metadata"]["cache_hit"] is True


async def test_a_cache_hit_keeps_the_original_latency_and_tokens(tmp_path):
    """Cached rows must be droppable from any timing or cost measurement."""
    inner = CountingScorer()
    cached = CachedScorer(inner, ScoringCache(tmp_path))

    await cached.score_essay("prompt", "task_2", "essay")
    hit = await cached.score_essay("prompt", "task_2", "essay")

    assert hit["processing_metadata"]["elapsed_ms"] == 4120
    assert hit["processing_metadata"]["total_tokens"] == 1000


async def test_a_different_essay_still_reaches_the_provider(tmp_path):
    inner = CountingScorer()
    cached = CachedScorer(inner, ScoringCache(tmp_path))

    await cached.score_essay("prompt", "task_2", "first essay")
    await cached.score_essay("prompt", "task_2", "second essay")

    assert inner.calls == 2


async def test_a_bumped_revision_rescores_rather_than_serving_the_old_result(tmp_path):
    cache = ScoringCache(tmp_path)
    old = CountingScorer()
    await CachedScorer(old, cache).score_essay("prompt", "task_2", "essay")

    bumped = CountingScorer(descriptor={**DESCRIPTOR, "modelVersion": "2026-10-01-v2"})
    await CachedScorer(bumped, cache).score_essay("prompt", "task_2", "essay")

    assert bumped.calls == 1


async def test_a_failure_is_raised_and_not_remembered(tmp_path):
    class Failing:
        def __init__(self):
            self.calls = 0

        async def score_essay(self, task_prompt, task_type, essay_text):
            self.calls += 1
            raise RuntimeError("429 error")

        def descriptor(self):
            return DESCRIPTOR

    inner = Failing()
    cached = CachedScorer(inner, ScoringCache(tmp_path))

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cached.score_essay("prompt", "task_2", "essay")

    assert inner.calls == 2
    assert list(tmp_path.glob("*.json")) == []


async def test_the_cache_survives_a_restart(tmp_path):
    """A new worker process reads what the last one wrote."""
    first_run = CountingScorer()
    await CachedScorer(first_run, ScoringCache(tmp_path)).score_essay("p", "task_2", "e")

    second_run = CountingScorer()
    await CachedScorer(second_run, ScoringCache(tmp_path)).score_essay("p", "task_2", "e")

    assert second_run.calls == 0


async def test_an_unwritable_directory_does_not_fail_the_scoring(tmp_path):
    blocked = tmp_path / "blocked"
    blocked.write_text("this is a file, not a directory", encoding="utf-8")
    inner = CountingScorer()

    result = await CachedScorer(inner, ScoringCache(blocked)).score_essay("p", "task_2", "e")

    assert result["status"] == "completed"
