# Network Publishing Feature

This feature allows admin users to publish their OpenAgents networks to the discovery registry directly from the Studio interface.

## Overview

Network publishing enables your network to be:
- **Discoverable**: Listed in the OpenAgents network directory
- **Accessible**: Connectable via `openagents://your-network-id`
- **Monitored**: Track views, likes, and connected agents
- **Online**: Automatic heartbeats keep your network status current

## Configuration

### 1. Get an API Key

Visit [openagents.org/dashboard](https://openagents.org/dashboard) to create your API key.

### 2. Configure network.yaml

Add the following sections to your `network.yaml`:

```yaml
network:
  # ... existing network config ...
  
  # Publishing configuration
  publishing:
    api_key: "env:OPENAGENTS_API_KEY"  # Recommended: use environment variable
    auto_heartbeat: true
    heartbeat_interval_minutes: 5
    discovery_server: "https://endpoint.openagents.org/v1"

# Network profile for discovery
network_profile:
  discoverable: true
  network_id: "my-unique-network-id"
  name: "My Network Name"
  description: "A description of what your network does"
  icon: "https://example.com/icon.png"  # Optional
  website: "https://mynetwork.example.com"  # Optional
  tags:
    - "research"
    - "ai"
  categories:
    - "Research"
  country: "United States"
  capacity: 100
  host: "0.0.0.0"
  port: 8700
  required_openagents_version: "0.7.5"
  readme: |
    ## Welcome to My Network
    
    Detailed information about your network...
```

### 3. Set Environment Variable (Recommended)

For security, store your API key in an environment variable:

```bash
export OPENAGENTS_API_KEY="oa-your-api-key-here"
```

Or add to your `.env` file:
```
OPENAGENTS_API_KEY=oa-your-api-key-here
```

## Using the Publishing Interface

### Access

1. Start your network with Studio enabled
2. Navigate to Studio at `http://localhost:8700/studio/`
3. Log in as an admin user
4. Click on "Publishing" in the navigation sidebar

### First-Time Publishing

1. **API Key**: Ensure your API key is configured
2. **Network Profile**: Verify your network profile settings
3. **Publish**: Click "Publish Network" button
4. **Verify**: Check the status shows "Published (Online)"

### Managing Published Networks

#### View Status
- **Online/Offline**: Current publication status
- **Network ID**: Your unique network identifier
- **Discovery URL**: Connection URL (`openagents://your-network-id`)
- **Statistics**: Views, likes, and connected agents

#### Update Profile
1. Click "Edit" on the Network Profile card
2. Modify profile details
3. Click "Save Changes"
4. Changes are immediately reflected in the directory

#### Send Heartbeat
- Click "💓 Send Heartbeat" to manually update status
- Auto-heartbeat runs automatically every 5 minutes (configurable)

#### Unpublish Network
1. Click "Unpublish Network"
2. Confirm the action
3. Network is removed from the directory

## API Endpoints

The following endpoints are available for programmatic access:

- `GET /api/admin/publishing/status` - Get current publishing status
- `POST /api/admin/publishing/publish` - Publish network
- `POST /api/admin/publishing/unpublish` - Unpublish network
- `PUT /api/admin/publishing/profile` - Update network profile
- `POST /api/admin/publishing/validate` - Validate network ID
- `GET /api/admin/publishing/stats` - Get statistics
- `POST /api/admin/publishing/heartbeat` - Send manual heartbeat
- `PUT /api/admin/publishing/settings` - Update settings

## Security Considerations

1. **API Key Protection**
   - Use environment variables instead of hardcoding keys
   - Never commit API keys to version control
   - Keep your API key secure and private

2. **Admin-Only Access**
   - Publishing features are restricted to admin users only
   - Admin status is verified via agent group membership

3. **HTTPS Communication**
   - All communication with the discovery server uses HTTPS
   - API keys are transmitted securely

## Troubleshooting

### Publishing Fails

**Problem**: "API key is not configured"
**Solution**: Ensure API key is set in network.yaml or environment variable

**Problem**: "Network ID already taken"
**Solution**: Choose a unique network ID and try again

### Heartbeat Not Sending

**Problem**: Auto-heartbeat not working
**Solution**: 
- Check that `auto_heartbeat: true` in publishing config
- Verify network is published
- Check logs for errors

### Not Visible in Directory

**Problem**: Network published but not appearing
**Solution**:
- Verify `discoverable: true` in network_profile
- Check that heartbeat is sending successfully
- Confirm network status shows "Online"

## Example

See the complete example in `examples/publishing_example/network.yaml`

## Further Reading

- [OpenAgents Documentation](https://docs.openagents.org)
- [Network Discovery Guide](https://docs.openagents.org/discovery)
- [API Reference](https://docs.openagents.org/api)
