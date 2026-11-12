// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useIsMobile } from './use-mobile';

let host: HTMLDivElement, root: Root, current: boolean | undefined;
function Probe() { current = useIsMobile(); return null; }
const render = () => act(async () => root.render(React.createElement(Probe)));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  current = undefined;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

function device(userAgent: string, width: number) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('keeps the desktop layout in a narrow window on a computer', async () => {
  device(MAC, 600);
  await render();
  expect(current).toBe(false);
});

it('uses the phone layout on a phone, and follows a tablet as it turns', async () => {
  device(IPHONE, 390);
  await render();
  expect(current).toBe(true);
  // Wide enough (a tablet in landscape): the desktop shell, as before.
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1180 });
    window.dispatchEvent(new Event('resize'));
  });
  expect(current).toBe(false);
});
