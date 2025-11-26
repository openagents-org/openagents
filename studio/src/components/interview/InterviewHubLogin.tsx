import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { NetworkConnection, ConnectionStatusEnum } from "@/types/connection";
import {
  getInterviewHubConfig,
  generateAgentNameFromUserInfo,
} from "@/config/interviewHubConfig";
import {
  saveAgentNameForNetwork,
} from "@/utils/cookies";
import openAgentsLogo from "@/assets/images/open-agents-logo.png";

/**
 * Interview Hub Login Component
 *
 * Simplified login page for Interview Hub mode that collects
 * user information (first name, last name, email) and automatically
 * connects to the configured network.
 */
const InterviewHubLogin: React.FC = () => {
  const navigate = useNavigate();
  const { setAgentName, handleNetworkSelected, setPasswordHash } = useAuthStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");

  const config = getInterviewHubConfig();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate inputs
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError("Please fill in all fields");
      return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsConnecting(true);

    try {
      // Generate agent name from user info
      const agentName = generateAgentNameFromUserInfo(firstName, lastName);
      console.log("🎯 Generated agent name:", agentName);

      // Create network connection object
      const networkConnection: NetworkConnection = {
        host: config.host,
        port: config.port,
        status: ConnectionStatusEnum.CONNECTING,
        networkInfo: {
          name: "Interview Hub",
        },
      };
      console.log("🌐 Created network connection:", networkConnection);

      // Save the connection and agent name
      handleNetworkSelected(networkConnection);
      setAgentName(agentName);
      console.log("✅ Saved network and agent name to auth store");

      // Save agent name to cookies
      saveAgentNameForNetwork(config.host, config.port, agentName);
      console.log("🍪 Saved agent name to cookies");

      // Save user info to localStorage for auto-registration
      const userInfo = {
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      };
      localStorage.setItem('interview_hub_user_info', JSON.stringify(userInfo));
      console.log("💾 Saved user info to localStorage:", userInfo);

      // No password for interview hub mode
      setPasswordHash(null);

      // Navigate directly to the interview page
      console.log("🚀 Navigating to /interview");
      navigate("/interview");
    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Failed to connect to Interview Hub. Please try again.");
      setIsConnecting(false);
    }
  };

  const getInitials = () => {
    const f = firstName.trim() || "?";
    const l = lastName.trim() || "?";
    return `${f[0]}${l[0]}`.toUpperCase();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-indigo-400 to-purple-500 dark:from-blue-800 dark:to-violet-800">
      <div className="max-w-lg w-full text-center rounded-2xl p-10 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50">
        {/* Header */}
        <div className="mb-6">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 shadow-lg border-4 border-white dark:border-gray-800">
            {getInitials()}
          </div>

          <h1 className="text-3xl font-bold mb-3 text-gray-800 dark:text-gray-50">
            Peak Mojo AI Interview Hub
          </h1>
          <p className="text-base leading-relaxed text-gray-500 dark:text-gray-300">
            Please enter your information to get started with your interview journey.
          </p>
        </div>

        {/* Network Info */}
        <div className="rounded-xl p-4 mt-4 mb-4 text-left bg-gray-100 dark:bg-gray-700">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Connecting to
          </div>
          <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {config.host}:{config.port}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="my-4">
          {/* First Name */}
          <div className="mb-4 text-left">
            <label
              htmlFor="firstName"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white border-gray-300 text-gray-800 focus:border-blue-500 focus:ring-blue-500/10 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/10"
              placeholder="Enter your first name"
              maxLength={50}
              autoComplete="given-name"
              disabled={isConnecting}
            />
          </div>

          {/* Last Name */}
          <div className="mb-4 text-left">
            <label
              htmlFor="lastName"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white border-gray-300 text-gray-800 focus:border-blue-500 focus:ring-blue-500/10 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/10"
              placeholder="Enter your last name"
              maxLength={50}
              autoComplete="family-name"
              disabled={isConnecting}
            />
          </div>

          {/* Email */}
          <div className="mb-4 text-left">
            <label
              htmlFor="email"
              className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300"
            >
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border-2 rounded-lg text-base transition-all duration-150 focus:outline-none focus:ring-3 bg-white border-gray-300 text-gray-800 focus:border-blue-500 focus:ring-blue-500/10 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/10"
              placeholder="Enter your email address"
              maxLength={100}
              autoComplete="email"
              disabled={isConnecting}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div className="text-red-500 dark:text-red-400 text-sm flex items-start gap-2">
                <span className="mt-0.5">⚠️</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Agent Name Preview */}
          {firstName && lastName && (
            <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-left">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                Your Agent Name
              </div>
              <div className="text-base font-semibold text-blue-900 dark:text-blue-100 mt-1">
                {generateAgentNameFromUserInfo(firstName, lastName)}
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!firstName.trim() || !lastName.trim() || !email.trim() || isConnecting}
            className={`w-full px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 text-white ${
              !firstName.trim() || !lastName.trim() || !email.trim() || isConnecting
                ? "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30"
            }`}
          >
            {isConnecting ? (
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
                <span>Connecting...</span>
              </div>
            ) : (
              <div className="flex justify-center items-center gap-2">
                <span>Get Started</span>
                <span>→</span>
              </div>
            )}
          </button>
        </form>

        {/* Footer Info */}
        <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          By continuing, you agree to share this information with the interview platform.
        </div>

        {/* Powered by */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center gap-3 text-base text-gray-600 dark:text-gray-300">
            <span>Powered by</span>
            <img src={openAgentsLogo} alt="OpenAgents" className="w-8 h-8" />
            <span className="text-lg font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              OpenAgents
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterviewHubLogin;
