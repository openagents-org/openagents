# Encrypted credentials in guided Workspace setup

The guided web add-agent flow sends newly entered API keys and native credential
fields directly to the selected connector using an encrypted envelope. It does
not request existing key values from the device. Sign-in detection reads runtime
status; existing account credentials remain on the device.

## Protocol

1. The authenticated connection owner queues `credential_key` with empty args.
2. The connector returns its RSA-3072 public key (SPKI DER, base64), SHA-256 key
   ID and `RSA-OAEP-256+A256GCM` algorithm identifier. Its private key stays at
   `<configDir>/credential-key.pem`, created with permissions `0600`.
3. Browser Web Crypto creates an AES-256-GCM key and 12-byte random IV, encrypts
   JSON containing only `apiKey` and/or `config`, and wraps the AES key using
   RSA-OAEP with SHA-256. Secret fields are removed from the command args.
4. Workspace relays the `encryptedCredentials` envelope unchanged. It refuses
   envelopes mixed with plaintext credentials or a server-managed model access
   ID. Only create/configure and browser sign-in input actions accept envelopes.
5. The connector checks the key ID, expiration and authenticated context, decrypts
   locally, and applies credentials using the existing agent configuration path.
   Errors from encrypted setup return a generic message rather than echoing CLI
   output that could contain credentials.

The GCM additional authenticated data is UTF-8 encoding of
`JSON.stringify([nodeId, action, name, type, model, baseUrl]) + "\n" + expiresAt`.
Missing context fields use empty strings. Expiration is Unix milliseconds; the
browser uses five minutes, and the connector rejects expired envelopes and ones
more than ten minutes in the future. GCM ciphertext includes its trailing
16-byte authentication tag. IV, wrapped key and ciphertext are base64 encoded.
The public key is obtained through the authenticated Workspace connection.

## Browser subscription sign-in

A Claude or Codex runtime reports `browserLogin: true` only when the
connector supports the flow and the POSIX `script` utility is available. Missing
or false capabilities keep the existing terminal instructions; no version guess
enables the new UI. Native Windows currently uses that fallback.

The connection owner queues `login_start` with the agent type. If its CLI is
missing, the connector installs it before starting sign-in. The device runs
`claude auth login` or `codex login --device-auth` in a pseudo-terminal and returns
an opaque session ID. `login_status` returns only a validated provider URL, a
Codex device code when applicable, expiry and status. Raw CLI output and account
credentials never leave the device. All commands use the existing connection
owner authorization. Sessions are additionally scoped to the workspace/node
pairing, expire after ten minutes, and can be stopped with `login_cancel`.

For Claude, `login_input` carries `{sessionId, encryptedCredentials}`. Its
encrypted `config.code` is the browser-provided authorization code. The AAD adds
`sessionId` as the seventh array element, binding that code to this device,
action and sign-in session. The device accepts input once, passes it to the
native CLI and verifies native subscription readiness before reporting `done`.
Leaving the flow cancels its active session. The backend must allow these
commands and the device must be updated before this flow is available.

## Compatibility and rollout

Both the backend (allowing `credential_key`) and device connector (key generation
and decryption) must be updated before this flow can send credentials. Browser
Web Crypto requires a secure context (HTTPS or localhost). Unsupported servers,
connectors and browsers fail closed: no plaintext retry. The user can still use
subscription sign-in on their device or choose to authenticate later.

This change does not migrate existing credentials or change the legacy desktop
and edit forms. Existing server-managed Model access entries retain their
existing storage and delivery behavior. Guided setup does not use those entries.
Models in guided setup default to the CLI's current default; optional suggestions
come only from the device's `cliModels`, with free-form IDs always accepted.
