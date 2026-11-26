import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The guest link's token is the page URL: never send it on as a Referer, and
// keep shared threads out of search results.
export const metadata: Metadata = {
  title: 'Shared thread · OpenAgents',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function GuestThreadLayout({ children }: { children: ReactNode }) {
  return children;
}
