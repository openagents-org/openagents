import type { Metadata } from 'next';
import { JamSetup } from '@/components/share/jam-setup';

export const metadata: Metadata = {
  title: 'Set up your jam · OpenAgents',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function JamSetupPage() {
  return <JamSetup />;
}
