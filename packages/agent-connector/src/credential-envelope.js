'use strict';

// The workspace relays ciphertext. The private key never leaves this device.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ALGORITHM = 'RSA-OAEP-256+A256GCM';

function deviceCredentialKey(configDir) {
  const filename = path.join(configDir, 'credential-key.pem');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  let pem;
  try { pem = fs.readFileSync(filename, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const generated = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    // Another command can ask at the same time. Only the first key wins.
    try { fs.writeFileSync(filename, generated, { mode: 0o600, flag: 'wx' }); }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
    pem = fs.readFileSync(filename, 'utf8');
  }
  const privateKey = crypto.createPrivateKey(pem);
  const publicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const keyId = crypto.createHash('sha256').update(publicDer).digest('hex');
  return { privateKey, publicKey: publicDer.toString('base64'), keyId, algorithm: ALGORITHM };
}

function credentialContext(nodeId, action, args) {
  const context = [nodeId, action, args.name || '', args.type || '', args.model || '', args.baseUrl || ''];
  if (action === 'login_input') context.push(args.sessionId || '');
  return JSON.stringify(context);
}

function decryptCredentials(configDir, nodeId, action, args) {
  const envelope = args.encryptedCredentials;
  if (!envelope) return args;
  if (!['create_agent', 'configure_agent', 'login_input'].includes(action) || args.apiKey || args.config || args.modelAccessId) {
    throw new Error('Invalid encrypted credential command');
  }
  const key = deviceCredentialKey(configDir);
  if (envelope.algorithm !== ALGORITHM || envelope.keyId !== key.keyId ||
      !Number.isFinite(envelope.expiresAt) || envelope.expiresAt < Date.now() ||
      envelope.expiresAt > Date.now() + 10 * 60 * 1000) throw new Error('Credential envelope expired or key changed');
  const context = credentialContext(nodeId, action, args);
  const aesKey = crypto.privateDecrypt({ key: key.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, 'base64'));
  let plaintext;
  try {
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${context}\n${envelope.expiresAt}`));
    decipher.setAuthTag(ciphertext.subarray(-16));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  } finally { aesKey.fill(0); }
  let credentials;
  try { credentials = JSON.parse(plaintext.toString('utf8')); }
  finally { plaintext.fill(0); }
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) ||
      Object.keys(credentials).some((k) => !['apiKey', 'config'].includes(k)) ||
      (credentials.apiKey !== undefined && typeof credentials.apiKey !== 'string') ||
      (credentials.config !== undefined && (!credentials.config || typeof credentials.config !== 'object' || Array.isArray(credentials.config) || Object.values(credentials.config).some((v) => typeof v !== 'string')))) {
    throw new Error('Invalid credential fields');
  }
  const { encryptedCredentials, ...publicArgs } = args;
  return { ...publicArgs, ...credentials };
}

module.exports = { deviceCredentialKey, decryptCredentials, credentialContext, ALGORITHM };
