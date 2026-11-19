'use client';
import { useEffect } from 'react';
import { Trash2, MessageSquare, Image as ImageIcon, Volume2, ChevronLeft } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useTokenPayModels } from '@/hooks/use-tokenpay-models';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { HostedAgentsSection } from './hosted-agents-section';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel, FieldSeparator, FieldTitle } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { CloudAgentConfig, CloudAgentProvider } from '@/lib/types';
import { ProviderIcon } from '@/components/icons/agent-icons';
import {
SelectGroup,Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from '@/components/ui/select';

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = category === 'image' ? ImageIcon : category === 'audio' ? Volume2 : MessageSquare;
  return <Icon className={cn('text-foreground/70', className)} />;
}

// ---------------------------------------------------------------------------
// Cloud Agents Tab
// ---------------------------------------------------------------------------

export function CloudAgentsTab({
  providers,
  cloudAgents,
  selectedProvider,
  selectedProviderInfo,
  isCustomProvider,
  workspaceId,
  onSelectProvider,
  cfgModel,
  setCfgModel,
  cfgName,
  setCfgName,
  cfgKey,
  setCfgKey,
  cfgBaseUrl,
  setCfgBaseUrl,
  cfgPrompt,
  setCfgPrompt,
  showAdvanced,
  setShowAdvanced,
  saving,
  onAdd,
  onRemove,
  onHostedChanged,
}: {
  providers: CloudAgentProvider[];
  cloudAgents: CloudAgentConfig[];
  selectedProvider: string | null;
  selectedProviderInfo: CloudAgentProvider | undefined;
  isCustomProvider: boolean;
  workspaceId: string;
  onSelectProvider: (name: string | null) => void;
  cfgModel: string;
  setCfgModel: (v: string) => void;
  cfgName: string;
  setCfgName: (v: string) => void;
  cfgKey: string;
  setCfgKey: (v: string) => void;
  cfgBaseUrl: string;
  setCfgBaseUrl: (v: string) => void;
  cfgPrompt: string;
  setCfgPrompt: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  saving: boolean;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onHostedChanged: () => void;
}) {
  const t = useT();
  const isTokenPay = selectedProvider === 'tokenpay';
  const tokenPay = useTokenPayModels(isTokenPay, cfgKey);

  useEffect(() => {
    if (!isTokenPay) return;
    const first = tokenPay.models[0];
    setCfgModel(first?.id || '');
    if (first) setCfgName(first.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64));
  }, [isTokenPay, tokenPay.models, setCfgModel, setCfgName]);

  const connectedAgents = cloudAgents.filter((agent) => !agent.managed && agent.provider !== 'openagents');

  // When a provider is selected, show config view instead of grid
  if (selectedProviderInfo) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-7">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={() => onSelectProvider(null)} className="self-start text-muted-foreground">
          <ChevronLeft data-icon="inline-start" />
          {t('connect.allProviders')}
        </Button>

        <Card className="animate-in fade-in slide-in-from-top-2 duration-200">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2.5">
              <ProviderIcon name={selectedProviderInfo.name} size={32} />
              {selectedProviderInfo.label}
            </CardTitle>
            <CardDescription>
              {isCustomProvider ? t('connect.customSubtitle') : t('connect.providerSubtitle')}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {isTokenPay && (
              <Field>
                <FieldLabel htmlFor="tokenpay-key">{t('connect.apiKey')}</FieldLabel>
                <Input id="tokenpay-key" type="password" autoComplete="off" value={cfgKey}
                  onChange={(e) => setCfgKey(e.target.value)} placeholder={t('connect.apiKeyPlaceholder')}
                  className="text-sm font-mono h-9" />
                <FieldDescription>
                  {t('connect.tokenpayKeyHint')}{' '}
                  <a href="https://tokendance.space/keys" target="_blank" rel="noopener noreferrer" className="underline">{t('connect.tokenpayGetKey')}</a>
                </FieldDescription>
                {tokenPay.loading && <p className="text-xs text-muted-foreground">{t('connect.byokLoadingModels')}</p>}
                {tokenPay.error && <p className="text-xs text-destructive">{tokenPay.error}</p>}
              </Field>
            )}
            {/* Custom endpoint: Base URL */}
            {isCustomProvider && (
              <Field>
                <FieldLabel htmlFor="cloud-base-url">{t('connect.endpointUrl')}</FieldLabel>
                <Input
                  id="cloud-base-url"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="text-sm font-mono h-9"
                />
                <FieldDescription>{t('connect.endpointHint')}</FieldDescription>
              </Field>
            )}

            {/* Model selector — list for known providers, text input for custom */}
            {isTokenPay ? (
              <Field>
                <FieldLabel>{t('connect.model')}</FieldLabel>
                <Select value={cfgModel || undefined} onValueChange={(id) => {
                  setCfgModel(id);
                  setCfgName(id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64));
                }} disabled={tokenPay.loading || tokenPay.models.length === 0}>
                  <SelectTrigger className="h-9 w-full"><SelectValue placeholder={t('connect.byokChooseModel')} /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>{tokenPay.models.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}</SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : isCustomProvider ? (
              <Field>
                <FieldLabel htmlFor="cloud-model">{t('connect.modelName')}</FieldLabel>
                <Input
                  id="cloud-model"
                  value={cfgModel}
                  onChange={(e) => setCfgModel(e.target.value)}
                  placeholder={t('connect.modelNamePlaceholder')}
                  className="text-sm font-mono h-9"
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel>{t('connect.model')}</FieldLabel>
                {/* Choice cards: the whole row picks the radio inside it. */}
                <RadioGroup value={cfgModel} onValueChange={setCfgModel} className="gap-1.5">
                  {selectedProviderInfo.models.map((m) => (
                    <FieldLabel key={m.id} htmlFor={`cloud-model-${m.id}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem value={m.id} id={`cloud-model-${m.id}`} />
                        <CategoryIcon category={m.category} className="size-3.5 shrink-0" />
                        <FieldTitle className="flex-1">{m.label}</FieldTitle>
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">{m.category}</span>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              </Field>
            )}

            {/* Google OAuth option */}
            {selectedProvider === 'google' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    // Fetch with auth headers, then navigate — the workspace
                    // token must never ride in a URL (server logs, history).
                    try {
                      const { url } = await workspaceApi.getGoogleOAuthUrl(
                        cfgName || 'gemini',
                        cfgModel || 'gemini-3.5-flash',
                      );
                      window.location.assign(url);
                    } catch {
                      toast.error(t('connect.googleAuthFailed'));
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" data-icon="inline-start" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {t('connect.signInWithGoogle')}
                </Button>
                <FieldSeparator>{t('connect.orUseApiKey')}</FieldSeparator>
              </>
            )}

            {/* Agent name */}
            <Field>
              <FieldLabel htmlFor="cloud-name">{t('connect.agentName')}</FieldLabel>
              <Input
                id="cloud-name"
                value={cfgName}
                onChange={(e) => setCfgName(e.target.value)}
                placeholder={t('connect.agentNamePlaceholder')}
                className="text-sm h-9"
              />
              <FieldDescription>{t('connect.agentNameHint')}</FieldDescription>
            </Field>

            {/* API Key */}
            {!isTokenPay && <Field>
              <FieldLabel htmlFor="cloud-key">{t('connect.apiKey')}</FieldLabel>
              <Input
                id="cloud-key"
                type="password"
                value={cfgKey}
                onChange={(e) => setCfgKey(e.target.value)}
                placeholder={t('connect.apiKeyPlaceholder')}
                className="text-sm font-mono h-9"
              />
            </Field>}

            {/* Advanced */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="link" size="xs" className="h-auto px-0 text-muted-foreground">
                  {showAdvanced ? t('connect.hideAdvanced') : t('connect.showAdvanced')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Field className="mt-2">
                  <FieldLabel htmlFor="cloud-prompt">{t('connect.systemPrompt')}</FieldLabel>
                  <Textarea
                    id="cloud-prompt"
                    value={cfgPrompt}
                    onChange={(e) => setCfgPrompt(e.target.value)}
                    placeholder={t('connect.systemPromptPlaceholder')}
                  />
                </Field>
              </CollapsibleContent>
            </Collapsible>

            {/* Add button */}
            <Button
              onClick={onAdd}
              disabled={saving || !cfgName || !cfgKey || !cfgModel || (isCustomProvider && !cfgBaseUrl) || (isTokenPay && (tokenPay.loading || !!tokenPay.error))}
              className="w-full"
              size="sm"
            >
              {saving && <Spinner data-icon="inline-start" />}
              {t('connect.cloudAgentAddButton')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Grid view — no provider selected
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-7">
      <div>
        <h2 className="text-lg font-semibold">{t('connect.cloudMarketplaceTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('connect.cloudMarketplaceHint')}</p>
      </div>
      <HostedAgentsSection onChanged={onHostedChanged} />

      {/* Connected cloud agents */}
      {connectedAgents.length > 0 && (
        <ItemGroup className="gap-2">
          <FieldSeparator>{t('connect.connected')}</FieldSeparator>
          {connectedAgents.map((agent) => (
            <Item key={agent.agentName} variant="outline" size="sm" role="listitem">
              <ItemMedia>
                <ProviderIcon name={agent.provider} size={28} />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle>
                  @{agent.agentName}
                  <CategoryIcon category={agent.category} className="size-3 text-muted-foreground" />
                </ItemTitle>
                <ItemDescription className="text-xs">{agent.model}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <span className="font-mono text-xs text-muted-foreground">{agent.apiKeyMasked}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(agent.agentName)}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t('connect.remove')}
                  aria-label={t('connect.remove')}
                >
                  <Trash2 />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
