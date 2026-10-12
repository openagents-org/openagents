"""TokenPay API-key access to the TokenDance model gateway.

The model catalog is public. Validate the key separately with the read-only
balance endpoint, without making a paid completion or returning wallet data.
"""

import httpx

BASE_URL = "https://tokendance.space/gateway/v1"
ANTHROPIC_BASE_URL = "https://tokendance.space/gateway"
BALANCE_URL = "https://tokendance.space/portal/api/v1/user/balance"


async def list_models(api_key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=20) as http:
        auth = await http.get(BALANCE_URL, headers={"Authorization": f"Bearer {api_key}"})
        auth.raise_for_status()
        response = await http.get(f"{BASE_URL}/models")
        response.raise_for_status()

    models = []
    for model in response.json().get("data", []):
        if not isinstance(model, dict) or not model.get("id"):
            continue
        protocols = model.get("supported_protocols") or []
        # Workspace agents use text generation. Keep both wire protocols so
        # the same saved key can serve Claude-family and OpenAI-family agents.
        if not any(p in protocols for p in ("openai:chat-completions", "anthropic:messages")):
            continue
        models.append({
            "id": model["id"],
            "label": model.get("name") or model["id"],
            "category": "chat",
            "supportedProtocols": protocols,
        })
    return sorted(models, key=lambda model: model["id"])
