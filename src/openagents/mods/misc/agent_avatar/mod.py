"""
Network-level agent avatar mod for OpenAgents.

This mod enables agents to set, get, and clear avatar images.
Avatars are stored as 256x256 PNG images in the workspace.
"""

import logging
import json
import time
import base64
import io
import hashlib
from typing import Dict, Any, List, Optional
from pathlib import Path
from dataclasses import dataclass

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logging.warning("PIL (Pillow) not available. Avatar image processing will not work.")
    # Create a dummy Image class for type hints when PIL is not available
    class Image:
        class Image:
            pass

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


@dataclass
class AvatarInfo:
    """Information about an agent's avatar."""
    agent_id: str
    has_avatar: bool
    file_path: Optional[str] = None
    avatar_url: Optional[str] = None
    updated_at: Optional[float] = None
    file_size: Optional[int] = None


def crop_center_square(img: "Image.Image") -> "Image.Image":
    """Crop image to center square."""
    width, height = img.size
    size = min(width, height)
    left = (width - size) // 2
    top = (height - size) // 2
    return img.crop((left, top, left + size, top + size))


def process_avatar(image_data: str, mime_type: str) -> bytes:
    """Process uploaded avatar image.
    
    Args:
        image_data: Base64-encoded image data
        mime_type: MIME type of the image
        
    Returns:
        bytes: Processed PNG image bytes (256x256)
        
    Raises:
        ValueError: If image processing fails
    """
    if not PIL_AVAILABLE:
        raise ValueError("PIL (Pillow) is required for image processing")
    
    # Decode base64
    try:
        image_bytes = base64.b64decode(image_data)
    except Exception as e:
        raise ValueError(f"Invalid base64 image data: {e}")
    
    # Check file size (before processing)
    if len(image_bytes) > 512 * 1024:  # 512KB
        raise ValueError("Image too large (max 512KB)")
    
    # Open image
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Invalid image format: {e}")
    
    # Convert to RGB if necessary (for PNG transparency)
    if img.mode in ('RGBA', 'LA', 'P'):
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        if img.mode == 'RGBA':
            background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Resize to 256x256, maintaining aspect ratio with center crop
    img = crop_center_square(img)
    img = img.resize((256, 256), Image.LANCZOS)
    
    # Save as PNG
    output = io.BytesIO()
    img.save(output, format='PNG', optimize=True)
    return output.getvalue()


