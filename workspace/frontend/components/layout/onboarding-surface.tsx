'use client';

import { createContext, useContext } from 'react';

/** The shell follows the surface actually rendered, including seeded Welcome threads. */
export const OnboardingSurfaceContext = createContext<{
  active: boolean;
  welcome?: boolean;
  welcomeAvailable?: boolean;
  onOpenWelcome?: () => void;
  onOpenConnect?: () => void;
  onDismiss?: () => void;
}>({ active: false });
export function useOnboardingSurface() { return useContext(OnboardingSurfaceContext).active; }
export function useWelcomeSurface() { return useContext(OnboardingSurfaceContext).welcome === true; }
export function useOpenConnect() { return useContext(OnboardingSurfaceContext).onOpenConnect; }
export function useWelcomeNavigation() {
  const surface = useContext(OnboardingSurfaceContext);
  return { available: surface.welcomeAvailable ?? surface.welcome === true, open: surface.onOpenWelcome };
}

export function useDismissOnboarding() { return useContext(OnboardingSurfaceContext).onDismiss; }
