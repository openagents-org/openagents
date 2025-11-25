import { networkFetch } from './httpClient';

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.trim().length === 0) {
    throw new Error('Password cannot be empty');
  }

  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', passwordBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

export interface PasswordVerificationResult {
  success: boolean;
  valid: boolean;
  groupName?: string;
  groupDescription?: string;
  passwordHash?: string;
  defaultGroup?: string;
  error?: string;
}

export async function verifyPasswordWithBackend(
  password: string,
  networkHost: string,
  networkPort: number
): Promise<PasswordVerificationResult> {
  if (!password || password.trim().length === 0) {
    return {
      success: false,
      valid: false,
      error: 'Password cannot be empty',
    };
  }

  try {
    const passwordHash = await hashPassword(password);

    const requestBody = {
      event_id: `verify_${Date.now()}_${Math.random()}`,
      event_name: 'system.verify_password',
      source_id: 'system:system',
      payload: {
        password_hash: passwordHash,
      },
      metadata: {},
      visibility: 'network' as const,
    };

    const response = await networkFetch(
      networkHost,
      networkPort,
      '/api/send_event',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
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
        error: result.message || 'Password verification failed',
      };
    }

    const data = result.data || {};
    const isValid = data.valid === true;

    if (isValid) {
      return {
        success: true,
        valid: true,
        groupName: data.group_name,
        groupDescription: data.group_description,
        passwordHash,
        defaultGroup: data.default_group,
      };
    } else {
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
      error:
        error instanceof Error ? error.message : 'Failed to connect to network',
    };
  }
}

