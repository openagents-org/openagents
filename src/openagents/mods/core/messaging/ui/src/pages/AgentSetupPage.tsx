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

const AgentNamePicker: React.FC = () => {
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
  }, [setPageAgentName]);

  // Load saved agent name
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
  }, [selectedNetwork, handleRandomize, setPageAgentName]);

  // Fetch network configuration to determine if password is required
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
          console.log("Network requires password:", configRequiresPassword);
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

    // Validate password requirement
    if (requiresPassword && !password.trim()) {
      setPasswordError("Password is required for this network");
      return;
    }

    setIsVerifying(true);
    setPasswordError("");

    try {
      let passwordHash: string | null = null;

      // If user entered a password, verify it with backend
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
        console.log(`Password verified - matched group: ${result.groupName}`);
      } else if (!requiresPassword) {
        // No password entered and it's optional - connect as guest
        console.log("Connecting as guest (no password provided)");
      }

      // Proceed with connection
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

    // Save the agent name for this network
    saveAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port,
      agentNameTrimmed
    );

    // Store the password hash in authStore so it can be accessed by HttpEventConnector
    setPasswordHash(hash);
    setAgentName(agentNameTrimmed);

    // Navigate to messaging main page
    navigate("/messaging/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-indigo-400 to-purple-500 dark:from-blue-800 dark:to-violet-800">
      <div className="max-w-lg w-full text-center rounded-2xl p-10 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50">
        {/* Header */}
        <div className="mb-6">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 shadow-lg border-4 border-white dark:border-gray-800">
            {getAvatarInitials(pageAgentName)}
          </div>

          <h1 className="text-3xl font-bold mb-3 text-gray-800 dark:text-gray-50">
            Join OpenAgents Network
          </h1>
          <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Choose your agent name to connect to the network and start
            collaborating with other agents.
          </p>
        </div>

        {/* Network Info */}
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

        {/* Saved Agent Name Info */}
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="my-4">
          {/* Agent Name Input */}
          <div className="mb-4 text-left">
            <label
              htmlFor="agentName"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              Agent Name
            </label>
            <input
              id="agentName"
              type="text"
              value={pageAgentName || ""}
              onChange={(e) => setPageAgentName(e.target.value)}
              className="w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white border-gray-300 text-gray-800 focus:border-blue-500 focus:ring-blue-500/10 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/10"
              placeholder="Enter your agent name..."
              maxLength={32}
              autoComplete="off"
            />

            {/* Action Buttons */}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleRandomize}
                className="px-3 py-2 rounded-md text-sm cursor-pointer transition-all duration-150 bg-gray-100 border border-gray-300 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-500 dark:border-gray-400 dark:text-gray-100 dark:hover:bg-gray-400 dark:hover:text-gray-800"
              >
                🎲 Generate Random Name
              </button>
              {savedAgentName && pageAgentName !== savedAgentName && (
                <button
                  type="button"
                  onClick={() => setPageAgentName(savedAgentName)}
                  className="px-3 py-2 rounded-md text-sm cursor-pointer transition-all duration-150 bg-blue-500 text-white border-none hover:bg-blue-600"
                >
                  ↶ Use Previous: {savedAgentName}
                </button>
              )}
            </div>

            <div className="text-xs mt-2 leading-relaxed text-gray-500 dark:text-gray-400">
              {savedAgentName && (
                <>💾 Your name will be automatically saved for this network.</>
              )}
            </div>
          </div>

          {/* Password Input */}
          <div className="mb-4 text-left">
            <label
              htmlFor="password"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              Password{" "}
              {!requiresPassword && (
                <span className="text-gray-400 font-normal">(Optional)</span>
              )}
              {requiresPassword && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(""); // Clear error when user types
              }}
              className={`w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white text-gray-800 focus:border-blue-500 focus:ring-blue-500/10 dark:bg-gray-600 dark:text-gray-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/10 ${
                passwordError
                  ? "border-red-500 dark:border-red-400"
                  : "border-gray-300 dark:border-gray-500"
              }`}
              placeholder="Enter password to join a group..."
              autoComplete="off"
            />

            {/* Password Error */}
            {passwordError && (
              <div className="text-red-500 dark:text-red-400 text-sm mt-2 flex items-start gap-1">
                <span className="mt-0.5">⚠️</span>
                <span>{passwordError}</span>
              </div>
            )}

            {/* Password Hint */}
            <div className="text-xs mt-2 leading-relaxed text-gray-500 dark:text-gray-400">
              {requiresPassword ? (
                <>
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    ⚠️ Password is required
                  </span>{" "}
                  to connect to this network
                </>
              ) : (
                <>
                  💡 Leave empty to connect as guest, or enter password to join
                  a specific group
                </>
              )}
            </div>
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={onBack}
              disabled={isVerifying}
              className="flex-1 px-6 py-3 border rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500 dark:hover:text-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={!isValidName(pageAgentName) || isVerifying}
              className={`flex-[2] px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 text-white ${
                !isValidName(pageAgentName) || isVerifying
                  ? "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30"
              }`}
            >
              <div className="flex flex-wrap justify-center items-center gap-2">
                {isVerifying ? (
                  <>
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
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>Connect as {pageAgentName || "Agent"}</span>
                    <span>→</span>
                  </>
                )}
              </div>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentNamePicker;

