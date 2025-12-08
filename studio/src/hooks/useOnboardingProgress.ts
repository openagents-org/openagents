/**
 * Hook for managing onboarding progress
 */

import { useState, useEffect } from 'react';
import { OnboardingStorage, OnboardingProgress } from '@/services/onboardingStorage';

export const useOnboardingProgress = (networkId: string) => {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!networkId) return;

    // Load or initialize progress
    let currentProgress = OnboardingStorage.getProgress(networkId);
    if (!currentProgress) {
      currentProgress = OnboardingStorage.initializeProgress(networkId);
    }
    setProgress(currentProgress);
    setLoading(false);
  }, [networkId]);

  const updateStep = (step: number) => {
    if (!networkId) return;
    OnboardingStorage.updateStep(networkId, step);
    const updated = OnboardingStorage.getProgress(networkId);
    setProgress(updated);
  };

  const completeStep = (stepName: keyof OnboardingProgress['stepsCompleted']) => {
    if (!networkId) return;
    OnboardingStorage.completeStep(networkId, stepName);
    const updated = OnboardingStorage.getProgress(networkId);
    setProgress(updated);
  };

  const completeOnboarding = () => {
    if (!networkId) return;
    OnboardingStorage.completeOnboarding(networkId);
    const updated = OnboardingStorage.getProgress(networkId);
    setProgress(updated);
  };

  const skipOnboarding = () => {
    if (!networkId) return;
    OnboardingStorage.skipOnboarding(networkId);
    const updated = OnboardingStorage.getProgress(networkId);
    setProgress(updated);
  };

  const resetProgress = () => {
    if (!networkId) return;
    OnboardingStorage.resetProgress(networkId);
    const newProgress = OnboardingStorage.initializeProgress(networkId);
    setProgress(newProgress);
  };

  return {
    progress,
    loading,
    updateStep,
    completeStep,
    completeOnboarding,
    skipOnboarding,
    resetProgress,
  };
};
