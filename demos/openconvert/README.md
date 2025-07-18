# OpenConvert Demo

This demo showcases a distributed file conversion system using OpenAgents network protocols. It allows agents to advertise their file conversion capabilities and enables other agents to discover and request conversion services.

## Features

- **Discovery Protocol**: Agents can announce their conversion capabilities
- **Multiple Categories**: Support for archive, audio, code, doc, image, model, and video conversions
- **Network Communication**: Distributed agent communication via OpenAgents protocols
- **File Transfer**: Base64-encoded file transfer over the network
- **Mock Mode**: Testing support without external dependencies

## Operating Modes

### 1. Mock Mode (Default - For Testing)
When the `agconvert` package is not installed, the system runs in mock mode:
- ✅ **txt → md conversion**: Simple content copy with `.md` extension
- ❌ **Other conversions**: Not supported (will throw error)
- 🎯 **Purpose**: Testing discovery protocol and basic functionality

### 2. Full Mode (With agconvert)
When `agconvert` is installed, full conversion support is available:
- ✅ **All conversions**: 42+ conversion pairs across all categories
- 🔧 **Real processing**: Actual file format conversion
- 📊 **Production ready**: Complete conversion service

## Setup Instructions

### Quick Start (Mock Mode)
```bash
# 1. Start the network server
openagents launch-network demos/openconvert/network_config.yaml

# 2. In another terminal, start a doc conversion agent
python demos/openconvert/run_agent.py doc

# 3. In a third terminal, run the test
python demos/openconvert/test.py
```

### Full Setup (Production Mode)
```bash
# 1. Install agconvert package (if available)
# Note: agconvert is a separate package that must be installed separately
# Check with your administrator for installation instructions

# 2. Start the network server
openagents launch-network demos/openconvert/network_config.yaml

# 3. Start conversion agents for different categories
python demos/openconvert/run_agent.py doc      # Document conversions
python demos/openconvert/run_agent.py image    # Image conversions  
python demos/openconvert/run_agent.py audio    # Audio conversions
python demos/openconvert/run_agent.py video    # Video conversions
python demos/openconvert/run_agent.py archive  # Archive conversions
python demos/openconvert/run_agent.py code     # Code/markup conversions
python demos/openconvert/run_agent.py model    # 3D model conversions

# 4. Test the system
python demos/openconvert/test.py
```

## Supported Conversions

### Mock Mode
- **text/plain → text/markdown** (txt → md)

### Full Mode (requires agconvert)
Each category supports multiple conversion pairs:

#### Document (doc) - 42 conversion pairs
- txt ↔ pdf, docx, html, md, rtf, csv
- pdf ↔ docx, txt, jpg, png, epub, html  
- docx ↔ pdf, txt, rtf, html, md, epub
- html ↔ pdf, docx, txt, md
- md ↔ pdf, docx, html, txt
- csv ↔ xlsx, json, xml, sql
- And more...

#### Image (image) - 45 conversion pairs
- png, jpg, jpeg, bmp, tiff, gif, ico, svg, webp
- Comprehensive image format conversion matrix

#### Audio (audio) - 20 conversion pairs  
- mp3, wav, ogg, flac, aac
- Cross-format audio conversion

#### Video (video) - 30 conversion pairs
- mp4, avi, mkv, mov, gif, webm
- Video format and container conversion

#### Archive (archive) - 20 conversion pairs
- zip, rar, 7z, tar, gz
- Archive format conversion and compression

#### Code (code) - 25 conversion pairs
- json, yaml, xml, html, md, latex
- Code and markup format conversion

#### Model (model) - 20 conversion pairs
- stl, obj, fbx, ply, glb
- 3D model format conversion

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Test Client    │    │   Network Server │    │ Conversion Agent│
│                 │    │                  │    │                 │
│ 1. Connect      │───▶│ 2. Register      │◀───│ 1. Connect      │
│ 2. Discover     │───▶│ 3. Discovery     │───▶│ 2. Announce     │
│ 3. Request      │───▶│ 4. Route Msg     │───▶│ 3. Convert      │
│ 4. Receive      │◀───│ 5. Return Result │◀───│ 4. Send Result  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Protocol Details

### Discovery Protocol
- **Protocol**: `openagents.protocols.discovery.openconvert_discovery`
- **Messages**: `announce_conversion_capabilities`, `discover_conversion_agents`
- **Data**: Conversion pairs with MIME types `{"from": "text/plain", "to": "text/markdown"}`

### Messaging Protocol  
- **Protocol**: `openagents.protocols.communication.simple_messaging`
- **Format**: `CONVERT_FILE|source_mime|target_mime|filename|base64_content`
- **Transfer**: Base64-encoded file content over network messages

## Testing

The included test script verifies:
1. **Network Connection**: Can connect to OpenAgents network
2. **Agent Discovery**: Can find agents with specific conversion capabilities  
3. **Conversion Request**: Can send file conversion requests
4. **Result Verification**: Can receive and validate converted files

## Troubleshooting

### "No agents found"
- Ensure conversion agents are running with the right category
- Check that agents have registered their capabilities
- Verify network connectivity between components

### "agconvert package not found"
- System will run in mock mode (txt→md only)
- For full functionality, install the agconvert package
- Check installation instructions with your administrator

### Connection errors
- Ensure network server is running on correct port (8765)
- Check firewall settings
- Verify all components use same network configuration

## Network Configuration

The system uses a centralized network topology with:
- **Message Size Limit**: 10MB (for file transfers)
- **Timeout**: 30 seconds for conversions
- **Transport**: WebSocket on port 8765
- **Protocols**: Discovery + Simple Messaging

See `network_config.yaml` for detailed configuration. 