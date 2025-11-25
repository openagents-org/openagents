import React from "react";
import LocalNetwork from "../components/network/LocalNetwork";
import ManualNetwork from "../components/network/ManualNetwork";

const NetworkSelectionPage: React.FC = () => {
  const Header = React.memo(() => {
    return (
      <div className="bg-gradient-to-r from-blue-600 to-indigo-500 p-8 text-white">
        <div className="flex items-center justify-center mb-4">
          <div className="w-16 h-16 mr-4 bg-white rounded-lg flex items-center justify-center">
            <span className="text-2xl font-bold text-blue-600">📄</span>
          </div>
          <h1 className="text-4xl font-bold">OpenAgents Documents Mod</h1>
        </div>
        <p className="text-center text-lg opacity-90">
          Connect to an OpenAgents network to collaborate on shared documents
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
        </div>
      </div>
    </div>
  );
};

export default NetworkSelectionPage;

