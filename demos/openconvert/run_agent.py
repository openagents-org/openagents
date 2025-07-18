#!/usr/bin/env python3
"""
OpenConvert Service Agent - A file conversion service agent for OpenAgents network.

This agent provides file conversion services for different categories:
- archive: zip, rar, 7z, tar, gz
- audio: mp3, wav, ogg, flac, aac
- code: json, yaml, xml, html, md, latex
- doc: txt, docx, pdf, html, md, rtf, csv, xlsx, epub
- image: png, jpg, jpeg, bmp, tiff, gif, ico, svg, webp
- model: stl, obj, fbx, ply, glb
- video: mp4, avi, mkv, mov, gif, webm

Usage:
    python run_agent.py <category>
    
Example:
    python run_agent.py image
    python run_agent.py doc
"""

import asyncio
import argparse
import logging
import sys
import os
import tempfile
import base64
from pathlib import Path
from typing import Dict, List, Tuple

# Add src directory to path to import openagents modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

# Set up logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from openagents.agents.runner import AgentRunner
from openagents.models.messages import DirectMessage, BroadcastMessage, BaseMessage
from openagents.models.message_thread import MessageThread
from openagents.protocols.discovery.openconvert_discovery import OpenConvertDiscoveryAdapter
from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter

# Import agconvert for file conversion
AGCONVERT_AVAILABLE = True
try:
    from agconvert import convert  # type: ignore
    logger.info("✅ agconvert package found")
except ImportError:
    AGCONVERT_AVAILABLE = False
    convert = None
    logger.warning("⚠️  agconvert package not found - running in MOCK MODE for testing")
    logger.warning("   In mock mode, only txt->md conversion is supported")
    logger.warning("   For full functionality, install agconvert package")

