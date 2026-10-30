"""Tests for the default models of the AgentConfig factory helpers."""

from openagents.config.llm_configs import LLMProviderType
from openagents.models.agent_config import create_claude_config


def test_create_claude_config_default_model_is_not_a_retired_claude_3_model():
    config = create_claude_config(api_key="test-key")

    assert config.provider == LLMProviderType.CLAUDE
    assert config.model_name == "claude-sonnet-5-5"
    assert not config.model_name.startswith("claude-3")
