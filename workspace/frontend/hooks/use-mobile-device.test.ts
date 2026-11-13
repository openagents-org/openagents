import { expect, it } from 'vitest';
import { isMobileDevice } from './use-mobile-device';

const device = (userAgent: string, maxTouchPoints = 0, mobile?: boolean) => ({ userAgent, maxTouchPoints, userAgentData: mobile === undefined ? undefined : { mobile } });

it('recognises phones and tablets, including iPadOS posing as a Mac', () => {
  expect(isMobileDevice(device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'))).toBe(true);
  expect(isMobileDevice(device('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile Safari/537.36'))).toBe(true);
  expect(isMobileDevice(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15', 5))).toBe(true);
  expect(isMobileDevice(device('Mozilla/5.0 (Linux; Android 15) Chrome/140.0', 0, true))).toBe(true);
});

it('treats desktops as desktops, whatever the window width', () => {
  expect(isMobileDevice(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36'))).toBe(false);
  expect(isMobileDevice(device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Electron/38.0 Safari/537.36', 10, false))).toBe(false);
  expect(isMobileDevice(undefined)).toBe(false);
});
