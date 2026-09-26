import pytest
from rate_limit import RateLimiter


class FakeClock:
    """A monotonic clock that only moves when something sleeps on it."""

    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def time(self):
        return self.now

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


async def test_the_first_call_is_never_delayed():
    clock = FakeClock()
    limiter = RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)

    assert await limiter.acquire() == 0.0
    assert clock.sleeps == []


async def test_a_back_to_back_call_waits_the_full_interval():
    clock = FakeClock()
    limiter = RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)

    await limiter.acquire()
    assert await limiter.acquire() == 6.0
    assert clock.sleeps == [6.0]


async def test_time_already_spent_working_counts_towards_the_interval():
    clock = FakeClock()
    limiter = RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)

    await limiter.acquire()
    clock.now += 4.0  # the scoring call itself took 4s

    assert await limiter.acquire() == 2.0


async def test_a_slow_call_removes_the_wait_entirely():
    clock = FakeClock()
    limiter = RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)

    await limiter.acquire()
    clock.now += 30.0

    assert await limiter.acquire() == 0.0
    assert clock.sleeps == []


async def test_ten_calls_are_spread_over_the_whole_minute():
    clock = FakeClock()
    limiter = RateLimiter(6.0, clock=clock.time, sleep=clock.sleep)
    started = clock.now

    for _ in range(10):
        await limiter.acquire()

    assert clock.now - started == 54.0  # first call free, then 9 gaps of 6s


async def test_a_zero_interval_disables_the_limiter():
    clock = FakeClock()
    limiter = RateLimiter(0.0, clock=clock.time, sleep=clock.sleep)

    await limiter.acquire()
    assert await limiter.acquire() == 0.0
    assert clock.sleeps == []
