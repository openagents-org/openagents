"""API Route's built-in OpenAI-compatible provider configuration."""

from unittest.mock import patch

from openagents.config.llm_configs import (
    LLMProviderType,
    create_model_provider,
    determine_provider,
    get_default_api_base,
    is_supported_provider,
)
from openagents.lms.providers import SimpleGenericProvider


def test_api_route_is_registered():
    """The named provider resolves to API Route's public API base."""
    assert LLMProviderType.API_ROUTE == "api-route"
    assert is_supported_provider("api-route")
    assert get_default_api_base("api-route") == "https://global.api-route.com/v1"
    assert determine_provider("api-route", "gpt-4o-mini", None) == "api-route"


def test_api_route_uses_provider_key_and_base_url(monkeypatch):
    """An API Route key reaches the generic OpenAI-compatible client."""
    monkeypatch.setenv("API_ROUTE_API_KEY", "test-key")
    monkeypatch.delenv("DEFAULT_LLM_API_KEY", raising=False)
    with patch("openai.AsyncOpenAI") as client:
        provider = create_model_provider("api-route", "gpt-4o-mini")
    assert isinstance(provider, SimpleGenericProvider)
    assert provider.model_name == "gpt-4o-mini"
    client.assert_called_once_with(base_url="https://global.api-route.com/v1", api_key="test-key")
