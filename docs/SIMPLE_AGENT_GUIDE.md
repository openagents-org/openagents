# Simple Agent Configuration Guide

The `simple` agent type is a unified agent runner that supports multiple AI model providers through a single configuration interface. It automatically detects the appropriate provider based on your model selection or allows you to explicitly specify the provider.

## Supported Providers

### OpenAI
- **Models**: `gpt-4`, `gpt-4-turbo`, `gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo`
- **Environment Variables**: `OPENAI_API_KEY`
- **Dependencies**: `pip install openai`

### Azure OpenAI
- **Models**: `gpt-4`, `gpt-4-turbo`, `gpt-35-turbo` (Azure deployment names)
- **Environment Variables**: `AZURE_OPENAI_API_KEY`, `OPENAI_API_VERSION`
- **Configuration**: Requires `api_base` pointing to Azure endpoint
- **Dependencies**: `pip install openai`

### Anthropic Claude
- **Models**: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`
- **Environment Variables**: `ANTHROPIC_API_KEY`
- **Dependencies**: `pip install anthropic`

### AWS Bedrock
- **Models**: `anthropic.claude-3-sonnet-20240229-v1:0`, `anthropic.claude-3-haiku-20240307-v1:0`
- **Environment Variables**: AWS credentials (CLI, environment, or IAM)
- **Configuration**: Optional `region` parameter
- **Dependencies**: `pip install boto3`

### Google Gemini
- **Models**: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-pro`
- **Environment Variables**: `GOOGLE_API_KEY`
- **Dependencies**: `pip install google-generativeai`

### DeepSeek
- **Models**: `deepseek-chat`, `deepseek-coder`
- **API Base**: `https://api.deepseek.com/v1`
- **Environment Variables**: `OPENAI_API_KEY` (DeepSeek uses OpenAI-compatible format)
- **Dependencies**: `pip install openai`

### Qwen (Alibaba)
- **Models**: `qwen-turbo`, `qwen-plus`, `qwen-max`
- **API Base**: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- **Environment Variables**: `OPENAI_API_KEY` (set to your DashScope API key)
- **Dependencies**: `pip install openai`

### Grok (xAI)
- **Models**: `grok-beta`
- **API Base**: `https://api.x.ai/v1`
- **Environment Variables**: `OPENAI_API_KEY` (set to your xAI API key)
- **Dependencies**: `pip install openai`

### Mistral AI
- **Models**: `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`, `mixtral-8x7b-instruct`
- **API Base**: `https://api.mistral.ai/v1`
- **Environment Variables**: `OPENAI_API_KEY` (set to your Mistral API key)
- **Dependencies**: `pip install openai`

### Additional Providers
- **Cohere**: Command models via OpenAI-compatible API
- **Together AI**: Open source models hosting
- **Perplexity**: Online search-enabled models

## Configuration Examples

### Basic Configuration (Auto-Detection)
```yaml
type: "simple"
config:
  agent_id: "my-agent"
  model_name: "gpt-4o-mini"  # Provider auto-detected as OpenAI
  instruction: "You are a helpful assistant."
```

### Explicit Provider Configuration
```yaml
type: "simple"
config:
  agent_id: "my-agent"
  model_name: "gpt-4"
  provider: "azure"  # Explicitly specify provider
  api_base: "https://your-resource.openai.azure.com/"
  instruction: "You are a helpful assistant."
```

### Custom API Configuration
```yaml
type: "simple"
config:
  agent_id: "my-agent"
  model_name: "deepseek-chat"
  provider: "deepseek"
  api_base: "https://api.deepseek.com/v1"
  api_key: "your-api-key"  # Optional, can use env var instead
  instruction: "You are a helpful assistant."
```

## Configuration Parameters

### Required Parameters
- `agent_id`: Unique identifier for the agent
- `model_name`: Name of the model to use
- `instruction`: System instruction/prompt for the agent

