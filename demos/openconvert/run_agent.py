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
from typing import Dict, List, Tuple, Any

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
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'csv': 'text/csv'  # Added missing CSV mapping
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
        
        # Add built-in conversions for any agent category
        builtin_pairs = self._get_builtin_conversion_pairs()
        conversion_pairs.extend(builtin_pairs)
        
        return conversion_pairs
    
    def _get_builtin_conversion_pairs(self) -> List[Dict[str, str]]:
        """Get list of built-in conversion pairs supported by our enhanced methods."""
        pairs = []
        
        # Text document conversions
        pairs.extend([
            {"from": "text/plain", "to": "text/markdown"},
            {"from": "text/plain", "to": "text/html"},
            {"from": "text/plain", "to": "application/pdf"},
        ])
        
        # HTML conversions 
        pairs.extend([
            {"from": "text/html", "to": "text/plain"},
            {"from": "text/html", "to": "text/markdown"},
        ])
        
        # Markdown conversions
        pairs.extend([
            {"from": "text/markdown", "to": "text/html"},
            {"from": "text/markdown", "to": "text/plain"},
        ])
        
        # JSON conversions
        pairs.extend([
            {"from": "application/json", "to": "text/plain"},
            {"from": "application/json", "to": "text/csv"},
        ])
        
        # CSV conversions
        pairs.extend([
            {"from": "text/csv", "to": "application/json"},
            {"from": "text/csv", "to": "text/plain"},
        ])
        
        return pairs

    async def setup(self):
        """Setup the agent after connection."""
        logger.info(f"🚀 {self.client.agent_id} connected and setting up...")
        
        # Protocol adapters are already registered in constructor
        logger.info("📦 Protocol adapters already registered")
        
        # CRITICAL FIX: Register direct message handler for conversion requests
        # This bypasses the AgentRunner integration issue
        self.messaging_adapter.register_message_handler(
            "conversion_handler", 
            self._handle_conversion_message
        )
        logger.info("✅ Registered direct message handler for conversions")
        
        # Generate conversion capabilities
        conversion_pairs = self._generate_conversion_pairs()
        
        # Set conversion capabilities
        await self.discovery_adapter.set_conversion_capabilities({
            "conversion_pairs": conversion_pairs,
            "description": f"OpenConvert {self.category} conversion service - supports {len(conversion_pairs)} conversion pairs"
        })
        
        logger.info(f"📋 Registered {len(conversion_pairs)} conversion pairs for {self.category}")
        print(f"🎯 {self.client.agent_id} ready! Supports {len(conversion_pairs)} conversions")
    
    def _handle_conversion_message(self, content: Dict[str, Any], sender_id: str):
        """Handle incoming conversion messages directly from the protocol adapter.
        
        This bypasses the AgentRunner integration issue by handling messages directly.
        """
        logger.info(f"📨 Direct message handler received message from {sender_id}")
        logger.info(f"   Content keys: {list(content.keys())}")
        
        # Create an async task to handle the conversion
        asyncio.create_task(self._process_conversion_request(content, sender_id))
    
    def _convert_with_builtin_methods(self, source_format: str, target_format: str, 
                                    input_file: Path, temp_dir: Path, file_bytes: bytes) -> str:
        """Convert files using built-in methods without external dependencies.
        
        Args:
            source_format: Source MIME type
            target_format: Target MIME type 
            input_file: Path to input file
            temp_dir: Temporary directory for output
            file_bytes: Raw file bytes
            
        Returns:
            Path to converted output file
            
        Raises:
            ValueError: If conversion is not supported
        """
        # Move imports to top level to avoid NameError
        import csv
        import html
        import json
        import re
        from io import StringIO
        
        # Determine output file extension
        target_ext = self._get_file_extension(target_format)
        output_file = temp_dir / f"output.{target_ext}"
        
        # Text and document conversions
        if source_format == "text/plain" and target_format == "text/markdown":
            # Plain text to Markdown - add basic formatting
            text = file_bytes.decode('utf-8', errors='ignore')
            markdown = f"# Converted Document\n\n{text}\n\n*Converted from txt to md by OpenConvert Mock Service*"
            output_file.write_text(markdown, encoding='utf-8')
            return str(output_file)
            
        elif source_format == "text/markdown" and target_format == "text/html":
            # Markdown to HTML - basic conversion
            text = file_bytes.decode('utf-8', errors='ignore')
            # Simple markdown to HTML conversion
            html_content = self._markdown_to_html(text)
            output_file.write_text(html_content, encoding='utf-8')
            return str(output_file)
            
        elif source_format == "text/html" and target_format == "text/plain":
            # HTML to plain text - strip tags
            text = file_bytes.decode('utf-8', errors='ignore')
            # Remove HTML tags and decode entities
            clean_text = re.sub(r'<[^>]+>', '', text)
            clean_text = html.unescape(clean_text)
            # Clean up whitespace
            clean_text = re.sub(r'\n\s*\n', '\n\n', clean_text.strip())
            output_file.write_text(clean_text, encoding='utf-8')
            return str(output_file)
            
        elif source_format == "application/json" and target_format == "text/plain":
            # JSON to plain text - pretty print
            try:
                data = json.loads(file_bytes.decode('utf-8'))
                pretty_text = json.dumps(data, indent=2, ensure_ascii=False)
                output_file.write_text(pretty_text, encoding='utf-8')
                return str(output_file)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON format: {e}")
                
        elif source_format == "application/json" and target_format == "text/csv":
            # JSON to CSV - convert JSON to CSV format
            try:
                data = json.loads(file_bytes.decode('utf-8'))
                output_text = StringIO()
                
                if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                    # Array of objects - convert to CSV
                    writer = csv.DictWriter(output_text, fieldnames=data[0].keys())
                    writer.writeheader()
                    writer.writerows(data)
                elif isinstance(data, dict):
                    # Single object - convert to CSV with one row
                    writer = csv.DictWriter(output_text, fieldnames=data.keys())
                    writer.writeheader()
                    writer.writerow(data)
                elif isinstance(data, list):
                    # Simple array - convert to single column CSV
                    writer = csv.writer(output_text)
                    writer.writerow(['value'])
                    for item in data:
                        writer.writerow([str(item)])
                else:
                    # Simple value - convert to single cell CSV
                    writer = csv.writer(output_text)
                    writer.writerow(['value'])
                    writer.writerow([str(data)])
                
                output_file.write_text(output_text.getvalue(), encoding='utf-8')
                return str(output_file)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON format: {e}")
                
        elif source_format == "text/csv" and target_format == "application/json":
            # CSV to JSON - convert CSV to JSON array
            try:
                text = file_bytes.decode('utf-8', errors='ignore')
                csv_reader = csv.DictReader(StringIO(text))
                data = list(csv_reader)
                json_text = json.dumps(data, indent=2, ensure_ascii=False)
                output_file.write_text(json_text, encoding='utf-8')
                return str(output_file)
            except Exception as e:
                raise ValueError(f"Invalid CSV format: {e}")
        
        # Image conversions using PIL
        elif self._is_image_format(source_format) and self._is_image_format(target_format):
            return self._convert_image(source_format, target_format, input_file, output_file)
            
        # PDF conversions (basic text extraction)
        elif source_format == "text/plain" and target_format == "application/pdf":
            return self._text_to_pdf(file_bytes, output_file)
            
        else:
            raise ValueError(f"Built-in conversion from {source_format} to {target_format} not implemented")
    
    def _get_file_extension(self, mime_type: str) -> str:
        """Get file extension from MIME type."""
        mime_to_ext = {
            'text/plain': 'txt',
            'text/markdown': 'md', 
            'text/html': 'html',
            'application/json': 'json',
            'text/csv': 'csv',
            'application/pdf': 'pdf',
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/bmp': 'bmp',
            'image/gif': 'gif',
            'image/tiff': 'tiff'
        }
        return mime_to_ext.get(mime_type, mime_type.split('/')[-1])
    
    def _markdown_to_html(self, markdown_text: str) -> str:
        """Convert basic markdown to HTML."""
        import re  # Import re module for regex operations
        html_content = markdown_text
        
        # Headers
        html_content = re.sub(r'^### (.+)$', r'<h3>\1</h3>', html_content, flags=re.MULTILINE)
        html_content = re.sub(r'^## (.+)$', r'<h2>\1</h2>', html_content, flags=re.MULTILINE)
        html_content = re.sub(r'^# (.+)$', r'<h1>\1</h1>', html_content, flags=re.MULTILINE)
        
        # Bold and italic
        html_content = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html_content)
        html_content = re.sub(r'\*(.+?)\*', r'<em>\1</em>', html_content)
        
        # Line breaks and paragraphs
        html_content = html_content.replace('\n\n', '</p>\n<p>')
        html_content = html_content.replace('\n', '<br>\n')
        
        # Wrap in HTML structure
        html_content = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Converted Document</title>
