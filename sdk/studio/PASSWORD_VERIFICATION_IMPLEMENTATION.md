# Password Verification Implementation

## Overview

Implemented backend API-based password verification functionality using SHA-256 hashing, allowing users to securely verify their credentials and join the corresponding agent group.

## Core Principles

### SHA-256 Working Mechanism
- **Deterministic hashing**: `SHA-256(password)` always generates the same hash for the same input
- **Backend verification**: Frontend sends password hash to backend for verification via `system.verify_password` event
- **One-way function**: Cannot reverse-engineer plaintext password from hash
- **No salt needed**: SHA-256 directly hashes the password string

### Implementation Flow

```
1. User inputs plaintext password (e.g.: ModSecure2024!)
                ↓
2. Frontend hashes password using SHA-256 (Web Crypto API)
   password_hash = SHA256("ModSecure2024!")
                ↓
3. Frontend sends system.verify_password event to backend
   POST /api/send_event
   {
     event_name: "system.verify_password",
     payload: { password_hash: "..." }
   }
                ↓
4. Backend verifies hash against configured groups
   - Iterates through each group's password_hash
   - Compares hashes using hashlib.sha256
   - Finds matching group
                ↓
5. Backend returns match result
   {
     success: true,
     valid: true,
     group_name: "moderators",
     group_description: "...",
     default_group: "guest"
   }
                ↓
6. Frontend uses the password_hash for agent registration
```

## File Modifications

### 1. `studio/src/utils/passwordHash.ts`

Complete rewrite to use SHA-256 and backend verification:

- **Removed bcrypt dependency**
- **Added SHA-256 hashing** using Web Crypto API:
  ```typescript
  export async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', passwordBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }
  ```

- **PasswordVerificationResult Interface**:
  ```typescript
  interface PasswordVerificationResult {
    success: boolean;
    valid: boolean;
    groupName?: string;
    groupDescription?: string;
    passwordHash?: string;
    defaultGroup?: string;
    error?: string;
  }
  ```

- **verifyPasswordWithBackend() Function**: Backend API verification
  ```typescript
  async function verifyPasswordWithBackend(
    password: string,
    networkHost: string,
    networkPort: number
  ): Promise<PasswordVerificationResult>
  ```

  Functionality:
  - Hashes password using SHA-256
  - Sends `system.verify_password` event to backend via `/api/send_event`
  - Receives verification result from backend
  - Returns matching group and password hash for registration

### 2. `studio/src/pages/AgentSetupPage.tsx`

Modifications:

- **Removed**: Fetching `group_config` from `/api/health`
- **Removed**: Client-side password verification
- **Removed**: `GroupConfig` state

- **Updated Password Verification Logic**:
  ```typescript
  const handlePasswordConfirm = async (password: string): Promise<string | null> => {
    if (!selectedNetwork) {
      return "Network not selected";
    }

    try {
      // Verify password with backend API
      const result = await verifyPasswordWithBackend(
        password,
        selectedNetwork.host,
        selectedNetwork.port
      );

      if (result.success && result.valid && result.passwordHash) {
        console.log(`Password verified - matched group: ${result.groupName}`);
        setIsPasswordModalOpen(false);
        proceedWithConnection(result.passwordHash);
        return null; // Success
      } else {
        return result.error || "Invalid password. Please try again.";
      }
    } catch (error) {
      console.error("Failed to verify password:", error);
      return "Failed to connect to network. Please try again.";
    }
  };
  ```

### 3. `studio/package.json`

Removed dependency:
- ❌ Removed `"bcryptjs": "^3.0.2"` from dependencies

## Backend Changes

### New System Event: `system.verify_password`

**File**: `sdk/src/openagents/core/system_commands.py` (lines 788-853)

**Handler**: `handle_verify_password()`

**Request**:
```json
{
  "event_name": "system.verify_password",
  "payload": {
    "password_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
  }
}
```

**Response** (valid password):
```json
{
  "success": true,
  "message": "Password verified: matches group 'moderators'",
  "data": {
    "type": "system_response",
    "command": "verify_password",
    "valid": true,
    "group_name": "moderators",
    "group_description": "Forum moderators with elevated permissions",
    "group_metadata": {...},
    "default_group": "guest"
  }
}
```

**Response** (invalid password):
```json
{
  "success": true,
  "message": "Password verification failed: no matching group found",
  "data": {
    "type": "system_response",
    "command": "verify_password",
    "valid": false,
    "default_group": "guest",
    "requires_password": false
  }
}
```

### Password Hashing Backend

**File**: `sdk/src/openagents/utils/password_utils.py`

**Functions**:
```python
def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    password_bytes = password.encode('utf-8')
    hash_obj = hashlib.sha256(password_bytes)
    password_hash = hash_obj.hexdigest()
    return password_hash

def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a SHA-256 hash."""
    password_bytes = password.encode('utf-8')
    hash_obj = hashlib.sha256(password_bytes)
    computed_hash = hash_obj.hexdigest()
    return computed_hash == password_hash
```

## Security Improvements

