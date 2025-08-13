# Model Support

OpenAgents provides comprehensive support for multiple AI model providers through a unified "simple" agent type. This feature allows you to use any supported AI model with the same configuration interface, making it easy to switch between providers or experiment with different models.

## Overview

The unified model support is implemented through the `SimpleAgentRunner` class, which provides:

- **Automatic Provider Detection**: Automatically detects the correct provider based on model names
- **Unified Configuration**: Same configuration format across all providers
- **Provider Abstraction**: Handles provider-specific API differences transparently
- **Tool Calling Support**: Consistent tool calling interface across compatible providers
- **Graceful Error Handling**: Clear error messages for missing dependencies or API keys

## Supported Providers

### OpenAI
The original OpenAI API with support for the latest models.

**Models Supported:**
- `gpt-4o` - Latest GPT-4 Omni model
- `gpt-4o-mini` - Smaller, faster GPT-4 Omni variant
- `gpt-4-turbo` - GPT-4 Turbo with enhanced capabilities
- `gpt-4` - Standard GPT-4 model
- `gpt-3.5-turbo` - GPT-3.5 Turbo model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "openai-agent"
  model_name: "gpt-4o-mini"
  provider: "openai"  # Optional, auto-detected
  instruction: "You are a helpful AI assistant."
```

**Environment Variables:**
- `OPENAI_API_KEY` - Your OpenAI API key

**Dependencies:**
```bash
pip install openai
```

### Azure OpenAI
Microsoft Azure's OpenAI service with enterprise features.

**Models Supported:**
- `gpt-4` - GPT-4 deployment on Azure
- `gpt-4-turbo` - GPT-4 Turbo deployment
- `gpt-35-turbo` - GPT-3.5 Turbo deployment

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "azure-agent"
  model_name: "gpt-4"  # Your Azure deployment name
  provider: "azure"
  api_base: "https://your-resource.openai.azure.com/"
  instruction: "You are an enterprise AI assistant."
```

**Environment Variables:**
- `AZURE_OPENAI_API_KEY` - Your Azure OpenAI API key
- `OPENAI_API_VERSION` - API version (optional, defaults to "2024-07-01-preview")

**Dependencies:**
```bash
pip install openai
```

### Anthropic Claude
Anthropic's Claude models known for safety and helpfulness.

**Models Supported:**
- `claude-3-5-sonnet-20241022` - Latest Claude 3.5 Sonnet
- `claude-3-5-haiku-20241022` - Latest Claude 3.5 Haiku
- `claude-3-opus-20240229` - Claude 3 Opus model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "claude-agent"
  model_name: "claude-3-5-sonnet-20241022"
  provider: "claude"  # Optional, auto-detected
  instruction: "You are Claude, a helpful AI assistant."
```

**Environment Variables:**
- `ANTHROPIC_API_KEY` - Your Anthropic API key

**Dependencies:**
```bash
pip install anthropic
```

### AWS Bedrock
Amazon's managed AI service supporting multiple model providers.

**Models Supported:**
- `anthropic.claude-3-sonnet-20240229-v1:0` - Claude 3 Sonnet on Bedrock
- `anthropic.claude-3-haiku-20240307-v1:0` - Claude 3 Haiku on Bedrock

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "bedrock-agent"
  model_name: "anthropic.claude-3-sonnet-20240229-v1:0"
  provider: "bedrock"  # Optional, auto-detected
  region: "us-east-1"  # Optional, defaults to us-east-1
  instruction: "You are an AI assistant running on AWS Bedrock."
```

**Environment Variables:**
- AWS credentials (via AWS CLI, environment variables, or IAM roles)
- `AWS_DEFAULT_REGION` - AWS region (optional)

**Dependencies:**
```bash
pip install boto3
```

### Google Gemini
Google's Gemini models with multimodal capabilities.

**Models Supported:**
- `gemini-1.5-pro` - Latest Gemini Pro model
- `gemini-1.5-flash` - Faster Gemini model
- `gemini-pro` - Standard Gemini Pro

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "gemini-agent"
  model_name: "gemini-1.5-pro"
  provider: "gemini"  # Optional, auto-detected
  instruction: "You are Gemini, Google's AI assistant."
```

**Environment Variables:**
- `GOOGLE_API_KEY` - Your Google AI API key

**Dependencies:**
```bash
pip install google-generativeai
```

### DeepSeek
DeepSeek's reasoning-focused models.

**Models Supported:**
- `deepseek-chat` - General conversation model
- `deepseek-coder` - Code-specialized model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "deepseek-agent"
  model_name: "deepseek-chat"
  provider: "deepseek"  # Optional, auto-detected
  api_base: "https://api.deepseek.com/v1"
  instruction: "You are DeepSeek, an AI focused on reasoning and problem-solving."
```

**Environment Variables:**
- `OPENAI_API_KEY` - Set to your DeepSeek API key (uses OpenAI-compatible format)

