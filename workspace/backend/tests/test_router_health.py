"""Router model availability/latency reporting for the status page."""
import time
from types import SimpleNamespace

import pytest

from app import cache
import app.config
from app.services import router_health


class FakeRedis:
    def __init__(self):
        self.lists, self.keys = {}, {}

    def pipeline(self):
        return self

    def execute(self):
        return []

    def lpush(self, key, value):
        self.lists.setdefault(key, []).insert(0, value)

    def ltrim(self, key, start, end):
        self.lists[key] = self.lists.get(key, [])[start:end + 1]

    def expire(self, key, seconds):
        pass

    def lrange(self, key, start, end):
        return self.lists.get(key, [])[start:end + 1]

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.keys:
            return None
        self.keys[key] = value
        return True


@pytest.fixture
def redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache, '_lazy_client', lambda: fake)
    # Other tests reload app.config; patch whichever object is current now.
    config = app.config.config
    monkeypatch.setattr(config, 'MESSAGE_ROUTER_MODEL', 'router-small')
    monkeypatch.setattr(config, 'MESSAGE_ROUTER_BASE_URL', 'https://router.example/v1')
    monkeypatch.setattr(config, 'MESSAGE_ROUTER_API_KEY', 'k')
    return fake


@pytest.fixture
def probes(monkeypatch):
    calls = SimpleNamespace(roles=[], ok=True)

    def probe(role):
        calls.roles.append(role)
        router_health.record(role, calls.ok, 42, source='probe')
    monkeypatch.setattr(router_health, '_probe', probe)
    return calls


def test_live_calls_report_availability_and_latency(client, redis, probes):
    for ms in (100, 200, 300):
        router_health.record('message', True, ms)
    router_health.record('message', False, 15000)
    response = client.get('/health/router/message')
    body = response.json()
    assert response.status_code == 503  # 3/4 < 90%
    assert body['status'] == 'degraded' and body['model'] == 'router-small'
    assert body['calls'] == 4 and body['availability'] == 0.75
    assert body['latency_p50_ms'] == 200 and body['latency_p95_ms'] == 300, 'failures are excluded from latency'
    assert probes.roles == [], 'recent traffic needs no probe'


def test_healthy_traffic_is_up(client, redis, probes):
    for _ in range(20):
        router_health.record('message', True, 120)
    response = client.get('/health/router/message')
    assert response.status_code == 200 and response.json()['status'] == 'ok'


def test_timed_records_failures_and_reraises(redis):
    with pytest.raises(RuntimeError):
        router_health.timed('general', lambda: (_ for _ in ()).throw(RuntimeError('boom')))
    assert router_health.timed('general', lambda: 'stop') == 'stop'
    samples = router_health._samples('general')
    assert [s[1] for s in samples] == [True, False]


def test_quiet_role_is_probed_once_per_interval(client, redis, probes):
    assert client.get('/health/router/message').json()['probe_calls'] == 1
    client.get('/health/router/message')
    assert probes.roles == ['message'], 'the probe lock allows one probe per interval'


def test_failed_probe_reports_down(client, redis, probes):
    probes.ok = False
    response = client.get('/health/router/message')
    assert response.status_code == 503 and response.json()['availability'] == 0.0


def test_old_samples_fall_out_of_the_window(client, redis, probes, monkeypatch):
    router_health.record('message', False, 100)
    later = time.time() + router_health.WINDOW_SECONDS + 1
    monkeypatch.setattr(router_health.time, 'time', lambda: later)
    router_health.record('message', True, 100)
    body = client.get('/health/router/message').json()
    assert body['calls'] == 1 and body['availability'] == 1.0


def test_unknown_role_and_missing_config(client, redis, monkeypatch):
    assert client.get('/health/router/nope').status_code == 404
    monkeypatch.setattr(app.config.config, 'MESSAGE_ROUTER_MODEL', '')
    assert client.get('/health/router/message').json()['status'] == 'not_configured'


def test_metrics_store_down_never_breaks_routing(monkeypatch):
    monkeypatch.setattr(cache, '_lazy_client', lambda: None)
    assert router_health.timed('message', lambda: 'next:bot') == 'next:bot'
