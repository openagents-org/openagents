/**
 * Tests for password hash utilities
 */

import { verifyPassword, findMatchingGroup, GroupConfig } from '../passwordHash';

describe('passwordHash utilities', () => {
  const mockGroupConfigs: GroupConfig[] = [
    {
      name: 'moderators',
      password_hash: '$2b$12$p7CBrw9kLCB8LC0snzyFOeIAXSzrEK6Zw.IBXp9GYVtb75k5F/o7O',
      description: 'Forum moderators',
    },
    {
      name: 'ai-bots',
      password_hash: '$2b$12$fN4XSArA6AmrXOZ6wtoKeO5vmUHuCUUzhFXEGulT2.GCi7VaPD2em',
      description: 'AI assistant agents',
    },
    {
      name: 'guests',
      description: 'Guest users without password',
      // No password_hash for guests
    },
  ];

  describe('verifyPassword', () => {
    it('should verify correct password against hash', async () => {
      const result = await verifyPassword(
        'ModSecure2024!',
        '$2b$12$p7CBrw9kLCB8LC0snzyFOeIAXSzrEK6Zw.IBXp9GYVtb75k5F/o7O'
      );
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const result = await verifyPassword(
        'WrongPassword',
        '$2b$12$p7CBrw9kLCB8LC0snzyFOeIAXSzrEK6Zw.IBXp9GYVtb75k5F/o7O'
      );
      expect(result).toBe(false);
    });

    it('should handle empty password', async () => {
      const result = await verifyPassword('', 'somehash');
      expect(result).toBe(false);
    });
  });

  describe('findMatchingGroup', () => {
    it('should find matching group for valid password', async () => {
      const result = await findMatchingGroup('ModSecure2024!', mockGroupConfigs);

      expect(result.success).toBe(true);
      expect(result.groupName).toBe('moderators');
      expect(result.passwordHash).toBe('$2b$12$p7CBrw9kLCB8LC0snzyFOeIAXSzrEK6Zw.IBXp9GYVtb75k5F/o7O');
      expect(result.error).toBeUndefined();
    });

    it('should return error for invalid password', async () => {
      const result = await findMatchingGroup('InvalidPassword123', mockGroupConfigs);

      expect(result.success).toBe(false);
      expect(result.groupName).toBeUndefined();
      expect(result.passwordHash).toBeUndefined();
      expect(result.error).toBe('Invalid password. Please check your credentials.');
    });

    it('should handle empty password', async () => {
      const result = await findMatchingGroup('', mockGroupConfigs);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password cannot be empty');
    });

    it('should handle empty group configs', async () => {
      const result = await findMatchingGroup('SomePassword', []);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No agent groups available');
    });

    it('should skip groups without password_hash', async () => {
      const result = await findMatchingGroup('ModSecure2024!', mockGroupConfigs);

      // Should match moderators, not guests (which has no password_hash)
      expect(result.success).toBe(true);
      expect(result.groupName).toBe('moderators');
    });

    it('should verify ai-bots password', async () => {
      const result = await findMatchingGroup('AiBotKey2024!', mockGroupConfigs);

      expect(result.success).toBe(true);
      expect(result.groupName).toBe('ai-bots');
      expect(result.passwordHash).toBe('$2b$12$fN4XSArA6AmrXOZ6wtoKeO5vmUHuCUUzhFXEGulT2.GCi7VaPD2em');
    });
  });
});