**Dependencies:**
```bash
pip install openai
```

### Qwen (Alibaba)
Alibaba's Qwen models with multilingual capabilities.

**Models Supported:**
- `qwen-turbo` - Fast Qwen model
- `qwen-plus` - Enhanced Qwen model
- `qwen-max` - Most capable Qwen model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "qwen-agent"
  model_name: "qwen-turbo"
  provider: "qwen"  # Optional, auto-detected
  api_base: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  instruction: "You are Qwen, a multilingual AI assistant."
```

**Environment Variables:**
- `OPENAI_API_KEY` - Set to your DashScope API key

**Dependencies:**
```bash
pip install openai
```

### Grok (xAI)
xAI's Grok model with real-time information access.

**Models Supported:**
- `grok-beta` - Grok beta model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "grok-agent"
  model_name: "grok-beta"
  provider: "grok"  # Optional, auto-detected
  api_base: "https://api.x.ai/v1"
  instruction: "You are Grok, xAI's AI assistant with real-time information access."
```

**Environment Variables:**
- `OPENAI_API_KEY` - Set to your xAI API key

**Dependencies:**
```bash
pip install openai
```

### Mistral AI
Mistral's efficient and powerful models.

**Models Supported:**
- `mistral-large-latest` - Latest Mistral Large model
- `mistral-medium-latest` - Latest Mistral Medium model
- `mistral-small-latest` - Latest Mistral Small model
- `mixtral-8x7b-instruct` - Mixtral mixture-of-experts model

**Configuration:**
```yaml
type: "simple"
config:
  agent_id: "mistral-agent"
  model_name: "mistral-large-latest"
  provider: "mistral"  # Optional, auto-detected
  api_base: "https://api.mistral.ai/v1"
  instruction: "You are a Mistral AI assistant."
```

**Environment Variables:**
- `OPENAI_API_KEY` - Set to your Mistral API key

**Dependencies:**
```bash
pip install openai
```

## Additional Providers

The system also supports several other providers through the generic OpenAI-compatible interface:

### Cohere
**Models:** `command-r-plus`, `command-r`, `command`
**API Base:** `https://api.cohere.ai/v1`

### Together AI
**Models:** `meta-llama/Llama-2-70b-chat-hf`, `mistralai/Mixtral-8x7B-Instruct-v0.1`
**API Base:** `https://api.together.xyz/v1`

### Perplexity
**Models:** `llama-3.1-sonar-huge-128k-online`, `llama-3.1-sonar-large-128k-online`
**API Base:** `https://api.perplexity.ai`

## Provider Auto-Detection

The system automatically detects the appropriate provider based on:

### 1. API Base URL Patterns
- `azure.com` → Azure OpenAI
- `deepseek.com` → DeepSeek
- `aliyuncs.com` → Qwen
- `x.ai` → Grok
- `anthropic.com` → Anthropic
- `googleapis.com` → Gemini

### 2. Model Name Patterns
- `gpt-*`, `openai` → OpenAI
- `claude-*` → Anthropic Claude
- `gemini-*` → Google Gemini
- `deepseek-*` → DeepSeek
- `qwen-*` → Qwen
- `grok-*` → Grok
- `mistral-*`, `mixtral-*` → Mistral
- `command-*` → Cohere
- `anthropic.*` → AWS Bedrock

### 3. Explicit Provider Override
You can always override auto-detection by explicitly setting the `provider` field:

```yaml
config:
  model_name: "custom-model-name"
  provider: "openai"  # Explicitly use OpenAI provider
```

## Configuration Parameters

### Required Parameters
- `agent_id` - Unique identifier for the agent
- `model_name` - Name of the model to use
- `instruction` - System instruction/prompt for the agent

### Optional Parameters
- `provider` - Explicit provider specification (overrides auto-detection)
- `api_base` - Custom API base URL
- `api_key` - API key (if not provided via environment variables)
- `protocol_names` - List of protocol names to register with
- `ignored_sender_ids` - List of sender IDs to ignore

### Provider-Specific Parameters
- `region` (Bedrock) - AWS region
- `api_version` (Azure) - API version

## Tool Calling Support

The simple agent supports tool calling across compatible providers:

### Supported Providers
- ✅ **OpenAI** - Native function calling
- ✅ **Azure OpenAI** - Native function calling  
- ✅ **Anthropic Claude** - Claude tool use format
- ✅ **AWS Bedrock** - Provider-specific tool formats
- ✅ **DeepSeek, Qwen, Grok, Mistral** - OpenAI-compatible function calling
- ⚠️ **Gemini** - Limited tool support (in development)

### Tool Format Conversion
The system automatically converts tools to the appropriate format for each provider:

```python
# OpenAI format
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "Tool description",
    "parameters": {...}
  }
}

# Anthropic format
{
  "name": "tool_name",
  "description": "Tool description",
  "input_schema": {...}
}
```

