# -*- coding: utf-8 -*-
"""Interactive credential/model checks shared by the agent-config form
(/v1/model-probe with a raw key) and Model access entries (probe by id).

Without ``model``: list the models the key can use — live from the provider's
own API when possible, falling back to the curated catalog (a 401/403 is
reported as an invalid key instead). With ``model``: run a tiny completion so
the caller can show "key + model verified" before anything is saved or added.
"""

import asyncio
import time

import httpx

from app.services.cloud_providers import chat_completion, list_models_live, providers_catalog


def sanitize_probe_error(msg: str, api_key: str) -> str:
    """Provider errors can echo the request — never reflect the key back."""
    out = (msg or "").replace(api_key, "***") if api_key else (msg or "")
    return out[:300] or "Request failed"


async def probe(provider: str, api_key: str, base_url: str | None, model: str | None) -> dict:
    """Run the probe and return a plain response dict (never raises)."""
    if model:
        start = time.monotonic()
        try:
            reply = await asyncio.wait_for(
                chat_completion(
                    api_key=api_key,
                    provider=provider,
                    model=model,
                    messages=[{"role": "user", "content": "Reply with exactly: ok"}],
                    base_url=base_url,
                ),
                timeout=45,
            )
            return {
                "ok": True,
                "latencyMs": int((time.monotonic() - start) * 1000),
                "reply": (reply or "").strip()[:80],
            }
        except asyncio.TimeoutError:
            return {"ok": False, "error": "The provider did not answer within 45s"}
        except Exception as e:  # surfaced to the form, never fatal
            return {"ok": False, "error": sanitize_probe_error(str(e), api_key)}

    def _catalog_fallback() -> list[dict]:
        return next((p["models"] for p in providers_catalog() if p["name"] == provider), [])

    try:
        models = await list_models_live(provider, api_key, base_url)
        return {"models": models, "source": "live", "keyOk": True}
    except httpx.HTTPStatusError as e:
        status = e.response.status_code if e.response is not None else 0
        if status in (401, 403):
            return {
                "models": [], "source": "live", "keyOk": False,
                "error": "The provider rejected this API key",
            }
        return {
            "models": _catalog_fallback(), "source": "catalog", "keyOk": None,
            "error": sanitize_probe_error(str(e), api_key),
        }
    except Exception as e:
        return {
            "models": _catalog_fallback(), "source": "catalog", "keyOk": None,
            "error": sanitize_probe_error(str(e), api_key),
        }
