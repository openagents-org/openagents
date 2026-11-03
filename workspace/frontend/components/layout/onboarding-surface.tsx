'use client';

import { createContext, useContext } from 'react';

/** The shell follows the surface actually rendered, including seeded Welcome threads. */
export const OnboardingSurfaceContext = createContext<{ active: boolean; onDismiss?: () => void }>({ active: false });
export function useOnboardingSurface() { return useContext(OnboardingSurfaceContext).active; }

export function useDismissOnboarding() { return useContext(OnboardingSurfaceContext).onDismiss; }
