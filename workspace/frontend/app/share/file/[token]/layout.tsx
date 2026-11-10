import type { Metadata } from 'next';

// The link's token is in this page's URL: nothing it loads or links to may
// receive it as a Referer.
export const metadata: Metadata = { referrer: 'no-referrer' };

export default function SharedFileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