# Define supported conversions by category with MIME type mappings
CATEGORY_CONVERSIONS = {
    'archive': {
        'extensions': {
            'zip': ['rar', '7z', 'tar', 'gz'],
            'rar': ['zip', '7z', 'tar', 'gz'],
            '7z': ['zip', 'rar', 'tar', 'gz'],
            'tar': ['zip', 'rar', '7z', 'gz'],
            'gz': ['zip', 'rar', '7z', 'tar']
        },
        'mime_mapping': {
            'zip': 'application/zip',
            'rar': 'application/x-rar-compressed',
            '7z': 'application/x-7z-compressed',
            'tar': 'application/x-tar',
            'gz': 'application/gzip'
        }
    },
    'audio': {
        'extensions': {
            'mp3': ['wav', 'ogg', 'flac', 'aac'],
            'wav': ['mp3', 'ogg', 'flac', 'aac'],
            'ogg': ['mp3', 'wav', 'flac', 'aac'],
            'flac': ['mp3', 'wav', 'ogg', 'aac'],
            'aac': ['mp3', 'wav', 'ogg', 'flac']
        },
        'mime_mapping': {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
            'aac': 'audio/aac'
        }
    },
    'code': {
        'extensions': {
            'json': ['xml', 'yaml', 'csv', 'txt'],
            'yaml': ['json', 'xml', 'txt'],
            'xml': ['json', 'yaml', 'txt'],
            'html': ['md', 'txt', 'pdf'],
            'md': ['html', 'txt', 'pdf'],
            'latex': ['pdf', 'docx', 'html']
        },
        'mime_mapping': {
            'json': 'application/json',
            'yaml': 'application/x-yaml',
            'xml': 'application/xml',
            'html': 'text/html',
            'md': 'text/markdown',
            'latex': 'application/x-latex',
            'txt': 'text/plain',
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
    },
    'doc': {
        'extensions': {
            'txt': ['pdf', 'docx', 'rtf', 'md', 'html', 'csv'],
            'docx': ['pdf', 'txt', 'rtf', 'html', 'md', 'epub'],
            'pdf': ['docx', 'txt', 'jpg', 'png', 'epub', 'html'],
            'html': ['pdf', 'docx', 'txt', 'md'],
            'md': ['pdf', 'docx', 'html', 'txt'],
            'rtf': ['docx', 'pdf', 'txt'],
            'csv': ['xlsx', 'json', 'txt', 'xml', 'sql'],
            'xlsx': ['csv', 'json', 'xml', 'sql'],
            'epub': ['pdf', 'docx', 'txt', 'html']
        },
        'mime_mapping': {
            'txt': 'text/plain',
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'rtf': 'application/rtf',
            'md': 'text/markdown',
            'html': 'text/html',
            'csv': 'text/csv',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'epub': 'application/epub+zip',
            'jpg': 'image/jpeg',
            'png': 'image/png',
            'json': 'application/json',
            'xml': 'application/xml',
            'sql': 'application/sql'
        }
    },
    'image': {
        'extensions': {
            'png': ['jpg', 'jpeg', 'bmp', 'tiff', 'gif', 'pdf', 'ico', 'svg', 'webp'],
            'jpg': ['png', 'bmp', 'tiff', 'gif', 'pdf', 'ico', 'svg', 'webp'],
            'jpeg': ['png', 'bmp', 'tiff', 'gif', 'pdf', 'ico', 'svg', 'webp'],
            'bmp': ['png', 'jpg', 'tiff', 'gif', 'pdf', 'ico', 'webp'],
            'gif': ['png', 'jpg', 'bmp', 'tiff', 'pdf', 'ico', 'webp'],
            'tiff': ['png', 'jpg', 'bmp', 'gif', 'pdf', 'webp'],
            'ico': ['png', 'jpg', 'bmp', 'tiff', 'gif', 'webp'],
            'svg': ['png', 'jpg', 'bmp', 'tiff', 'pdf', 'webp'],
            'webp': ['png', 'jpg', 'bmp', 'tiff', 'gif', 'pdf']
        },
        'mime_mapping': {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'bmp': 'image/bmp',
            'tiff': 'image/tiff',
            'gif': 'image/gif',
            'pdf': 'application/pdf',
            'ico': 'image/x-icon',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        }
    },
    'model': {
        'extensions': {
            'stl': ['obj', 'fbx', 'ply', 'glb', 'ply'],
            'obj': ['stl', 'fbx', 'ply'],
            'fbx': ['stl', 'obj', 'ply'],
            'ply': ['stl', 'obj', 'fbx']
        },
        'mime_mapping': {
            'stl': 'model/stl',
            'obj': 'model/obj',
            'fbx': 'model/fbx',
            'ply': 'model/ply',
            'glb': 'model/gltf-binary'
        }
    },
    'video': {
        'extensions': {
            'mp4': ['avi', 'mkv', 'mov', 'gif', 'webm'],
            'avi': ['mp4', 'mkv', 'mov', 'gif'],
            'mkv': ['mp4', 'avi', 'mov'],
            'mov': ['mp4', 'avi', 'mkv'],
            'gif': ['mp4', 'avi'],
            'webm': ['mp4', 'avi', 'mkv']
        },
        'mime_mapping': {
            'mp4': 'video/mp4',
            'avi': 'video/x-msvideo',
            'mkv': 'video/x-matroska',
            'mov': 'video/quicktime',
            'gif': 'image/gif',
            'webm': 'video/webm'
        }
    }
}


class OpenConvertServiceAgent(AgentRunner):
    """OpenConvert service agent that handles file conversion requests."""
    
    def __init__(self, category: str):
        """Initialize the conversion agent for a specific category.
        
        Args:
            category: The conversion category (archive, audio, code, doc, image, model, video)
        """
        if category not in CATEGORY_CONVERSIONS:
            raise ValueError(f"Unsupported category: {category}. Supported: {list(CATEGORY_CONVERSIONS.keys())}")
        
        self.category = category
        self.category_config = CATEGORY_CONVERSIONS[category]
        
        # Create agent ID based on category
        agent_id = f"OpenConvert-{category.capitalize()}Agent"
        
        # Create protocol adapters before initializing AgentRunner
        self.discovery_adapter = OpenConvertDiscoveryAdapter()
        self.messaging_adapter = SimpleMessagingAgentAdapter()
        
        # Initialize AgentRunner with the protocol adapters
        super().__init__(
            agent_id=agent_id,
            protocol_adapters=[self.discovery_adapter, self.messaging_adapter]
        )
        
        logger.info(f"Initialized {agent_id} for {category} conversions")

    def _generate_conversion_pairs(self) -> List[Dict[str, str]]:
        """Generate conversion pairs for this category."""
        conversion_pairs = []
        extensions = self.category_config['extensions']
        mime_mapping = self.category_config['mime_mapping']
        
        for source_ext, target_exts in extensions.items():
            source_mime = mime_mapping.get(source_ext, f"{self.category}/{source_ext}")
            for target_ext in target_exts:
                target_mime = mime_mapping.get(target_ext, f"{self.category}/{target_ext}")
                conversion_pairs.append({
                    "from": source_mime,
                    "to": target_mime
                })
        
        return conversion_pairs

    async def setup(self):
        """Setup the agent after connection."""
        logger.info(f"🚀 {self.client.agent_id} connected and setting up...")
        
        # Protocol adapters are already registered in constructor
        logger.info("📦 Protocol adapters already registered")
        
        # Generate conversion capabilities
        conversion_pairs = self._generate_conversion_pairs()
        
        # Set conversion capabilities
        await self.discovery_adapter.set_conversion_capabilities({
            "conversion_pairs": conversion_pairs,
            "description": f"OpenConvert {self.category} conversion service - supports {len(conversion_pairs)} conversion pairs"
        })
        
        logger.info(f"📋 Registered {len(conversion_pairs)} conversion pairs for {self.category}")
        print(f"🎯 {self.client.agent_id} ready! Supports {len(conversion_pairs)} conversions")
        
        # Announce availability
        greeting_content = {"text": f"{self.client.agent_id} is ready! I can handle {self.category} file conversions."}
        await self.messaging_adapter.send_broadcast_message(greeting_content)

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to incoming messages - handle conversion requests."""
        try:
            sender_id = incoming_message.sender_id
            content = incoming_message.content
            
            logger.info(f"📨 Received message from {sender_id}: {content}")
            
            # Handle direct messages with file conversion requests
            if isinstance(incoming_message, DirectMessage):
                await self._handle_conversion_request(incoming_message)
            elif isinstance(incoming_message, BroadcastMessage):
                # Ignore broadcast messages for now
                pass
                
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            if isinstance(incoming_message, DirectMessage):
                await self._send_error_response(incoming_message.sender_id, str(e))

    async def _handle_conversion_request(self, message: DirectMessage):
        """Handle a file conversion request."""
        content = message.content
        sender_id = message.sender_id
        
        # Check if this is a conversion request
        file_data = content.get("file_data")
        source_format = content.get("source_format")
        target_format = content.get("target_format")
        filename = content.get("filename", "input_file")
        
        if not file_data or not source_format or not target_format:
            await self._send_response(sender_id, 
                "Invalid conversion request. Required fields: file_data (base64), source_format (MIME), target_format (MIME), filename")
            return
        
        # Ensure we have strings for type safety
        if not isinstance(file_data, str) or not isinstance(source_format, str) or not isinstance(target_format, str):
            await self._send_response(sender_id, 
                "Invalid conversion request. file_data, source_format, and target_format must be strings")
            return
        
        logger.info(f"🔄 Converting {filename} from {source_format} to {target_format}")
        
        try:
            # Check if we can handle this conversion
            if not self._can_convert(source_format, target_format):
                await self._send_response(sender_id, 
                    f"Cannot convert from {source_format} to {target_format}. This agent handles {self.category} conversions.")
                return
            
            # Decode file data
            file_bytes = base64.b64decode(file_data)
            
            # Create temporary files
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_dir = Path(temp_dir)
                
                # Save input file
                source_ext = source_format.split('/')[-1]
                input_file = temp_dir / f"input.{source_ext}"
                input_file.write_bytes(file_bytes)
                
                # Handle conversion based on availability
                if not AGCONVERT_AVAILABLE:
                    # Mock mode - only support txt -> md
                    if source_format == "text/plain" and target_format == "text/markdown":
                        target_ext = "md"
                        output_file_path = temp_dir / f"output.{target_ext}"
                        # Copy content as-is
                        output_file_path.write_bytes(file_bytes)
                        output_file_path = str(output_file_path)
                        logger.info(f"🧪 Mock mode: txt -> md conversion (simple copy)")
                    else:
                        raise ValueError(f"Mock mode only supports txt->md conversion, got {source_format}->{target_format}")
                elif source_format == "text/plain" and target_format == "text/markdown":
                    # For testing: just copy content with .md extension even with agconvert available
                    target_ext = "md"
                    output_file_path = temp_dir / f"output.{target_ext}"
                    # Copy content as-is
                    output_file_path.write_bytes(file_bytes)
                    output_file_path = str(output_file_path)
                    logger.info(f"🧪 Test mode: txt -> md conversion (simple copy)")
                else:
                    # Normal conversion using agconvert
                    if not AGCONVERT_AVAILABLE or convert is None:
                        raise ValueError("agconvert package required for this conversion")
                    output_file_path = convert(
                        filepath=str(input_file),
                        source_mine_format=source_format,
                        target_mine_format=target_format,
                        output_path=str(temp_dir),
                        options={}
                    )
                
                # Read converted file
                output_file = Path(output_file_path)
                converted_data = output_file.read_bytes()
                converted_base64 = base64.b64encode(converted_data).decode('utf-8')
                
                # Send converted file back
                target_ext = target_format.split('/')[-1]
                converted_filename = Path(filename).stem + f".{target_ext}"
                
                await self._send_converted_file(sender_id, converted_base64, target_format, converted_filename)
                
                logger.info(f"✅ Successfully converted {filename} for {sender_id}")
                
        except Exception as e:
            logger.error(f"❌ Conversion failed: {e}")
            await self._send_error_response(sender_id, f"Conversion failed: {str(e)}")

    def _can_convert(self, source_format: str, target_format: str) -> bool:
        """Check if this agent can handle the conversion."""
        conversion_pairs = self._generate_conversion_pairs()
        
        for pair in conversion_pairs:
            if pair["from"] == source_format and pair["to"] == target_format:
                return True
        return False

    async def _send_converted_file(self, recipient_id: str, file_data: str, mime_type: str, filename: str):
        """Send converted file back to the requester."""
        response_content = {
            "text": f"File conversion completed: {filename}",
            "file_data": file_data,
            "mime_type": mime_type,
            "filename": filename,
            "conversion_status": "success"
        }
        await self.messaging_adapter.send_direct_message(recipient_id, response_content)

    async def _send_response(self, recipient_id: str, message: str):
        """Send a text response."""
        response_content = {"text": message}
        await self.messaging_adapter.send_direct_message(recipient_id, response_content)

    async def _send_error_response(self, recipient_id: str, error_message: str):
        """Send an error response."""
        response_content = {
            "text": f"Conversion error: {error_message}",
            "conversion_status": "error",
            "error": error_message
        }
        await self.messaging_adapter.send_direct_message(recipient_id, response_content)

    async def teardown(self):
        """Cleanup before disconnection."""
        logger.info(f"🔌 {self.client.agent_id} is shutting down...")
        
        # Send goodbye message
        goodbye_content = {"text": f"{self.client.agent_id} is going offline. Goodbye!"}
        await self.messaging_adapter.send_broadcast_message(goodbye_content)


def main():
    """Main function to run the OpenConvert service agent."""
    parser = argparse.ArgumentParser(
        description="OpenConvert Service Agent - File conversion service for OpenAgents network",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Supported categories:
  archive  - zip, rar, 7z, tar, gz
  audio    - mp3, wav, ogg, flac, aac  
  code     - json, yaml, xml, html, md, latex
  doc      - txt, docx, pdf, html, md, rtf, csv, xlsx, epub
  image    - png, jpg, jpeg, bmp, tiff, gif, ico, svg, webp
  model    - stl, obj, fbx, ply, glb
  video    - mp4, avi, mkv, mov, gif, webm

Example usage:
  python run_agent.py image
  python run_agent.py doc
        """
    )
    parser.add_argument(
        "category", 
        choices=list(CATEGORY_CONVERSIONS.keys()),
        help="Conversion category to handle"
    )
    parser.add_argument(
        "--host", 
        default="localhost",
        help="Network host to connect to (default: localhost)"
    )
    parser.add_argument(
        "--port", 
        type=int,
        default=8765,
        help="Network port to connect to (default: 8765)"
    )
    
    args = parser.parse_args()
    
    # Create agent
    try:
        agent = OpenConvertServiceAgent(args.category)
    except ValueError as e:
        print(f"Error: {e}")
        return 1
    
    # Agent metadata
    metadata = {
        "name": f"OpenConvert {args.category.capitalize()} Agent",
        "type": "conversion_service",
        "category": args.category,
        "capabilities": ["file_conversion", args.category],
        "version": "1.0.0",
        "protocols": ["openagents.protocols.discovery.openconvert_discovery", "openagents.protocols.communication.simple_messaging"]
    }
    
    try:
        print(f"🚀 Starting OpenConvert-{args.category.capitalize()}Agent...")
        print(f"🌐 Connecting to {args.host}:{args.port}...")
        print(f"📁 Handling {args.category} file conversions")
        print("Press Ctrl+C to stop")
        
        # Start the agent
        agent.start(host=args.host, port=args.port, metadata=metadata)
        
        # Wait for the agent to finish
        agent.wait_for_stop()
        
    except KeyboardInterrupt:
        print("\n🛑 Shutting down agent...")
    except Exception as e:
        print(f"❌ Error running agent: {e}")
        return 1
    finally:
        # Stop the agent
        agent.stop()
        print("✅ Agent stopped")
    
    return 0


if __name__ == "__main__":
    sys.exit(main()) 