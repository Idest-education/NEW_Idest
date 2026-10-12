import asyncio

from chat import ChatWorker, build_chat_prompt

JOB = {
    "turnId": "t1",
    "taskType": "task_2",
    "taskPrompt": "Do cars do more harm than good?",
    "essayText": "Cars is useful.",
    "wordCount": 3,
    "result": {"by": "ai", "scores": {"overall": 5.0}, "feedback": {"comment": "Too short."}},
    "history": [{"question": "Why 5?", "answer": "It is short."}],
    "question": "How do I fix the grammar?",
}


class FakeLLM:
    name = "fake"

    def __init__(self, replies):
        self.replies = list(replies)

    async def complete_json(self, system, user, schema):
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def worker(replies):
    w = ChatWorker(llm=FakeLLM(replies))
    w.sleep = lambda _s: asyncio.sleep(0)
    return w


def test_the_prompt_carries_essay_question_assessment_and_history():
    prompt = build_chat_prompt(JOB)
    for part in ("Cars is useful.", "Do cars do more harm", "Too short.", "Why 5?", "It is short.", "fix the grammar"):
        assert part in prompt


def test_an_answer_is_returned():
    assert asyncio.run(worker([{"answer": " Use 'are'. "}]).answer(JOB)) == {
        "status": "answered",
        "answer": "Use 'are'.",
        "error": None,
    }


def test_a_transient_failure_is_retried_then_answered():
    result = asyncio.run(worker([ConnectionError("down"), {"answer": "ok"}]).answer(JOB))
    assert result["status"] == "answered"


def test_a_bad_request_fails_without_retrying():
    result = asyncio.run(worker([ValueError("bad config")]).answer(JOB))
    assert result["status"] == "failed"
