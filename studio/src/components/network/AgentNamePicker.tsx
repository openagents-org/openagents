import React, { useState, useEffect, useCallback } from "react";
import {
  getSavedAgentNameForNetwork,
  saveAgentNameForNetwork,
} from "@/utils/cookies";
import {
  generateRandomAgentName,
  isValidName,
  getAvatarInitials,
} from "@/utils/utils";
import { useNetworkStore } from "@/stores/networkStore";

const AgentNamePicker: React.FC = () => {
  const { selectedNetwork, setAgentName, clearAgentName, clearNetwork } =
    useNetworkStore();

  const [pageAgentName, setPageAgentName] = useState<string | null>(null);
  const [savedAgentName, setSavedAgentName] = useState<string | null>(null);

  const handleRandomize = useCallback(() => {
    setPageAgentName(generateRandomAgentName());
  }, [setPageAgentName]);

  useEffect(() => {
    if (!selectedNetwork) return;
    // Check for saved agent name for this network
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

  const onBack = useCallback(() => {
    clearAgentName();
    clearNetwork();
  }, [clearAgentName, clearNetwork]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const agentNameTrimmed = pageAgentName?.trim();
    if (!agentNameTrimmed || !selectedNetwork) return;
    // Save the agent name for this network
    saveAgentNameForNetwork(
      selectedNetwork.host,
      selectedNetwork.port,
      agentNameTrimmed
    );
    setAgentName(agentNameTrimmed);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-5 bg-gradient-to-br from-indigo-400 to-purple-500 dark:from-blue-800 dark:to-violet-800">
      <div className="max-w-lg w-full text-center rounded-2xl p-10 bg-white shadow-2xl shadow-black/25 dark:bg-gray-800 dark:shadow-black/50">
        {/* Header */}
        <div className="mb-8">
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
        <div className="rounded-xl p-4 my-6 text-left bg-gray-100 dark:bg-gray-700">
          <div className="text-xs font-semibold uppercase tracking-wide mb-1 text-gray-500 dark:text-gray-400">
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
          <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-xl p-4 my-6 text-left">
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

        {/* Features List */}
        <div className="text-left rounded-lg p-4 my-6 bg-slate-50 dark:bg-slate-900">
          <h4 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-200">
            Available Features:
          </h4>
          <div className="flex items-center gap-2 text-xs mb-1.5 text-gray-500 dark:text-gray-400">
            <span className="text-emerald-500 font-bold">✓</span>
            <span>Thread messaging with 5-level nesting</span>
          </div>
          <div className="flex items-center gap-2 text-xs mb-1.5 text-gray-500 dark:text-gray-400">
            <span className="text-emerald-500 font-bold">✓</span>
            <span>Channel-based communication</span>
          </div>
          <div className="flex items-center gap-2 text-xs mb-1.5 text-gray-500 dark:text-gray-400">
            <span className="text-emerald-500 font-bold">✓</span>
            <span>Direct messaging with other agents</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="text-emerald-500 font-bold">✓</span>
            <span>File sharing and reactions</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="my-8">
          <div className="mb-6 text-left">
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
            <div className="flex gap-2 mt-2">
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
              Agent names must be 3-32 characters and contain only letters,
              numbers, underscores, and hyphens.
              {savedAgentName && (
                <>
                  <br />
                  💾 Your name will be automatically saved for this network.
                </>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button
              type="button"
              onClick={onBack}
              className="flex-1 px-6 py-3 border rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:bg-gray-600 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-500 dark:hover:text-gray-50"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={!isValidName(pageAgentName)}
              className={`flex-[2] px-6 py-3 border-none rounded-lg text-base font-semibold cursor-pointer transition-all duration-150 text-white ${
                !isValidName(pageAgentName)
                  ? "bg-gray-300 dark:bg-gray-500 cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-500/30"
              }`}
            >
              <div className="flex flex-wrap justify-center">
                Connect as&nbsp;
                <span>{pageAgentName || "Agent"} →</span>
              </div>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentNamePicker;
