/**
 * Completion step - Congratulations and next steps
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

interface CompletionStepProps {
  networkName: string;
  onFinish: () => void;
}

const CompletionStep: React.FC<CompletionStepProps> = ({ networkName, onFinish }) => {
  const navigate = useNavigate();

  const handleFinish = () => {
    onFinish();
    navigate('/messaging');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
          <svg
            className="w-10 h-10 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h2 className="text-4xl font-bold text-gray-900 mb-4">
          🎉 You're All Set!
        </h2>
        <p className="text-lg text-gray-600">
          Your {networkName} is ready for action
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">What You've Set Up:</h3>
        <div className="space-y-3">
          <div className="flex items-center">
            <svg
              className="w-6 h-6 text-green-500 mr-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-gray-700">Explored your network configuration</span>
          </div>
          <div className="flex items-center">
            <svg
              className="w-6 h-6 text-green-500 mr-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-gray-700">Learned about Studio features</span>
          </div>
          <div className="flex items-center">
            <svg
              className="w-6 h-6 text-green-500 mr-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-gray-700">Understood how to connect agents</span>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Quick Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => navigate('/messaging')}
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all text-left border border-gray-200 group"
          >
            <div className="flex items-center mb-2">
              <svg
                className="w-6 h-6 text-blue-500 mr-2 group-hover:scale-110 transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <span className="font-semibold text-gray-900">Go to Studio</span>
            </div>
            <p className="text-gray-600 text-sm">Start chatting with agents</p>
          </button>

          <a
            href="https://openagents.org/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all text-left border border-gray-200 group"
          >
            <div className="flex items-center mb-2">
              <svg
                className="w-6 h-6 text-purple-500 mr-2 group-hover:scale-110 transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <span className="font-semibold text-gray-900">Documentation</span>
            </div>
            <p className="text-gray-600 text-sm">Learn more about OpenAgents</p>
          </a>

          <a
            href="https://discord.gg/openagents"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all text-left border border-gray-200 group"
          >
            <div className="flex items-center mb-2">
              <svg
                className="w-6 h-6 text-indigo-500 mr-2 group-hover:scale-110 transition-transform"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              <span className="font-semibold text-gray-900">Join Discord</span>
            </div>
            <p className="text-gray-600 text-sm">Connect with the community</p>
          </a>
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={handleFinish}
          className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all shadow-md hover:shadow-lg"
        >
          Start Using Studio
        </button>
      </div>
    </div>
  );
};

export default CompletionStep;
