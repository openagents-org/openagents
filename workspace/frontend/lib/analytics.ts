declare global {
  interface Window {
    posthog?: {
      capture: (event: string, properties?: Record<string, unknown>) => void;
      identify: (distinctId: string, properties?: Record<string, unknown>) => void;
      group: (groupType: string, groupKey: string, properties?: Record<string, unknown>) => void;
    };
  }
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  window.posthog?.capture(event, properties);
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  window.posthog?.identify(userId, properties);
}

// Tie subsequent events to a workspace. The workspace ID is the join key that connects
// this user's activity to the website + launcher funnel stages for the same workspace.
export function group(groupType: string, groupKey: string, properties?: Record<string, unknown>): void {
  window.posthog?.group(groupType, groupKey, properties);
}
