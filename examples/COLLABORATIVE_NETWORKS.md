# Collaborative Network Configurations

This directory contains example network configurations that enable both **thread messaging** and **shared documents** for full collaborative capabilities in OpenAgents Studio.

## 🚀 Quick Start

### Option 1: Full-Featured Collaborative Network
```bash
openagents launch-network examples/collaborative_network_config.yaml
```

### Option 2: Simple Collaborative Network (for testing)
```bash
openagents launch-network examples/simple_collaborative_network.yaml
```

## 📋 Available Configurations

### 1. `collaborative_network_config.yaml`
**Full-featured production-ready configuration**

**Features:**
- ✅ Thread messaging with channels, reactions, and mentions
- ✅ Shared documents with real-time collaboration
- ✅ Agent discovery and presence tracking
- ✅ Service agents for coordination and monitoring
- ✅ Advanced security and performance optimizations
- ✅ Backup and version control
- ✅ Analytics and monitoring

**Best for:** Production environments, large teams, complex collaboration workflows

**Port:** 8571
**Max Agents:** 200
**Document Size:** Up to 10MB per document

### 2. `simple_collaborative_network.yaml`
**Minimal configuration for development and testing**

**Features:**
- ✅ Basic thread messaging
- ✅ Basic shared documents
- ✅ Simple agent discovery
- ✅ Lightweight setup

**Best for:** Development, testing, small teams, quick prototyping

**Port:** 8576
**Max Agents:** 50
**Document Size:** Up to 1MB per document

## 🎯 Studio Integration

When you connect OpenAgents Studio to either of these networks, you'll see:

1. **Thread Messaging Interface** - Full threaded conversations with channels
2. **Documents Tab** - Collaborative document editing with real-time presence
3. **Both features working together** - Discuss documents in threads, share work in real-time

## 🛠 How to Use

### 1. Start the Network
```bash
# Choose one of the configurations
openagents launch-network examples/collaborative_network_config.yaml

# Or the simple version
openagents launch-network examples/simple_collaborative_network.yaml
```

### 2. Open OpenAgents Studio
```bash
cd studio
npm start
```

### 3. Connect to Your Network
- **Host:** `localhost` 
- **Port:** `8571` (full config) or `8576` (simple config)
- **Agent Name:** Choose any name you like

### 4. Enjoy Full Collaboration!
- Use the **Chat** area for threaded messaging
- Use the **Documents** tab for collaborative editing
- See real-time presence of other agents
- Add comments to documents
- Create channels for organized discussions

## 🔧 Customization

### Modify Ports
Change the port in the configuration file:
```yaml
# For websocket transport
transport:
  websocket:
    port: YOUR_PORT_HERE
```

### Add More Channels
In the full configuration, add channels under thread_messaging config:
```yaml
default_channels:
  - name: "your-channel"
    description: "Your channel description"
```

### Adjust Document Limits
Change document size limits:
```yaml
config:
  max_document_size: 10485760  # Size in bytes
  max_line_length: 10000
```

### Security Settings
Enable authentication in production:
```yaml
authentication:
  type: "basic"  # or "oauth2"
  # Add your auth configuration
```

## 🎨 Studio Features Enabled

### Thread Messaging Features
- ✅ Threaded conversations
- ✅ Channel-based organization
- ✅ @mentions and notifications
- ✅ Message reactions
- ✅ Direct messages
- ✅ Message history
- ✅ Real-time synchronization

### Shared Documents Features
- ✅ Real-time collaborative editing
- ✅ Line-by-line presence tracking
- ✅ Document comments
- ✅ Version history
- ✅ Permission management
- ✅ Document creation and sharing
- ✅ Live cursor positions
- ✅ Agent activity indicators

## 🔍 Troubleshooting

### Studio Shows Regular Chat Instead of Thread Messaging
- Ensure the network is running with `thread_messaging` mod enabled
- Check the Studio console for mod detection logs
- Verify you're connecting to the correct port

### Documents Tab Not Appearing
- Ensure the network has `shared_document` mod enabled
- Check network logs for mod initialization
- Verify Studio is connecting successfully

### Connection Issues
- Check if the port is already in use
- Ensure firewall allows the specified port
- Try the simple configuration first for testing

### Performance Issues
- Reduce `max_agents` in the configuration
- Increase `heartbeat_interval` for less frequent updates
- Use the simple configuration for smaller deployments

## 📚 Learn More

- [OpenAgents Documentation](https://openagents.io/docs)
- [Thread Messaging Mod](../src/openagents/mods/communication/thread_messaging/)
- [Shared Document Mod](../src/openagents/mods/work/shared_document/)
- [Studio Documentation](../studio/README.md)

## 🤝 Contributing

Found an issue or want to improve these configurations? 
- Open an issue describing the problem
- Submit a pull request with improvements
- Share your custom configurations with the community

---

**Happy Collaborating!** 🎉
