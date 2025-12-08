/**
 * Main Onboarding page - Wizard container
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useNetworkContext } from '@/context/NetworkContext';
import { useOnboardingProgress } from '@/hooks/useOnboardingProgress';
import { OnboardingProgress } from '@/services/onboardingStorage';
import ProgressIndicator from './components/ProgressIndicator';
import ExitButton from './components/ExitButton';
import WelcomeStep from './components/WelcomeStep';
import NetworkConfigStep from './components/NetworkConfigStep';
import StudioAccessStep from './components/StudioAccessStep';
import AgentConnectionStep from './components/AgentConnectionStep';
import CompletionStep from './components/CompletionStep';

interface NetworkSummary {
  name: string;
  description: string;
  network_id: string;
  transports: {
    http?: { enabled: boolean; port: number };
    grpc?: { enabled: boolean; port: number };
  };
  mods: string[];
  studio_enabled: boolean;
}

const OnboardingPage: React.FC = () => {
  const navigate = useNavigate();
  const networkContext = useNetworkContext();
  const [currentStep, setCurrentStep] = useState(1);
  const [networkData, setNetworkData] = useState<NetworkSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Get network ID from context or use default
  const networkId = networkContext?.networkId || 'local_network';
  const networkHost = networkContext?.networkHost || 'localhost';
  const networkPort = networkContext?.networkPort || 8700;

  const {
    progress,
    updateStep,
    completeStep,
    completeOnboarding,
    skipOnboarding,
  } = useOnboardingProgress(networkId);

  useEffect(() => {
    // Fetch network summary
    const fetchNetworkData = async () => {
      try {
        const response = await axios.get(
          `http://${networkHost}:${networkPort}/api/network/summary`
        );
        if (response.data.success) {
          setNetworkData(response.data.data);
        }
      } catch (error) {
        console.error('Failed to fetch network summary:', error);
        // Use fallback data
        setNetworkData({
          name: 'OpenAgents Network',
          description: '',
          network_id: networkId,
          transports: {
            http: { enabled: true, port: networkPort },
          },
          mods: [],
          studio_enabled: true,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchNetworkData();
  }, [networkHost, networkPort, networkId]);

  // Step names corresponding to progress.stepsCompleted keys
  const STEP_NAMES: Array<keyof OnboardingProgress['stepsCompleted']> = [
    'welcome',
    'networkConfig',
    'studioAccess',
    'agentConnection',
    'completion',
  ];

  useEffect(() => {
    // Sync current step with progress
    if (progress) {
      setCurrentStep(progress.currentStep);
    }
  }, [progress]);

  const handleNext = () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    updateStep(nextStep);

    // Mark current step as completed
    if (currentStep > 0 && currentStep <= STEP_NAMES.length) {
      completeStep(STEP_NAMES[currentStep - 1]);
    }
  };

  const handleBack = () => {
    const prevStep = Math.max(1, currentStep - 1);
    setCurrentStep(prevStep);
    updateStep(prevStep);
  };

  const handleFinish = () => {
    completeOnboarding();
    navigate('/messaging');
  };

  const handleSkip = () => {
    skipOnboarding();
  };

  if (loading || !networkData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center">
            <svg
              className="w-8 h-8 text-blue-500 mr-3"
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
            <div>
              <h1 className="text-xl font-bold text-gray-900">OpenAgents Setup</h1>
              <p className="text-sm text-gray-600">Get started with your network</p>
            </div>
          </div>
          <ExitButton onSkip={handleSkip} />
        </div>
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator currentStep={currentStep} />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-lg p-8 min-h-[500px]">
          {currentStep === 1 && (
            <WelcomeStep
              networkName={networkData.name}
              onContinue={handleNext}
            />
          )}

          {currentStep === 2 && (
            <NetworkConfigStep
              networkData={networkData}
              onBack={handleBack}
              onContinue={handleNext}
            />
          )}

          {currentStep === 3 && (
            <StudioAccessStep
              httpPort={networkData.transports.http?.port || networkPort}
              onBack={handleBack}
              onContinue={handleNext}
            />
          )}

          {currentStep === 4 && (
            <AgentConnectionStep
              httpPort={networkData.transports.http?.port || networkPort}
              networkPath={networkContext?.workspacePath || './my_network'}
              onBack={handleBack}
              onContinue={handleNext}
            />
          )}

          {currentStep === 5 && (
            <CompletionStep
              networkName={networkData.name}
              onFinish={handleFinish}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-gray-500 text-sm">
        <p>Need help? Visit our{' '}
          <a
            href="https://openagents.org/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            documentation
          </a>
          {' '}or join our{' '}
          <a
            href="https://discord.gg/openagents"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            Discord community
          </a>
        </p>
      </div>
    </div>
  );
};

export default OnboardingPage;
