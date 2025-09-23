import React from "react";
import OpenAgentsLogo from "../icons/OpenAgentsLogo";
import LocalNetwork from "./LocalNetwork";
import ManualNetwork from "./ManualNetwork";
import PublicNetwork from "./PublicNetwork";

const NetworkSelectionView: React.FC = () => {
  const Header = React.memo(() => {
    return (
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
        <div className="flex items-center justify-center mb-4">
          <OpenAgentsLogo className="w-16 h-16 mr-4" />
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

          <PublicNetwork />
        </div>
      </div>
    </div>
  );
};

export default NetworkSelectionView;
