'use client';
import React from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey } from '@/lib/i18n';
import { desktopHost } from '@/lib/desktop-host';
import { desktopDownloads } from '@/lib/desktop-downloads';

const HINT_CODE = 'font-mono whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-foreground';
const CODE_MARK = '\u0000';

/** `text` with each CODE_MARK replaced, in order, by the matching `codes` entry as code. */
function withCode(text: string, codes: string[]): React.ReactNode[] {
  return text.split(CODE_MARK).flatMap((part, i) =>
    i < codes.length ? [part, <code key={i} className={HINT_CODE}>{codes[i]}</code>] : [part]);
}

/**
 * What to do about an agent installed with no credentials: an API key always
 * works; an agent whose CLI signs in to an account (a subscription) can also be
 * signed in on its device — from the desktop app, or for a device paired from
 * the command line, with `command` in a terminal there.
 */
export function NeedsCredentialsHint({ label, device, command, note, os }: { label: string; device: string; command: string; note?: MessageKey; os?: string | null }) {
  const t = useT();
  // Already in the desktop app: no point offering to download it.
  const downloads = desktopHost() ? [] : desktopDownloads(t);
  // The CLI's own command (a device too old for `agn login`) relies on the
  // terminal's PATH, which often lacks where the CLI really is — an npm global
  // folder or OpenAgents' own. `agn runtimes`, which old devices have, prints
  // that path; PowerShell needs `&` to run a quoted one.
  const bare = !!command && !command.startsWith('agn ');
  const fullPath = `${os === 'win32' ? '& ' : ''}"${t('connect.nodeNeedsLoginPath')}" ${command.split(/\s+/).slice(1).join(' ')}`.trim();
  return (
    <div data-testid="agent-setup-needs-credentials" className="flex flex-col gap-2">
      <p>{t(command ? 'connect.nodeNeedsLoginHint' : 'connect.nodeNeedsKeyHint')}</p>
      <div>
        <p className="font-semibold">{t('connect.nodeNeedsLoginKeyTitle')}</p>
        <p>{t('connect.nodeNeedsLoginKeyStep')}</p>
      </div>
      {command && (
        <div>
          <p className="font-semibold">{t('connect.nodeNeedsLoginSubTitle')}</p>
          {note && <p className="mb-1">{t(note)}</p>}
          <ol className="list-decimal flex flex-col gap-1.5 pl-4">
            <li>
              {t('connect.nodeNeedsLoginDesktop', { device, label })}
              {downloads.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {downloads.map((d) => (
                    <Button key={d.os} variant="outline" size="xs" asChild>
                      <a href={d.href} target="_blank" rel="noopener noreferrer">
                        <Download data-icon="inline-start" />{d.os}
                      </a>
                    </Button>
                  ))}
                </span>
              )}
            </li>
            <li>
              {t('connect.nodeNeedsLoginCli')}{' '}
              <code className={HINT_CODE}>{command}</code>
              {bare && (
                <span data-testid="agent-setup-cli-not-found" className="mt-1 block">
                  {withCode(t('connect.nodeNeedsLoginCliMissing', { label, runtimes: CODE_MARK, example: CODE_MARK }), ['agn runtimes', fullPath])}
                </span>
              )}
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
