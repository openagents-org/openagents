/**
 * Service for managing onboarding progress in localStorage
 */

export interface OnboardingProgress {
  networkId: string;           // Unique network identifier
  startedAt: string;           // ISO timestamp
  completedAt: string | null;  // ISO timestamp or null
  currentStep: number;         // 1-5
  stepsCompleted: {
    welcome: boolean;
    networkConfig: boolean;
    studioAccess: boolean;
    agentConnection: boolean;
    completion: boolean;
  };
  skipped: boolean;            // True if user clicked "Skip Wizard"
}

const STORAGE_KEY = 'openagents_onboarding_progress';

export class OnboardingStorage {
  /**
   * Get onboarding progress for a specific network
   */
  static getProgress(networkId: string): OnboardingProgress | null {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${networkId}`);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (error) {
      console.error('Failed to get onboarding progress:', error);
      return null;
    }
  }

  /**
   * Save onboarding progress
   */
  static saveProgress(progress: OnboardingProgress): void {
    try {
      localStorage.setItem(
        `${STORAGE_KEY}_${progress.networkId}`,
        JSON.stringify(progress)
      );
    } catch (error) {
      console.error('Failed to save onboarding progress:', error);
    }
  }

  /**
   * Initialize new onboarding progress
   */
  static initializeProgress(networkId: string): OnboardingProgress {
    const progress: OnboardingProgress = {
      networkId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentStep: 1,
      stepsCompleted: {
        welcome: false,
        networkConfig: false,
        studioAccess: false,
        agentConnection: false,
        completion: false,
      },
      skipped: false,
    };
    this.saveProgress(progress);
    return progress;
  }

  /**
   * Mark onboarding as completed
   */
  static completeOnboarding(networkId: string): void {
    const progress = this.getProgress(networkId);
    if (progress) {
      progress.completedAt = new Date().toISOString();
      progress.currentStep = 5;
      progress.stepsCompleted.completion = true;
      this.saveProgress(progress);
    }
  }

  /**
   * Mark onboarding as skipped
   */
  static skipOnboarding(networkId: string): void {
    const progress = this.getProgress(networkId);
    if (progress) {
      progress.skipped = true;
      progress.completedAt = new Date().toISOString();
      this.saveProgress(progress);
    }
  }

  /**
   * Update current step
   */
  static updateStep(networkId: string, step: number): void {
    const progress = this.getProgress(networkId);
    if (progress) {
      progress.currentStep = step;
      this.saveProgress(progress);
    }
  }

  /**
   * Mark a step as completed
   */
  static completeStep(networkId: string, stepName: keyof OnboardingProgress['stepsCompleted']): void {
    const progress = this.getProgress(networkId);
    if (progress) {
      progress.stepsCompleted[stepName] = true;
      this.saveProgress(progress);
    }
  }

  /**
   * Check if onboarding should be shown
   */
  static shouldShowOnboarding(networkId: string): boolean {
    const progress = this.getProgress(networkId);
    if (!progress) return true; // First time
    if (progress.completedAt) return false; // Already completed
    return true; // In progress
  }

  /**
   * Reset onboarding progress (for testing)
   */
  static resetProgress(networkId: string): void {
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${networkId}`);
    } catch (error) {
      console.error('Failed to reset onboarding progress:', error);
    }
  }
}
