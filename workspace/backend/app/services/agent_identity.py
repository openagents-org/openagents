# -*- coding: utf-8 -*-
"""Agent identity on machine calls (permission model v1.1 §3).

A request made with a workspace/device token is a *machine* unless it says
which agent it acts for. The connector states that on every per-agent request
with the header ``X-Agent-Name: <agent>`` (preferred — added centrally in its
HTTP client); older callers and the event bus convey the same thing as
``source=openagents:<agent>`` in the query string or JSON body.

This module is deliberately dependency-free (no FastAPI, no SQLAlchemy) so it
can be called from routers, services and the access model alike, and unit
tested with plain dicts.
"""

from typing import Any, Mapping, Optional

HEADER = "X-Agent-Name"
SOURCE_PREFIX = "openagents:"
MAX_LEN = 128


def _clean(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name or len(name) > MAX_LEN or any(ch in name for ch in "\r\n\x00"):
        return None
    return name


def _lookup(mapping: Optional[Mapping], key: str) -> Any:
    """Case-insensitive get that works for dicts and Starlette's Headers/QueryParams."""
    if mapping is None:
        return None
    try:
        v = mapping.get(key)
    except Exception:
        return None
    if v is not None:
        return v
    lower = key.lower()
    try:
        for k in mapping.keys():  # type: ignore[union-attr]
            if isinstance(k, str) and k.lower() == lower:
                return mapping.get(k)
    except Exception:
        pass
    return None


def agent_name_from_source(source: Any) -> Optional[str]:
    """``'openagents:<name>'`` → ``'<name>'``; anything else (humans, system,
    bare strings) → None."""
    s = _clean(source)
    if not s or not s.lower().startswith(SOURCE_PREFIX):
        return None
    return _clean(s[len(SOURCE_PREFIX):])


def agent_name_from_request(
    headers: Optional[Mapping] = None,
    query: Optional[Mapping] = None,
    body: Any = None,
) -> Optional[str]:
    """Which agent is this machine call acting for? None → anonymous machine.

    Order: ``X-Agent-Name`` header, then ``source=openagents:<name>`` in the
    query string, then in the JSON body. Values are stripped; blank, oversized
    or control-character names count as absent.
    """
    name = _clean(_lookup(headers, HEADER))
    if name:
        return name
    name = agent_name_from_source(_lookup(query, "source"))
    if name:
        return name
    if isinstance(body, Mapping):
        name = agent_name_from_source(_lookup(body, "source"))
        if name:
            return name
    return None


__all__ = ["HEADER", "SOURCE_PREFIX", "agent_name_from_request", "agent_name_from_source"]
