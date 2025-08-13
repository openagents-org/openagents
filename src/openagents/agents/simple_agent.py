import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional, Union
from abc import ABC, abstractmethod

from openagents.agents.runner import AgentRunner
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage
from openagents.models.tool import AgentAdapterTool
from openagents.utils.verbose import verbose_print
from jinja2 import Template

logger = logging.getLogger(__name__)

# Prompt template for conversation formatting
user_prompt_template = Template("""
<conversation>
    <threads>
        {% for thread_id, thread in message_threads.items() %}
        <thread id="{{ thread_id }}">
            {% for message in thread.messages[-10:] %}
            <message sender="{{ message.sender_id }}">
                {% if message.text_representation %}
                <content>{{ message.text_representation }}</content>
                {% else %}
                <content>{{ message.content }}</content>
                {% endif %}
            </message>
            {% endfor %}
        </thread>
        {% endfor %}
    </threads>
    
    <current_interaction>
        <incoming_thread_id>{{ incoming_thread_id }}</incoming_thread_id>
        <incoming_message sender="{{ incoming_message.sender_id }}">
            {% if incoming_message.text_representation %}
            <content>{{ incoming_message.text_representation }}</content>
            {% else %}
            <content>{{ incoming_message.content }}</content>
            {% endif %}
        </incoming_message>
    </current_interaction>
</conversation>

Please respond to the incoming message based on the context provided. You have access to tools that you can use if needed.
In each step, you MUST either:
1. Call a tool to perform an action, or
2. Use the finish tool when you've completed all necessary actions.

If you don't need to use any tools, use the finish tool directly.
""")


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
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
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
    
    def __init__(self, model_name: str, api_base: Optional[str] = None, api_key: Optional[str] = None, **kwargs):
        self.model_name = model_name
        
        try:
            from openai import AzureOpenAI, OpenAI
        except ImportError:
            raise ImportError("openai package is required for OpenAI provider. Install with: pip install openai")
        
        # Determine API base URL and initialize client
        effective_api_base = api_base or os.getenv("OPENAI_BASE_URL")
        effective_api_key = api_key or os.getenv("OPENAI_API_KEY")
        
        if effective_api_base and "azure.com" in effective_api_base:
            # Azure OpenAI
            azure_api_key = api_key or os.getenv("AZURE_OPENAI_API_KEY")
            api_version = kwargs.get("api_version") or os.getenv("OPENAI_API_VERSION", "2024-07-01-preview")
            self.client = AzureOpenAI(
                azure_endpoint=effective_api_base,
                api_key=azure_api_key,
                api_version=api_version
            )
        elif effective_api_base:
            # Custom OpenAI-compatible endpoint
            self.client = OpenAI(base_url=effective_api_base, api_key=effective_api_key)
        else:
            # Standard OpenAI
            self.client = OpenAI(api_key=effective_api_key)
    
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Generate chat completion using OpenAI API."""
        kwargs = {
            "model": self.model_name,
            "messages": messages
        }
        
        if tools:
            kwargs["tools"] = [{"type": "function", "function": tool} for tool in tools]
            kwargs["tool_choice"] = "auto"
        
        response = self.client.chat.completions.create(**kwargs)
        
        # Standardize response format
        message = response.choices[0].message
        result = {
            "content": message.content,
            "tool_calls": []
        }
        
        if hasattr(message, 'tool_calls') and message.tool_calls:
            for tool_call in message.tool_calls:
                result["tool_calls"].append({
                    "id": tool_call.id,
                    "name": tool_call.function.name,
                    "arguments": tool_call.function.arguments
                })
        
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
            raise ImportError("anthropic package is required for Anthropic provider. Install with: pip install anthropic")
        
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key)
    
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Generate chat completion using Anthropic API."""
        # Convert messages to Anthropic format
        anthropic_messages = []
        system_message = None
        
        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                anthropic_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
        
        kwargs = {
            "model": self.model_name,
            "messages": anthropic_messages,
            "max_tokens": 4096
        }
        
        if system_message:
            kwargs["system"] = system_message
        
        if tools:
            kwargs["tools"] = tools
        
        response = self.client.messages.create(**kwargs)
        
        # Standardize response format
        result = {
            "content": "",
            "tool_calls": []
        }
        
        for content_block in response.content:
            if content_block.type == "text":
                result["content"] += content_block.text
            elif content_block.type == "tool_use":
                result["tool_calls"].append({
                    "id": content_block.id,
                    "name": content_block.name,
                    "arguments": json.dumps(content_block.input)
                })
        
        return result
    
    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Anthropic tool use."""
        formatted_tools = []
        for tool in tools:
            openai_format = tool.to_openai_function()
            anthropic_tool = {
                "name": openai_format["name"],
                "description": openai_format["description"],
                "input_schema": openai_format["parameters"]
            }
            formatted_tools.append(anthropic_tool)
        return formatted_tools


class BedrockProvider(BaseModelProvider):
    """AWS Bedrock provider supporting Claude and other models."""
    
    def __init__(self, model_name: str, region: Optional[str] = None, **kwargs):
        self.model_name = model_name
        self.region = region or os.getenv("AWS_DEFAULT_REGION", "us-east-1")
        
        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 package is required for Bedrock provider. Install with: pip install boto3")
        
        self.client = boto3.client("bedrock-runtime", region_name=self.region)
    
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Generate chat completion using AWS Bedrock."""
        # Format depends on the specific model
        if "claude" in self.model_name.lower():
            return await self._claude_bedrock_completion(messages, tools)
        else:
            raise NotImplementedError(f"Model {self.model_name} not yet supported in Bedrock provider")
    
    async def _claude_bedrock_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Handle Claude models on Bedrock."""
        # Convert to Claude Bedrock format
        claude_messages = []
        system_message = None
        
        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                claude_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })
        
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": claude_messages
        }
        
        if system_message:
            body["system"] = system_message
        
        if tools:
            body["tools"] = tools
        
        response = self.client.invoke_model(
            modelId=self.model_name,
            body=json.dumps(body)
        )
        
        response_body = json.loads(response["body"].read())
        
        # Standardize response format
        result = {
            "content": "",
            "tool_calls": []
        }
        
        for content_block in response_body.get("content", []):
            if content_block["type"] == "text":
                result["content"] += content_block["text"]
            elif content_block["type"] == "tool_use":
                result["tool_calls"].append({
                    "id": content_block["id"],
                    "name": content_block["name"],
                    "arguments": json.dumps(content_block["input"])
                })
        
        return result
    
    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Bedrock."""
        formatted_tools = []
        for tool in tools:
            openai_format = tool.to_openai_function()
            bedrock_tool = {
                "name": openai_format["name"],
                "description": openai_format["description"],
                "input_schema": openai_format["parameters"]
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
            raise ImportError("google-generativeai package is required for Gemini provider. Install with: pip install google-generativeai")
        
        api_key = api_key or os.getenv("GOOGLE_API_KEY")
        genai.configure(api_key=api_key)
        self.client = genai.GenerativeModel(model_name)
    
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
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
                gemini_messages.append({"role": "model", "parts": [msg["content"] or ""]})
        
        # For now, simple text completion (tool calling requires more complex setup)
        if gemini_messages:
            last_message = gemini_messages[-1]["parts"][0] if gemini_messages else ""
            response = self.client.generate_content(last_message)
            
            return {
                "content": response.text,
                "tool_calls": []
            }
        else:
            return {"content": "", "tool_calls": []}
    
    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for Gemini (simplified for now)."""
        return []  # Tool calling implementation would go here


class SimpleGenericProvider(BaseModelProvider):
    """Generic provider for OpenAI-compatible APIs (DeepSeek, Qwen, Grok, etc.)."""
    
    def __init__(self, model_name: str, api_base: str, api_key: Optional[str] = None, **kwargs):
        self.model_name = model_name
        self.api_base = api_base
        
        try:
            from openai import OpenAI
        except ImportError:
            raise ImportError("openai package is required for generic provider. Install with: pip install openai")
        
        self.client = OpenAI(base_url=api_base, api_key=api_key or "dummy")
    
    async def chat_completion(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Generate chat completion using OpenAI-compatible API."""
        kwargs = {
            "model": self.model_name,
            "messages": messages
        }
        
        if tools:
            kwargs["tools"] = [{"type": "function", "function": tool} for tool in tools]
            kwargs["tool_choice"] = "auto"
        
        response = self.client.chat.completions.create(**kwargs)
        
        # Standardize response format
        message = response.choices[0].message
        result = {
            "content": message.content,
            "tool_calls": []
        }
        
        if hasattr(message, 'tool_calls') and message.tool_calls:
            for tool_call in message.tool_calls:
                result["tool_calls"].append({
                    "id": tool_call.id,
                    "name": tool_call.function.name,
                    "arguments": tool_call.function.arguments
                })
        
        return result
    
    def format_tools(self, tools: List[Any]) -> List[Dict[str, Any]]:
        """Format tools for OpenAI-compatible function calling."""
        return [tool.to_openai_function() for tool in tools]


class SimpleAgentRunner(AgentRunner):
    """Unified agent runner supporting multiple model providers."""
    
    # Predefined model configurations
    MODEL_CONFIGS = {
        # OpenAI models
        "openai": {
            "provider": "openai",
            "models": ["gpt-4", "gpt-4-turbo", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]
        },
        # Azure OpenAI
        "azure": {
            "provider": "openai",
            "models": ["gpt-4", "gpt-4-turbo", "gpt-35-turbo"]
        },
        # Anthropic Claude
        "claude": {
            "provider": "anthropic",
            "models": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"]
        },
        # AWS Bedrock
        "bedrock": {
            "provider": "bedrock",
            "models": ["anthropic.claude-3-sonnet-20240229-v1:0", "anthropic.claude-3-haiku-20240307-v1:0"]
        },
        # Google Gemini
        "gemini": {
            "provider": "gemini",
            "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"]
        },
        # DeepSeek
        "deepseek": {
            "provider": "generic",
            "api_base": "https://api.deepseek.com/v1",
            "models": ["deepseek-chat", "deepseek-coder"]
        },
        # Qwen
        "qwen": {
            "provider": "generic", 
            "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "models": ["qwen-turbo", "qwen-plus", "qwen-max"]
        },
        # Grok (xAI)
        "grok": {
            "provider": "generic",
            "api_base": "https://api.x.ai/v1",
            "models": ["grok-beta"]
        },
        # Mistral AI
        "mistral": {
            "provider": "generic",
            "api_base": "https://api.mistral.ai/v1",
            "models": ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "mixtral-8x7b-instruct"]
        },
        # Cohere
        "cohere": {
            "provider": "generic",
            "api_base": "https://api.cohere.ai/v1",
            "models": ["command-r-plus", "command-r", "command"]
        },
        # Together AI (hosts many open models)
        "together": {
            "provider": "generic",
            "api_base": "https://api.together.xyz/v1",
            "models": ["meta-llama/Llama-2-70b-chat-hf", "mistralai/Mixtral-8x7B-Instruct-v0.1"]
        },
        # Perplexity
        "perplexity": {
            "provider": "generic",
            "api_base": "https://api.perplexity.ai",
            "models": ["llama-3.1-sonar-huge-128k-online", "llama-3.1-sonar-large-128k-online"]
        }
    }
    
    def __init__(
        self,
        agent_id: str,
        model_name: str,
        instruction: str,
        provider: Optional[str] = None,
        api_base: Optional[str] = None,
        api_key: Optional[str] = None,
        protocol_names: Optional[List[str]] = None,
        ignored_sender_ids: Optional[List[str]] = None,
        **kwargs
    ):
        """Initialize the SimpleAgentRunner.
        
        Args:
            agent_id: Unique identifier for this agent
            model_name: Name of the model to use
            instruction: System instruction/prompt for the agent
            provider: Model provider (openai, claude, bedrock, gemini, deepseek, qwen, grok)
            api_base: Custom API base URL (overrides provider defaults)
            api_key: API key (if not provided, will use environment variables)
            protocol_names: List of protocol names to register with
            ignored_sender_ids: List of sender IDs to ignore
            **kwargs: Additional provider-specific configuration
        """
        super().__init__(agent_id=agent_id, mod_names=protocol_names, ignored_sender_ids=ignored_sender_ids)
        
        self.model_name = model_name
        self.instruction = instruction
        
        # Determine provider and initialize model provider
        self.provider = self._determine_provider(provider, model_name, api_base)
        self.model_provider = self._create_model_provider(api_base, api_key, kwargs)
    
    def _determine_provider(self, provider: Optional[str], model_name: str, api_base: Optional[str]) -> str:
        """Determine the model provider based on configuration."""
        
        if provider:
            return provider.lower()
        
        # Auto-detect provider based on model name or API base
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
    
    def _create_model_provider(self, api_base: Optional[str], api_key: Optional[str], kwargs: Dict[str, Any]) -> BaseModelProvider:
        """Create the appropriate model provider."""
        
        if self.provider == "openai" or self.provider == "azure":
            return OpenAIProvider(
                model_name=self.model_name,
                api_base=api_base,
                api_key=api_key,
                **kwargs
            )
        elif self.provider == "claude":
            return AnthropicProvider(
                model_name=self.model_name,
                api_key=api_key,
                **kwargs
            )
        elif self.provider == "bedrock":
            return BedrockProvider(
                model_name=self.model_name,
                **kwargs
            )
        elif self.provider == "gemini":
            return GeminiProvider(
                model_name=self.model_name,
                api_key=api_key,
                **kwargs
            )
        elif self.provider in ["deepseek", "qwen", "grok", "mistral", "cohere", "together", "perplexity"]:
            # Use predefined API base if not provided
            if not api_base and self.provider in self.MODEL_CONFIGS:
                api_base = self.MODEL_CONFIGS[self.provider]["api_base"]
            
            if not api_base:
                raise ValueError(f"API base URL required for provider: {self.provider}")
            
            return SimpleGenericProvider(
                model_name=self.model_name,
                api_base=api_base,
                api_key=api_key,
                **kwargs
            )
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")
    
    def _create_finish_tool(self):
        """Create a tool that allows the model to indicate it's finished with actions."""
        return AgentAdapterTool(
            name="finish",
            description="Use this tool when you have completed all necessary actions and don't need to do anything else.",
            input_schema={
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Reason for finishing the action chain."
                    }
                },
                "required": ["reason"]
            },
            func=lambda reason: f"Action chain completed: {reason}"
        )
    
    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to an incoming message using the configured model provider."""
        verbose_print(f">>> Reacting to message: {incoming_message.text_representation} (thread:{incoming_thread_id})")
        
        # Generate the prompt using the template
        prompt_content = user_prompt_template.render(
            message_threads=message_threads,
            incoming_thread_id=incoming_thread_id,
            incoming_message=incoming_message
        )
        
        # Create messages with instruction as system message and prompt as user message
        messages = [
            {"role": "system", "content": self.instruction},
            {"role": "user", "content": prompt_content}
        ]
        
        # Convert tools to provider format and add the finish tool
        all_tools = list(self.tools)
        finish_tool = self._create_finish_tool()
        all_tools.append(finish_tool)
        
        formatted_tools = self.model_provider.format_tools(all_tools)
        
        # Start the conversation with the model
        is_finished = False
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        
        while not is_finished and iteration < max_iterations:
            iteration += 1
            
            try:
                # Call the model provider
                response = await self.model_provider.chat_completion(messages, formatted_tools)
                
                # Add the assistant's response to the conversation
                messages.append({
                    "role": "assistant",
                    "content": response.get("content") or None
                })
                
                # Check if the model wants to call tools
                if response.get("tool_calls"):
                    for tool_call in response["tool_calls"]:
                        verbose_print(f">>> tool >>> {tool_call['name']}({tool_call['arguments']})")
                        
                        tool_name = tool_call["name"]
                        
                        # Check if the model wants to finish
                        if tool_name == "finish":
                            is_finished = True
                            messages.append({
                                "role": "tool",
                                "content": "Action chain completed."
                            })
                            break
                        
                        # Find the corresponding tool
                        tool = next((t for t in self.tools if t.name == tool_name), None)
                        
                        if tool:
                            try:
                                # Parse the function arguments
                                arguments = json.loads(tool_call["arguments"])
                                
                                # Execute the tool
                                result = await tool.execute(**arguments)
                                
                                # Add the tool result to the conversation
                                messages.append({
                                    "role": "tool",
                                    "content": str(result)
                                })
                            except (json.JSONDecodeError, Exception) as e:
                                # If there's an error, add it as a tool result
                                messages.append({
                                    "role": "tool",
                                    "content": f"Error: {str(e)}"
                                })
                                logger.info(f"Error executing tool {tool_name}: {e}")
                else:
                    verbose_print(f">>> response >>> {response.get('content')}")
                    # If the model generates a response without calling a tool, finish
                    is_finished = True
                    break
                    
            except Exception as e:
                logger.error(f"Error during model interaction: {e}")
                verbose_print(f">>> error >>> {e}")
                break
