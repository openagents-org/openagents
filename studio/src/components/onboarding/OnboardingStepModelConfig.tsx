import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Info, ChevronDown } from "lucide-react";

interface ModelConfig {
  provider: string;
  modelName: string;
  apiKey: string;
}

interface OnboardingStepModelConfigProps {
  onNext: (config: ModelConfig | null) => void;
  onBack: () => void;
}

const MODEL_PROVIDERS = [
  // Free tier providers
  { id: "groq", name: "Groq", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "deepseek-r1-distill-llama-70b"], free: true },
  { id: "gemini", name: "Google Gemini", models: ["gemini-3-flash", "gemini-3-pro", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"], free: true },
  { id: "mistral", name: "Mistral", models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"], free: true },
  // Paid providers
  { id: "openai", name: "OpenAI", models: ["gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3-mini"] },
  { id: "anthropic", name: "Anthropic", models: ["claude-opus-4-5-20251124", "claude-sonnet-4-5-20250514", "claude-haiku-4-5-20251015", "claude-sonnet-4-20250514"] },
  { id: "deepseek", name: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "grok", name: "Grok (xAI)", models: ["grok-3", "grok-3-mini", "grok-2"] },
  { id: "qwen", name: "Qwen (Alibaba)", models: ["qwen-turbo", "qwen-plus", "qwen-max"] },
  { id: "azure", name: "Azure OpenAI", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"] },
  { id: "bedrock", name: "Amazon Bedrock", models: ["us.anthropic.claude-sonnet-4-5-20250514-v1:0", "us.anthropic.claude-haiku-4-5-20250514-v1:0", "anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic.claude-3-5-haiku-20241022-v1:0", "anthropic.claude-3-opus-20240229-v1:0"] },
  { id: "openrouter", name: "OpenRouter", models: [] },
  { id: "openai-compatible", name: "Custom OpenAI Compatible", models: [] },
];

const OnboardingStepModelConfig: React.FC<OnboardingStepModelConfigProps> = ({ onNext, onBack }) => {
  const { t } = useTranslation('onboarding');
  const [provider, setProvider] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  const selectedProvider = MODEL_PROVIDERS.find(p => p.id === provider);
  const hasModels = selectedProvider && selectedProvider.models.length > 0;
  const isConfigured = provider && modelName && apiKey;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfigured) return;
    // Just pass the config to the next step - actual configuration happens during deployment
    onNext({ provider, modelName, apiKey });
  };

  const handleSkip = () => {
    onNext(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-white">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-purple-200/30 to-pink-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-gradient-to-r from-blue-200/30 to-indigo-200/30 rounded-full blur-3xl" />

      <div className="max-w-2xl w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl overflow-hidden relative z-10 border border-gray-200">
        <div className="p-8">
          <div className="mb-8">
            <div className="text-sm text-gray-500 mb-2">
              {t('stepModelConfig.stepIndicator')}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {t('stepModelConfig.title')}
            </h1>
            <p className="text-gray-600">
              {t('stepModelConfig.description')}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bg-gray-50 rounded-xl p-6 mb-6 border border-gray-200">
              {/* Provider Dropdown */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('stepModelConfig.providerLabel')}
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-left flex items-center justify-between"
                  >
                    <span className={provider ? "text-gray-900" : "text-gray-400"}>
                      {selectedProvider?.name || t('stepModelConfig.selectProvider')}
                    </span>
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  </button>
                  {providerDropdownOpen && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                      {MODEL_PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProvider(p.id);
                            setModelName("");
                            setProviderDropdownOpen(false);
                          }}
                          className="w-full px-4 py-3 text-left hover:bg-gray-50 text-gray-900"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Model Name */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('stepModelConfig.modelNameLabel')}
                </label>
                {hasModels ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-left flex items-center justify-between"
                    >
                      <span className={modelName ? "text-gray-900" : "text-gray-400"}>
                        {modelName || t('stepModelConfig.selectModel')}
                      </span>
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    </button>
                    {modelDropdownOpen && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                        {selectedProvider.models.map((model) => (
                          <button
                            key={model}
                            type="button"
                            onClick={() => {
                              setModelName(model);
                              setModelDropdownOpen(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 text-gray-900"
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400"
                    placeholder={t('stepModelConfig.modelNamePlaceholder')}
                  />
                )}
              </div>

              {/* API Key */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('stepModelConfig.apiKeyLabel')}
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white text-gray-900 placeholder-gray-400 pr-12"
                    placeholder={t('stepModelConfig.apiKeyPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-sm text-gray-500 mb-6">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>{t('stepModelConfig.hint')}</p>
            </div>

            <div className="flex justify-between">
              <button
                type="button"
                onClick={onBack}
                className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors"
              >
                {t('stepModelConfig.backButton')}
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSkip}
                  className="px-6 py-2 text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg transition-colors"
                >
                  {t('stepModelConfig.skipButton')}
                </button>
                <button
                  type="submit"
                  disabled={!isConfigured}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {t('stepModelConfig.continueButton')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OnboardingStepModelConfig;
