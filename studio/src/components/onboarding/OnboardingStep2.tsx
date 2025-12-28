import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Template } from "@/pages/OnboardingPage";
import { useAuthStore } from "@/stores/authStore";

// Import template icons
import chatroomIcon from "@/assets/images/template_icons/chatroom.png";
import customIcon from "@/assets/images/template_icons/custom.png";
import infoIcon from "@/assets/images/template_icons/info.png";
import projectIcon from "@/assets/images/template_icons/project.png";
import wikiIcon from "@/assets/images/template_icons/wiki.png";

// Template ID to icon mapping
const templateIconMap: Record<string, string> = {
  "multi-agent-chatroom": chatroomIcon,
  "information-hub": infoIcon,
  "project-hub": projectIcon,
  "wiki-network": wikiIcon,
  "custom": customIcon,
};

interface OnboardingStep2Props {
  onNext: (template: Template) => void;
  onBack: () => void;
}

const TEMPLATES_PER_PAGE = 5;
const CUSTOM_TEMPLATE_ID = "custom";

const OnboardingStep2: React.FC<OnboardingStep2Props> = ({ onNext, onBack }) => {
  const { t } = useTranslation('onboarding');
  const { selectedNetwork } = useAuthStore();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Custom template definition
  const customTemplate: Template = {
    id: CUSTOM_TEMPLATE_ID,
    name: t('step2.templates.custom.name'),
    description: t('step2.templates.custom.description'),
    icon: "",
    agentCount: 0,
    mods: [],
    setupTime: "",
    agents: [],
  };

  // Fetch templates from API
  useEffect(() => {
    const fetchTemplates = async () => {
      if (!selectedNetwork) {
        setError("No network connection");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const protocol = selectedNetwork.useHttps ? "https" : "http";
        const baseUrl = `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}`;

        const response = await fetch(`${baseUrl}/api/templates`, {
          method: "GET",
          headers: {
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success && Array.isArray(result.templates)) {
          // Map API response to Template interface
          // Filter out default_network as it's not a proper onboarding template
          const mappedTemplates: Template[] = result.templates
            .filter((item: any) => item.name !== 'default_network')
            .map((item: any) => ({
              id: item.name || item.id,
              name: item.name,
              description: item.description || "",
              icon: item.icon || "",
              agentCount: item.agentCount || item.agent_count || 0,
              mods: item.mods || [],
              setupTime: item.setupTime || item.setup_time || t('step2.setupTime.quick'),
              agents: item.agents || [],
            }));
          setTemplates(mappedTemplates);
        } else {
          throw new Error("Invalid response format");
        }
      } catch (err: any) {
        console.error("Failed to fetch templates:", err);
        setError(err.message || "Failed to load templates");
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [selectedNetwork, t]);

  // All templates including custom
  const allTemplates = [...templates, customTemplate];

  const totalPages = Math.ceil(allTemplates.length / TEMPLATES_PER_PAGE);
  const visibleTemplates = allTemplates.slice(
    currentPage * TEMPLATES_PER_PAGE,
    (currentPage + 1) * TEMPLATES_PER_PAGE
  );

  const handleSelect = (template: Template) => {
    setSelectedTemplateId(template.id);
  };

  const handleNext = async () => {
    const selected = allTemplates.find(t => t.id === selectedTemplateId);
    if (!selected || !selectedNetwork) return;

    // If not custom template, call initialize/template API
    if (selected.id !== CUSTOM_TEMPLATE_ID) {
      try {
        setSubmitting(true);
        const protocol = selectedNetwork.useHttps ? "https" : "http";
        const baseUrl = `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}`;

        const response = await fetch(`${baseUrl}/api/network/initialize/template`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ template_name: selected.id }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        // If network is restarting, wait for it to come back up
        if (result.network_restarting) {
          console.log("🔄 Network is restarting, waiting for it to come back up...");

          // Wait for network to restart (poll health endpoint)
          const maxRetries = 10;
          const retryDelay = 1000; // 1 second
          let networkReady = false;

          for (let i = 0; i < maxRetries; i++) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));

            try {
              const healthResponse = await fetch(`${baseUrl}/api/health`, {
                method: "GET",
                headers: { "Accept": "application/json" },
              });

              if (healthResponse.ok) {
                console.log("✅ Network is back online");
                networkReady = true;
                break;
              }
            } catch {
              console.log(`⏳ Waiting for network... (attempt ${i + 1}/${maxRetries})`);
            }
          }

          if (!networkReady) {
            throw new Error("Network did not restart in time. Please refresh the page.");
          }
        }
      } catch (err: any) {
        console.error("Failed to initialize template:", err);
        setError(err.message || "Failed to initialize template");
        setSubmitting(false);
        return;
      } finally {
        setSubmitting(false);
      }
    }

    onNext(selected);
  };

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-white">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-purple-200/30 to-pink-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-gradient-to-r from-blue-200/30 to-indigo-200/30 rounded-full blur-3xl" />

      <div className="max-w-6xl w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl overflow-hidden relative z-10 border border-gray-200">
        <div className="p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-500 mb-2">
                {t('step2.stepIndicator')}
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {t('step2.title')}
              </h1>
              <p className="text-gray-600">
                {t('step2.description')}
              </p>
            </div>
            {/* Pagination controls in header */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-gray-500 text-sm">
                  {currentPage + 1} / {totalPages}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages - 1}
                  className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="text-center py-16">
              <p className="text-red-500 mb-4">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                {t('step2.retry') || 'Retry'}
              </button>
            </div>
          )}

          {/* Templates grid - horizontal layout, max 5 per row */}
          {!loading && !error && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
              {visibleTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`border-2 rounded-xl p-5 cursor-pointer transition-all flex flex-col ${
                    selectedTemplateId === template.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
                  }`}
                  onClick={() => handleSelect(template)}
                >
                  {/* Template icon */}
                  {templateIconMap[template.id] && (
                    <div className="mb-3 flex justify-center">
                      <img
                        src={templateIconMap[template.id]}
                        alt={`${template.name} icon`}
                        className="w-full h-24 object-cover rounded-lg"
                      />
                    </div>
                  )}
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {template.name}
                  </h3>
                  <p className="text-gray-600 text-sm flex-grow">
                    {template.description}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={onBack}
              className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors"
            >
              {t('step2.backButton')}
            </button>
            <button
              onClick={handleNext}
              disabled={!selectedTemplateId || submitting}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('step2.nextButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingStep2;
