/**
 * Welcome step - Introduction to the onboarding wizard
 */

import React from 'react';

interface WelcomeStepProps {
  networkName: string;
  onContinue: () => void;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ networkName, onContinue }) => {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-blue-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Welcome to {networkName}!
        </h2>
        <p className="text-lg text-gray-600">
          Let's get you set up with your AI agent network
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <h3 className="text-xl font-semibold mb-4">What you'll set up:</h3>
        <div className="space-y-4">
          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
              <span className="text-blue-600 font-semibold">1</span>
            </div>
            <div className="ml-4">
              <h4 className="font-semibold text-gray-900">Network Configuration</h4>
              <p className="text-gray-600 text-sm">
                Review your network settings and available features
              </p>
            </div>
          </div>

          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
              <span className="text-blue-600 font-semibold">2</span>
            </div>
            <div className="ml-4">
              <h4 className="font-semibold text-gray-900">Studio Access</h4>
              <p className="text-gray-600 text-sm">
                Learn how to access and navigate OpenAgents Studio
              </p>
            </div>
          </div>

          <div className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
              <span className="text-blue-600 font-semibold">3</span>
            </div>
            <div className="ml-4">
              <h4 className="font-semibold text-gray-900">Connect Your First Agent</h4>
              <p className="text-gray-600 text-sm">
                Get started with easy agent connection options
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
        <div className="flex items-center">
          <svg
            className="w-5 h-5 text-blue-500 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-blue-700 font-medium">
            Estimated time: ~3 minutes
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onContinue}
          className="px-8 py-3 bg-blue-500 text-white font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
        >
          Get Started
        </button>
      </div>
    </div>
  );
};

export default WelcomeStep;
