"""Unit tests for the Atlas Cloud provider entry.

Atlas Cloud is an OpenAI-compatible gateway, so it routes through the shared
``SimpleGenericProvider`` and carries no bespoke client code. What the config
entry can still get wrong is routing: its model ids are already
``vendor/model``, which collides with the name-based provider detection in
``determine_provider``.
"""

from unittest.mock import patch

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

ATLASCLOUD_API_BASE = "https://api.atlascloud.ai/v1"


class TestAtlasCloudConfig:
    """The registry entry itself."""

    def test_enum_member_exists(self):
        assert LLMProviderType.ATLASCLOUD == "atlascloud"

    def test_provider_is_registered(self):
        assert is_supported_provider("atlascloud")
        assert "atlascloud" in list_all_providers()

    def test_default_api_base_is_the_gateway(self):
        assert get_default_api_base("atlascloud") == ATLASCLOUD_API_BASE

    def test_uses_the_shared_generic_provider(self):
        """No bespoke client: the gateway speaks plain OpenAI chat completions."""
        assert get_provider_type("atlascloud") == "generic"

    def test_model_list_is_open_ended(self):
        """The gateway routes 100+ models; users name the one they want."""
        assert get_supported_models("atlascloud") == []

    def test_api_key_env_var(self):
        assert MODEL_CONFIGS["atlascloud"]["API_KEY_ENV_VAR"] == "ATLASCLOUD_API_KEY"


class TestAtlasCloudRouting:
    """determine_provider must not hand aggregator ids to a direct vendor."""

    def test_explicit_provider_wins_over_model_name_detection(self):
        """ "deepseek-ai/deepseek-v3.2" contains "deepseek" but is an Atlas id."""
        assert determine_provider("atlascloud", "deepseek-ai/deepseek-v3.2", None) == "atlascloud"

    @pytest.mark.parametrize(
        "model",
        [
            "openai/gpt-4.1-mini",
            "anthropic/claude-sonnet-4-6",
            "Qwen/Qwen3-235B-A22B-Instruct-2507",
            "minimaxai/minimax-m2.5",
            "zai-org/GLM-4.6",
        ],
    )
    def test_explicit_provider_survives_every_vendor_name_in_the_id(self, model):
        assert determine_provider("atlascloud", model, None) == "atlascloud"

    def test_api_base_alone_resolves_to_atlascloud(self):
        """Without this, the base URL is ignored and the model name decides."""
        assert determine_provider(None, "deepseek-ai/deepseek-v3.2", ATLASCLOUD_API_BASE) == "atlascloud"

    def test_other_gateways_are_unaffected(self):
        assert determine_provider(None, "MiniMax-M3", "https://api.minimax.io/v1") == "minimax"
        assert determine_provider(None, "deepseek-chat", "https://api.deepseek.com/v1") == "deepseek"


class TestAtlasCloudProviderCreation:
    def test_create_uses_the_registered_api_base(self):
        with patch("openagents.lms.SimpleGenericProvider") as mock_provider:
            create_model_provider(
                provider="atlascloud",
                model_name="deepseek-ai/deepseek-v3.2",
                api_base=None,
                api_key="apikey-test",
            )

        kwargs = mock_provider.call_args.kwargs
        assert kwargs["api_base"] == ATLASCLOUD_API_BASE
        assert kwargs["api_key"] == "apikey-test"
        assert kwargs["model_name"] == "deepseek-ai/deepseek-v3.2"

    def test_explicit_api_base_override_is_honoured(self):
        with patch("openagents.lms.SimpleGenericProvider") as mock_provider:
            create_model_provider(
                provider="atlascloud",
                model_name="openai/gpt-4.1-mini",
                api_base="https://gateway.internal/v1",
                api_key="apikey-test",
            )

        assert mock_provider.call_args.kwargs["api_base"] == "https://gateway.internal/v1"
