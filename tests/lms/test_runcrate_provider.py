"""Unit tests for the Runcrate provider configuration."""

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

RUNCRATE_BASE_URL = "https://api.runcrate.ai/v1"
REPO_ROOT = Path(__file__).resolve().parents[2]


class TestRuncrateConfig:
    """Tests for the Runcrate entry in MODEL_CONFIGS."""

    def test_enum_and_registration(self):
        assert LLMProviderType.RUNCRATE.value == "runcrate"
        assert is_supported_provider("runcrate")
        assert "runcrate" in list_all_providers()

    def test_openai_compatible_base_url_and_env_var(self):
        config = MODEL_CONFIGS["runcrate"]
        assert config["api_base"] == RUNCRATE_BASE_URL
        assert config["API_KEY_ENV_VAR"] == "RUNCRATE_API_KEY"
        assert get_default_api_base("runcrate") == RUNCRATE_BASE_URL
        assert get_provider_type("runcrate") == "generic"

    def test_models_are_listed(self):
        models = get_supported_models("runcrate")
        assert "deepseek-ai/DeepSeek-V3.2" in models
        assert all("/" in model for model in models)

    def test_determine_provider_from_explicit_name(self):
        assert determine_provider("runcrate", "deepseek-ai/DeepSeek-V3.2", None) == "runcrate"

    def test_determine_provider_from_api_base(self):
        assert determine_provider(None, "moonshotai/Kimi-K2.6", RUNCRATE_BASE_URL) == "runcrate"
        # The api.runcrate.ai host wins over the model-name heuristics.
        assert determine_provider(None, "deepseek-ai/DeepSeek-V3.2", RUNCRATE_BASE_URL) == "runcrate"


class TestRuncrateProvider:
    """Tests for creating a Runcrate model provider."""

    def test_creates_generic_provider_with_default_base_url(self):
        with patch("openai.AsyncOpenAI") as mock_client:
            provider = create_model_provider("runcrate", "deepseek-ai/DeepSeek-V3.2", api_key="test-key")

        assert isinstance(provider, SimpleGenericProvider)
        assert provider.model_name == "deepseek-ai/DeepSeek-V3.2"
        assert provider.api_base == RUNCRATE_BASE_URL
        mock_client.assert_called_once_with(base_url=RUNCRATE_BASE_URL, api_key="test-key")

    def test_custom_api_base_overrides_default(self):
        with patch("openai.AsyncOpenAI") as mock_client:
            provider = create_model_provider(
                "runcrate",
                "openai/gpt-oss-120b",
                api_base="https://proxy.example.com/v1",
                api_key="test-key",
            )

        assert provider.api_base == "https://proxy.example.com/v1"
        mock_client.assert_called_once_with(base_url="https://proxy.example.com/v1", api_key="test-key")

    @pytest.mark.asyncio
    async def test_chat_completion_uses_the_runcrate_model_id(self):
        message = MagicMock()
        message.content = "hello"
        message.tool_calls = None
        response = MagicMock()
        response.choices = [MagicMock(message=message)]

        with patch("openai.AsyncOpenAI") as mock_client:
            create = AsyncMock(return_value=response)
            mock_client.return_value.chat.completions.create = create
            provider = create_model_provider("runcrate", "moonshotai/Kimi-K2.6", api_key="test-key")
            result = await provider.chat_completion([{"role": "user", "content": "hi"}])

        assert result["content"] == "hello"
        assert create.await_args.kwargs["model"] == "moonshotai/Kimi-K2.6"


class TestRuncrateCatalog:
    """The repo-root /cloud_providers entry that feeds the workspace picker."""

    def _load(self):
        return json.loads((REPO_ROOT / "cloud_providers" / "runcrate.json").read_text(encoding="utf-8"))

    def test_entry_shape(self):
        data = self._load()
        assert data["name"] == "runcrate"
        assert data["base_url"] == RUNCRATE_BASE_URL
        assert data["key_url"].startswith("https://www.runcrate.ai/")
        assert data["models"], "picker needs at least one model"
        assert all(m["category"] == "chat" for m in data["models"])

    def test_catalog_models_match_sdk_defaults(self):
        catalog_ids = {m["id"] for m in self._load()["models"]}
        assert set(get_supported_models("runcrate")) <= catalog_ids
