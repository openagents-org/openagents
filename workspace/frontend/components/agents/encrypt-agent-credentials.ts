import type { AgentSetupApi } from './agent-setup-types';

const ALGORITHM = 'RSA-OAEP-256+A256GCM';
const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const base64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));

/** No plaintext fallback: only this device's private key can open the payload. */
export async function encryptAgentCredentials(
  api: AgentSetupApi, nodeId: string, action: string, args: Record<string, unknown>, unavailableMessage: string,
): Promise<Record<string, unknown>> {
  const { apiKey, config, ...publicArgs } = args;
  if (!apiKey && !config) return args;
  if (!globalThis.crypto?.subtle) throw new Error(unavailableMessage);
  const command = await api.enqueueNodeCommand(nodeId, 'credential_key', {});
  if (!command.commandId) throw new Error(unavailableMessage);
  let deviceKey: { algorithm?: string; keyId?: string; publicKey?: string } | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const commands = await api.listNodeCommands(nodeId);
    const result = commands.find((c) => c.commandId === command.commandId);
    if (result?.status === 'error' || result?.result?.ok === false) throw new Error(unavailableMessage);
    if (result?.status === 'done') {
      deviceKey = result.result?.data as typeof deviceKey;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (deviceKey?.algorithm !== ALGORITHM || !deviceKey.keyId || !deviceKey.publicKey) throw new Error(unavailableMessage);
  const rsa = await crypto.subtle.importKey('spki', bytes(deviceKey.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const binding = [nodeId, action, args.name || '', args.type || '', args.model || '', args.baseUrl || ''];
  if (action === 'login_input') binding.push(args.sessionId || '');
  const context = JSON.stringify(binding);
  const encoded = new TextEncoder().encode(JSON.stringify({ ...(apiKey ? { apiKey } : {}), ...(config ? { config } : {}) }));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${context}\n${expiresAt}`) }, aes, encoded);
    const wrappedKey = await crypto.subtle.wrapKey('raw', aes, rsa, 'RSA-OAEP');
    return { ...publicArgs, encryptedCredentials: {
      algorithm: ALGORITHM, keyId: deviceKey.keyId, expiresAt,
      iv: base64(iv.buffer), wrappedKey: base64(wrappedKey), ciphertext: base64(ciphertext),
    } };
  } finally { encoded.fill(0); }
}
