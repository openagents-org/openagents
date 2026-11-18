'use client';
import { agentDisplayName } from './agent-display-name';
import React from 'react';
import { AlertCircle, ArrowRight, ChevronLeft, ExternalLink, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { AgentIcon } from '@/components/icons/agent-icons';
import { useT } from '@/lib/i18n';
import type { AgentCatalogEntry } from '@/lib/types';
import type { AgentSetupProps } from './agent-setup-types';
import { RuntimeStatusBadge } from './agent-setup-status-hint';
import { AgentSetupWizard } from './agent-setup-wizard';
import { AgentSetupFormBody } from './agent-setup-form-body';
import type { AgentSetupForm } from './use-agent-setup-form';

/**
 * A focused, full-view form for the chosen agent, in three bands: which agent
 * this is (fixed), the form (the only part that scrolls) and the actions
 * (fixed). On one long scrolling page a long form carried the agent it
 * configured, and its Save button, out of sight.
 */
export function AgentSetupConfigView({ form, props, entry, onSubmit }: { form: AgentSetupForm; props: AgentSetupProps; entry: AgentCatalogEntry; onSubmit: () => void }) {
  const t = useT();
  const { node, extensions, editAgent, contextLabel, onBack } = props;
  const { isEdit, busy, error, selectedStatus, signIn, creds, startType, backToSelection } = form;
  const compact = !!extensions?.compact;
  // A button beside "Needs login", not a bare link: it is the one thing to do
  // about that state.
  const signInLink = signIn && (
    <Button type="button" variant="outline" size="sm" onClick={signIn} className="shrink-0">
      {t('connect.agentSignIn')}<ArrowRight data-icon="inline-end" />
    </Button>
  );
  const saveButton = (
    <Button data-testid="agent-setup-submit" size={compact ? 'lg' : undefined} onClick={onSubmit} disabled={busy || !form.name.trim() || extensions?.disabled} className={compact ? 'w-full' : 'shrink-0'}>
      {busy ? <Spinner data-icon="inline-start" /> : !isEdit && (!extensions?.headerActions || compact) && <Plus data-icon="inline-start" />}
      {isEdit ? t('connect.nodeSaveChanges') : creds.signInUnconfirmed && creds.credsError ? t('connect.agentAddAnyway') : t('connect.agentAddTitle')}
    </Button>
  );
  const errorText = (className?: string) => <Alert variant="destructive" className={className}><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>;
  const body = <AgentSetupFormBody form={form} props={props} />;

  if (extensions?.guided && !isEdit && !compact && !extensions.configuration) {
    return <AgentSetupWizard form={form} props={props} entry={entry} onSubmit={onSubmit} />;
  }

  // ---- Desktop layout: breadcrumb, title, the form beside an info column,
  // and its actions at the bottom of the form.
  if (compact) {
    // Opened on a type (the launcher always does), the way back is to the page
    // that opened it — there is no type list behind this form to return to.
    const leave = isEdit || startType ? onBack : backToSelection;
    const title = t('connect.agentConfigure', { name: isEdit ? editAgent!.displayName || editAgent!.name : agentDisplayName(entry) });
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-9 pt-6">
            <div className="flex flex-col gap-1">
              {/* Same lead-in as the type picker before it: an explicit way back,
                  not only the breadcrumb's first step. */}
              <nav className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button variant="ghost" size="sm" onClick={leave} disabled={busy} className="-ml-2">
                  <ChevronLeft data-icon="inline-start" />{t('connect.nodeBack')}
                </Button>
                <Separator orientation="vertical" className="mx-1 data-vertical:h-4" />
                <Button variant="link" size="sm" onClick={leave} disabled={busy} className="h-auto px-0 font-normal text-muted-foreground hover:text-foreground">
                  {extensions?.breadcrumbRoot || t('connect.nodeBackToAgents')}
                </Button>
                <span aria-hidden>/</span>
                <span className="text-foreground">{title}</span>
              </nav>
              <div className="mt-2 flex items-center gap-2">
                <h1 className="truncate font-heading text-2xl font-semibold tracking-tight">{title}</h1>
                <RuntimeStatusBadge status={selectedStatus} />
                {signInLink}
              </div>
              <p className="text-sm text-muted-foreground">
                {isEdit ? contextLabel : t('connect.compactFormSubtitle')}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-5">
                {body}
                {error && errorText()}
                {/* The actions close the form, splitting the full width of its
                    column, and stay in view at the bottom while it scrolls:
                    users who signed in and saw no Add button went back
                    without ever scrolling down to it. */}
                <div data-testid="agent-setup-actions" className="sticky bottom-0 z-10 grid grid-cols-2 gap-4 border-t bg-background pt-4 pb-6">
                  <Button variant="outline" size="lg" className="w-full" onClick={leave} disabled={busy}>
                    {t('connect.compactCancel')}
                  </Button>
                  {saveButton}
                </div>
              </div>
              {extensions?.aside && form.selected && (
                <aside className="min-w-0 lg:border-l lg:pl-6">{extensions.aside({ type: form.selected })}</aside>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const back = isEdit ? onBack : backToSelection;
  const backLabel = isEdit ? t('connect.nodeBack') : t('connect.nodeBackToAgents');
  const backButton = (
    <Button variant="ghost" onClick={back} disabled={busy} className="shrink-0">
      {!extensions?.headerActions && <ChevronLeft data-icon="inline-start" />}{backLabel}
    </Button>
  );
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-4 sm:px-6">
          {/* A way back at the top too: the footer's Back sits below a long
              form, out of sight when the page opens. */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button variant="link" size="sm" onClick={back} disabled={busy} className="h-auto shrink-0 px-0">
              <ChevronLeft data-icon="inline-start" />{backLabel}
            </Button>
            <Separator orientation="vertical" className="mx-1 data-vertical:h-4" />
            <span className="min-w-0 truncate">{contextLabel || t('connect.agentRunsOn', { device: node.name })}</span>
          </div>

          {/* Agent hero */}
          <div className="flex items-center gap-4">
            <AgentIcon name={entry.name} size={56} className="shadow-sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-base font-semibold">{isEdit ? t('connect.agentConfigure', { name: editAgent!.displayName || editAgent!.name }) : agentDisplayName(entry)}</h3>
                <RuntimeStatusBadge status={selectedStatus} />
                {/* Beside "Needs login" the link is the sign-in itself where the
                    host can run it; otherwise it is labelled as docs, because a
                    bare arrow there reads as "sign in here". */}
                {signInLink || entry.homepage && (
                  <Button variant="link" size="xs" asChild className="h-auto px-0 text-muted-foreground hover:text-primary">
                    <a href={entry.homepage} target="_blank" rel="noopener noreferrer" title={entry.homepage}>
                      {t('connect.agentDocs')}<ExternalLink data-icon="inline-end" />
                    </a>
                  </Button>
                )}
              </div>
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
            </div>
            {extensions?.headerActions && (
              <div className="flex shrink-0 items-center gap-2">{backButton}{saveButton}</div>
            )}
          </div>
          {extensions?.headerActions && error && errorText('line-clamp-2')}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-5 sm:px-6">
          {body}
        </div>
      </div>

      {/* Back and Save stay on screen however long the form is. Back replaces
          the old Cancel beside Save: both only ever left the form. */}
      {!extensions?.headerActions && (
        <footer className="shrink-0 border-t bg-background">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
            {backButton}
            {error ? errorText('min-w-0 flex-1 line-clamp-2') : <div className="flex-1" />}
            {saveButton}
          </div>
        </footer>
      )}
    </div>
  );
}
