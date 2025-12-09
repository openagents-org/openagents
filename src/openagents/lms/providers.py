"""Model provider implementations for different AI services."""

import os
import json
import logging
from typing import Dict, List, Any, Optional
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class BaseModelProvider(ABC):
    """Abstract base class for model providers."""

    @abstractmethod
    def __init__(self, model_name: str, **kwargs):
        """Initialize the model provider.

        Args:
            model_name: Name of the model to use
            **kwargs: Provider-specific configuration
        """
        pass

    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate a chat completion.

        Args:
            messages: List of message dictionaries
            tools: Optional list of tool definitions

        Returns:
            Response dictionary with standardized format
        """
        pass

    @abstractmethod
    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for this provider.

        Args:
            tools: List of tool objects

        Returns:
            List of provider-specific tool definitions
        """
        pass


class OpenAIProvider(BaseModelProvider):
    """OpenAI provider supporting both OpenAI and Azure OpenAI."""

    def __init__(
        self,
        model_name: str,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs,
    ):
        self.model_name = model_name

        try:
            from openai import AsyncAzureOpenAI, AsyncOpenAI
        except ImportError:
            raise ImportError(
                "openai package is required for OpenAI provider. Install with: pip install openai"
            )

        # Determine API base URL and initialize client
        effective_api_base = api_base or os.getenv("OPENAI_BASE_URL")
        effective_api_key = api_key or os.getenv("OPENAI_API_KEY")

        if effective_api_base and "azure.com" in effective_api_base:
            # Azure OpenAI
            azure_api_key = api_key or os.getenv("AZURE_OPENAI_API_KEY")
            api_version = kwargs.get("api_version") or os.getenv(
                "OPENAI_API_VERSION", "2024-07-01-preview"
            )
            self.client = AsyncAzureOpenAI(
                azure_endpoint=effective_api_base,
                api_key=azure_api_key,
                api_version=api_version,
            )
        elif effective_api_base:
            # Custom OpenAI-compatible endpoint
            self.client = AsyncOpenAI(
                base_url=effective_api_base, api_key=effective_api_key
            )
        else:
            # Standard OpenAI
            self.client = AsyncOpenAI(api_key=effective_api_key)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using OpenAI API."""
        kwargs = {"model": self.model_name, "messages": messages}

        if tools:
            kwargs["tools"] = [{"type": "function", "function": tool} for tool in tools]
            kwargs["tool_choice"] = "auto"

        response = await self.client.chat.completions.create(**kwargs)

        # Standardize response format
        message = response.choices[0].message
        result = {"content": message.content, "tool_calls": []}

        if hasattr(message, "tool_calls") and message.tool_calls:
            for tool_call in message.tool_calls:
                result["tool_calls"].append(
                    {
                        "id": tool_call.id,
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments,
                    }
                )

        # Extract token usage
        if hasattr(response, "usage") and response.usage:
            result["usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }

        return result

    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for OpenAI function calling."""
        return [tool.to_openai_function() for tool in tools]


class AnthropicProvider(BaseModelProvider):
    """Anthropic Claude provider."""

    def __init__(self, model_name: str, api_key: Optional[str] = None, **kwargs):
        self.model_name = model_name

        try:
            import anthropic
        except ImportError:
            raise ImportError(
                "anthropic package is required for Anthropic provider. Install with: pip install anthropic"
            )

        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.AsyncAnthropic(api_key=api_key)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using Anthropic API."""
        # Convert messages to Anthropic format
        anthropic_messages = []
        system_message = None

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                anthropic_messages.append(
                    {"role": msg["role"], "content": msg["content"]}
                )

        kwargs = {
            "model": self.model_name,
            "messages": anthropic_messages,
            "max_tokens": 4096,
        }

        if system_message:
            kwargs["system"] = system_message

        if tools:
            kwargs["tools"] = tools

        response = await self.client.messages.create(**kwargs)

        # Standardize response format
        result = {"content": "", "tool_calls": []}

        for content_block in response.content:
            if content_block.type == "text":
                result["content"] += content_block.text
            elif content_block.type == "tool_use":
                result["tool_calls"].append(
                    {
                        "id": content_block.id,
                        "name": content_block.name,
                        "arguments": json.dumps(content_block.input),
                    }
                )

        # Extract token usage from Anthropic response
        if hasattr(response, "usage") and response.usage:
            input_tokens = getattr(response.usage, "input_tokens", None)
            output_tokens = getattr(response.usage, "output_tokens", None)
            result["usage"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": (input_tokens or 0) + (output_tokens or 0) if input_tokens or output_tokens else None,
            }

        return result

    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Anthropic tool use."""
        formatted_tools = []
        for tool in tools:
            openai_format = tool.to_openai_function()
            anthropic_tool = {
                "name": openai_format["name"],
                "description": openai_format["description"],
                "input_schema": openai_format["parameters"],
            }
            formatted_tools.append(anthropic_tool)
        return formatted_tools


