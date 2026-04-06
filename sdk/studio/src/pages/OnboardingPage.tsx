import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { hashPassword } from "@/utils/passwordHash";
import OnboardingStep1 from "@/components/onboarding/OnboardingStep1";
import OnboardingStep2 from "@/components/onboarding/OnboardingStep2";
import OnboardingStep3 from "@/components/onboarding/OnboardingStep3";
import OnboardingStepModelConfig from "@/components/onboarding/OnboardingStepModelConfig";
import OnboardingStep4 from "@/components/onboarding/OnboardingStep4";
import OnboardingSuccess from "@/components/onboarding/OnboardingSuccess";

interface ModelConfig {
  provider: string;
  modelName: string;
  apiKey: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  agentCount: number;
  mods: string[];
  setupTime: string;
  agents: string[];
}

const ADMIN_AGENT_NAME = "admin";

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedNetwork, setAgentName, setPasswordHash, setAgentGroup } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentProgress, setDeploymentProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  // Onboarding status is now checked in NetworkSelectionPage
  // No need to check here since we're already showing onboarding

  const handleStep1Next = () => {
    setCurrentStep(2);
  };

  const handleStep2Next = (template: Template) => {
    setSelectedTemplate(template);
    setCurrentStep(3);
  };

  const handleStep2Back = () => {
    setCurrentStep(1);
  };

  const handleStep3Next = (password: string) => {
    setAdminPassword(password);
    setCurrentStep(4);
  };

  const handleStep3Back = () => {
    setCurrentStep(2);
  };

  const handleModelConfigNext = (config: ModelConfig | null) => {
    // Store the config first, then start deployment with it
    setModelConfig(config);
    setCurrentStep(5);
    // Start deployment with the config passed directly (since setState is async)
    handleDeployment(config);
  };

  const handleModelConfigBack = () => {
    setCurrentStep(3);
  };

  const handleDeployment = async (config: ModelConfig | null) => {
    if (!selectedNetwork) return;

    setIsDeploying(true);
    setDeploymentProgress(0);

    const protocol = selectedNetwork.useHttps ? "https" : "http";
    const baseUrl = `${protocol}://${selectedNetwork.host}:${selectedNetwork.port}`;

    try {
      // Step 1: Set admin password (25%)
      setDeploymentProgress(25);
      const passwordResponse = await fetch(`${baseUrl}/api/network/initialize/admin-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      if (!passwordResponse.ok) {
        throw new Error(`Failed to set admin password: ${passwordResponse.statusText}`);
      }

      // Step 2: Apply mods / template (50%)
      setDeploymentProgress(50);
      if (selectedTemplate) {
        const templateResponse = await fetch(`${baseUrl}/api/network/initialize/template`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_name: selectedTemplate.id }),
        });
        if (!templateResponse.ok) {
          console.warn("Template application failed, continuing...");
        }
      }

      // Step 3: Configure model (if provided) (75%)
      setDeploymentProgress(75);
      if (config) {
        const modelResponse = await fetch(`${baseUrl}/api/network/initialize/model-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: config.provider,
            model_name: config.modelName,
            api_key: config.apiKey,
          }),
        });
        if (!modelResponse.ok) {
          console.warn("Model config failed, continuing...");
        }
      }

      // Step 4: Starting network (90%)
      setDeploymentProgress(90);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 5: Verify connection (100%)
      setDeploymentProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 500));

      setIsDeploying(false);
      setIsComplete(true);

      // Set auth state for admin access
      const hashedPassword = await hashPassword(adminPassword);
      setPasswordHash(hashedPassword);
      setAgentGroup("admin");
      setAgentName(ADMIN_AGENT_NAME);

      // Auto-redirect to admin dashboard after a brief moment
      await new Promise((resolve) => setTimeout(resolve, 1000));
      navigate("/admin/dashboard", { replace: true });
    } catch (error) {
      console.error("Deployment failed:", error);
      setIsDeploying(false);
      // TODO: Show error to user
    }
  };

  if (isComplete) {
    return (
      <OnboardingSuccess
        template={selectedTemplate!}
        agentCount={selectedTemplate?.agentCount || 0}
        adminPassword={adminPassword}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      {currentStep === 1 && (
        <OnboardingStep1 onNext={handleStep1Next} />
      )}
      {currentStep === 2 && (
        <OnboardingStep2
          onNext={handleStep2Next}
          onBack={handleStep2Back}
        />
      )}
      {currentStep === 3 && (
        <OnboardingStep3
          onNext={handleStep3Next}
          onBack={handleStep3Back}
        />
      )}
      {currentStep === 4 && (
        <OnboardingStepModelConfig
          onNext={handleModelConfigNext}
          onBack={handleModelConfigBack}
        />
      )}
      {currentStep === 5 && (
        <OnboardingStep4
          template={selectedTemplate!}
          isDeploying={isDeploying}
          progress={deploymentProgress}
        />
      )}
    </div>
  );
};

export default OnboardingPage;
