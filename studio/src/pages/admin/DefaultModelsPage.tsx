import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, ChevronDown, Save, Check, AlertCircle, ExternalLink, Key, Server, Play, Wrench, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { networkFetch } from "@/utils/httpClient";

interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  free?: boolean;
  apiKeyUrl?: string;
  apiKeyName?: string;
  requiresBaseUrl?: boolean;
}

const MODEL_PROVIDERS: ProviderInfo[] = [
  // Free tier providers (recommended for getting started)
  {
    id: "groq",
    name: "Groq",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "deepseek-r1-distill-llama-70b"],
    free: true,
    apiKeyUrl: "https://console.groq.com/keys",
    apiKeyName: "GROQ_API_KEY",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-3-flash", "gemini-3-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    free: true,
    apiKeyUrl: "https://aistudio.google.com/apikey",
    apiKeyName: "GEMINI_API_KEY",
  },
  {
    id: "mistral",
    name: "Mistral",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    free: true,
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    apiKeyName: "MISTRAL_API_KEY",
  },
  // Paid providers
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3-mini"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    apiKeyName: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-opus-4-5-20251124", "claude-sonnet-4-5-20250514", "claude-haiku-4-5-20251015", "claude-sonnet-4-20250514"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    apiKeyName: "ANTHROPIC_API_KEY",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    apiKeyName: "DEEPSEEK_API_KEY",
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    models: ["grok-3", "grok-3-mini", "grok-2"],
    apiKeyUrl: "https://console.x.ai/",
    apiKeyName: "XAI_API_KEY",
  },
  {
    id: "qwen",
    name: "Qwen (Alibaba)",
    models: ["qwen-turbo", "qwen-plus", "qwen-max"],
    apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
    apiKeyName: "DASHSCOPE_API_KEY",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    apiKeyUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
    apiKeyName: "AZURE_OPENAI_API_KEY",
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    models: [
      "us.anthropic.claude-sonnet-4-5-20250514-v1:0",
      "us.anthropic.claude-haiku-4-5-20250514-v1:0",
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "anthropic.claude-3-5-haiku-20241022-v1:0",
      "anthropic.claude-3-opus-20240229-v1:0",
      "anthropic.claude-3-sonnet-20240229-v1:0",
    ],
    apiKeyUrl: "https://console.aws.amazon.com/bedrock/",
    apiKeyName: "AWS_ACCESS_KEY_ID",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [],
    apiKeyUrl: "https://openrouter.ai/keys",
    apiKeyName: "OPENROUTER_API_KEY",
  },
  {
    id: "openai-compatible",
    name: "Custom OpenAI Compatible",
    models: [],
    requiresBaseUrl: true,
    apiKeyName: "CUSTOM_API_KEY",
  },
];

