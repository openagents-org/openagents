import CryptoJS from 'crypto-js';

const SECRET_KEY = 'openagents-studio-secret-key-2024-v1';

export function encryptForStorage(plainText: string): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty string');
  }

  try {
    const encrypted = CryptoJS.AES.encrypt(plainText, SECRET_KEY).toString();
    console.log('🔒 Data encrypted for storage');
    return encrypted;
  } catch (error) {
    console.error('❌ Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

export function decryptFromStorage(encryptedText: string): string {
  if (!encryptedText) {
    throw new Error('Cannot decrypt empty string');
  }

  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, SECRET_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      throw new Error(
        'Decryption resulted in empty string - wrong key or corrupted data'
      );
    }

    console.log('🔓 Data decrypted from storage');
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption failed:', error);
    throw new Error('Failed to decrypt data - data may be corrupted');
  }
}

export function isEncrypted(text: string): boolean {
  if (!text) return false;
  return text.startsWith('U2FsdGVkX1');
}

