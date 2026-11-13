import type { Metadata } from 'next';

// The token is in this page's URL: no request the page makes — an image a
// shared document embeds, a link someone follows — may carry it as a Referer.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function SharedArtifactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
