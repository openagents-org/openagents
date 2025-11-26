import React from "react";
import OpenAgentsLogo from "@/assets/images/openagents-logo-trans-white.png";
import LocalNetwork from "@/components/network/LocalNetwork";
import ManualNetwork from "@/components/network/ManualNetwork";
import InterviewHubLogin from "@/components/interview/InterviewHubLogin";
import { isInterviewHubMode } from "@/config/interviewHubConfig";

const NetworkSelectionView: React.FC = () => {
  // Check if Interview Hub mode is enabled
  if (isInterviewHubMode()) {
    return <InterviewHubLogin />;
  }
  const Header = React.memo(() => {
    return (
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
        <div className="flex items-center justify-center mb-4">
          <img
            src={OpenAgentsLogo}
            alt="OpenAgents Logo"
            className="w-16 h-16 mr-4"
          />
          <h1 className="text-4xl font-bold">OpenAgents Studio</h1>
        </div>
        <p className="text-center text-lg opacity-90">
          Connect to an OpenAgents network to start collaborating with AI agents
        </p>
      </div>
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        <Header />

        <div className="p-8">
          <LocalNetwork />

          <ManualNetwork />

          {/* <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-200">
              Public Networks
            </h2>
            <button
              onClick={() => {}}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Go To Public Networks
            </button>
          </div> */}
        </div>
      </div>
    </div>
  );
};

export default NetworkSelectionView;
