/**
 * Simple encryption/decryption utilities for secure local storage
 *
 * This module provides AES encryption for sensitive data (like passwordHash)
 * that needs to be stored in localStorage. Works in all environments:
 * http, https, and localhost.
 */

import CryptoJS from 'crypto-js';
import { logger } from './logger';

// Secret key for encryption/decryption
// In production, this could be made more complex or derived from other sources
const SECRET_KEY = 'openagents-studio-secret-key-2024-v1';

/**
 * Encrypt a string for secure storage
 *
 * @param plainText - The text to encrypt (e.g., passwordHash)
 * @returns Encrypted string that can be safely stored in localStorage
 *
 * @example
 * const encrypted = encryptForStorage("$2b$12$abc...");
 * // Returns: "U2FsdGVkX1+xxx..."
 */
export function encryptForStorage(plainText: string): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty string');
  }

  try {
    const encrypted = CryptoJS.AES.encrypt(plainText, SECRET_KEY).toString();
    logger.debug('🔒 Data encrypted for storage');
    return encrypted;
  } catch (error) {
    logger.error('❌ Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt a string from storage
 *
 * @param encryptedText - The encrypted text from localStorage
 * @returns Original plain text
 *
 * @example
 * const decrypted = decryptFromStorage("U2FsdGVkX1+xxx...");
 * // Returns: "$2b$12$abc..."
 */
export function decryptFromStorage(encryptedText: string): string {
  if (!encryptedText) {
    throw new Error('Cannot decrypt empty string');
  }

  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, SECRET_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);

    if (!decrypted) {
      throw new Error('Decryption resulted in empty string - wrong key or corrupted data');
    }

    logger.debug('🔓 Data decrypted from storage');
    return decrypted;
  } catch (error) {
    logger.error('❌ Decryption failed:', error);
    throw new Error('Failed to decrypt data - data may be corrupted');
  }
}

/**
 * Check if a string appears to be encrypted
 *
 * @param text - The text to check
 * @returns true if the text looks like it was encrypted by this module
 */
export function isEncrypted(text: string): boolean {
  if (!text) return false;

  // CryptoJS encrypted strings typically start with "U2FsdGVkX1" (base64 of "Salted__")
  return text.startsWith('U2FsdGVkX1');
}
