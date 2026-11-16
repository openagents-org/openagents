'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';
import { getCampaignModels } from '@/lib/account-api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';

/** The gateway's base URL and the models it serves, each one copyable. */
export function CampaignHowtoCard({ gatewayUrl, idToken }: { gatewayUrl?: string; idToken: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const baseUrl = `${gatewayUrl}/v1`;

  // Loaded up front: the hint under the Base URL names what the gateway serves
  // right now. It used to be a fixed list, and when the gateway narrowed to one
  // model people kept configuring the ones the page still recommended.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    getCampaignModels(idToken)
      .then((r) => { if (!cancelled) setModels(r.models); })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [idToken]);

  const copyModel = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedModel(id);
      setTimeout(() => setCopiedModel((current) => (current === id ? null : current)), 1500);
    }, () => {});
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('campaign.howtoTitle')}</CardTitle>
        <CardDescription>{t('campaign.howtoBody')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
            {baseUrl}
          </code>
          <CopyButton value={baseUrl} title={t('campaign.howtoBaseUrl')} />
        </div>
        {models && models.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('campaign.howtoModels', { models: models.slice(0, 5).join(', ') })}
          </p>
        )}

        {/* Full model catalog, on demand */}
        <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
          <CollapsibleTrigger asChild>
            <Button variant="link" size="xs" className="h-auto self-start px-0">
              <ChevronDown data-icon="inline-start" className={cn('transition-transform', open && 'rotate-180')} />
              {open ? t('campaign.hideModels') : t('campaign.showAllModels')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-lg border bg-muted/30 p-3">
            {models === null ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Spinner />
              </div>
            ) : models.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t('campaign.modelsCount', { count: models.length })}</p>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {models.map((id) => (
                    <button
                      key={id}
                      onClick={() => copyModel(id)}
                      className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent"
                      title={id}
                    >
                      {copiedModel === id ? (
                        <Check className="size-3 shrink-0 text-success" />
                      ) : (
                        <Copy className="size-3 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className="truncate">{id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
