/**
 * Environment configuration.
 *
 * Read once at import so a missing secret fails at boot rather than on the
 * first webhook, when the platform is already retrying and the user is already
 * waiting.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  port: Number(optional('PORT', '8080')),
  /** Public HTTPS origin the platforms call back to. */
  publicUrl: optional('GATEWAY_PUBLIC_URL', 'http://localhost:8080'),

  databaseUrl: required('DATABASE_URL'),

  /** The OA backend's base URL, e.g. https://workspace-endpoint.openagents.org */
  oaEndpoint: required('OA_ENDPOINT'),
  /**
   * Shared secret for the two handshake endpoints where no binding credential
   * exists yet — or no longer does. Distinct from a binding's own key: this
   * says "you are the gateway", not "you may act for this binding".
   */
  oaServiceKey: required('OA_SERVICE_KEY'),

  /**
   * 32-byte key (base64) encrypting platform credentials at rest. Rotating it
   * invalidates stored credentials, which means re-running OAuth — so treat it
   * as durable state, not a config knob.
   */
  encryptionKey: required('GATEWAY_ENCRYPTION_KEY'),

  /**
   * Identifies this replica when it takes a lease. Railway sets
   * RAILWAY_REPLICA_ID; anything unique per process works.
   */
  instanceId: optional(
    'GATEWAY_INSTANCE_ID',
    process.env.RAILWAY_REPLICA_ID || `local-${process.pid}`,
  ),

  /**
   * How often to check that the event stream is still alive.
   *
   * Not a polling interval — outbound is driven by the stream, and this only
   * catches the case where a connection looks open but has silently stopped
   * delivering. Set to 0 to disable.
   */
  watchdogSeconds: Number(optional('GATEWAY_WATCHDOG_SECONDS', '60')),

  /** How long a drain lease is held before another replica may take over. */
  leaseSeconds: Number(optional('GATEWAY_LEASE_SECONDS', '120')),

  logLevel: optional('LOG_LEVEL', 'info'),
} as const;
