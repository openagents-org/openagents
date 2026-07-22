'use client';

/**
 * Imperative, promise-based replacements for the browser-native window.confirm /
 * window.prompt — which render as ugly OS/webview popups (especially inside the
 * WeChat in-app browser). Backed by the responsive Dialog, so they show as a
 * centered dialog on desktop and a bottom drawer on mobile.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: '...', destructive: true }))) return;
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: '...', placeholder: '...' });
 *   if (name == null) return; // cancelled
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
}

type Pending =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'prompt' } & PromptOptions);

interface DialogsApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogsContext = React.createContext<DialogsApi | null>(null);

export function useConfirm() {
  const ctx = React.useContext(DialogsContext);
  if (!ctx) throw new Error('useConfirm must be used within <DialogsProvider>');
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = React.useContext(DialogsContext);
  if (!ctx) throw new Error('usePrompt must be used within <DialogsProvider>');
  return ctx.prompt;
}

export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [value, setValue] = React.useState('');
  const resolverRef = React.useRef<((result: boolean | string | null) => void) | null>(null);

  const settle = React.useCallback((result: boolean | string | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirm = React.useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve as (r: boolean | string | null) => void;
        setPending({ kind: 'confirm', ...opts });
      }),
    [],
  );

  const prompt = React.useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        resolverRef.current = resolve as (r: boolean | string | null) => void;
        setValue(opts.defaultValue ?? '');
        setPending({ kind: 'prompt', ...opts });
      }),
    [],
  );

  const api = React.useMemo<DialogsApi>(() => ({ confirm, prompt }), [confirm, prompt]);

  // Cancel-on-dismiss resolves to the "declined" value for each kind.
  const cancelResult = pending?.kind === 'prompt' ? null : false;

  const handleOpenChange = (open: boolean) => {
    if (!open) settle(cancelResult);
  };

  const submit = () => {
    if (pending?.kind === 'prompt') settle(value);
    else settle(true);
  };

  return (
    <DialogsContext.Provider value={api}>
      {children}
      <Dialog open={!!pending} onOpenChange={handleOpenChange}>
        {pending && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{pending.title}</DialogTitle>
              {pending.description && (
                <DialogDescription>{pending.description}</DialogDescription>
              )}
            </DialogHeader>

            {pending.kind === 'prompt' && (
              <DialogBody className="py-1">
                <Input
                  autoFocus
                  value={value}
                  placeholder={pending.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </DialogBody>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => settle(cancelResult)}>
                {pending.cancelText ?? 'Cancel'}
              </Button>
              <Button
                variant={pending.kind === 'confirm' && pending.destructive ? 'destructive' : 'primary'}
                onClick={submit}
              >
                {pending.confirmText ?? (pending.kind === 'prompt' ? 'OK' : 'Confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </DialogsContext.Provider>
  );
}
