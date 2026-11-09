// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LayoutProvider, useLayout } from '@/components/layout/layout-context';
import { I18nProvider } from '@/lib/i18n';
import { YumiAgentLocation } from './yumi-agent-location';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('opens the matching setup directly and emits a fresh request for repeated choices', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const requests: unknown[] = [];
  function State() {
    const { viewMode, connectSetupRequest } = useLayout();
    React.useEffect(() => { if (connectSetupRequest) requests.push(connectSetupRequest); }, [connectSetupRequest]);
    return React.createElement('output', null, `${viewMode}:${connectSetupRequest?.method || ''}`);
  }
  const choose = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
  try {
    await act(async () => root.render(React.createElement(I18nProvider, { initialLocale: 'en-US', hasStoredLocale: true,
      children: React.createElement(LayoutProvider, { children: React.createElement(React.Fragment, null, React.createElement(YumiAgentLocation), React.createElement(State)) }) })));
    expect(host.textContent).toContain('Where will your agent run?');
    await act(async () => choose('On my computer').click());
    expect(host.querySelector('output')?.textContent).toBe('connect:desktop');
    await act(async () => choose('On my computer').click());
    expect(requests).toHaveLength(2);
    expect(requests[0]).not.toBe(requests[1]);
    await act(async () => choose('On a remote machine').click());
    expect(host.querySelector('output')?.textContent).toBe('connect:terminal');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