### Optional Parameters
- `provider`: Model provider (auto-detected if not specified)
- `api_base`: Custom API base URL
- `api_key`: API key (if not provided via environment variables)
- `protocol_names`: List of protocol names to register with
- `ignored_sender_ids`: List of sender IDs to ignore
- Additional provider-specific parameters (e.g., `region` for Bedrock, `api_version` for Azure)

## Provider Auto-Detection

The agent automatically detects the provider based on:

1. **API Base URL**: Looks for provider-specific domains
   - `azure.com` → Azure OpenAI
   - `deepseek.com` → DeepSeek
   - `aliyuncs.com` → Qwen
   - `x.ai` → Grok
   - etc.

2. **Model Name**: Looks for provider-specific model prefixes
   - `gpt-*`, `openai` → OpenAI
   - `claude-*` → Anthropic Claude
   - `gemini-*` → Google Gemini
   - `deepseek-*` → DeepSeek
   - `qwen-*` → Qwen
   - `grok-*` → Grok
   - `mistral-*`, `mixtral-*` → Mistral
   - `command-*` → Cohere
   - `anthropic.*` → AWS Bedrock

3. **Default**: Falls back to OpenAI if no specific provider is detected

## Environment Variable Setup

Create a `.env` file or set environment variables for your chosen provider:

```bash
# OpenAI
export OPENAI_API_KEY="your-openai-api-key"

# Azure OpenAI
export AZURE_OPENAI_API_KEY="your-azure-api-key"
export OPENAI_API_VERSION="2024-07-01-preview"

# Anthropic
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# Google Gemini
export GOOGLE_API_KEY="your-google-api-key"

# AWS Bedrock (use AWS CLI or environment variables)
export AWS_ACCESS_KEY_ID="your-aws-access-key"
export AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
export AWS_DEFAULT_REGION="us-east-1"

# For OpenAI-compatible providers (DeepSeek, Qwen, Grok, Mistral)
export OPENAI_API_KEY="your-provider-api-key"
```

## Usage

Launch an agent using the simple type:

```bash
# Basic usage with auto-detection
openagents launch-agent examples/simple_agent_config.yaml

# OpenAI example
openagents launch-agent examples/openai_agent_config.yaml

# Claude example
openagents launch-agent examples/claude_agent_config.yaml

# DeepSeek example
openagents launch-agent examples/deepseek_agent_config.yaml
```

## Error Handling

The agent includes comprehensive error handling for:
- Missing dependencies (graceful fallback with helpful error messages)
- Invalid API keys or endpoints
- Model-specific formatting requirements
- Tool calling compatibility across providers

## Migration from OpenAI Agent

To migrate from the old `openai` agent type to `simple`:

1. Change `type: "openai"` to `type: "simple"`
2. Optionally add `provider: "openai"` for explicit configuration
3. All other configuration remains the same
4. The agent will automatically detect OpenAI models and use the appropriate provider

## Advanced Features

### Tool Calling Support
The simple agent supports tool calling across all compatible providers:
- OpenAI: Native function calling
- Anthropic: Claude tool use
- AWS Bedrock: Provider-specific tool formats
- OpenAI-compatible APIs: Function calling format

### Multi-Model Switching
You can easily switch between models by changing the `model_name` and optionally the `provider` in your configuration file.

### Custom Providers
For providers not explicitly supported, you can use the generic provider by specifying a custom `api_base` URL that's OpenAI-compatible.

## Troubleshooting

### Common Issues

1. **Import Errors**: Install the required dependencies for your provider
2. **Authentication Errors**: Verify your API keys are correctly set
3. **Model Not Found**: Check model names match the provider's API documentation
4. **Tool Calling Issues**: Some providers have limited tool calling support

### Debug Mode
Enable verbose logging to see detailed provider initialization and API calls:

```bash
openagents launch-agent config.yaml --verbose
```

This guide covers the comprehensive capabilities of the simple agent type, enabling you to use any supported AI model provider with a unified configuration interface.
