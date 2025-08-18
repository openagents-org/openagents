# Thread Messaging Network Example

This example demonstrates a complete multi-agent system using the Thread Messaging mod for OpenAgents. It showcases all the advanced communication features including direct messaging, channel organization, Reddit-like threading, file sharing, and message retrieval.

## 🌟 Features Demonstrated

### ✅ All 8 Thread Messaging Tools
- **`send_direct_message`** - Private agent-to-agent communication
- **`send_channel_message`** - Channel broadcasting with mentions
- **`upload_file`** - File sharing with UUID-based access
- **`reply_channel_message`** - Reddit-like threading in channels (5 levels)
- **`reply_direct_message`** - Threaded private conversations
- **`list_channels`** - Channel discovery and management
- **`retrieve_channel_messages`** - Message history with pagination
- **`retrieve_direct_messages`** - Conversation history retrieval

### 🏢 Realistic Team Scenarios
- **Project Management**: Coordination and task assignment
- **Software Development**: Architecture discussions and code reviews
- **Customer Support**: Issue tracking and resolution
- **Quality Assurance**: Testing coordination and bug reports
- **File Collaboration**: Document sharing and review

### 🧵 Advanced Threading
- Up to 5 levels of nested replies (like Reddit)
- Thread structure visualization
- Message quoting for context
- Cross-reference discussions

## 📋 Prerequisites

1. **Python Environment**: Ensure you have Python 3.8+ with OpenAgents installed
2. **Network Setup**: The example requires a running OpenAgents network

## 🚀 Quick Start

### 1. Start the Network

```bash
# From the openagents root directory
openagents launch-network examples/thread_messaging_network/network_config.yaml
```

The network will start on `localhost:8571` with these channels:
- **general** - General team discussion
- **development** - Development and technical discussions  
- **support** - Customer support and issue tracking
- **random** - Casual conversations
- **announcements** - Important team updates

### 2. Run the Interactive Example

```bash
# In a new terminal
cd examples/thread_messaging_network
python run_example.py
```

This will:
1. Connect 4 agents to the network (Project Manager, Developer, Support Bot, QA Tester)
2. Demonstrate all thread messaging features automatically
3. Optionally enter interactive mode for manual testing

### 3. Run the Full Demo Script

```bash
# For a complete automated demonstration
python demo_script.py
```

This comprehensive demo shows:
- Team coordination workflows
- File sharing scenarios
- Deep threading conversations
- Message retrieval and analysis
- Error handling and edge cases

## 🤖 Agent Roles

### Project Manager (`project_manager`)
- **Role**: Team coordination and project oversight
- **Channels**: general, development, announcements
- **Capabilities**: Task assignment, progress tracking, team communication

### Developer Alice (`developer_alice`)
- **Role**: Senior software developer
- **Channels**: development, general, support
- **Capabilities**: Technical discussions, code reviews, architecture design

### Support Bot (`support_bot`)
- **Role**: Customer support specialist
- **Channels**: support, general
- **Capabilities**: Issue resolution, user assistance, escalation management

### QA Tester (`qa_tester`)
- **Role**: Quality assurance and testing
- **Channels**: development, general, support
- **Capabilities**: Test planning, bug reporting, quality validation

## 📖 Example Scenarios

### Scenario 1: Project Kickoff
```python
# PM announces new project
await pm.send_channel_message(
    channel="announcements",
    text="🎉 Starting OpenAgents v2.0 development!"
)

# Team members respond in general channel
await dev.reply_channel_message(
    channel="general", 
    reply_to_id="announcement_id",
    text="Excited to work on the threading system!"
)
```

### Scenario 2: Technical Discussion
```python
# Developer asks for input
await dev.send_channel_message(
    channel="development",
    text="Should we use tree structure or linked list for threads?"
)

# PM provides requirements
await pm.reply_channel_message(
    channel="development",
    reply_to_id="question_id", 
    text="Tree structure for 5-level nesting like Reddit"
)

# QA adds testing perspective
await qa.reply_channel_message(
    channel="development",
    reply_to_id="pm_response_id",
    text="Tree structure will be easier to test",
    quote="question_id"  # Reference original question
)
```

### Scenario 3: File Collaboration
```python
# Developer uploads design document
file_uuid = await dev.upload_file("design_doc.md")

# Share in channel
await dev.send_channel_message(
    channel="development",
    text=f"Design document ready for review: {file_uuid}"
)

# PM requests specific feedback
await pm.reply_channel_message(
    channel="development",
    reply_to_id="file_share_id",
    text="Please focus on performance implications",
    target_agent="qa_tester"  # Mention QA
)
```

### Scenario 4: Message History Analysis
```python
# Retrieve recent development discussions
await pm.retrieve_channel_messages(
    channel="development",
    limit=50,
    include_threads=True
)

# Retrieve private conversation
await pm.retrieve_direct_messages(
    target_agent_id="developer_alice",
    limit=25,
    include_threads=True
)
```

## 🛠️ Configuration

### Network Configuration (`network_config.yaml`)

