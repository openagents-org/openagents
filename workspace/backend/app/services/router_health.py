"""Availability and latency of the routing models, for the status page.

Every real routing call records (time, ok, latency) into a short Redis list per
model role. GET /health/router/{role} summarizes the recent window. When a
role has had no calls for PROBE_AFTER_SECONDS (quiet hours), one tiny probe
request runs — at most once per PROBE_AFTER_SECONDS per role across all
workers — so the page keeps reporting real reachability without traffic.
Recording never raises: Redis trouble must not affect routing.
"""
import json
import logging
import time

from app import cache

logger = logging.getLogger(__name__)

ROLES = ("message", "general")
WINDOW_SECONDS = 900          # availability / latency window reported
LATENCY_WINDOW_SECONDS = 300  # latency percentiles use the freshest samples
PROBE_AFTER_SECONDS = 300
PROBE_TIMEOUT_SECONDS = 6     # below the status page's own request timeout
MAX_SAMPLES = 500
AVAILABLE_AT = 0.9            # share of successful calls that counts as "up"


def _key(role):
    return "router-health:samples:" + role


def record(role, ok, latency_ms, source="live"):
    client = cache._lazy_client()
    if client is None:
        return
    try:
        sample = json.dumps([round(time.time(), 3), bool(ok), int(latency_ms), source])
        pipe = client.pipeline()
        pipe.lpush(_key(role), sample)
        pipe.ltrim(_key(role), 0, MAX_SAMPLES - 1)
        pipe.expire(_key(role), 86400)
        pipe.execute()
    except Exception:
        logger.debug("router health: record failed", exc_info=True)


def timed(role, call):
    """Run call(), recording its outcome for role. Re-raises the call's errors."""
    started = time.monotonic()
    try:
        result = call()
    except Exception:
        record(role, False, (time.monotonic() - started) * 1000)
        raise
    record(role, True, (time.monotonic() - started) * 1000)
    return result


def _samples(role):
    client = cache._lazy_client()
    if client is None:
        return None
    try:
        raw = client.lrange(_key(role), 0, MAX_SAMPLES - 1)
    except Exception:
        return None
    out = []
    for item in raw:
        try:
            out.append(json.loads(item))
        except (TypeError, ValueError):
            continue
    return out


def _model(role):
    from app.config import config
    if role == "message":
        return config.MESSAGE_ROUTER_MODEL or None
    from app.mods.workspace_mod import _get_router_model
    return _get_router_model()


def _configured(role):
    from app.config import config
    if role == "message":
        return bool(config.MESSAGE_ROUTER_MODEL and config.MESSAGE_ROUTER_BASE_URL and config.MESSAGE_ROUTER_API_KEY)
    from app.mods.workspace_mod import _get_router_api_key
    return bool(config.ROUTER_LLM_ENABLED and _get_router_api_key())


def _probe(role):
    """One minimal request through the same client the router uses."""
    prompt = [{"role": "user", "content": "Reply with the single word: stop"}]
    if role == "message":
        from app.config import config
        from app.services.message_router import get_client
        client = get_client(config.MESSAGE_ROUTER_BASE_URL, config.MESSAGE_ROUTER_API_KEY).with_options(
            timeout=PROBE_TIMEOUT_SECONDS, max_retries=0)
        model = config.MESSAGE_ROUTER_MODEL
        call = lambda: client.chat.completions.create(model=model, max_tokens=5, temperature=0, messages=prompt)  # noqa: E731
    else:
        from app.mods.workspace_mod import _get_llm_client
        client, provider = _get_llm_client()
        client = client.with_options(timeout=PROBE_TIMEOUT_SECONDS, max_retries=0)
        model = _model(role)
        if provider == "openai":
            extra = {"extra_body": {"thinking": {"type": "disabled"}}} if model.lower().startswith("deepseek") else {}
            call = lambda: client.chat.completions.create(model=model, max_tokens=5, messages=prompt, **extra)  # noqa: E731
        else:
            call = lambda: client.messages.create(model=model, max_tokens=5, messages=prompt)  # noqa: E731
    started = time.monotonic()
    try:
        call()
        ok = True
    except Exception as e:
        ok = False
        logger.warning("router health: %s probe failed (%s)", role, type(e).__name__)
    record(role, ok, (time.monotonic() - started) * 1000, source="probe")


def _maybe_probe(role, samples):
    newest = samples[0][0] if samples else 0
    if time.time() - newest < PROBE_AFTER_SECONDS:
        return False
    client = cache._lazy_client()
    try:
        if client is None or not client.set("router-health:probe:" + role, b"1", nx=True, ex=PROBE_AFTER_SECONDS):
            return False
    except Exception:
        return False
    _probe(role)
    return True


def _percentile(values, p):
    if not values:
        return None
    values = sorted(values)
    return values[min(len(values) - 1, max(0, int(-(-p * len(values) // 100)) - 1))]


def summary(role):
    """(http_status, body) for GET /health/router/{role}."""
    if role not in ROLES:
        return 404, {"status": "unknown_role"}
    if not _configured(role):
        return 200, {"status": "not_configured", "role": role}
    samples = _samples(role)
    if samples is None:
        return 503, {"status": "unknown", "role": role, "error": "metrics store unavailable"}
    if _maybe_probe(role, samples):
        samples = _samples(role) or []
    now = time.time()
    recent = [s for s in samples if now - s[0] <= WINDOW_SECONDS]
    ok = [s for s in recent if s[1]]
    fresh_ok = [s[2] for s in ok if now - s[0] <= LATENCY_WINDOW_SECONDS] or [s[2] for s in ok]
    last_ok = next((s for s in samples if s[1]), None)
    availability = len(ok) / len(recent) if recent else None
    up = availability is not None and availability >= AVAILABLE_AT
    body = {
        "status": "ok" if up else ("no_data" if availability is None else "degraded"),
        "role": role,
        "model": _model(role),
        "window_seconds": WINDOW_SECONDS,
        "calls": len(recent),
        "probe_calls": sum(1 for s in recent if len(s) > 3 and s[3] == "probe"),
        "availability": round(availability, 4) if availability is not None else None,
        "latency_p50_ms": _percentile(fresh_ok, 50),
        "latency_p95_ms": _percentile(fresh_ok, 95),
        "last_success_seconds_ago": round(now - last_ok[0]) if last_ok else None,
    }
    return (200 if up else 503), body
