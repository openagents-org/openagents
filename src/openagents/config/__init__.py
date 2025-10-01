"""
Configuration package for OpenAgents.

This package contains global configuration constants and settings.
"""

from openagents.config.globals import *
from openagents.config.llm_configs import *
from openagents.config.prompt_templates import *

__all__ = [
    "WORKSPACE_DEFAULT_MOD_NAME",
    "WORKSPACE_MESSAGING_MOD_NAME",
    "MODEL_CONFIGS",
    "LLMProviderType",
    "get_supported_models",
    "get_default_api_base",
    "get_provider_type",
    "is_supported_provider",
    "list_all_providers",
    "get_all_models",
    "determine_provider",
    "create_model_provider",
    "DEFAULT_AGENT_USER_PROMPT_TEMPLATE",
    "SIMPLE_USER_PROMPT_TEMPLATE",
    "TOOL_FOCUSED_USER_PROMPT_TEMPLATE",
    "get_default_user_prompt_template",
    "get_simple_user_prompt_template",
    "get_tool_focused_user_prompt_template",
]
