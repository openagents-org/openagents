import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'My rooms · OpenAgents',
  robots: { index: false, follow: false },
};

export default function RoomsLayout({ children }: { children: ReactNode }) {
  return children;
}
