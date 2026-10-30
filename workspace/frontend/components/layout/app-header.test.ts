// @vitest-environment jsdom
import React, { Activity, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppHeaderActions, AppHeaderTitle } from './app-header';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('detaches inactive page titles and actions so the thread fallback can appear', async () => {
  document.body.innerHTML = '<div id="root"></div><div id="app-header-title"><div data-header-title-fallback>Thread title</div></div><div id="app-header-actions"></div>';
  const root = createRoot(document.getElementById('root')!);
  const title = document.getElementById('app-header-title')!;
  const actions = document.getElementById('app-header-actions')!;
  const render = (visible: boolean) => root.render(
    createElement(Activity, { mode: visible ? 'visible' : 'hidden', children: createElement(React.Fragment, null,
      createElement(AppHeaderTitle, { children: createElement('h3', null, 'Knowledge page') }),
      createElement(AppHeaderActions, { children: createElement('button', null, 'Export') }),
    ) })
  );
  try {
    for (let i = 0; i < 3; i++) {
      await act(async () => render(true));
      expect(title.textContent).toContain('Knowledge page');
      expect(actions.querySelectorAll('button')).toHaveLength(1);
      await act(async () => render(false));
      expect(title.querySelector('[data-header-title-fallback]:only-child')).not.toBeNull();
      expect(title.textContent).toBe('Thread title');
      expect(actions.children).toHaveLength(0);
    }
  } finally {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
  }
});
