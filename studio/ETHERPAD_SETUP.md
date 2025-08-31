# Etherpad Integration Setup

The Studio now uses Etherpad for collaborative document editing. This provides real-time collaborative editing with operational transformation.

## Quick Setup (No Installation Required!)

The integration works out of the box using public Etherpad instances. No Docker, no installation, no configuration needed!

### Default Configuration

- **Default Server**: `https://pad.riseup.net` (free public instance)
- **Automatic Setup**: Works immediately when you open a document
- **Settings Panel**: Click the ⚙️ gear icon to change servers

### Using Your Own Etherpad Server

If you have your own Etherpad server, you can configure it in two ways:

#### Option 1: Environment Variable (Optional)
Add to your `.env` file in the studio directory:

```bash
# Etherpad Configuration (optional)
REACT_APP_ETHERPAD_URL=https://your-etherpad-server.com
```

#### Option 2: Settings Panel (Recommended)
1. Open any document in the Studio
2. Click the ⚙️ settings icon in the header
3. Enter your Etherpad server URL
4. Click "Apply"

### Popular Public Instances

The settings panel includes quick access to these public instances:

- **pad.riseup.net** (Default) - Privacy-focused, reliable
- **etherpad.wikimedia.org** - Wikimedia Foundation hosted  
- **board.net** - Simple and fast
- **pad.fnordig.de** - European instance
- **yopad.eu** - European collaborative platform

**Note**: Pad names are automatically cleaned to be alphanumeric-only for compatibility with different Etherpad instances.

## Self-Hosting Etherpad (Optional)

If you want to run your own Etherpad server, here are some options:

### Option 1: Docker (Simplest)

```bash
# Basic setup
docker run -d \
  --name etherpad \
  -p 9001:9001 \
  etherpad/etherpad:latest

# With persistence
docker run -d \
  --name etherpad \
  -p 9001:9001 \
  -v etherpad_data:/opt/etherpad-lite/var \
  etherpad/etherpad:latest
```

### Option 2: Node.js Installation

```bash
# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup Etherpad
git clone https://github.com/ether/etherpad-lite.git
cd etherpad-lite
npm install
npm start
```

### Option 3: Cloud Services

- **Heroku**: Deploy with one click using Etherpad buildpack
- **DigitalOcean**: Use their Etherpad one-click app
- **AWS/GCP**: Deploy using container services

## Features

### Current Implementation

- ✅ **Real-time collaborative editing** via Etherpad iframe
- ✅ **Document loading** from OpenAgents backend
- ✅ **User presence** display
- ✅ **Comments sidebar** (UI ready)
- ✅ **Read-only mode** support
- ✅ **Dark/light theme** integration

### Planned Enhancements

- 🔄 **Bidirectional sync** between Etherpad and OpenAgents backend
- 🔄 **API integration** for programmatic content management
- 🔄 **Comment system** integration with OpenAgents
- 🔄 **User authentication** integration
- 🔄 **Custom plugins** for OpenAgents-specific features

## API Integration (Future)

For more advanced integration, you can use the Etherpad HTTP API:

```typescript
// Example API calls
const etherpadApi = {
  // Get pad content
  async getPadText(padId: string): Promise<string> {
    const response = await fetch(`${ETHERPAD_URL}/api/1/getText?apikey=${API_KEY}&padID=${padId}`);
    const data = await response.json();
    return data.data.text;
  },

  // Set pad content
  async setPadText(padId: string, text: string): Promise<void> {
    await fetch(`${ETHERPAD_URL}/api/1/setText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: API_KEY,
        padID: padId,
        text: text
      })
    });
  },

  // Get pad users
  async getPadUsers(padId: string): Promise<any[]> {
    const response = await fetch(`${ETHERPAD_URL}/api/1/padUsers?apikey=${API_KEY}&padID=${padId}`);
    const data = await response.json();
    return data.data.padUsers;
  }
};
```

## Troubleshooting

### Common Issues

1. **Iframe not loading**: Check if the Etherpad server URL is accessible
2. **CORS issues**: Most public Etherpad instances allow iframe embedding
3. **Settings not saving**: Make sure to click "Apply" in the settings modal
4. **Slow loading**: Try switching to a different public instance

### Testing Connection

You can test if an Etherpad server works by:

1. Opening the URL directly in your browser
2. Creating a test pad to verify functionality
3. Checking if iframe embedding is allowed

### Switching Servers

If one server is slow or unavailable:

1. Click the ⚙️ settings icon in the document editor
2. Try a different public instance from the list
3. Or enter your own server URL

## Security Considerations

- **Production deployment**: Use proper authentication and HTTPS
- **API keys**: Keep API keys secure and rotate regularly  
- **Network isolation**: Consider running Etherpad in a private network
- **Content validation**: Validate content when syncing between systems
