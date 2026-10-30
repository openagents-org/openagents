declare global {
  interface Window {
    posthog?: {
      capture: (event: string, properties?: Record<string, unknown>) => void;
      identify: (distinctId: string, properties?: Record<string, unknown>) => void;
      group: (groupType: string, groupKey: string, properties?: Record<string, unknown>) => void;
    };
  }
}

// Acquisition source (?src=yt on the entry URL) — persisted for the session so
// every funnel event downstream of the landing carries it. Mobile vs desktop
// rides along too: the mobile-onboarding funnel (YouTube → phone → laptop
// hand-off) is measured by slicing the same events on these two properties.
const SRC_KEY = 'oa_acq_src';

function baseProps(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('src');
    if (fromUrl) sessionStorage.setItem(SRC_KEY, fromUrl);
    const src = sessionStorage.getItem(SRC_KEY);
    return {
      is_mobile: window.innerWidth < 1024,
      ...(src ? { acq_src: src } : {}),
    };
  } catch {
    return { is_mobile: window.innerWidth < 1024 };
  }
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  window.posthog?.capture(event, { ...baseProps(), ...properties });
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  window.posthog?.identify(userId, properties);
}

// Tie subsequent events to a workspace. The workspace ID is the join key that connects
// this user's activity to the website + launcher funnel stages for the same workspace.
export function group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
  window.posthog?.group(groupType, groupKey, properties);
}
