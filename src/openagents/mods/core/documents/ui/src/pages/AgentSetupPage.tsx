import React, { useState, useEffect, useCallback } from "react";
import {
  getSavedAgentNameForNetwork,
  saveAgentNameForNetwork,
} from "../utils/cookies";
import {
  generateRandomAgentName,
  isValidName,
  getAvatarInitials,
} from "../utils/utils";
import { useAuthStore } from "../stores/authStore";
import { useNavigate } from "react-router-dom";
import { verifyPasswordWithBackend } from "../utils/passwordHash";
import { networkFetch } from "../utils/httpClient";

const AgentSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    selectedNetwork,
    setAgentName,
    clearAgentName,
    clearNetwork,
    setPasswordHash,
  } = useAuthStore();

  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);
  const [password, setPassword] = useState<string>("");
  const [requiresPassword, setRequiresPassword] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const handleRandomize = useCallback(() => {
    setPageAgentName(generateRandomAgentName());
  }, []);

  useEffect(() => {
    if (!selectedNetwork) return;
    const savedName = getSavedAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port
    );

    if (savedName) {
      setSavedAgentName(savedName);
      setPageAgentName(savedName);
    } else {
      handleRandomize();
    }
  }, [selectedNetwork, handleRandomize]);

  useEffect(() => {
    const fetchNetworkConfig = async () => {
      if (!selectedNetwork) return;

      try {
        const response = await networkFetch(
          selectedNetwork.host,
          selectedNetwork.port,
          "/api/health",
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (response.ok) {
          const healthData = await response.json();
          const configRequiresPassword =
            healthData.data?.requires_password || false;
          setRequiresPassword(configRequiresPassword);
        }
      } catch (error) {
        console.error("Failed to fetch network config:", error);
      }
    };

    fetchNetworkConfig();
  }, [selectedNetwork]);

  const onBack = useCallback(() => {
    clearAgentName();
    clearNetwork();
  }, [clearAgentName, clearNetwork]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const agentNameTrimmed = pageAgentName?.trim();
    if (!agentNameTrimmed || !selectedNetwork) return;

    if (requiresPassword && !password.trim()) {
      setPasswordError("Password is required for this network");
      return;
    }

    setIsVerifying(true);
    setPasswordError("");

    try {
      let passwordHash: string | null = null;

      if (password.trim()) {
        const result = await verifyPasswordWithBackend(
          password,
          selectedNetwork.host,
          selectedNetwork.port
        );

        if (!result.success) {
          setPasswordError(
            result.error || "Invalid password. Please check your credentials."
          );
          setIsVerifying(false);
          return;
        }

        passwordHash = result.passwordHash || null;
      }

      proceedWithConnection(passwordHash);
    } catch (error) {
      console.error("Failed to verify password:", error);
      setPasswordError("Failed to connect to network. Please try again.");
      setIsVerifying(false);
    }
  };

  const proceedWithConnection = (hash: string | null) => {
    const agentNameTrimmed = pageAgentName?.trim();
    if (!agentNameTrimmed || !selectedNetwork) return;

    saveAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port,
      agentNameTrimmed
    );

    setPasswordHash(hash);
    setAgentName(agentNameTrimmed);
    navigate("/documents/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-blue-400 to-indigo-500 dark:from-blue-800 dark:to-indigo-800">
      <div className="max-w-lg w-full text-center rounded-2xl p-10 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50">
        <div className="mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 shadow-lg border-4 border-white dark:border-gray-800">
            {getAvatarInitials(pageAgentName)}
          </div>

          <h1 className="text-3xl font-bold mb-3 text-gray-800 dark:text-gray-50">
            Choose Your Agent Identity
          </h1>
          <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Set the agent name that will appear in document collaborations.
          </p>
        </div>

        <div className="rounded-xl p-4 mt-4 mb-4 text-left bg-gray-100 dark:bg-gray-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Connecting to
          </div>
          {selectedNetwork && (
            <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
              {selectedNetwork.host}:{selectedNetwork.port}
            </div>
          )}
        </div>

        {savedAgentName && (
          <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl p-4 my-4 text-left">
            <div className="text-xs font-semibold uppercase tracking-wide mb-1 text-sky-700 dark:text-sky-400">
              Previously used name
            </div>
            <div className="text-base font-semibold text-sky-900 dark:text-sky-100">
              {savedAgentName}
            </div>
            <p className="text-xs text-sky-700 dark:text-sky-400 mt-1">
              You can use your previous name or create a new one
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4 text-left">
            <label
              htmlFor="agentName"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Agent Name
            </label>
            <div className="flex gap-3">
              <input
                id="agentName"
                type="text"
                value={pageAgentName || ""}
                onChange={(e) => setPageAgentName(e.target.value)}
                placeholder="Choose a unique agent name"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={handleRandomize}
                className="px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Randomize
              </button>
            </div>
            {pageAgentName && !isValidName(pageAgentName) && (
              <p className="text-sm text-red-500 mt-2">
                Agent name must be 3-32 characters, letters/numbers/underscores
                only
              </p>
            )}
          </div>

          {requiresPassword && (
            <div className="mb-4 text-left">
              <label
                htmlFor="agentPassword"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Network Password
              </label>
              <input
                id="agentPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter the network password"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
              {passwordError && (
                <p className="text-sm text-red-500 mt-2">{passwordError}</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-6">
            <button
              type="submit"
              disabled={
                !pageAgentName ||
                !isValidName(pageAgentName) ||
                (requiresPassword && !password.trim()) ||
                isVerifying
              }
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isVerifying ? "Connecting..." : "Continue to Documents"}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Back to Network Selection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentSetupPage;