class BedrockProvider(BaseModelProvider):
    """AWS Bedrock provider supporting Claude and other models."""

    def __init__(self, model_name: str, region: Optional[str] = None, **kwargs):
        self.model_name = model_name
        self.region = region or os.getenv("AWS_DEFAULT_REGION", "us-east-1")

        try:
            import aioboto3
        except ImportError:
            raise ImportError(
                "aioboto3 package is required for async Bedrock provider. Install with: pip install aioboto3"
            )

        self.session = aioboto3.Session()

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using AWS Bedrock."""
        # Format depends on the specific model
        if "claude" in self.model_name.lower():
            return await self._claude_bedrock_completion(messages, tools)
        else:
            raise NotImplementedError(
                f"Model {self.model_name} not yet supported in Bedrock provider"
            )

    async def _claude_bedrock_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Handle Claude models on Bedrock."""
        # Convert to Claude Bedrock format
        claude_messages = []
        system_message = None

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                claude_messages.append({"role": msg["role"], "content": msg["content"]})

        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": claude_messages,
        }

        if system_message:
            body["system"] = system_message

        if tools:
            body["tools"] = tools

        async with self.session.client(
            "bedrock-runtime", region_name=self.region
        ) as client:
            response = await client.invoke_model(
                modelId=self.model_name, body=json.dumps(body)
            )

        response_body = json.loads(response["body"].read())

        # Standardize response format
        result = {"content": "", "tool_calls": []}

        for content_block in response_body.get("content", []):
            if content_block["type"] == "text":
                result["content"] += content_block["text"]
            elif content_block["type"] == "tool_use":
                result["tool_calls"].append(
                    {
                        "id": content_block["id"],
                        "name": content_block["name"],
                        "arguments": json.dumps(content_block["input"]),
                    }
                )

        # Extract token usage from Bedrock response
        usage = response_body.get("usage", {})
        if usage:
            input_tokens = usage.get("input_tokens")
            output_tokens = usage.get("output_tokens")
            result["usage"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": (input_tokens or 0) + (output_tokens or 0) if input_tokens or output_tokens else None,
            }

        return result

    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Bedrock."""
        formatted_tools = []
        for tool in tools:
            openai_format = tool.to_openai_function()
            bedrock_tool = {
                "name": openai_format["name"],
                "description": openai_format["description"],
                "input_schema": openai_format["parameters"],
            }
            formatted_tools.append(bedrock_tool)
        return formatted_tools


class GeminiProvider(BaseModelProvider):
    """Google Gemini provider."""

    def __init__(self, model_name: str, api_key: Optional[str] = None, **kwargs):
        self.model_name = model_name

        try:
            import google.generativeai as genai
        except ImportError:
            raise ImportError(
                "google-generativeai package is required for Gemini provider. Install with: pip install google-generativeai"
            )

        api_key = api_key or os.getenv("GOOGLE_API_KEY")
        genai.configure(api_key=api_key)
        self.client = genai.GenerativeModel(model_name)

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using Gemini API."""
        # Convert messages to Gemini format
        gemini_messages = []

        for msg in messages:
            if msg["role"] == "system":
                # Gemini handles system messages differently
                gemini_messages.append({"role": "user", "parts": [msg["content"]]})
                gemini_messages.append({"role": "model", "parts": ["I understand."]})
            elif msg["role"] == "user":
                gemini_messages.append({"role": "user", "parts": [msg["content"]]})
            elif msg["role"] == "assistant":
                gemini_messages.append(
                    {"role": "model", "parts": [msg["content"] or ""]}
                )

        # For now, simple text completion (tool calling requires more complex setup)
        if gemini_messages:
            last_message = gemini_messages[-1]["parts"][0] if gemini_messages else ""
            response = await self.client.generate_content_async(last_message)

            result = {"content": response.text, "tool_calls": []}

            # Extract token usage from Gemini response
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                usage = response.usage_metadata
                result["usage"] = {
                    "input_tokens": getattr(usage, "prompt_token_count", None),
                    "output_tokens": getattr(usage, "candidates_token_count", None),
                    "total_tokens": getattr(usage, "total_token_count", None),
                }

            return result
        else:
            return {"content": "", "tool_calls": []}

    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Gemini (simplified for now)."""
        return []  # Tool calling implementation would go here


class SimpleGenericProvider(BaseModelProvider):
    """Generic provider for OpenAI-compatible APIs (DeepSeek, Qwen, Grok, etc.)."""

    def __init__(
        self, model_name: str, api_base: str, api_key: Optional[str] = None, **kwargs
    ):
        self.model_name = model_name
        self.api_base = api_base

        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError(
                "openai package is required for generic provider. Install with: pip install openai"
            )

        if not api_key:
            logger.warning(f"No API key provided for model {model_name}, using dummy key")
        self.client = AsyncOpenAI(base_url=api_base, api_key=api_key or "dummy")

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using OpenAI-compatible API."""
        kwargs = {"model": self.model_name, "messages": messages}

        if tools:
            kwargs["tools"] = [{"type": "function", "function": tool} for tool in tools]
            kwargs["tool_choice"] = "auto"

        response = await self.client.chat.completions.create(**kwargs)

        # Standardize response format
        message = response.choices[0].message
        result = {"content": message.content, "tool_calls": []}

        if hasattr(message, "tool_calls") and message.tool_calls:
            for tool_call in message.tool_calls:
                result["tool_calls"].append(
                    {
                        "id": tool_call.id,
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments,
                    }
                )

        # Extract token usage
        if hasattr(response, "usage") and response.usage:
            result["usage"] = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }

        return result

    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for OpenAI-compatible function calling."""
        return [tool.to_openai_function() for tool in tools]
