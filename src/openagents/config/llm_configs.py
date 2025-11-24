"""Model provider configurations for OpenAgents.

This module contains the configuration mappings for different AI model providers,
including their API endpoints, supported models, and provider types.
"""

import os
from typing import Dict, List, Any, Optional
from enum import Enum


class LLMProviderType(str, Enum):
    """Supported model providers."""

    OPENAI = "openai"
    AZURE = "azure"
    CLAUDE = "claude"
    BEDROCK = "bedrock"
    GEMINI = "gemini"
    DEEPSEEK = "deepseek"
    QWEN = "qwen"
    GROK = "grok"
    MISTRAL = "mistral"
    COHERE = "cohere"
    TOGETHER = "together"
    PERPLEXITY = "perplexity"


# Model provider configurations
# This mirrors the MODEL_CONFIGS from SimpleAgentRunner for consistency
MODEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    # OpenAI models
    "openai": {
        "provider": "openai",
        "models": ["gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        "API_KEY_ENV_VAR": "OPENAI_API_KEY",
    },
    # Azure OpenAI
    "azure": {
        "provider": "openai",
        "models": ["gpt-4", "gpt-4-turbo", "gpt-35-turbo"],
        "API_KEY_ENV_VAR": "AZURE_OPENAI_API_KEY",
    },
    # Anthropic Claude
    "claude": {
        "provider": "anthropic",
        "models": [
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ],
        "API_KEY_ENV_VAR": "ANTHROPIC_API_KEY",
    },
    # AWS Bedrock
    "bedrock": {
        "provider": "bedrock",
        "models": [
            "anthropic.claude-3-sonnet-20240229-v1:0",
            "anthropic.claude-3-haiku-20240307-v1:0",
        ],
        "API_KEY_ENV_VAR": "BEDROCK_API_KEY",
    },
    # Google Gemini
    "gemini": {
        "provider": "gemini",
        "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"],
        "API_KEY_ENV_VAR": "GEMINI_API_KEY",
    },
    # DeepSeek
    "deepseek": {
        "provider": "generic",
        "api_base": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-coder"],
        "API_KEY_ENV_VAR": "DEEPSEEK_API_KEY",
    },
    # Qwen
    "qwen": {
        "provider": "generic",
        "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "models": ["qwen-turbo", "qwen-plus", "qwen-max"],
        "API_KEY_ENV_VAR": "DASHSCOPE_API_KEY",
    },
    # Grok (xAI)
    "grok": {
        "provider": "generic",
        "api_base": "https://api.x.ai/v1",
        "models": ["grok-beta"],
        "API_KEY_ENV_VAR": "XAI_API_KEY",
    },
    # Mistral AI
    "mistral": {
        "provider": "generic",
        "api_base": "https://api.mistral.ai/v1",
        "models": [
            "mistral-large-latest",
            "mistral-medium-latest",
            "mistral-small-latest",
            "mixtral-8x7b-instruct",
        ],
        "API_KEY_ENV_VAR": "MISTRAL_API_KEY",
    },
    # Cohere
    "cohere": {
        "provider": "generic",
        "api_base": "https://api.cohere.ai/v1",
        "models": ["command-r-plus", "command-r", "command"],
        "API_KEY_ENV_VAR": "COHERE_API_KEY",
    },
    # Together AI (hosts many open models)
    "together": {
        "provider": "generic",
        "api_base": "https://api.together.xyz/v1",
        "models": [
            "meta-llama/Llama-2-70b-chat-hf",
            "mistralai/Mixtral-8x7B-Instruct-v0.1",
        ],
        "API_KEY_ENV_VAR": "TOGETHER_API_KEY",
    },
    # Perplexity
    "perplexity": {
        "provider": "generic",
        "api_base": "https://api.perplexity.ai",
        "models": [
            "llama-3.1-sonar-huge-128k-online",
            "llama-3.1-sonar-large-128k-online",
        ],
        "API_KEY_ENV_VAR": "PERPLEXITY_API_KEY",
    },
}


def get_supported_models(provider: str) -> List[str]:
    """Get list of supported models for a provider.

    Args:
        provider: Provider name

    Returns:
        List of supported model names
    """
    config = MODEL_CONFIGS.get(provider, {})
    return config.get("models", [])


def get_default_api_base(provider: str) -> str:
    """Get default API base URL for a provider.

    Args:
        provider: Provider name

    Returns:
        Default API base URL or None
    """
    config = MODEL_CONFIGS.get(provider, {})
    return config.get("api_base")