## Usage Examples

### Basic Usage with Auto-Detection
```yaml
type: "simple"
config:
  agent_id: "my-agent"
  model_name: "gpt-4o-mini"  # Auto-detects as OpenAI
  instruction: "You are a helpful assistant."
```

### Multi-Provider Setup
```yaml
# OpenAI Agent
type: "simple"
config:
  agent_id: "openai-agent"
  model_name: "gpt-4o-mini"
  instruction: "You are an OpenAI assistant."

---
# Claude Agent  
type: "simple"
config:
  agent_id: "claude-agent"
  model_name: "claude-3-5-sonnet-20241022"
  instruction: "You are Claude, Anthropic's assistant."

---
# DeepSeek Agent
type: "simple"
config:
  agent_id: "deepseek-agent"
  model_name: "deepseek-chat"
  instruction: "You are DeepSeek, focused on reasoning."
```

### Custom API Endpoint
```yaml
type: "simple"
config:
  agent_id: "custom-agent"
  model_name: "custom-model"
  provider: "deepseek"
  api_base: "https://custom-api-endpoint.com/v1"
  api_key: "your-custom-api-key"
  instruction: "You are a custom AI assistant."
```

## Migration Guide

### From OpenAI Agent Type
To migrate from the legacy `openai` agent type:

1. Change `type: "openai"` to `type: "simple"`
2. Optionally add `provider: "openai"` for explicit configuration
3. All other configuration remains the same

**Before:**
```yaml
type: "openai"
config:
  agent_id: "my-agent"
  model_name: "gpt-4o-mini"
  instruction: "You are a helpful assistant."
```

**After:**
```yaml
type: "simple"
config:
  agent_id: "my-agent"
  model_name: "gpt-4o-mini"
  provider: "openai"  # Optional
  instruction: "You are a helpful assistant."
```

## Error Handling

The system provides comprehensive error handling:

### Missing Dependencies
```
anthropic package is required for Anthropic provider. 
Install with: pip install anthropic
```

### Missing API Keys
```
The api_key client option must be set either by passing 
api_key to the client or by setting the OPENAI_API_KEY 
environment variable
```

### Invalid Configuration
```
Unsupported provider: invalid-provider
```

### Missing API Base
```
API base URL required for provider: deepseek
```

## Performance Considerations

### Model Selection
- **Speed:** `gpt-4o-mini`, `claude-3-5-haiku`, `gemini-1.5-flash`
- **Quality:** `gpt-4o`, `claude-3-5-sonnet`, `gemini-1.5-pro`
- **Cost-Effective:** `gpt-3.5-turbo`, `deepseek-chat`, `qwen-turbo`

### Provider Characteristics
- **OpenAI:** Fastest response times, best function calling
- **Anthropic:** Best safety and reasoning, excellent for analysis
- **Gemini:** Multimodal capabilities, good for diverse content
- **DeepSeek:** Strong reasoning, cost-effective
- **Qwen:** Multilingual support, good performance in Chinese
- **Azure/Bedrock:** Enterprise features, compliance, SLA guarantees

## Troubleshooting

### Common Issues

**1. Provider Not Detected**
- Check model name spelling
- Verify API base URL format
- Set explicit `provider` parameter

**2. Authentication Errors**
- Verify API key is set correctly
- Check environment variable names
- Ensure API key has necessary permissions

**3. Model Not Found**
- Verify model name matches provider's API
- Check if model requires special access
- Confirm API endpoint supports the model

**4. Tool Calling Issues**
- Verify provider supports tool calling
- Check tool schema format
- Review function definitions

### Debug Mode
Enable verbose logging for detailed debugging:

```bash
openagents launch-agent config.yaml --log-level DEBUG
```

## Best Practices

### 1. Environment Management
```bash
# Use .env file for API keys
echo "OPENAI_API_KEY=your-key" >> .env
echo "ANTHROPIC_API_KEY=your-key" >> .env
source .env
```

### 2. Provider Selection
- Use OpenAI for general tasks requiring fast responses
- Use Claude for analysis, writing, and safety-critical applications
- Use specialized models (DeepSeek for reasoning, Qwen for multilingual)

### 3. Error Handling
```yaml
# Always include fallback instructions
instruction: |
  You are a helpful AI assistant. If you encounter any errors or 
  limitations, explain them clearly to the user and suggest alternatives.
```

### 4. Testing
```bash
# Test configuration without network dependency
openagents launch-agent config.yaml --host localhost --port 9999
```

## Contributing

To add support for a new model provider:

1. Create a new provider class inheriting from `BaseModelProvider`
2. Implement required methods: `__init__`, `chat_completion`, `format_tools`
3. Add provider detection logic to `_determine_provider`
4. Update `_create_model_provider` method
5. Add configuration example and documentation
6. Create tests for the new provider

See `src/openagents/agents/simple_agent.py` for implementation details.