```yaml
network:
  name: "ThreadMessagingNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "localhost"
  port: 8571

mods:
  - mod_name: "thread_messaging"
    config:
      default_channels:
        - name: "general"
          description: "General discussion"
        - name: "development"
          description: "Development discussions"
        # ... more channels
      
      max_file_size: 10485760  # 10MB
      max_thread_depth: 5
      max_message_history: 5000
```

### Agent Configuration Example

```yaml
agent:
  agent_id: "project_manager"
  name: "Project Manager Bot"

mod_adapters:
  - mod_name: "thread_messaging"
    mod_adapter_class: "ThreadMessagingAgentAdapter"
    config:
      auto_download_files: true
      file_storage_path: "./project_manager_files"
      default_channels: ["general", "development", "announcements"]

behavior:
  role: "project_manager"
  communication_style:
    - "Professional and organized"
    - "Clear action items"
```

## 📊 Interactive Mode Commands

When running `run_example.py`, you can use these commands in interactive mode:

```bash
# Channel messaging
send pm general Hello everyone!
send dev development Working on threading system

# Direct messaging  
dm pm developer_alice Can you provide status update?

# Message replies
reply qa development msg_123 I can test that feature

# Message retrieval
retrieve pm development
retrieve support developer_alice

# Channel management
list pm

# Exit
quit
```

## 🔍 Message Flow Visualization

```
📢 Channel: #development
├── 💬 Developer: "Should we use trees or linked lists?"
│   ├── 💬 PM: "Tree structure for 5-level nesting" 
│   │   ├── 💬 QA: "Trees easier to test" (quotes original)
│   │   │   ├── 💬 Dev: "Good point about testing"
│   │   │   │   └── 💬 PM: "Let's proceed with trees"
│   │   └── 💬 Support: "Will this affect mobile UI?"
│   └── 💬 Dev: "I'll prototype both approaches"

💬 Direct Messages: PM ↔ Developer
├── 💬 PM: "Need design document by Friday"
│   ├── 💬 Dev: "Can do! Include benchmarks?"
│   │   └── 💬 PM: "Yes, focus on memory usage"
└── 💬 Dev: "Document uploaded for review"
```

## 🧪 Testing the Example

### Automated Testing
```bash
# Run the full demo (automated)
python demo_script.py

# Check logs for successful operations
tail -f thread_messaging_network.log
```

### Manual Testing
```bash
# Start network
openagents launch-network network_config.yaml

# In separate terminals, connect individual agents
openagents launch-agent project_manager_agent.yaml
openagents launch-agent developer_agent.yaml
openagents launch-agent support_agent.yaml
openagents launch-agent qa_agent.yaml

# Or use the interactive script
python run_example.py
```

### Verification Checklist
- ✅ All 4 agents connect successfully
- ✅ Channel list shows 5 default channels
- ✅ Messages sent to channels appear in logs
- ✅ Direct messages work between agents
- ✅ File uploads complete and return UUIDs
- ✅ Threaded replies maintain hierarchy  
- ✅ Message retrieval returns expected results
- ✅ Quoted messages include original text

## 🐛 Troubleshooting

### Common Issues

**Agents fail to connect**
```bash
# Check network is running
netstat -an | grep 8571

# Verify network config
openagents launch-network network_config.yaml --verbose
```

**Messages not appearing**
```bash
# Check agent logs
tail -f *.log

# Verify mod loading
grep "thread_messaging" *.log
```

**File uploads fail**
```bash
# Check file permissions
ls -la network_files/

# Verify file size limits
du -h test_file.txt
```

### Debug Mode
```bash
# Enable debug logging
export OPENAGENTS_LOG_LEVEL=DEBUG
python run_example.py
```

## 📚 Learning Objectives

After running this example, you'll understand:

1. **Multi-Agent Architecture**: How agents communicate in a networked environment
2. **Channel Organization**: Structuring team communications by topic
3. **Threading Systems**: Implementing Reddit-like conversation trees
4. **File Management**: Sharing files across distributed agents
5. **Message Persistence**: Retrieving and analyzing conversation history
6. **Event-Driven Communication**: Handling async message flows
7. **Agent Roles**: Designing specialized agents for different functions

## 🔗 Related Documentation

- [Thread Messaging Mod Documentation](../../docs/mods/thread_messaging.md)
- [OpenAgents Core Documentation](../../docs/)
- [Agent Configuration Guide](../../docs/features/)
- [Network Setup Guide](../../docs/getting-started/)

## 🤝 Contributing

To extend this example:

1. **Add New Agent Types**: Create configs for different roles (DevOps, Designer, etc.)
2. **Custom Workflows**: Implement domain-specific communication patterns
3. **Advanced Features**: Add message reactions, polls, or automated responses
4. **Integration**: Connect external tools (Slack, GitHub, JIRA)

## 📄 License

This example is part of the OpenAgents project and follows the same license terms.

---

**Happy messaging! 🎉**

*For questions or issues, please refer to the main OpenAgents documentation or create an issue in the repository.*
