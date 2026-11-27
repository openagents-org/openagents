"""Unit tests for the LLMTR provider configuration."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from openagents.config.llm_configs import (
    MODEL_CONFIGS,
    LLMProviderType,
    create_model_provider,
    determine_provider,
    get_default_api_base,
    get_provider_type,
    get_supported_models,
    is_supported_provider,
    list_all_providers,
)
from openagents.lms.providers import SimpleGenericProvider

LLMTR_BASE_URL = "https://llmtr.com/v1"
REPO_ROOT = Path(__file__).resolve().parents[2]


class TestLlmtrConfig:
    """Tests for the LLMTR entry in MODEL_CONFIGS."""

    def test_enum_and_registration(self):
        assert LLMProviderType.LLMTR.value == "llmtr"
        assert is_supported_provider("llmtr")
        assert "llmtr" in list_all_providers()

    def test_openai_compatible_base_url_and_env_var(self):
        config = MODEL_CONFIGS["llmtr"]
        assert config["api_base"] == LLMTR_BASE_URL
        assert config["API_KEY_ENV_VAR"] == "LLMTR_API_KEY"
        assert get_default_api_base("llmtr") == LLMTR_BASE_URL
        assert get_provider_type("llmtr") == "generic"

    def test_models_are_listed(self):
        models = get_supported_models("llmtr")
        assert "qwen/qwen3.8-flash" in models
        assert all("/" in model for model in models)

    def test_determine_provider_from_explicit_name(self):
        assert determine_provider("llmtr", "qwen/qwen3.8-flash", None) == "llmtr"

    def test_determine_provider_from_api_base(self):
        assert determine_provider(None, "qwen/qwen3.8-max", LLMTR_BASE_URL) == "llmtr"
        # The llmtr.com host wins over the model-name heuristics.
        assert determine_provider(None, "qwen/qwen3.8-flash", LLMTR_BASE_URL) == "llmtr"


class TestLlmtrProvider:
    """Tests for creating an LLMTR model provider."""

    def test_creates_generic_provider_with_default_base_url(self):
        with patch("openai.AsyncOpenAI") as mock_client:
            provider = create_model_provider("llmtr", "qwen/qwen3.8-flash", api_key="test-key")

        assert isinstance(provider, SimpleGenericProvider)
        assert provider.model_name == "qwen/qwen3.8-flash"
        assert provider.api_base == LLMTR_BASE_URL
        mock_client.assert_called_once_with(base_url=LLMTR_BASE_URL, api_key="test-key")

    def test_custom_api_base_overrides_default(self):
        with patch("openai.AsyncOpenAI") as mock_client:
            provider = create_model_provider(
                "llmtr",
                "mistral/devstral-medium-latest",
                api_base="https://proxy.example.com/v1",
                api_key="test-key",
            )

        assert provider.api_base == "https://proxy.example.com/v1"
        mock_client.assert_called_once_with(base_url="https://proxy.example.com/v1", api_key="test-key")

    @pytest.mark.asyncio
    async def test_chat_completion_uses_the_llmtr_model_id(self):
        message = MagicMock()
        message.content = "hello"
        message.tool_calls = None
        response = MagicMock()
        response.choices = [MagicMock(message=message)]

        with patch("openai.AsyncOpenAI") as mock_client:
            create = AsyncMock(return_value=response)
            mock_client.return_value.chat.completions.create = create
            provider = create_model_provider("llmtr", "qwen/qwen3.8-max", api_key="test-key")
            result = await provider.chat_completion([{"role": "user", "content": "hi"}])

        assert result["content"] == "hello"
        assert create.await_args.kwargs["model"] == "qwen/qwen3.8-max"


class TestLlmtrCatalog:
    """The repo-root /cloud_providers entry that feeds the workspace picker."""

    def _load(self):
        return json.loads((REPO_ROOT / "cloud_providers" / "llmtr.json").read_text(encoding="utf-8"))

    def test_entry_shape(self):
        data = self._load()
        assert data["name"] == "llmtr"
        assert data["base_url"] == LLMTR_BASE_URL
        assert data["key_url"].startswith("https://llmtr.com/")
        assert data["models"], "picker needs at least one model"
        assert all(m["category"] == "chat" for m in data["models"])

    def test_catalog_models_match_sdk_defaults(self):
        catalog_ids = {m["id"] for m in self._load()["models"]}
        assert set(get_supported_models("llmtr")) <= catalog_ids