def get_provider_type(provider: str) -> str:
    """Get the provider type for a given provider.

    Args:
        provider: Provider name

    Returns:
        Provider type (e.g., 'openai', 'anthropic', 'bedrock', 'gemini', 'generic')
    """
    config = MODEL_CONFIGS.get(provider, {})
    return config.get("provider", "generic")


def is_supported_provider(provider: str) -> bool:
    """Check if a provider is supported.

    Args:
        provider: Provider name

    Returns:
        True if provider is supported
    """
    return provider in MODEL_CONFIGS


def list_all_providers() -> List[str]:
    """Get list of all supported providers.

    Returns:
        List of provider names
    """
    return list(MODEL_CONFIGS.keys())


def get_all_models() -> Dict[str, List[str]]:
    """Get all models organized by provider.

    Returns:
        Dictionary mapping provider names to their supported models
    """
    return {
        provider: config.get("models", []) for provider, config in MODEL_CONFIGS.items()
    }


def determine_provider(
    provider: Optional[str], model_name: str, api_base: Optional[str]
) -> str:
    """Determine the model provider based on configuration.

    Args:
        provider: Explicitly specified provider (takes precedence)
        model_name: Name of the model to analyze
        api_base: API base URL to analyze

    Returns:
        Determined provider name
    """
    if provider:
        return provider.lower()

    # Auto-detect provider based on API base
    if api_base:
        if "azure.com" in api_base:
            return "azure"
        elif "deepseek.com" in api_base:
            return "deepseek"
        elif "aliyuncs.com" in api_base:
            return "qwen"
        elif "x.ai" in api_base:
            return "grok"
        elif "anthropic.com" in api_base:
            return "claude"
        elif "googleapis.com" in api_base:
            return "gemini"

    # Auto-detect based on model name
    model_lower = model_name.lower()
    if any(name in model_lower for name in ["gpt", "openai"]):
        return "openai"
    elif any(name in model_lower for name in ["claude"]):
        return "claude"
    elif any(name in model_lower for name in ["gemini"]):
        return "gemini"
    elif any(name in model_lower for name in ["deepseek"]):
        return "deepseek"
    elif any(name in model_lower for name in ["qwen"]):
        return "qwen"
    elif any(name in model_lower for name in ["grok"]):
        return "grok"
    elif any(name in model_lower for name in ["mistral", "mixtral"]):
        return "mistral"
    elif any(name in model_lower for name in ["command"]):
        return "cohere"
    elif "llama" in model_lower or "meta-" in model_lower:
        return "together"
    elif "sonar" in model_lower:
        return "perplexity"
    elif "anthropic." in model_name:
        return "bedrock"

    # Default to OpenAI
    return "openai"


def create_model_provider(
    provider: str,
    model_name: str,
    api_base: Optional[str] = None,
    api_key: Optional[str] = None,
    **kwargs,
):
    """Create the appropriate model provider instance.

    Args:
        provider: Provider name (e.g., "openai", "claude", etc.)
        model_name: Name of the model
        api_base: Optional API base URL
        api_key: Optional API key
        **kwargs: Additional provider-specific configuration

    Returns:
        Model provider instance

    Raises:
        ValueError: If provider is unsupported or required parameters missing
    """
    # Import here to avoid circular dependencies
    from openagents.lms import (
        OpenAIProvider,
        AnthropicProvider,
        BedrockProvider,
        GeminiProvider,
        SimpleGenericProvider,
    )

    if not api_key and MODEL_CONFIGS[provider].get("API_KEY_ENV_VAR"):
        api_key = os.getenv(MODEL_CONFIGS[provider].get("API_KEY_ENV_VAR"))

    if provider == "openai" or provider == "azure":
        return OpenAIProvider(
            model_name=model_name, api_base=api_base, api_key=api_key, **kwargs
        )
    elif provider == "claude":
        return AnthropicProvider(model_name=model_name, api_key=api_key, **kwargs)
    elif provider == "bedrock":
        return BedrockProvider(model_name=model_name, **kwargs)
    elif provider == "gemini":
        return GeminiProvider(model_name=model_name, api_key=api_key, **kwargs)
    elif provider in [
        "deepseek",
        "qwen",
        "grok",
        "mistral",
        "cohere",
        "together",
        "perplexity",
    ]:
        # Use predefined API base if not provided
        if not api_base and provider in MODEL_CONFIGS:
            api_base = MODEL_CONFIGS[provider]["api_base"]

        if not api_base:
            raise ValueError(f"API base URL required for provider: {provider}")

        return SimpleGenericProvider(
            model_name=model_name, api_base=api_base, api_key=api_key, **kwargs
        )
    else:
        raise ValueError(f"Unsupported provider: {provider}")