class AgentAvatarMod(BaseMod):
    """Network-level agent avatar mod implementation.
    
    This mod enables agents to:
    - Set their own avatar images
    - Get their own or other agents' avatars
    - Clear their avatars
    - Batch retrieve multiple avatars
    """
    
    def __init__(self, mod_name: str = "agent_avatar"):
        """Initialize the agent avatar mod."""
        super().__init__(mod_name=mod_name)
        
        self.avatars_dir: Optional[Path] = None
        self.metadata_file: Optional[Path] = None
        self.metadata: Dict[str, Any] = {"avatars": {}}
        
        logger.info("Initializing Agent Avatar mod")
    
    def bind_network(self, network):
        """Bind the mod to a network and initialize storage."""
        super().bind_network(network)
        
        # Set up avatar storage
        self._setup_avatar_storage()
    
    def _setup_avatar_storage(self):
        """Set up avatar storage using workspace."""
        storage_path = self.get_storage_path()
        self.avatars_dir = storage_path / "avatars"
        self.avatars_dir.mkdir(exist_ok=True)
        
        self.metadata_file = self.avatars_dir / "metadata.json"
        
        logger.info(f"Using avatar storage at {self.avatars_dir}")
        
        self._load_metadata()
    
    def _load_metadata(self):
        """Load avatar metadata from storage."""
        try:
            if self.metadata_file and self.metadata_file.exists():
                with open(self.metadata_file, "r") as f:
                    self.metadata = json.load(f)
                logger.info(f"Loaded avatar metadata for {len(self.metadata.get('avatars', {}))} agents")
            else:
                self.metadata = {"avatars": {}}
                logger.debug("No existing avatar metadata found")
        except Exception as e:
            logger.error(f"Failed to load avatar metadata: {e}")
            self.metadata = {"avatars": {}}
    
    def _save_metadata(self):
        """Save avatar metadata to storage."""
        try:
            if self.metadata_file:
                with open(self.metadata_file, "w") as f:
                    json.dump(self.metadata, f, indent=2)
                logger.debug("Saved avatar metadata")
        except Exception as e:
            logger.error(f"Failed to save avatar metadata: {e}")
    
    def _get_avatar_info(self, agent_id: str) -> AvatarInfo:
        """Get avatar information for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            AvatarInfo: Avatar information
        """
        avatar_path = self.avatars_dir / f"{agent_id}.png"
        has_avatar = avatar_path.exists()
        
        if has_avatar:
            file_size = avatar_path.stat().st_size
            updated_at = self.metadata.get("avatars", {}).get(agent_id, {}).get("uploaded_at")
            avatar_url = f"/api/avatars/{agent_id}.png"
            
            return AvatarInfo(
                agent_id=agent_id,
                has_avatar=True,
                file_path=str(avatar_path),
                avatar_url=avatar_url,
                updated_at=updated_at,
                file_size=file_size
            )
        else:
            return AvatarInfo(
                agent_id=agent_id,
                has_avatar=False,
                avatar_url=None
            )
    
    @mod_event_handler("avatar.set")
    async def _handle_set_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar set request.
        
        Args:
            event: The avatar set event
            
        Returns:
            EventResponse: Response with avatar URL if successful
        """
        try:
            agent_id = event.source_id
            payload = event.payload or {}
            
            # Access control: agent can only set their own avatar
            if not agent_id:
                return EventResponse(
                    success=False,
                    message="Agent ID is required"
                )
            
            image_data = payload.get("image_data")
            mime_type = payload.get("mime_type", "image/png")
            
            # Validate
            if not image_data:
                return EventResponse(
                    success=False,
                    message="No image data provided"
                )
            
            # Check file size (base64 is ~33% larger than binary)
            if len(image_data) > 700000:  # ~512KB after decode
                return EventResponse(
                    success=False,
                    message="Image too large (max 512KB)"
                )
            
            # Process image
            try:
                processed = process_avatar(image_data, mime_type)
            except ValueError as e:
                return EventResponse(
                    success=False,
                    message=f"Invalid image: {e}"
                )
            except Exception as e:
                logger.error(f"Error processing avatar image: {e}")
                return EventResponse(
                    success=False,
                    message=f"Error processing image: {e}"
                )
            
            # Save
            avatar_path = self.avatars_dir / f"{agent_id}.png"
            avatar_path.write_bytes(processed)
            
            # Update metadata
            if "avatars" not in self.metadata:
                self.metadata["avatars"] = {}
            
            original_filename = payload.get("original_filename", "unknown")
            self.metadata["avatars"][agent_id] = {
                "original_filename": original_filename,
                "original_mime_type": mime_type,
                "uploaded_at": time.time(),
                "file_size": len(processed)
            }
            self._save_metadata()
            
            logger.info(f"Avatar set for agent {agent_id}")
            
            return EventResponse(
                success=True,
                message="Avatar updated successfully",
                data={
                    "agent_id": agent_id,
                    "avatar_url": f"/api/avatars/{agent_id}.png",
                    "updated_at": self.metadata["avatars"][agent_id]["uploaded_at"]
                }
            )
            
        except Exception as e:
            logger.error(f"Error setting avatar: {e}")
            return EventResponse(
                success=False,
                message=f"Error setting avatar: {str(e)}"
            )
    
    @mod_event_handler("avatar.clear")
    async def _handle_clear_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar clear request.
        
        Args:
            event: The avatar clear event
            
        Returns:
            EventResponse: Response indicating success or failure
        """
        try:
            agent_id = event.source_id
            
            # Access control: agent can only clear their own avatar
            if not agent_id:
                return EventResponse(
                    success=False,
                    message="Agent ID is required"
                )
            
            avatar_path = self.avatars_dir / f"{agent_id}.png"
            
            if avatar_path.exists():
                avatar_path.unlink()
            
            # Remove from metadata
            if "avatars" in self.metadata and agent_id in self.metadata["avatars"]:
                del self.metadata["avatars"][agent_id]
                self._save_metadata()
            
            logger.info(f"Avatar cleared for agent {agent_id}")
            
            return EventResponse(
                success=True,
                message="Avatar cleared successfully",
                data={
                    "agent_id": agent_id
                }
            )
            
        except Exception as e:
            logger.error(f"Error clearing avatar: {e}")
            return EventResponse(
                success=False,
                message=f"Error clearing avatar: {str(e)}"
            )
    
    @mod_event_handler("avatar.get")
    async def _handle_get_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar get request.
        
        Args:
            event: The avatar get event
            
        Returns:
            EventResponse: Response with avatar info
        """
        try:
            payload = event.payload or {}
            agent_id = payload.get("agent_id", event.source_id)
            
            # Get avatar info
            avatar_info = self._get_avatar_info(agent_id)
            
            response_data = {
                "agent_id": avatar_info.agent_id,
                "has_avatar": avatar_info.has_avatar,
                "avatar_url": avatar_info.avatar_url,
                "updated_at": avatar_info.updated_at
            }
            
            # Optionally include avatar data if requested
            include_data = payload.get("include_data", False)
            if include_data and avatar_info.has_avatar:
                avatar_path = Path(avatar_info.file_path)
                if avatar_path.exists():
                    avatar_bytes = avatar_path.read_bytes()
                    response_data["avatar_data"] = base64.b64encode(avatar_bytes).decode("utf-8")
            
            return EventResponse(
                success=True,
                message="Avatar retrieved",
                data=response_data
            )
            
        except Exception as e:
            logger.error(f"Error getting avatar: {e}")
            return EventResponse(
                success=False,
                message=f"Error getting avatar: {str(e)}"
            )
    
    @mod_event_handler("avatar.get_batch")
    async def _handle_get_batch(self, event: Event) -> Optional[EventResponse]:
        """Handle batch avatar get request.
        
        Args:
            event: The batch avatar get event
            
        Returns:
            EventResponse: Response with avatar info for multiple agents
        """
        try:
            payload = event.payload or {}
            agent_ids = payload.get("agent_ids", [])
            
            if not isinstance(agent_ids, list):
                return EventResponse(
                    success=False,
                    message="agent_ids must be a list"
                )
            
            avatars = {}
            for agent_id in agent_ids:
                avatar_info = self._get_avatar_info(agent_id)
                avatars[agent_id] = {
                    "has_avatar": avatar_info.has_avatar,
                    "avatar_url": avatar_info.avatar_url
                }
            
            return EventResponse(
                success=True,
                message=f"Retrieved avatars for {len(agent_ids)} agents",
                data={
                    "avatars": avatars
                }
            )
            
        except Exception as e:
            logger.error(f"Error getting batch avatars: {e}")
            return EventResponse(
                success=False,
                message=f"Error getting batch avatars: {str(e)}"
            )
    
    def get_avatar_path(self, agent_id: str) -> Optional[Path]:
        """Get the file path for an agent's avatar.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            Optional[Path]: Path to avatar file, or None if not found
        """
        if not self.avatars_dir:
            return None
        
        avatar_path = self.avatars_dir / f"{agent_id}.png"
        if avatar_path.exists():
            return avatar_path
        return None
    
    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        self._save_metadata()
        return True

