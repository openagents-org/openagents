"""Tests for the default models of the AgentConfig factory helpers."""

from openagents.config.llm_configs import LLMProviderType
from openagents.models.agent_config import create_claude_config, create_gemini_config


def test_create_claude_config_default_model_is_not_a_retired_claude_3_model():
    config = create_claude_config(api_key="test-key")

    assert config.provider == LLMProviderType.CLAUDE
    assert config.model_name == "claude-sonnet-5"
    assert not config.model_name.startswith("claude-3")


def test_create_gemini_config_default_model_is_not_a_retired_gemini_1_5_model():
    config = create_gemini_config(api_key="test-key")

    assert config.provider == LLMProviderType.GEMINI
    assert config.model_name == "gemini-3.8-flash"
    assert not config.model_name.startswith("gemini-1.5")