const DefaultModelsPage: React.FC = () => {
  const { t } = useTranslation("admin");
  const { selectedNetwork } = useAuthStore();

  const [provider, setProvider] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    inference_works: boolean;
    supports_tool_use: boolean;
    response?: string;
    tool_use_response?: string;
    error_message?: string;
    tool_use_error?: string;
  } | null>(null);

  const selectedProvider = MODEL_PROVIDERS.find((p) => p.id === provider);
  const hasModels = selectedProvider && selectedProvider.models.length > 0;
  const requiresBaseUrl = selectedProvider?.requiresBaseUrl || false;
  const isConfigured = provider && modelName && apiKey && (!requiresBaseUrl || baseUrl);

  // Load current config on mount
  useEffect(() => {
    const loadConfig = async () => {
      if (!selectedNetwork) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await networkFetch(
          selectedNetwork.host,
          selectedNetwork.port,
          "/api/admin/default-model",
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            useHttps: selectedNetwork.useHttps,
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.config) {
            setProvider(data.config.provider || "");
            setModelName(data.config.model_name || "");
            setApiKey(data.config.api_key || "");
            setBaseUrl(data.config.base_url || "");
            // Check if the model is custom (not in the provider's list)
            const loadedProvider = MODEL_PROVIDERS.find(p => p.id === data.config.provider);
            if (loadedProvider && loadedProvider.models.length > 0 && !loadedProvider.models.includes(data.config.model_name)) {
              setUseCustomModel(true);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load default model config:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [selectedNetwork]);

  const handleSave = async () => {
    if (!selectedNetwork) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError("");

    try {
      const response = await networkFetch(
        selectedNetwork.host,
        selectedNetwork.port,
        "/api/admin/default-model",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            provider,
            model_name: modelName,
            api_key: apiKey,
            ...(requiresBaseUrl && baseUrl ? { base_url: baseUrl } : {}),
          }),
          useHttps: selectedNetwork.useHttps,
        }
      );

      const data = await response.json();

      if (data.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(data.error_message || t("defaultModels.saveFailed"));
      }
    } catch (error) {
      console.error("Failed to save default model config:", error);
      setSaveError(t("defaultModels.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!selectedNetwork) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError("");

    try {
      const response = await networkFetch(
        selectedNetwork.host,
        selectedNetwork.port,
        "/api/admin/default-model",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          useHttps: selectedNetwork.useHttps,
        }
      );

      const data = await response.json();

      if (data.success) {
        setProvider("");
        setModelName("");
        setApiKey("");
        setBaseUrl("");
        setUseCustomModel(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError(data.error_message || t("defaultModels.clearFailed"));
      }
    } catch (error) {
      console.error("Failed to clear default model config:", error);
      setSaveError(t("defaultModels.clearFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedNetwork) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await networkFetch(
        selectedNetwork.host,
        selectedNetwork.port,
        "/api/admin/default-model/test",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            provider,
            model_name: modelName,
            api_key: apiKey,
            ...(requiresBaseUrl && baseUrl ? { base_url: baseUrl } : {}),
          }),
          useHttps: selectedNetwork.useHttps,
        }
      );

      const data = await response.json();
      setTestResult(data);
    } catch (error) {
      console.error("Failed to test model config:", error);
      setTestResult({
        success: false,
        inference_works: false,
        supports_tool_use: false,
        error_message: t("defaultModels.testFailed"),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleProviderChange = (providerId: string) => {
    setProvider(providerId);
    setModelName("");
    setBaseUrl("");
    setUseCustomModel(false);
    setProviderDropdownOpen(false);
    setTestResult(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t("defaultModels.title")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t("defaultModels.subtitle")}
        </p>
      </div>

      {/* Current Default Model Display */}
      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
              {t("defaultModels.currentModel")}
            </p>
            {provider && modelName ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {selectedProvider?.name || provider}
                </span>
                <span className="text-gray-400 dark:text-gray-500">/</span>
                <span className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
                  {modelName}
                </span>
                {apiKey && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                    {t("defaultModels.apiKeyConfigured")}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-lg text-gray-400 dark:text-gray-500 italic">
                {t("defaultModels.notConfigured")}
              </span>
            )}
            {baseUrl && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Base URL: {baseUrl}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
        {/* Provider Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("defaultModels.providerLabel")}
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-left flex items-center justify-between"
            >
              <span className={provider ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}>
                {selectedProvider ? (
                  <span className="flex items-center gap-2">
                    {selectedProvider.name}
                    {selectedProvider.free && (
                      <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                        Free
                      </span>
                    )}
                  </span>
                ) : (
                  t("defaultModels.selectProvider")
                )}
              </span>
              <ChevronDown className="w-5 h-5 text-gray-400" />
            </button>
            {providerDropdownOpen && (
              <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-80 overflow-auto">
                {/* Free Providers Section */}
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-600">
                  {t("defaultModels.freeProviders")}
                </div>
                {MODEL_PROVIDERS.filter(p => p.free).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 flex items-center justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                      Free
                    </span>
                  </button>
                ))}
                {/* Paid Providers Section */}
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-y border-gray-200 dark:border-gray-600">
                  {t("defaultModels.paidProviders")}
                </div>
                {MODEL_PROVIDERS.filter(p => !p.free && !p.requiresBaseUrl && p.id !== 'custom').map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
                  >
                    {p.name}
                  </button>
                ))}
                {/* Custom Providers Section */}
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-y border-gray-200 dark:border-gray-600">
                  {t("defaultModels.customProviders")}
                </div>
                {MODEL_PROVIDERS.filter(p => p.requiresBaseUrl || p.id === 'custom').map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 flex items-center gap-2"
                  >
                    {p.requiresBaseUrl && <Server className="w-4 h-4 text-gray-400" />}
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Base URL (for OpenAI Compatible) */}
        {requiresBaseUrl && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("defaultModels.baseUrlLabel")}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              placeholder={t("defaultModels.baseUrlPlaceholder")}
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {t("defaultModels.baseUrlHint")}
            </p>
          </div>
        )}

        {/* Model Name */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("defaultModels.modelNameLabel")}
            </label>
            {hasModels && (
              <button
                type="button"
                onClick={() => {
                  setUseCustomModel(!useCustomModel);
                  if (!useCustomModel) {
                    setModelName("");
                  }
                }}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
              >
                {useCustomModel ? t("defaultModels.selectFromList") : t("defaultModels.enterCustomModel")}
              </button>
            )}
          </div>

          {hasModels && !useCustomModel ? (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-left flex items-center justify-between"
                >
                  <span className={modelName ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}>
                    {modelName || t("defaultModels.selectModel")}
                  </span>
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                </button>
                {modelDropdownOpen && (
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {selectedProvider?.models.map((model) => (
                      <button
                        key={model}
                        type="button"
                        onClick={() => {
                          setModelName(model);
                          setModelDropdownOpen(false);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              placeholder={t("defaultModels.modelNamePlaceholder")}
            />
          )}
        </div>

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t("defaultModels.apiKeyLabel")}
            {selectedProvider?.apiKeyName && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                ({selectedProvider.apiKeyName})
              </span>
            )}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 pr-12"
              placeholder={t("defaultModels.apiKeyPlaceholder")}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {/* API Key Link */}
          {selectedProvider?.apiKeyUrl && (
            <div className="mt-2">
              <a
                href={selectedProvider.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
              >
                <Key className="w-4 h-4" />
                <span>{t("defaultModels.getApiKey", { provider: selectedProvider.name })}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Info hint */}
        <div className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{t("defaultModels.hint")}</p>
        </div>

        {/* Save status */}
        {/* Test Results */}
        {testResult && (
          <div className={`p-4 rounded-lg border ${
            testResult.success
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className={`font-medium ${
                testResult.success
                  ? "text-green-800 dark:text-green-200"
                  : "text-red-800 dark:text-red-200"
              }`}>
                {t("defaultModels.testResults")}
              </h4>
              <button
                onClick={() => setTestResult(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {testResult.error_message && !testResult.success && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 mb-3">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{testResult.error_message}</span>
              </div>
            )}

            {testResult.success && (
              <div className="space-y-3">
                {/* Inference Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    testResult.inference_works ? "bg-green-500" : "bg-red-500"
                  }`} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t("defaultModels.inferenceStatus")}:{" "}
                    <span className={testResult.inference_works ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
                      {testResult.inference_works ? t("defaultModels.working") : t("defaultModels.notWorking")}
                    </span>
                  </span>
                </div>

                {/* Tool Use Status */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    testResult.supports_tool_use ? "bg-green-500" : "bg-yellow-500"
                  }`} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    <Wrench className="w-3.5 h-3.5 inline mr-1" />
                    {t("defaultModels.toolUseStatus")}:{" "}
                    <span className={testResult.supports_tool_use ? "text-green-600 dark:text-green-400 font-medium" : "text-yellow-600 dark:text-yellow-400 font-medium"}>
                      {testResult.supports_tool_use ? t("defaultModels.supported") : t("defaultModels.notDetected")}
                    </span>
                  </span>
                </div>

                {/* Model Response Preview */}
                {testResult.response && (
                  <div className="mt-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("defaultModels.modelResponse")}:</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 font-mono">
                      {testResult.response.length > 100
                        ? testResult.response.substring(0, 100) + "..."
                        : testResult.response}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {saveSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="w-4 h-4" />
            <span>{t("defaultModels.saveSuccess")}</span>
          </div>
        )}

        {saveError && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClear}
            disabled={isSaving || isTesting}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("defaultModels.clearButton")}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={!isConfigured || isTesting || isSaving}
            className="px-4 py-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 border border-indigo-300 dark:border-indigo-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isTesting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
                <span>{t("defaultModels.testing")}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>{t("defaultModels.testButton")}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isConfigured || isSaving || isTesting}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>{t("defaultModels.saving")}</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>{t("defaultModels.saveButton")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DefaultModelsPage;
