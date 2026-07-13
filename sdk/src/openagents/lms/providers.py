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

    def __init__(
        self,
        model_name: str,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs,
    ):
        self.model_name = model_name
        self.api_base = api_base.rstrip("/") if api_base else None

        try:
            import anthropic
        except ImportError:
            raise ImportError(
                "anthropic package is required for Anthropic provider. Install with: pip install anthropic"
            )

        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if self.api_base:
            self.client = anthropic.AsyncAnthropic(
                api_key=api_key, base_url=self.api_base
            )
        else:
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
        self.bearer_token = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
        self.session = None

        if not self.bearer_token:
            try:
                import aioboto3
            except ImportError:
                raise ImportError(
                    "aioboto3 package is required for async Bedrock provider (unless using AWS_BEARER_TOKEN_BEDROCK). "
                    "Install with: pip install aioboto3"
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
        elif "qwen" in self.model_name.lower():
            return await self._qwen_bedrock_completion(messages, tools)
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
        # Convert to Converse API format for bearer token, or invoke_model for boto3
        if self.bearer_token:
            return await self._claude_bedrock_bearer(messages, tools)

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

    async def _claude_bedrock_bearer(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Handle Claude models on Bedrock using bearer token (Converse API)."""
        import aiohttp

        # Build Converse API request body
        converse_messages = []
        system_parts = []

        for msg in messages:
            if msg["role"] == "system":
                system_parts.append({"text": msg["content"]})
            elif msg["role"] == "tool":
                # Converse API expects tool results inside a "user" role message
                tool_result = {
                    "toolResult": {
                        "toolUseId": msg.get("tool_call_id", ""),
                        "content": [{"text": msg.get("content", "")}]
                    }
                }
                converse_messages.append({
                    "role": "user",
                    "content": [tool_result]
                })
            elif msg["role"] == "assistant" and msg.get("tool_calls"):
                # Convert assistant tool_calls to Converse format
                content = []
                if msg.get("content"):
                    content.append({"text": msg["content"]})
                for tc in msg["tool_calls"]:
                    content.append({
                        "toolUse": {
                            "toolUseId": tc.get("id", ""),
                            "name": tc.get("name", tc.get("function", {}).get("name", "")),
                            "input": json.loads(tc.get("arguments", tc.get("function", {}).get("arguments", "{}")))
                        }
                    })
                converse_messages.append({"role": "assistant", "content": content})
            else:
                converse_messages.append({
                    "role": msg["role"],
                    "content": [{"text": msg.get("content", "") or ""}]
                })

        body = {"messages": converse_messages}

        if system_parts:
            body["system"] = system_parts

        if tools:
            tool_config = {"tools": []}
            for tool in tools:
                tool_spec = {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "inputSchema": {
                        "json": tool.get("input_schema", tool.get("parameters", {"type": "object", "properties": {}}))
                    }
                }
                tool_config["tools"].append({"toolSpec": tool_spec})
            body["toolConfig"] = tool_config

        url = f"https://bedrock-runtime.{self.region}.amazonaws.com/model/{self.model_name}/converse"

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.bearer_token}",
                },
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise RuntimeError(f"Bedrock API error ({resp.status}): {error_text}")
                response_body = await resp.json()

        # Parse Converse API response
        result = {"content": "", "tool_calls": []}

        output = response_body.get("output", {})
        message = output.get("message", {})
        for content_block in message.get("content", []):
            if "text" in content_block:
                result["content"] += content_block["text"]
            elif "toolUse" in content_block:
                tool_use = content_block["toolUse"]
                result["tool_calls"].append({
                    "id": tool_use["toolUseId"],
                    "name": tool_use["name"],
                    "arguments": json.dumps(tool_use["input"]),
                })

        # Extract token usage
        usage = response_body.get("usage", {})
        if usage:
            input_tokens = usage.get("inputTokens")
            output_tokens = usage.get("outputTokens")
            result["usage"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": (input_tokens or 0) + (output_tokens or 0) if input_tokens or output_tokens else None,
            }

        return result

    async def _qwen_bedrock_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Handle Qwen models on Bedrock (OpenAI-compatible format)."""
        # Use Converse API with bearer token if available
        if self.bearer_token:
            return await self._claude_bedrock_bearer(messages, tools)

        # Qwen uses OpenAI-compatible message format
        qwen_messages = []

        for msg in messages:
            qwen_messages.append({"role": msg["role"], "content": msg["content"]})

        body = {
            "messages": qwen_messages,
            "max_tokens": 4096,
        }

        if tools:
            body["tools"] = [{"type": "function", "function": tool} for tool in tools]
            body["tool_choice"] = "auto"

        async with self.session.client(
            "bedrock-runtime", region_name=self.region
        ) as client:
            response = await client.invoke_model(
                modelId=self.model_name, body=json.dumps(body)
            )

        response_body = json.loads(response["body"].read())

        # Standardize response format (OpenAI-compatible response)
        result = {"content": "", "tool_calls": []}

        # Handle OpenAI-compatible response format
        if "choices" in response_body:
            choice = response_body["choices"][0]
            message = choice.get("message", {})
            result["content"] = message.get("content", "")

            if "tool_calls" in message and message["tool_calls"]:
                for tool_call in message["tool_calls"]:
                    result["tool_calls"].append(
                        {
                            "id": tool_call.get("id", ""),
                            "name": tool_call["function"]["name"],
                            "arguments": tool_call["function"]["arguments"],
                        }
                    )
        # Handle direct content response
        elif "content" in response_body:
            result["content"] = response_body["content"]

        # Extract token usage
        usage = response_body.get("usage", {})
        if usage:
            result["usage"] = {
                "input_tokens": usage.get("prompt_tokens"),
                "output_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
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


class MiniMaxProvider(BaseModelProvider):
    """MiniMax provider using OpenAI- or Anthropic-compatible APIs."""

    def __init__(
        self,
        model_name: str,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs,
    ):
        self.model_name = model_name
        self.api_base = (api_base or "https://api.minimax.io/v1").rstrip("/")
        self.protocol = (
            "anthropic" if self.api_base.endswith("/anthropic") else "openai"
        )

        effective_api_key = api_key or os.getenv("MINIMAX_API_KEY")
        if not effective_api_key:
            logger.warning("No MINIMAX_API_KEY provided for MiniMax provider")

        self._anthropic_provider = None
        if self.protocol == "anthropic":
            self._anthropic_provider = AnthropicProvider(
                model_name=model_name,
                api_base=self.api_base,
                api_key=effective_api_key or "dummy",
            )
            self.client = self._anthropic_provider.client
            return

        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError(
                "openai package is required for MiniMax provider. Install with: pip install openai"
            )

        self.client = AsyncOpenAI(
            base_url=self.api_base, api_key=effective_api_key or "dummy"
        )

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate a chat completion using the configured MiniMax protocol."""
        if self._anthropic_provider:
            return await self._anthropic_provider.chat_completion(messages, tools)

        kwargs = {
            "model": self.model_name,
            "messages": messages,
            "temperature": 1.0,  # MiniMax requires temperature in (0.0, 1.0]
        }

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
        """Format tools for MiniMax function calling."""
        if self._anthropic_provider:
            return self._anthropic_provider.format_tools(tools)
        return [tool.to_openai_function() for tool in tools]


class LiteLLMProvider(BaseModelProvider):
    """LiteLLM provider supporting 100+ LLM providers through a unified interface.

    LiteLLM routes requests to the correct provider based on the model string.
    For example, ``anthropic/claude-sonnet-4-5`` routes to Anthropic,
    ``bedrock/anthropic.claude-v2`` routes to AWS Bedrock, and
    ``vertex_ai/gemini-pro`` routes to Google Vertex AI.

    Authentication is handled via provider-specific environment variables
    (e.g. ``ANTHROPIC_API_KEY``, ``OPENAI_API_KEY``, ``AWS_ACCESS_KEY_ID``).
    LiteLLM reads these automatically based on the model prefix.

    For a full list of supported providers, see: https://docs.litellm.ai/docs/providers
    """

    def __init__(
        self,
        model_name: str,
        api_key: Optional[str] = None,
        api_base: Optional[str] = None,
        **kwargs,
    ):
        try:
            import litellm  # noqa: F401
        except ImportError:
            raise ImportError(
                "litellm package is required for LiteLLMProvider. "
                "Install with: pip install litellm"
            )
        self.model_name = model_name
        self._api_key = api_key
        self._api_base = api_base

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate chat completion using LiteLLM SDK."""
        import litellm

        call_kwargs: Dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "drop_params": True,
        }
        if self._api_key:
            call_kwargs["api_key"] = self._api_key
        if self._api_base:
            call_kwargs["api_base"] = self._api_base

        if tools:
            call_kwargs["tools"] = [{"type": "function", "function": tool} for tool in tools]
            call_kwargs["tool_choice"] = "auto"

        try:
            response = await litellm.acompletion(**call_kwargs)
        except litellm.AuthenticationError:
            raise
        except litellm.BadRequestError:
            raise
        except litellm.RateLimitError as e:
            logger.warning(f"LiteLLM rate limited: {e}")
            raise
        except (litellm.APIConnectionError, litellm.Timeout) as e:
            logger.error(f"LiteLLM connection error: {e}")
            raise

        # Standardize response format
        message = response.choices[0].message
        result: Dict[str, Any] = {"content": message.content, "tool_calls": []}

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
        """Format tools for LiteLLM (OpenAI-compatible format)."""
        return [tool.to_openai_function() for tool in tools]


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
