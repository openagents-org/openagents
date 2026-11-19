'use client';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import type { PairingCode } from '@/lib/types';
import { OnboardingPairingPanel } from './onboarding-pairing-panel';

/**
 * Connecting another device, on a screen of its own: the device roster stays
 * out of the way while the pairing code waits to be redeemed.
 */
export function PairAnotherDevice({
  pairing,
  pairingError,
  pairingLoading,
  onBack,
  onGenerate,
}: {
  pairing: PairingCode | null;
  pairingError: boolean;
  pairingLoading: boolean;
  /** Leave for the device list, dropping the code. */
  onBack: () => void;
  onGenerate: () => void;
}) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-7">
      <Button variant="ghost" size="sm" disabled={pairingLoading} onClick={onBack} className="self-start text-muted-foreground">
        <ChevronLeft data-icon="inline-start" />{t('connect.nodeBack')}
      </Button>
      {pairing ? (
        <OnboardingPairingPanel
          pairing={pairing}
          onDismiss={onBack}
          onRegenerate={onGenerate}
          regenerating={pairingLoading}
          stepLabel={t('connect.connectAnotherDevice')}
        />
      ) : pairingError ? (
        <Empty role="alert" className="border">
          <EmptyHeader>
            <EmptyDescription>{t('connect.nodePairingFailed')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onGenerate}>{t('common.retry')}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Spinner />{t('connect.nodeGenerating')}
        </div>
      )}
    </div>
  );
}
