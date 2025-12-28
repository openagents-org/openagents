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
    ANTHROPIC = "anthropic"  # Alias for claude
    BEDROCK = "bedrock"
    GEMINI = "gemini"
    DEEPSEEK = "deepseek"
    QWEN = "qwen"
    GROK = "grok"
    MISTRAL = "mistral"
    COHERE = "cohere"
    TOGETHER = "together"
    PERPLEXITY = "perplexity"
    GROQ = "groq"
    OPENROUTER = "openrouter"
    CUSTOM = "custom"  # Custom OpenAI-compatible endpoint
    OPENAI_COMPATIBLE = "openai-compatible"  # Alias for custom


# Model provider configurations
# This mirrors the MODEL_CONFIGS from SimpleAgentRunner for consistency
MODEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    # OpenAI models
    "openai": {
        "provider": "openai",
        "models": [
            "gpt-5.2",
            "gpt-5.2-pro",
            "gpt-5.1",
            "gpt-5-mini",
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
            "o4-mini",
            "o3-mini",
        ],
        "API_KEY_ENV_VAR": "OPENAI_API_KEY",
    },
    # Azure OpenAI
    "azure": {
        "provider": "openai",
        "models": ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
        "API_KEY_ENV_VAR": "AZURE_OPENAI_API_KEY",
    },
    # Anthropic Claude (supports both "claude" and "anthropic" as provider IDs)
    "claude": {
        "provider": "anthropic",
        "models": [
            "claude-sonnet-4-20250514",   # Latest Claude 4 Sonnet
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
        ],
        "API_KEY_ENV_VAR": "ANTHROPIC_API_KEY",
    },
    "anthropic": {
        "provider": "anthropic",
        "models": [
            "claude-opus-4-5-20251124",
            "claude-sonnet-4-5-20250514",
            "claude-haiku-4-5-20251015",
            "claude-sonnet-4-20250514",
        ],
        "API_KEY_ENV_VAR": "ANTHROPIC_API_KEY",
    },
    # AWS Bedrock
    "bedrock": {
        "provider": "bedrock",
        "models": [
            "us.anthropic.claude-sonnet-4-5-20250514-v1:0",
            "us.anthropic.claude-haiku-4-5-20250514-v1:0",
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "anthropic.claude-3-opus-20240229-v1:0",
            "anthropic.claude-3-sonnet-20240229-v1:0",
        ],
        "API_KEY_ENV_VAR": "AWS_ACCESS_KEY_ID",
    },
    # Google Gemini (free tier: 20-25 req/day as of Dec 2025)
    "gemini": {
        "provider": "gemini",
        "models": [
            "gemini-3-flash",
            "gemini-3-pro",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
        ],
        "API_KEY_ENV_VAR": "GEMINI_API_KEY",
        "free_tier": True,
    },
    # DeepSeek
    "deepseek": {
        "provider": "generic",
        "api_base": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-reasoner"],
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
        "models": ["grok-3", "grok-3-mini", "grok-2"],
        "API_KEY_ENV_VAR": "XAI_API_KEY",
    },
    # Mistral AI (free tier: 1B tokens/month)
    "mistral": {
        "provider": "generic",
        "api_base": "https://api.mistral.ai/v1",
        "models": [
            "mistral-large-latest",
            "mistral-small-latest",
            "codestral-latest",
        ],
        "API_KEY_ENV_VAR": "MISTRAL_API_KEY",
        "free_tier": True,
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
    # Groq (free tier: 14,400 req/day, excellent tool use support)
    "groq": {
        "provider": "generic",
        "api_base": "https://api.groq.com/openai/v1",
        "models": [
            "llama-3.3-70b-versatile",      # Best for tool use
            "llama-3.1-8b-instant",          # Fastest
            "qwen/qwen3-32b",                # Great reasoning
            "deepseek-r1-distill-llama-70b", # Reasoning model
        ],
        "API_KEY_ENV_VAR": "GROQ_API_KEY",
        "free_tier": True,
    },
    # OpenRouter (aggregator for multiple models)
    "openrouter": {
        "provider": "generic",
        "api_base": "https://openrouter.ai/api/v1",
        "models": [],  # User specifies model name (e.g., "anthropic/claude-3-opus")
        "API_KEY_ENV_VAR": "OPENROUTER_API_KEY",
    },
    # Custom OpenAI-compatible endpoint (e.g., Ollama, vLLM, local models)
    "custom": {
        "provider": "generic",
        "models": [],  # User specifies model name
        "API_KEY_ENV_VAR": "CUSTOM_API_KEY",
    },
    # Alias for custom OpenAI-compatible (used by frontend)
    "openai-compatible": {
        "provider": "generic",
        "models": [],  # User specifies model name
        "API_KEY_ENV_VAR": "CUSTOM_API_KEY",
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


def resolve_auto_model_config() -> Dict[str, Optional[str]]:
    """Resolve 'auto' model configuration from environment variables.

    When an agent specifies model_name="auto", this function resolves the
    actual model configuration from the following environment variables:
    - DEFAULT_LLM_PROVIDER: The provider name (e.g., "openai", "claude", "custom")
    - DEFAULT_LLM_MODEL_NAME: The model name (e.g., "gpt-4o", "claude-3-5-sonnet")
    - DEFAULT_LLM_API_KEY: The API key for the provider
    - DEFAULT_LLM_BASE_URL: The base URL for custom OpenAI-compatible endpoints

    Returns:
        Dictionary with 'provider', 'model_name', 'api_key', and 'base_url' resolved from env vars
    """
    return {
        "provider": os.getenv("DEFAULT_LLM_PROVIDER"),
        "model_name": os.getenv("DEFAULT_LLM_MODEL_NAME"),
        "api_key": os.getenv("DEFAULT_LLM_API_KEY"),
        "base_url": os.getenv("DEFAULT_LLM_BASE_URL"),
    }


def is_auto_model(model_name: Optional[str]) -> bool:
    """Check if the model name indicates automatic configuration.

    Args:
        model_name: The model name to check

    Returns:
        True if model should use auto configuration
    """
    if not model_name:
        return False
    return model_name.lower() == "auto"


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
        elif "groq.com" in api_base:
            return "groq"

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
    elif any(name in model_lower for name in ["mistral"]):
        return "mistral"
    elif any(name in model_lower for name in ["command"]):
        return "cohere"
    elif "sonar" in model_lower:
        return "perplexity"
    elif "anthropic." in model_name:
        return "bedrock"
    # Groq-specific model patterns (llama with specific suffixes, mixtral with context size)
    elif any(name in model_lower for name in ["versatile", "instant", "32768", "gemma2"]):
        return "groq"
    elif "llama" in model_lower or "meta-" in model_lower or "mixtral" in model_lower:
        return "together"

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
    elif provider == "claude" or provider == "anthropic":
        return AnthropicProvider(model_name=model_name, api_key=api_key, **kwargs)
    elif provider == "bedrock":
        return BedrockProvider(model_name=model_name, **kwargs)
    elif provider == "gemini":
        return GeminiProvider(model_name=model_name, api_key=api_key, **kwargs)
    elif provider == "custom" or provider == "openai-compatible":
        # Custom OpenAI-compatible endpoint requires api_base
        if not api_base:
            raise ValueError(
                "API base URL is required for custom OpenAI-compatible provider. "
                "Please provide the base_url parameter (e.g., http://localhost:11434/v1 for Ollama)."
            )

        return SimpleGenericProvider(
            model_name=model_name, api_base=api_base, api_key=api_key, **kwargs
        )
    elif provider in [
        "deepseek",
        "qwen",
        "grok",
        "mistral",
        "cohere",
        "together",
        "perplexity",
        "groq",
        "openrouter",
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
