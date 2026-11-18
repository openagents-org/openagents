'use client';
import { WifiOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';

/**
 * What to do about a device that stopped checking in. The connector on it
 * recovers by itself after a network drop or a wake from sleep, so the steps
 * cover what it cannot fix: the app closed, the connector stopped, or the
 * device joined to a different workspace. Shown under the device's last
 * reported agents, which is all the workspace knows until it is back.
 */
export function NodeOfflineHelp() {
  const t = useT();
  const { workspace } = useWorkspace();
  const steps = [
    t('connect.nodeOfflineStepOpen'),
    t('connect.nodeOfflineStepConnector'),
    t('connect.nodeOfflineStepWorkspace', { workspace: workspace?.name || t('nav.workspaceFallback') }),
  ];
  return (
    <Alert data-testid="node-offline-help">
      <WifiOff className="text-warning" />
      <AlertTitle>{t('connect.nodeOfflineTitle')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5 text-xs">
        <p>{t('connect.nodeOfflineActionHint')}</p>
        <ol className="flex list-decimal flex-col gap-0.5 ps-4">
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p>{t('connect.nodeOfflineStayOnline')}</p>
      </AlertDescription>
    </Alert>
  );
}
