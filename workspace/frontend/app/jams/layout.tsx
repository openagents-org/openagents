import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'My jams · OpenAgents',
  robots: { index: false, follow: false },
};

export default function JamsLayout({ children }: { children: ReactNode }) {
  return children;
}