- ✅ **No password hashes exposed to client**: Client never receives password_hash values from `/api/health`
- ✅ **Backend-controlled verification**: All password logic centralized on backend
- ✅ **Reduced attack surface**: Client-side verification removed
- ✅ **SHA-256 hashing**: Industry-standard cryptographic hash function
- ✅ **Plaintext never stored**: Only hashes are stored and transmitted
- ✅ **Support for guest mode**: Passwordless connection still available

## Testing

### Manual Testing Steps

1. **Start backend network** with password-protected groups
2. **Access Studio** at `http://localhost:3000`
3. **Select network** and proceed to agent setup
4. **Enter password** in modal and verify:
   - Correct password → Success, assigned to correct group
   - Incorrect password → Error message displayed
   - Guest mode → Assigns to default guest group

### Test Passwords (from `examples/workspace_test.yaml`)

Generate SHA-256 hashes for test passwords:

```python
from openagents.utils.password_utils import hash_password

# Generate hashes
print(hash_password("ModSecure2024!"))
print(hash_password("AiBotKey2024!"))
print(hash_password("ResearchAccess2024!"))
print(hash_password("UserStandard2024!"))
```

## Usage

### Frontend Implementation

```typescript
// Import verification function
import { verifyPasswordWithBackend } from '@/utils/passwordHash';

// Verify password with backend
const result = await verifyPasswordWithBackend(
  "ModSecure2024!",
  "localhost",
  8700
);

if (result.success && result.valid) {
  console.log(`Matched group: ${result.groupName}`);
  // Use result.passwordHash for registration
}
```

### Backend Configuration

Configure agent groups in `network.yaml`:

```yaml
network:
  name: "My Network"
  mode: "centralized"
  agent_groups:
    moderators:
      description: "Forum moderators with elevated permissions"
      password_hash: "<SHA256_HASH_OF_PASSWORD>"
      metadata:
        permissions: ["moderate", "delete", "ban"]

    users:
      description: "Regular users"
      password_hash: "<SHA256_HASH_OF_PASSWORD>"
      metadata:
        permissions: ["read", "post"]

  default_agent_group: "guest"
  requires_password: false  # Allow guest connections
```

## API Response Structure

The `system.verify_password` event response structure:

```typescript
interface VerifyPasswordResponse {
  success: boolean;
  message: string;
  data: {
    type: "system_response";
    command: "verify_password";
    valid: boolean;
    group_name?: string;  // Only if valid=true
    group_description?: string;  // Only if valid=true
    group_metadata?: Record<string, any>;  // Only if valid=true
    default_group: string;
    requires_password?: boolean;  // Only if valid=false
  };
}
```

## Migration from bcrypt

### Changes Required

1. **Password hashes must be regenerated** using SHA-256 instead of bcrypt
2. **Update network configuration** with new SHA-256 hashes
3. **Remove bcryptjs** from dependencies: `npm uninstall bcryptjs`
4. **Clear browser cache** to remove old bcrypt library

### Generating New Hashes

Python (backend):
```python
from openagents.utils.password_utils import hash_password
hash_value = hash_password("your_password")
```

TypeScript (frontend):
```typescript
import { hashPassword } from '@/utils/passwordHash';
const hash = await hashPassword("your_password");
```

## FAQ

### Q: Why switch from bcrypt to SHA-256?
A: Simplicity and consistency. The backend uses SHA-256, so frontend now matches. SHA-256 is sufficient for this use case since password hashes are verified server-side.

### Q: Is SHA-256 secure enough?
A: Yes, for this use case. SHA-256 is a cryptographic hash function. Since verification happens server-side and hashes are never exposed to clients, the security model is sound.

### Q: How does guest mode work?
A: Users can skip password entry. Frontend sends `null` as password_hash during registration, and backend assigns to `default_agent_group` (typically "guest").

### Q: What happens if password verification fails?
A: The modal displays the error message returned by backend. User can retry or choose guest mode.

### Q: Can I still use the old bcrypt-based system?
A: No, the backend has migrated to SHA-256. All clients must update to the new system.

## Future Improvements

Possible enhancements:
- [ ] Add password strength validation on client-side
- [ ] Support password reset workflow
- [ ] Add rate limiting for password verification attempts
- [ ] Implement two-factor authentication (2FA)
- [ ] Add session management for authenticated users

## Important Fix Records

### 2025-10-26: Migrated from bcrypt to SHA-256 Backend Verification

**Problem**:
- Frontend used bcrypt for client-side password verification
- Backend changed to SHA-256 (`hashlib.sha256`)
- Incompatibility between frontend (bcrypt) and backend (SHA-256)
- Security issue: password hashes exposed via `/api/health`

**Solution**:
- Removed bcrypt dependency completely
- Implemented SHA-256 hashing using Web Crypto API
- Created `system.verify_password` backend API for secure verification
- Removed client-side password verification
- Passwords now verified server-side only

**Benefits**:
- Better security (no hash exposure)
- Consistent with backend implementation
- Simpler codebase (removed bcrypt dependency)
- Centralized password logic on backend
- Reduced client-side attack surface
