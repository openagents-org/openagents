declare global {
  interface Window {
    posthog?: {
      capture: (event: string, properties?: Record<string, unknown>) => void;
      identify: (distinctId: string, properties?: Record<string, unknown>) => void;
    };
  }
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  window.posthog?.capture(event, properties);
}

export function identify(userId: string, properties?: Record<string, unknown>): void {
  window.posthog?.identify(userId, properties);
}
