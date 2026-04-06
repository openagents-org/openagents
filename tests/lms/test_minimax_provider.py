"""Unit tests for the MiniMax provider."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from openagents.lms.providers import MiniMaxProvider
from openagents.config.llm_configs import (
    MODEL_CONFIGS,
    LLMProviderType,
    determine_provider,
    get_supported_models,
    get_provider_type,
    is_supported_provider,
)


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
            result = await provider.chat_completion(messages)

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


class TestMiniMaxConfig:
    """Tests for MiniMax configuration entries."""

    def test_minimax_in_model_configs(self):
        """Test that minimax is in MODEL_CONFIGS."""
        assert "minimax" in MODEL_CONFIGS

    def test_minimax_has_correct_models(self):
        """Test that minimax config has the correct models."""
        models = MODEL_CONFIGS["minimax"]["models"]
        assert "MiniMax-M2.7" in models
        assert "MiniMax-M2.7-highspeed" in models
        assert len(models) == 2

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

    def test_detects_minimax_m2_7_highspeed(self):
        """Test that MiniMax-M2.7-highspeed is auto-detected as minimax provider."""
        provider = determine_provider(None, "MiniMax-M2.7-highspeed", None)
        assert provider == "minimax"

    def test_explicit_minimax_provider(self):
        """Test that explicit 'minimax' provider is respected."""
        provider = determine_provider("minimax", "MiniMax-M2.7", None)
        assert provider == "minimax"
