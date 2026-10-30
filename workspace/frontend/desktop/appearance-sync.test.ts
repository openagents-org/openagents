import { describe, expect, it } from 'vitest';

import { createAppearanceSync } from './appearance-sync';

/** Step through successive React renders, including delayed host replies. */
function renderer() {
  const sync = createAppearanceSync();
  return (host: string | undefined, local: string | undefined, hostRevision?: number) =>
    sync({ host, local, hostRevision });
}

describe('desktop appearance synchronization', () => {
  it('keeps a workspace dark-mode selection while waiting for the host', () => {
    const render = renderer();
    expect(render('light', 'light')).toBeNull();
    expect(render('light', 'dark')).toEqual({ destination: 'host', value: 'dark' });
    // Another render (including a new next-themes setter) must not restore light.
    expect(render('light', 'dark')).toBeNull();
    expect(render('dark', 'dark')).toBeNull();
    expect(render('dark', 'dark')).toBeNull();
  });

  it('applies a launcher change once without sending the old value back', () => {
    const render = renderer();
    expect(render('light', 'light')).toBeNull();
    expect(render('dark', 'light')).toEqual({ destination: 'local', value: 'dark' });
    expect(render('dark', 'light')).toBeNull();
    expect(render('dark', 'dark')).toBeNull();
  });

  it('keeps a newer local choice when the host acknowledges an older selection', () => {
    const render = renderer();
    expect(render('light', 'light')).toBeNull();
    expect(render('light', 'dark')).toEqual({ destination: 'host', value: 'dark' });
    expect(render('light', 'system')).toBeNull();
    expect(render('dark', 'system')).toEqual({ destination: 'host', value: 'system' });
    expect(render('system', 'system')).toBeNull();
  });

  it('reports a quick switch back to the original host value', () => {
    const render = renderer();
    expect(render('light', 'light')).toBeNull();
    expect(render('light', 'dark')).toEqual({ destination: 'host', value: 'dark' });
    expect(render('light', 'light')).toBeNull();
    expect(render('dark', 'light')).toEqual({ destination: 'host', value: 'light' });
    expect(render('light', 'light')).toBeNull();
    // After acknowledgement, a new launcher choice is authoritative again.
    expect(render('dark', 'light')).toEqual({ destination: 'local', value: 'dark' });
  });

  it('coalesces repeated local toggles without leaving stale acknowledgements', () => {
    const render = renderer();
    expect(render('light', 'light')).toBeNull();
    expect(render('light', 'dark')).toEqual({ destination: 'host', value: 'dark' });
    expect(render('light', 'light')).toBeNull();
    expect(render('light', 'dark')).toBeNull();
    expect(render('dark', 'dark')).toBeNull();
    // There was just one report, so a later launcher change is not mistaken
    // for an acknowledgement left over from the intermediate light selection.
    expect(render('light', 'dark')).toEqual({ destination: 'local', value: 'light' });
    expect(render('light', 'light')).toBeNull();
  });

  it('keeps a pending preference across same-value host notifications', () => {
    const render = renderer();
    expect(render('light', 'light', 0)).toBeNull();
    expect(render('light', 'dark', 0)).toEqual({ destination: 'host', value: 'dark' });
    expect(render('light', 'light', 0)).toBeNull();
    expect(render('light', 'light', 1)).toBeNull();
    expect(render('dark', 'light', 2)).toEqual({ destination: 'host', value: 'light' });
    expect(render('light', 'light', 3)).toBeNull();
    expect(render('dark', 'light', 4)).toEqual({ destination: 'local', value: 'dark' });
  });

  it('does not restore an old theme on an unrelated locale notification', () => {
    const render = renderer();
    expect(render('light', 'light', 0)).toBeNull();
    expect(render('light', 'dark', 0)).toEqual({ destination: 'host', value: 'dark' });
    expect(render('light', 'dark', 1)).toBeNull();
    expect(render('dark', 'dark', 2)).toBeNull();
  });

  it('uses the host preference when workspace storage initially disagrees', () => {
    const render = renderer();
    expect(render('dark', 'system')).toEqual({ destination: 'local', value: 'dark' });
    expect(render('dark', 'dark')).toBeNull();
  });

  it('does not repeat an update when StrictMode replays the mount effect', () => {
    const render = renderer();
    expect(render('light', 'dark')).toEqual({ destination: 'local', value: 'light' });
    expect(render('light', 'dark')).toBeNull();
    expect(render('light', 'light')).toBeNull();
  });

  it('can apply the host before next-themes has initialized', () => {
    const render = renderer();
    expect(render('light', undefined)).toEqual({ destination: 'local', value: 'light' });
    expect(render('light', 'light')).toBeNull();
  });

  it('preserves system mode as a preference rather than resolving it to dark or light', () => {
    const render = renderer();
    expect(render('dark', 'dark')).toBeNull();
    expect(render('dark', 'system')).toEqual({ destination: 'host', value: 'system' });
    expect(render('system', 'system')).toBeNull();
    expect(render('system', 'system')).toBeNull();
  });

  it('uses the same one-way-at-a-time behavior for language changes', () => {
    const render = renderer();
    expect(render('en-US', 'en-US')).toBeNull();
    expect(render('en-US', 'zh-CN')).toEqual({ destination: 'host', value: 'zh-CN' });
    expect(render('zh-CN', 'zh-CN')).toBeNull();
    expect(render('en-US', 'zh-CN')).toEqual({ destination: 'local', value: 'en-US' });
    expect(render('en-US', 'en-US')).toBeNull();
  });

  it('does not change ordinary web preferences when there is no host', () => {
    const render = renderer();
    expect(render(undefined, 'light')).toBeNull();
    expect(render(undefined, 'dark')).toBeNull();
    expect(render(undefined, 'system')).toBeNull();
  });
});
