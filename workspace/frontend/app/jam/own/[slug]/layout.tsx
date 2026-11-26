import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The owner link carries the workspace token in its query string: never send
// it on as a Referer, and keep the page out of search results.
export const metadata: Metadata = {
  title: 'Your shared agent · OpenAgents',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function OwnerJamLayout({ children }: { children: ReactNode }) {
  return children;
}
