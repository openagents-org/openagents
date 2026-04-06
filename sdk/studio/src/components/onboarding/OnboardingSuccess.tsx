import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Template } from "@/pages/OnboardingPage";
import { useAuthStore } from "@/stores/authStore";
import { hashPassword } from "@/utils/passwordHash";
import { networkFetch } from "@/utils/httpClient";
import OpenAgentsLogo from "@/assets/images/openagents_logo_color_280.png";

const ADMIN_AGENT_NAME = "admin";

interface OnboardingSuccessProps {
  template: Template;
  agentCount: number;
  adminPassword: string;
}

const OnboardingSuccess: React.FC<OnboardingSuccessProps> = ({
  adminPassword,
}) => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const {
    selectedNetwork,
    setAgentName,
    setPasswordHash,
    setAgentGroup,
  } = useAuthStore();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnterDashboard = async () => {
    if (!selectedNetwork || !adminPassword) return;

    setIsLoggingIn(true);
    setError(null);

    try {
      // Hash the password
      const hashedPassword = await hashPassword(adminPassword);

      // Verify credentials by attempting registration with admin group
      const verifyResponse = await networkFetch(
        selectedNetwork.host,
        selectedNetwork.port,
        "/api/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: ADMIN_AGENT_NAME,
            metadata: {
              display_name: ADMIN_AGENT_NAME,
              platform: "web",
              verification_only: true,
            },
            password_hash: hashedPassword,
            agent_group: "admin",
          }),
          useHttps: selectedNetwork.useHttps,
        }
      );

      const verifyData = await verifyResponse.json();

      if (!verifyData.success) {
        const errorMessage = verifyData.error_message || "Failed to connect as admin";
        setError(errorMessage);
        setIsLoggingIn(false);
        return;
      }

      // Registration succeeded - unregister to let the main app re-register
      try {
        await networkFetch(
          selectedNetwork.host,
          selectedNetwork.port,
          "/api/unregister",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agent_id: ADMIN_AGENT_NAME,
              secret: verifyData.secret,
            }),
            useHttps: selectedNetwork.useHttps,
          }
        );
      } catch (unregError) {
        console.warn("Failed to unregister after verification:", unregError);
      }

      // Store the admin credentials in authStore
      setPasswordHash(hashedPassword);
      setAgentGroup("admin");
      setAgentName(ADMIN_AGENT_NAME);

      // Navigate to admin dashboard
      navigate("/admin/dashboard", { replace: true });
    } catch (err: any) {
      console.error("Failed to login as admin:", err);
      setError(err.message || "Failed to login as admin");
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative bg-white">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />

      {/* Decorative gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-purple-200/30 to-pink-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-gradient-to-r from-blue-200/30 to-indigo-200/30 rounded-full blur-3xl" />

      <div className="max-w-2xl w-full bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl overflow-hidden relative z-10 border border-gray-200">
        <div className="p-12 text-center">
          <div className="mb-8">
            <img
              src={OpenAgentsLogo}
              alt="OpenAgents Logo"
              className="w-24 h-24 mx-auto"
            />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-8">
            {t('success.title')}
          </h1>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleEnterDashboard}
            disabled={isLoggingIn}
            className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:via-purple-500 hover:to-pink-500 text-white font-semibold py-4 px-8 rounded-xl text-lg transition-all transform hover:scale-105 shadow-lg shadow-indigo-500/25 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            {isLoggingIn && <Loader2 className="w-5 h-5 animate-spin" />}
            {t('success.enterDashboardButton')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingSuccess;
