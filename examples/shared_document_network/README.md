# Shared Document Network Demo

This directory contains a complete demonstration of the shared document mod capabilities, showing how multiple agents can collaborate on document creation, editing, and review in real-time.

## Demo Overview

The demo showcases:

1. **Document Creation**: An editor agent creates a new shared document
2. **Collaborative Editing**: Multiple agents simultaneously edit different parts
3. **Review and Comments**: A reviewer agent adds feedback and suggestions
4. **Presence Tracking**: Agents track each other's working positions
5. **Document Management**: Viewing content, history, and managing documents

## Files

- `network_config.yaml`: Network configuration for the demo
- `editor_agent.yaml`: Configuration for the document editor agent
- `reviewer_agent.yaml`: Configuration for the document reviewer agent  
- `collaborator_agent.yaml`: Configuration for the collaborative agent
- `demo_script.py`: Main demonstration script
- `README.md`: This documentation file

## Prerequisites

1. OpenAgents installed and configured
2. Python 3.8+ with required dependencies
3. OpenAI API key (set as `OPENAI_API_KEY` environment variable)

## Running the Demo

1. **Set up environment variables**:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   ```

2. **Run the demo**:
   ```bash
   cd examples/shared_document_network
   python demo_script.py
   ```

3. **Watch the collaboration**:
   The script will demonstrate various shared document operations with detailed output showing what each agent is doing.

## Demo Scenarios

### Scenario 1: Document Creation
- Editor agent creates a new "Project Requirements" document
- Sets initial content with placeholder sections
- Grants read/write permissions to other agents

### Scenario 2: Collaborative Editing
- Multiple agents open the same document
- Editor updates the scope section
- Collaborator adds detailed timeline information
- Editor adds resource allocation details
- All changes are synchronized in real-time

### Scenario 3: Review and Comments
- Reviewer agent opens the document
- Adds constructive comments to specific lines
- Provides feedback on content quality and completeness
- Comments are attached to specific line numbers

### Scenario 4: Presence Tracking
- Agents update their cursor positions
- System tracks who is working where in the document
- Other agents can see active collaborators and their positions

### Scenario 5: Document Management
- Retrieving current document content with comments
- Viewing operation history to see all changes
- Listing available documents
- Managing document access and permissions

## Expected Output

The demo produces detailed console output showing:

```
🎯 Starting Shared Document Collaboration Demo
============================================================
🚀 Setting up shared document collaboration network...
✅ Network started successfully
👥 Creating demonstration agents...
✅ All agents created and started

📝 Demo 1: Document Creation
--------------------------------------------------
Editor creating new document...
Document creation result: {'status': 'success', 'message': "Document creation request sent for 'Project Requirements'"}

🤝 Demo 2: Collaborative Editing
--------------------------------------------------
Agents opening document...
Editor updating scope section...
Collaborator adding timeline details...
Editor adding resource information...

💬 Demo 3: Review and Comments
--------------------------------------------------
Reviewer opening document for review...
Reviewer adding feedback comments...

👀 Demo 4: Agent Presence Tracking
--------------------------------------------------
Agents updating their working positions...
Checking agent presence...

📋 Demo 5: Document Management
--------------------------------------------------
Getting current document content...
Getting document operation history...
Listing all available documents...

🎉 Demo completed successfully!
============================================================
```

## Customization

You can customize the demo by:

1. **Modifying agent configurations**: Edit the YAML files to change agent personalities or capabilities
2. **Changing document content**: Update the initial content in `demo_script.py`
3. **Adding more agents**: Create additional agent configurations and add them to the demo
4. **Extending scenarios**: Add new demo functions to showcase additional features

## Troubleshooting

### Common Issues

1. **Network connection errors**: Ensure no other services are using port 8888
2. **Agent registration failures**: Check that agent configurations are valid
3. **OpenAI API errors**: Verify your API key is set correctly
4. **Permission errors**: Ensure agents have proper access permissions

### Debug Mode

Enable debug logging by modifying the network config:

```yaml
logging:
  level: "DEBUG"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
```

### Manual Testing

You can also test individual operations manually:

```python
# Create a simple test
import asyncio
from openagents.agents.simple_agent import SimpleAgent

async def test_basic_operations():
    agent = SimpleAgent("test_agent.yaml")
    await agent.start()
    
    # Create document
    result = await agent.create_document(
        document_name="Test Doc",
        initial_content="Hello World"
    )
    print(f"Create result: {result}")
    
    await agent.stop()

asyncio.run(test_basic_operations())
```

## Integration Examples

The shared document mod can be integrated into various use cases:

1. **Code Review Systems**: Collaborative code review with inline comments
2. **Documentation Creation**: Multi-author documentation with real-time editing
3. **Project Planning**: Collaborative requirement and planning documents
4. **Knowledge Management**: Shared knowledge bases with expert contributions
5. **Content Creation**: Collaborative writing and editing workflows

This demo provides a foundation for building more complex collaborative document systems using the OpenAgents shared document mod.