</head>
<body>
    <p>{html_content}</p>
</body>
</html>"""
        
        return html_content
    
    def _is_image_format(self, mime_type: str) -> bool:
        """Check if MIME type is an image format."""
        return mime_type.startswith('image/')
    
    def _convert_image(self, source_format: str, target_format: str, 
                      input_file: Path, output_file: Path) -> str:
        """Convert images using PIL."""
        try:
            from PIL import Image
        except ImportError:
            raise ValueError("PIL (Pillow) package required for image conversions")
        
        try:
            with Image.open(input_file) as img:
                # Handle transparency and color mode issues
                if target_format == "image/jpeg":
                    # JPEG doesn't support transparency, convert to RGB
                    if img.mode in ('RGBA', 'LA', 'P'):
                        # Create white background for transparent images
                        rgb_img = Image.new('RGB', img.size, (255, 255, 255))
                        if img.mode == 'P':
                            img = img.convert('RGBA')
                        if img.mode in ('RGBA', 'LA'):
                            rgb_img.paste(img, mask=img.split()[-1])
                        else:
                            rgb_img.paste(img)
                        img = rgb_img
                    elif img.mode not in ('RGB', 'L'):
                        img = img.convert('RGB')
                
                elif target_format == "image/png":
                    # PNG supports all modes, but ensure proper conversion
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                
                # Convert and save with proper quality for JPEG
                target_format_pil = self._get_pil_format(target_format)
                if target_format == "image/jpeg":
                    img.save(output_file, format=target_format_pil, quality=95)
                else:
                    img.save(output_file, format=target_format_pil)
                return str(output_file)
                
        except Exception as e:
            raise ValueError(f"Failed to convert {input_file.suffix} to {target_format.split('/')[-1]}: {e}")
    
    def _get_pil_format(self, mime_type: str) -> str:
        """Get PIL format name from MIME type."""
        mime_to_pil = {
            'image/png': 'PNG',
            'image/jpeg': 'JPEG', 
            'image/bmp': 'BMP',
            'image/gif': 'GIF',
            'image/tiff': 'TIFF'
        }
        return mime_to_pil.get(mime_type, mime_type.split('/')[-1].upper())
    
    def _text_to_pdf(self, text_bytes: bytes, output_file: Path) -> str:
        """Convert plain text to PDF using basic method."""
        try:
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import letter
        except ImportError:
            raise ValueError("ReportLab package required for PDF generation")
        
        text = text_bytes.decode('utf-8', errors='ignore')
        c = canvas.Canvas(str(output_file), pagesize=letter)
        width, height = letter
        
        # Simple text rendering
        y = height - 72  # Start near top with margin
        for line in text.split('\n'):
            if y < 72:  # Start new page if near bottom
                c.showPage()
                y = height - 72
            c.drawString(72, y, line[:100])  # Limit line length
            y -= 12  # Move down for next line
            
        c.save()
        return str(output_file)
    
    async def _process_conversion_request(self, content: Dict[str, Any], sender_id: str):
        """Process a conversion request asynchronously."""
        try:
            # Check if this looks like a conversion request
            file_data = content.get("file_data")
            source_format = content.get("source_format")
            target_format = content.get("target_format")
            filename = content.get("filename", "input_file")
            
            if not file_data or not source_format or not target_format:
                # Not a conversion request, might be a greeting or other message
                if "text" in content:
                    logger.info(f"💬 Received text message: {content['text']}")
                    # Send a friendly response
                    await self._send_response(sender_id, 
                        f"Hello! I'm {self.client.agent_id}. Send me files to convert!")
                return
            
            logger.info(f"🔄 Processing conversion: {filename} from {source_format} to {target_format}")
            
            # Ensure we have strings for type safety
            if not isinstance(file_data, str) or not isinstance(source_format, str) or not isinstance(target_format, str):
                await self._send_response(sender_id, 
                    "Invalid conversion request. file_data, source_format, and target_format must be strings")
                return
            
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
                
                # Handle conversion - try built-in methods first, then agconvert as fallback
                output_file_path = None
                conversion_method = None
                
                # Try built-in conversion methods first
                try:
                    output_file_path = self._convert_with_builtin_methods(
                        source_format, target_format, input_file, temp_dir, file_bytes
                    )
                    conversion_method = "built-in"
                except Exception as builtin_error:
                    logger.debug(f"Built-in conversion failed: {builtin_error}")
                    
                    # Fallback to agconvert if available
                    if AGCONVERT_AVAILABLE and convert is not None:
                        try:
                            output_file_path = convert(
                                filepath=str(input_file),
                                source_mine_format=source_format,
                                target_mine_format=target_format,
                                output_path=str(temp_dir),
                                options={}
                            )
                            conversion_method = "agconvert"
                        except Exception as agconvert_error:
                            logger.error(f"Both built-in and agconvert failed: {builtin_error}, {agconvert_error}")
                            raise ValueError(f"Failed to convert {source_format} to {target_format}: {builtin_error}")
                    else:
                        logger.error(f"Built-in conversion failed and agconvert not available: {builtin_error}")
                        raise ValueError(f"Unsupported conversion {source_format} to {target_format}: {builtin_error}")
                
                if output_file_path is None:
                    raise ValueError(f"No conversion method succeeded for {source_format} to {target_format}")
                
                logger.info(f"✅ Conversion successful using {conversion_method} method")
                
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

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to incoming messages - handle conversion requests.
        
        NOTE: This method is kept for compatibility, but the main conversion logic
        now runs through the direct message handler registered in setup().
        """
        try:
            sender_id = incoming_message.sender_id
            content = incoming_message.content
            
            logger.info(f"📨 AgentRunner react() called from {sender_id}: {content}")
            
            # The actual conversion handling is now done via the direct message handler
            # This is just for logging/debugging
            
        except Exception as e:
            logger.error(f"Error in react method: {e}")
            if isinstance(incoming_message, DirectMessage):
                await self._send_error_response(incoming_message.sender_id, str(e))

    def _can_convert(self, source_format: str, target_format: str) -> bool:
        """Check if this agent can handle the conversion."""
        # First check advertised conversion pairs
        conversion_pairs = self._generate_conversion_pairs()
        
        for pair in conversion_pairs:
            if pair["from"] == source_format and pair["to"] == target_format:
                return True
        
        # Also check if our built-in methods can handle it
        if self._can_convert_with_builtin(source_format, target_format):
            return True
            
        return False
    
    def _can_convert_with_builtin(self, source_format: str, target_format: str) -> bool:
        """Check if built-in conversion methods can handle this conversion."""
        # Text and document conversions
        if source_format == "text/plain" and target_format == "text/markdown":
            return True
        if source_format == "text/plain" and target_format == "text/html":
            return True
        if source_format == "text/plain" and target_format == "application/pdf":
            return True
            
        # HTML conversions
        if source_format == "text/html" and target_format == "text/plain":
            return True
        if source_format == "text/html" and target_format == "text/markdown":
            return True
            
        # Markdown conversions
        if source_format == "text/markdown" and target_format == "text/html":
            return True
        if source_format == "text/markdown" and target_format == "text/plain":
            return True
            
        # JSON conversions
        if source_format == "application/json" and target_format == "text/plain":
            return True
        if source_format == "application/json" and target_format == "text/csv":
            return True
            
        # CSV conversions
        if source_format == "text/csv" and target_format == "application/json":
            return True
        if source_format == "text/csv" and target_format == "text/plain":
            return True
            
        # Image conversions (if both are image formats)
        if self._is_image_format(source_format) and self._is_image_format(target_format):
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