import React from "react";
import { useTranslation } from "react-i18next";
import { Template } from "@/pages/OnboardingPage";

interface OnboardingStep4Props {
  template: Template;
  isDeploying: boolean;
  progress: number;
}

const OnboardingStep4: React.FC<OnboardingStep4Props> = ({ template, progress }) => {
  const { t } = useTranslation('onboarding');

  const modsText = template.mods.length > 0
    ? t('step4.steps.installMods', { mods: template.mods.join(", ") })
    : t('step4.steps.installModsEmpty');

  const steps = [
    { name: t('step4.steps.createConfig'), completed: progress >= 25 },
    { name: modsText, completed: progress >= 50 },
    { name: t('step4.steps.configureAgents'), completed: progress >= 75 },
    { name: t('step4.steps.startingAgents'), completed: progress >= 90, inProgress: progress >= 75 && progress < 90 },
    { name: t('step4.steps.verifyConnection'), completed: progress >= 100 },
  ];

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
              {t('step4.stepIndicator')}
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {t('step4.title')}
            </h1>
          </div>

          <div className="bg-gray-50 rounded-xl p-6 mb-6 border border-gray-200">
            <div className="space-y-4">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center">
                  <div className="mr-4">
                    {step.completed ? (
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    ) : step.inProgress ? (
                      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 border-2 border-gray-300 rounded-full"></div>
                    )}
                  </div>
                  <span
                    className={`${
                      step.completed
                        ? "text-green-600"
                        : step.inProgress
                        ? "text-indigo-600"
                        : "text-gray-400"
                    }`}
                  >
                    {step.name}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <div className="flex justify-between text-sm text-gray-500 mb-2">
                <span>{t('step4.progress')}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          </div>

          {(template.name || template.agents.length > 0) && (
            <div className="text-center text-gray-600">
              {template.name && (
                <div className="mb-2">
                  <strong className="text-gray-900">{t('step4.template')}</strong> {template.name}
                </div>
              )}
              {template.agents.length > 0 && (
                <div>
                  <strong className="text-gray-900">{t('step4.agents')}</strong>{" "}
                  {template.agents.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingStep4;
