# Interview Hub Mode

Interview Hub Mode is a special configuration for the OpenAgents Studio designed to provide a streamlined experience for the PeakMojo Interview Hub platform.

## Overview

When Interview Hub Mode is enabled, the Studio:

1. **Replaces the network selection page** with a simplified login form
2. **Automatically connects** to a pre-configured network
3. **Generates agent names** automatically from user information
4. **Hides the module switcher** sidebar for a focused interface
5. **Redirects directly** to the Interview Hub page

## Configuration

### Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Enable Interview Hub Mode
REACT_APP_INTERVIEW_HUB_MODE=true

# Network Configuration
REACT_APP_INTERVIEW_HUB_HOST=localhost
REACT_APP_INTERVIEW_HUB_PORT=8700
```

### Example Configuration

For a production Interview Hub deployment:

```bash
REACT_APP_INTERVIEW_HUB_MODE=true
REACT_APP_INTERVIEW_HUB_HOST=interview.peakmojo.com
REACT_APP_INTERVIEW_HUB_PORT=8700
```

## User Experience Flow

### Standard Mode (Default)

1. User sees network selection page
2. User chooses or enters network details
3. User picks an agent name
4. User enters password (if required)
5. User is directed to the default module

### Interview Hub Mode (Enabled)

1. User sees simplified login form
2. User enters:
   - First Name
   - Last Name
   - Email Address
3. Agent name is automatically generated as `firstname.lastname`
   - Spaces are replaced with underscores
   - All lowercase
4. User is automatically connected to the configured network
5. User is directed to the Interview Hub page (`/interview/interviewer-hub`)

## Agent Name Generation

The agent name is automatically generated from the user's first and last name:

- Format: `{first_name}.{last_name}`
- All lowercase
- Spaces replaced with underscores

### Examples

| First Name | Last Name | Agent Name |
|------------|-----------|------------|
| John | Doe | john.doe |
| Mary Jane | Smith | mary_jane.smith |
| José | García | josé.garcía |

## UI Changes in Interview Hub Mode

### Hidden Elements

- **Module Switcher Sidebar**: The left sidebar for switching between different modules (Messaging, Forum, Wiki, etc.) is hidden
- **Network Selection**: Users cannot manually select or switch networks

### Modified Elements

- **Login Page**: Simplified to collect only essential user information
- **Default Route**: Changed from `/messaging` to `/interview/interviewer-hub`

## Implementation Details

### Key Files

1. **Configuration**
   - `src/config/interviewHubConfig.ts`: Configuration utilities and environment variable handling

2. **Components**
   - `src/components/interview/InterviewHubLogin.tsx`: Simplified login form
   - `src/pages/NetworkSelectionPage.tsx`: Modified to show Interview Hub login when enabled
   - `src/pages/AgentSetupPage.tsx`: Auto-proceeds in Interview Hub mode

3. **Layout**
   - `src/components/layout/RootLayout.tsx`: Hides ModSidebar when interview mod is enabled
   - `src/utils/moduleUtils.ts`: Sets default route to `/interview/interviewer-hub`

### Configuration Functions

```typescript
// Check if Interview Hub mode is enabled
import { isInterviewHubMode } from '@/config/interviewHubConfig';

if (isInterviewHubMode()) {
  // Show Interview Hub specific UI
}

// Get Interview Hub configuration
import { getInterviewHubConfig } from '@/config/interviewHubConfig';

const config = getInterviewHubConfig();
// config.enabled, config.host, config.port

// Generate agent name from user info
import { generateAgentNameFromUserInfo } from '@/config/interviewHubConfig';

const agentName = generateAgentNameFromUserInfo('John', 'Doe');
// Returns: "john.doe"
```

## Development

### Testing Interview Hub Mode Locally

1. Update your `.env` file:
   ```bash
   REACT_APP_INTERVIEW_HUB_MODE=true
   REACT_APP_INTERVIEW_HUB_HOST=localhost
   REACT_APP_INTERVIEW_HUB_PORT=8700
   ```

2. Ensure you have a network running with interview mod enabled on port 8700

3. Start the Studio:
   ```bash
   cd studio
   npm start
   ```

4. Navigate to `http://localhost:8050`

5. You should see the Interview Hub login form instead of the standard network selection page

### Disabling Interview Hub Mode

To return to standard mode, either:

1. Set `REACT_APP_INTERVIEW_HUB_MODE=false` in `.env`, or
2. Remove the `REACT_APP_INTERVIEW_HUB_MODE` variable entirely

Then restart the development server.

## Security Considerations

### User Data

In Interview Hub mode, user information (first name, last name, email) is:
- Used to generate the agent name
- Stored locally in browser cookies for the network connection
- Sent to the network during agent registration

### Password Authentication

Interview Hub mode assumes the network does not require password authentication. The `setPasswordHash(null)` is called, meaning users connect as guests or in a passwordless mode.

If password authentication is required for your Interview Hub deployment, you'll need to:
1. Add a password field to the `InterviewHubLogin` component
2. Update the password verification logic
3. Store the password hash appropriately

## Deployment

### Production Deployment Steps

1. **Set Environment Variables** on your hosting platform:
   ```bash
   REACT_APP_INTERVIEW_HUB_MODE=true
   REACT_APP_INTERVIEW_HUB_HOST=your-network-host.com
   REACT_APP_INTERVIEW_HUB_PORT=8700
   ```

2. **Build the application**:
   ```bash
   cd studio
   npm run build
   ```

3. **Deploy** the `build/` directory to your hosting platform

4. **Verify** the configuration by accessing your deployment URL

### Environment-Specific Configurations

For multiple environments (dev, staging, production), use different `.env` files:

- `.env.development` - Development configuration
- `.env.staging` - Staging configuration
- `.env.production` - Production configuration

Create React App will automatically load the appropriate file based on the `NODE_ENV`.

## Troubleshooting

### Issue: Login form not showing

**Solution**: Verify that `REACT_APP_INTERVIEW_HUB_MODE=true` is set in your `.env` file and restart the development server.

### Issue: Unable to connect to network

**Solution**:
1. Check that the network is running on the specified host and port
2. Verify `REACT_APP_INTERVIEW_HUB_HOST` and `REACT_APP_INTERVIEW_HUB_PORT` are correct
3. Check browser console for connection errors

### Issue: Agent name contains invalid characters

**Solution**: The agent name generator automatically handles spaces and special characters. If you're seeing issues, check the `generateAgentNameFromUserInfo()` function in `src/config/interviewHubConfig.ts`.

### Issue: Still seeing the module switcher sidebar

**Solution**: The sidebar is hidden when the interview mod is enabled. Ensure:
1. Your network has the interview mod enabled
2. The network's `/api/health` endpoint returns the interview mod in the mods list
3. The module visibility logic in `RootLayout.tsx` is working correctly

## Future Enhancements

Potential improvements for Interview Hub mode:

1. **Custom Branding**: Allow configuring logo, colors, and text via environment variables
2. **Additional Fields**: Support for collecting additional user information (phone, location, etc.)
3. **Multi-Language**: Support for internationalization in the login form
4. **Email Verification**: Optional email verification step before connecting
5. **Terms & Conditions**: Display and require acceptance of terms before proceeding
6. **Custom Agent Name Format**: Allow configuring the agent name format via environment variables
