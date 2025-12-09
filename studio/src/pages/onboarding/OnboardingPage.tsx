/**
 * Main Onboarding page - Wizard container
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useNetworkContext } from '@/context/NetworkContext';
import { useOnboardingProgress } from '@/hooks/useOnboardingProgress';
import { OnboardingProgress } from '@/services/onboardingStorage';
import { useIsAdmin } from '@/hooks/useIsAdmin';
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
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();

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
    navigate('/profile');
  };

  const handleSkip = () => {
    skipOnboarding();
    navigate('/profile');
  };

  // Check admin access
  if (isAdminLoading) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
          <div className="flex items-center">
            <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-400">Admin Access Required</h3>
              <p className="text-yellow-700 dark:text-yellow-500 mt-1">
                The onboarding wizard is only accessible to network administrators.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !networkData) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Network Setup Wizard</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Guide users through network configuration</p>
          </div>
        </div>
        <ExitButton onSkip={handleSkip} />
      </div>

      {/* Progress Indicator */}
      <ProgressIndicator currentStep={currentStep} />

      {/* Main Content */}
      <div className="max-w-5xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 min-h-[500px]">{currentStep === 1 && (
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
    </div>
  );
};

export default OnboardingPage;
