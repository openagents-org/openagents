/**
 * Password hashing and verification utility
 *
 * This module provides password hashing functionality compatible with
 * the backend's SHA-256 implementation (Python hashlib.sha256).
 */

import { networkFetch } from './httpClient';

/**
 * Hash a password using SHA-256 (matching backend implementation)
 *
 * @param password - Plain text password to hash
 * @returns Promise that resolves to the SHA-256 hex hash string
 *
 * @example
 * const hash = await hashPassword("MySecurePassword123!");
 * // Returns: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8" (example)
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.trim().length === 0) {
    throw new Error('Password cannot be empty');
  }

  // Convert password string to bytes
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Hash using SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordBytes);

  // Convert buffer to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Interface for group configuration from /api/health endpoint
 */
export interface GroupConfig {
  name: string;
  description?: string;
  password_hash?: string;
  agent_count?: number;
  metadata?: Record<string, any>;
}

/**
 * Result of password verification from backend
 */
export interface PasswordVerificationResult {
  success: boolean;
  valid: boolean;
  groupName?: string;
  groupDescription?: string;
  passwordHash?: string;
  defaultGroup?: string;
  error?: string;
}

/**
 * Verify a password with the backend using the system.verify_password API
 *
 * This function sends the plaintext password to the backend, which verifies it
 * against configured agent groups and returns the matching group information.
 *
 * @param password - Plain text password to verify
 * @param networkHost - Network host address
 * @param networkPort - Network port
 * @returns Promise that resolves to verification result with group info
 *
 * @example
 * const result = await verifyPasswordWithBackend("ModSecure2024!", "localhost", 8700);
 * if (result.success && result.valid) {
 *   console.log(`Matched group: ${result.groupName}`);
 *   // Use result.passwordHash for registration
 * }
 */
export async function verifyPasswordWithBackend(
  password: string,
  networkHost: string,
  networkPort: number,
  useHttps?: boolean
): Promise<PasswordVerificationResult> {
  if (!password || password.trim().length === 0) {
    return {
      success: false,
      valid: false,
      error: 'Password cannot be empty'
    };
  }

  try {
    // Hash the password using SHA-256
    const passwordHash = await hashPassword(password);

    // Send verification request to backend using networkFetch (with automatic proxy support)
    const requestBody = {
      event_id: `verify_${Date.now()}_${Math.random()}`,
      event_name: 'system.verify_password',
      source_id: 'system:system',
      payload: {
        password_hash: passwordHash,
      },
      metadata: {},
      visibility: 'network',
    };

    const response = await networkFetch(
      networkHost,
      networkPort,
      '/api/send_event',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
        useHttps: useHttps,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      return {
        success: false,
        valid: false,
        error: result.message || 'Password verification failed'
      };
    }

    // Parse the response data
    const data = result.data || {};
    const isValid = data.valid === true;

    if (isValid) {
      // Password matched a group
      return {
        success: true,
        valid: true,
        groupName: data.group_name,
        groupDescription: data.group_description,
        passwordHash: passwordHash, // Return the hash for registration
        defaultGroup: data.default_group,
      };
    } else {
      // Password did not match any group
      return {
        success: true,
        valid: false,
        defaultGroup: data.default_group,
        error: 'Invalid password. Please check your credentials.',
      };
    }
  } catch (error) {
    console.error('Failed to verify password with backend:', error);
    return {
      success: false,
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to connect to network'
    };
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use verifyPasswordWithBackend() instead
 */
export interface PasswordMatchResult {
  success: boolean;
  groupName?: string;
  passwordHash?: string;
  error?: string;
}

/**
 * Verify password against backend (wrapper for compatibility)
 * @deprecated This function is kept for backward compatibility
 */
export async function findMatchingGroup(
  password: string,
  networkHost: string,
  networkPort: number,
  useHttps?: boolean
): Promise<PasswordMatchResult> {
  const result = await verifyPasswordWithBackend(password, networkHost, networkPort, useHttps);

  return {
    success: result.success && result.valid,
    groupName: result.groupName,
    passwordHash: result.passwordHash,
    error: result.error
  };
}
