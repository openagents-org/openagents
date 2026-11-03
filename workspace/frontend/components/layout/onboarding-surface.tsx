'use client';

import { createContext, useContext } from 'react';

/** The shell follows the surface actually rendered, including seeded Welcome threads. */
export const OnboardingSurfaceContext = createContext(false);
export function useOnboardingSurface() { return useContext(OnboardingSurfaceContext); }
