import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate, useLocation } from "react-router-dom";
import { hashPassword } from "@/utils/passwordHash";
import { networkFetch } from "@/utils/httpClient";
import { Shield } from "lucide-react";
import { NetworkConnection } from "@/types/connection";

const ADMIN_AGENT_NAME = "admin";

interface LocationState {
  pendingConnection?: NetworkConnection;
}

const AdminLoginPage: React.FC = () => {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const location = useLocation();
  const {
    selectedNetwork,
    setAgentName,
    setPasswordHash,
    setAgentGroup,
    handleNetworkSelected,
  } = useAuthStore();

  const [password, setPassword] = useState<string>("");
  const [passwordError, setPasswordError] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Get pending connection from navigation state
  const locationState = location.state as LocationState | null;
  const pendingConnection = locationState?.pendingConnection;

  // Set network from pending connection if available
  useEffect(() => {
    if (pendingConnection && !selectedNetwork) {
      handleNetworkSelected(pendingConnection);
    }
  }, [pendingConnection, selectedNetwork, handleNetworkSelected]);

  // Use either selectedNetwork or pendingConnection for display
  const networkToUse = selectedNetwork || pendingConnection;

  // Redirect if no network selected and no pending connection
  useEffect(() => {
    if (!selectedNetwork && !pendingConnection) {
      navigate("/");
    }
  }, [selectedNetwork, pendingConnection, navigate]);

  const onBack = () => {
    navigate("/agent-setup");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!networkToUse) return;

    // Validate password
    if (!password.trim()) {
      setPasswordError(t("agentSetup.errors.adminPasswordRequired"));
      return;
    }

    setIsVerifying(true);
    setPasswordError("");

    try {
      // Hash the password
      const hashedPassword = await hashPassword(password);
      console.log("Password hashed for admin group");

      // Verify credentials by attempting registration with admin group
      const verifyResponse = await networkFetch(
        networkToUse.host,
        networkToUse.port,
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
          useHttps: networkToUse.useHttps,
        }
      );

      const verifyData = await verifyResponse.json();

      if (!verifyData.success) {
        const errorMessage = verifyData.error_message || t("agentSetup.errors.adminConnectionFailed");
        setPasswordError(errorMessage);
        setIsVerifying(false);
        return;
      }

      // Registration succeeded - unregister to let the main app re-register
      try {
        await networkFetch(
          networkToUse.host,
          networkToUse.port,
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
            useHttps: networkToUse.useHttps,
          }
        );
      } catch (unregError) {
        console.warn("Failed to unregister after verification:", unregError);
      }

      // Store the complete admin auth state BEFORE navigation
      // All three must be set before navigate() to avoid RouteGuard redirecting to /agent-setup
      setPasswordHash(hashedPassword);
      setAgentGroup("admin");
      setAgentName(ADMIN_AGENT_NAME);

      // Navigate after auth state is complete
      navigate("/admin/dashboard", { replace: true });
    } catch (error) {
      console.error("Failed to verify admin credentials:", error);
      setPasswordError(t("agentSetup.errors.adminConnectionFailed"));
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-amber-400 to-orange-500 dark:from-amber-700 dark:to-orange-800">
      <div className="max-w-md w-full text-center rounded-2xl p-10 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50">
        {/* Header */}
        <div className="mb-8">
          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white mx-auto mb-6 shadow-lg border-4 border-white dark:border-gray-800">
            <Shield className="w-10 h-10" />
          </div>

          <h1 className="text-3xl font-bold mb-3 text-gray-800 dark:text-gray-50">
            {t("agentSetup.buttons.loginAsAdmin")}
          </h1>
          <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
            {t("agentSetup.adminPasswordHint")}
          </p>
        </div>

        {/* Network Info */}
        {networkToUse && (
          <div className="rounded-xl p-4 mb-6 text-left bg-gray-100 dark:bg-gray-700">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("agentSetup.connectingTo")}
            </div>
            <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
              {networkToUse.host}:{networkToUse.port}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Password Input */}
          <div className="mb-6 text-left">
            <label
              htmlFor="password"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              {t("agentSetup.adminPassword")} <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError("");
              }}
              className={`w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white text-gray-800 focus:border-amber-500 focus:ring-amber-500/10 dark:bg-gray-600 dark:text-gray-50 dark:focus:border-amber-400 dark:focus:ring-amber-400/10 ${
                passwordError
                  ? "border-red-500 dark:border-red-400"
                  : "border-gray-300 dark:border-gray-500"
              }`}
              placeholder={t("agentSetup.adminPasswordPlaceholder")}
              autoComplete="current-password"
              autoFocus
              required
            />

            {/* Password Error */}
            {passwordError && (
              <div className="text-red-500 dark:text-red-400 text-sm mt-2 flex items-start gap-1">
                <span className="mt-0.5">⚠️</span>
                <span>{passwordError}</span>
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onBack}
              disabled={isVerifying}
              className="flex-1 px-6 py-3 border rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500 dark:hover:text-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("agentSetup.buttons.back")}
            </button>
            <button
              type="submit"
              disabled={!password.trim() || isVerifying}
              className={`flex-[2] px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 text-white ${
                !password.trim() || isVerifying
                  ? "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
                  : "bg-amber-500 hover:bg-amber-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-500/30"
              }`}
            >
              {isVerifying ? (
                <div className="flex justify-center items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span>{t("agentSetup.buttons.connecting")}</span>
                </div>
              ) : (
                <span>{t("agentSetup.buttons.loginAsAdmin")} →</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminLoginPage;
