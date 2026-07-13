"""Unit tests for the MiniMax provider."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from openagents.config.llm_configs import (
    MODEL_CONFIGS,
    LLMProviderType,
    create_model_provider,
    determine_provider,
    get_supported_models,
    get_provider_type,
    is_supported_provider,
)
from openagents.lms.providers import AnthropicProvider, MiniMaxProvider
from openagents.models.agent_config import AgentConfig


MINIMAX_OPENAI_BASE_URLS = [
    "https://api.minimax.io/v1",
    "https://api.minimaxi.com/v1",
]
MINIMAX_ANTHROPIC_BASE_URLS = [
    "https://api.minimax.io/anthropic",
    "https://api.minimaxi.com/anthropic",
]


class TestMiniMaxProvider:
    """Tests for MiniMaxProvider class."""

    def test_creates_instance_with_api_key(self):
        """Test that MiniMaxProvider can be created with an API key."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")
        assert provider is not None
        assert provider.model_name == "MiniMax-M2.7"

    def test_uses_default_base_url(self):
        """Test that MiniMaxProvider uses the correct default base URL."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")
        assert provider.api_base == "https://api.minimax.io/v1"

    def test_uses_custom_base_url(self):
        """Test that MiniMaxProvider uses a custom base URL when provided."""
        custom_url = "https://custom.minimax.io/v1"
        provider = MiniMaxProvider(
            model_name="MiniMax-M2.7", api_key="test-key", api_base=custom_url
        )
        assert provider.api_base == custom_url

    @pytest.mark.parametrize("api_base", MINIMAX_OPENAI_BASE_URLS)
    def test_uses_openai_compatible_endpoints(self, api_base):
        """Test that both OpenAI-compatible regional endpoints are usable."""
        with patch("openai.AsyncOpenAI") as mock_client:
            provider = MiniMaxProvider(
                model_name="MiniMax-M3", api_key="test-key", api_base=api_base
            )

        assert provider.protocol == "openai"
        mock_client.assert_called_once_with(base_url=api_base, api_key="test-key")

    @pytest.mark.parametrize("api_base", MINIMAX_ANTHROPIC_BASE_URLS)
    def test_uses_anthropic_compatible_endpoints(self, api_base):
        """Test that both Anthropic-compatible regional endpoints are usable."""
        with patch("openagents.lms.providers.AnthropicProvider") as provider_class:
            provider = MiniMaxProvider(
                model_name="MiniMax-M3", api_key="test-key", api_base=api_base
            )

        assert provider.protocol == "anthropic"
        provider_class.assert_called_once_with(
            model_name="MiniMax-M3", api_base=api_base, api_key="test-key"
        )
        assert provider.client is provider_class.return_value.client

    def test_anthropic_provider_passes_custom_base_url_to_sdk(self):
        """Test that AnthropicProvider preserves a custom API base URL."""
        anthropic_module = MagicMock()
        api_base = "https://api.minimax.io/anthropic"

        with patch.dict("sys.modules", {"anthropic": anthropic_module}):
            provider = AnthropicProvider(
                model_name="MiniMax-M3", api_key="test-key", api_base=api_base
            )

        assert provider.api_base == api_base
        anthropic_module.AsyncAnthropic.assert_called_once_with(
            api_key="test-key", base_url=api_base
        )

    def test_uses_env_api_key(self, monkeypatch):
        """Test that MiniMaxProvider reads API key from MINIMAX_API_KEY env var."""
        monkeypatch.setenv("MINIMAX_API_KEY", "env-api-key")
        provider = MiniMaxProvider(model_name="MiniMax-M2.7")
        assert provider is not None

    def test_creates_instance_for_highspeed_model(self):
        """Test creating instance with MiniMax-M2.7-highspeed model."""
        provider = MiniMaxProvider(
            model_name="MiniMax-M2.7-highspeed", api_key="test-key"
        )
        assert provider.model_name == "MiniMax-M2.7-highspeed"

    def test_format_tools_returns_list(self):
        """Test format_tools returns a list."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")
        mock_tool = MagicMock()
        mock_tool.to_openai_function.return_value = {
            "name": "test_tool",
            "description": "A test tool",
            "parameters": {},
        }
        result = provider.format_tools([mock_tool])
        assert isinstance(result, list)
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_chat_completion_uses_temperature_1(self):
        """Test that chat_completion always uses temperature=1.0."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")

        mock_message = MagicMock()
        mock_message.content = "Hello!"
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = None

        with patch.object(
            provider.client.chat.completions,
            "create",
            new_callable=AsyncMock,
            return_value=mock_response,
        ) as mock_create:
            messages = [{"role": "user", "content": "Hi"}]
            await provider.chat_completion(messages)

            call_kwargs = mock_create.call_args[1]
            assert call_kwargs["temperature"] == 1.0

    @pytest.mark.asyncio
    async def test_chat_completion_returns_standardized_format(self):
        """Test that chat_completion returns the standardized response format."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")

        mock_message = MagicMock()
        mock_message.content = "Test response"
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_usage = MagicMock()
        mock_usage.prompt_tokens = 10
        mock_usage.completion_tokens = 5
        mock_usage.total_tokens = 15

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = mock_usage

        with patch.object(
            provider.client.chat.completions,
            "create",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            messages = [{"role": "user", "content": "Say hello"}]
            result = await provider.chat_completion(messages)

            assert "content" in result
            assert "tool_calls" in result
            assert result["content"] == "Test response"
            assert result["tool_calls"] == []
            assert result["usage"]["prompt_tokens"] == 10
            assert result["usage"]["completion_tokens"] == 5
            assert result["usage"]["total_tokens"] == 15

    @pytest.mark.asyncio
    async def test_chat_completion_with_tools(self):
        """Test chat_completion with tools passes them correctly."""
        provider = MiniMaxProvider(model_name="MiniMax-M2.7", api_key="test-key")

        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_response.usage = None

        tools = [{"name": "get_weather", "description": "Get weather", "parameters": {}}]

        with patch.object(
            provider.client.chat.completions,
            "create",
            new_callable=AsyncMock,
            return_value=mock_response,
        ) as mock_create:
            messages = [{"role": "user", "content": "What's the weather?"}]
            await provider.chat_completion(messages, tools=tools)

            call_kwargs = mock_create.call_args[1]
            assert "tools" in call_kwargs
            assert call_kwargs["tool_choice"] == "auto"

    @pytest.mark.asyncio
    async def test_chat_completion_delegates_anthropic_protocol(self):
        """Test that Anthropic-compatible requests use AnthropicProvider."""
        messages = [{"role": "user", "content": "Hello"}]
        expected = {"content": "Hi", "tool_calls": []}

        with patch("openagents.lms.providers.AnthropicProvider") as provider_class:
            delegate = provider_class.return_value
            delegate.chat_completion = AsyncMock(return_value=expected)
            provider = MiniMaxProvider(
                model_name="MiniMax-M3",
                api_key="test-key",
                api_base="https://api.minimax.io/anthropic",
            )
            result = await provider.chat_completion(messages)

        assert result == expected
        delegate.chat_completion.assert_awaited_once_with(messages, None)


class TestMiniMaxConfig:
    """Tests for MiniMax configuration entries."""

    def test_minimax_in_model_configs(self):
        """Test that minimax is in MODEL_CONFIGS."""
        assert "minimax" in MODEL_CONFIGS

    def test_minimax_has_correct_models(self):
        """Test that minimax config has the correct models."""
        models = MODEL_CONFIGS["minimax"]["models"]
        assert models[:2] == ["MiniMax-M3", "MiniMax-M2.7"]
        assert "MiniMax-M2.7-highspeed" in models
        assert len(models) == 3

    def test_minimax_has_correct_api_base(self):
        """Test that minimax config has the correct API base URL."""
        api_base = MODEL_CONFIGS["minimax"]["api_base"]
        assert api_base == "https://api.minimax.io/v1"
        assert api_base.startswith("https://api.minimax.io")

    def test_minimax_api_key_env_var(self):
        """Test that minimax config uses MINIMAX_API_KEY env var."""
        assert MODEL_CONFIGS["minimax"]["API_KEY_ENV_VAR"] == "MINIMAX_API_KEY"

    def test_minimax_provider_type(self):
        """Test that minimax provider type is correct."""
        assert MODEL_CONFIGS["minimax"]["provider"] == "minimax"

    def test_minimax_in_llm_provider_type_enum(self):
        """Test that MINIMAX is in LLMProviderType enum."""
        assert LLMProviderType.MINIMAX == "minimax"

    def test_is_supported_provider(self):
        """Test that minimax is recognized as a supported provider."""
        assert is_supported_provider("minimax") is True

    def test_get_supported_models(self):
        """Test get_supported_models for minimax."""
        models = get_supported_models("minimax")
        assert "MiniMax-M3" in models
        assert "MiniMax-M2.7" in models
        assert "MiniMax-M2.7-highspeed" in models

    def test_get_provider_type(self):
        """Test get_provider_type for minimax."""
        assert get_provider_type("minimax") == "minimax"


class TestDetermineProvider:
    """Tests for determine_provider with MiniMax models."""

    def test_detects_minimax_m2_7(self):
        """Test that MiniMax-M2.7 is auto-detected as minimax provider."""
        provider = determine_provider(None, "MiniMax-M2.7", None)
        assert provider == "minimax"

    def test_detects_minimax_m3(self):
        """Test that MiniMax-M3 is auto-detected as minimax provider."""
        provider = determine_provider(None, "MiniMax-M3", None)
        assert provider == "minimax"

    def test_detects_minimax_m2_7_highspeed(self):
        """Test that MiniMax-M2.7-highspeed is auto-detected as minimax provider."""
        provider = determine_provider(None, "MiniMax-M2.7-highspeed", None)
        assert provider == "minimax"

    def test_explicit_minimax_provider(self):
        """Test that explicit 'minimax' provider is respected."""
        provider = determine_provider("minimax", "MiniMax-M2.7", None)
        assert provider == "minimax"

    @pytest.mark.parametrize(
        "api_base", MINIMAX_OPENAI_BASE_URLS + MINIMAX_ANTHROPIC_BASE_URLS
    )
    def test_detects_minimax_endpoints(self, api_base):
        """Test that all MiniMax endpoints are auto-detected."""
        provider = determine_provider(None, "custom-model", api_base)
        assert provider == "minimax"

    def test_agent_config_detects_minimax_m3(self):
        """Test that AgentConfig detects MiniMax-M3 consistently."""
        config = AgentConfig(instruction="Be helpful.", model_name="MiniMax-M3")
        assert config.determine_provider() == "minimax"

    @pytest.mark.parametrize(
        "api_base", MINIMAX_OPENAI_BASE_URLS + MINIMAX_ANTHROPIC_BASE_URLS
    )
    def test_agent_config_detects_minimax_endpoints(self, api_base):
        """Test that AgentConfig detects all MiniMax endpoint variants."""
        config = AgentConfig(
            instruction="Be helpful.", model_name="custom-model", api_base=api_base
        )
        assert config.determine_provider() == "minimax"


class TestMiniMaxFactory:
    """Tests for MiniMax provider construction."""

    @pytest.mark.parametrize("api_base", MINIMAX_ANTHROPIC_BASE_URLS)
    def test_factory_preserves_anthropic_base_url(self, api_base):
        """Test that the provider factory preserves Anthropic base URLs."""
        with patch("openagents.lms.MiniMaxProvider") as provider_class:
            create_model_provider(
                provider="minimax",
                model_name="MiniMax-M3",
                api_base=api_base,
                api_key="test-key",
            )

        provider_class.assert_called_once_with(
            model_name="MiniMax-M3", api_base=api_base, api_key="test-key"
        )
