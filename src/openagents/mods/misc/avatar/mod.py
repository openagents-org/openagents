"""
Network-level avatar mod for OpenAgents.

This mod provides avatar management for agents in the network,
including image upload, processing, storage, and retrieval.
"""

import logging
import time
import base64
import io
import json
from typing import Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass

from openagents.core.base_mod import BaseMod
from openagents.models.messages import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

# Image processing will be imported conditionally
try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    logger.warning("Pillow not available. Avatar image processing will be disabled.")


@dataclass
class AvatarInfo:
    """Information about an agent's avatar."""
    agent_id: str
    has_avatar: bool
    file_path: Optional[str] = None
    avatar_url: Optional[str] = None
    updated_at: Optional[float] = None
    file_size: Optional[int] = None


class AvatarNetworkMod(BaseMod):
    """Network-level avatar mod implementation.

    This mod provides:
    - Avatar image upload and processing
    - Avatar storage and metadata management
    - Avatar retrieval (single and batch)
    - HTTP endpoints for serving avatar images
    """

    def __init__(self, mod_name: str = "avatar"):
        """Initialize the avatar mod for a network."""
        super().__init__(mod_name=mod_name)

        # Register event handlers
        self.register_event_handler(self._handle_set_avatar, "avatar.set")
        self.register_event_handler(self._handle_clear_avatar, "avatar.clear")
        self.register_event_handler(self._handle_get_avatar, "avatar.get")
        self.register_event_handler(self._handle_get_batch, "avatar.get_batch")

        # Storage will be initialized when workspace is available
        self.avatars_dir: Optional[Path] = None
        self.metadata_file: Optional[Path] = None
        self.metadata: Dict[str, Any] = {"avatars": {}}

        # Configuration
        self.max_file_size = 524288  # 512KB
        self.image_size = 256
        self.supported_formats = ["png", "jpg", "jpeg", "gif", "webp"]

        logger.info("Initializing Avatar network mod")

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful
        """
        # Initialize storage directory
        if self.workspace_manager:
            workspace_path = Path(self.workspace_manager.workspace_path)
            self.avatars_dir = workspace_path / "avatars"
            self.avatars_dir.mkdir(exist_ok=True, parents=True)
            self.metadata_file = self.avatars_dir / "metadata.json"
            self._load_metadata()
            logger.info(f"Avatar mod initialized with storage at {self.avatars_dir}")
        else:
            logger.warning("Avatar mod initialized without workspace (storage disabled)")

        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info("Avatar mod shutting down")
        return True

    def _load_metadata(self) -> None:
        """Load avatar metadata from file."""
        if self.metadata_file and self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r') as f:
                    self.metadata = json.load(f)
                logger.info(f"Loaded metadata for {len(self.metadata.get('avatars', {}))} avatars")
            except Exception as e:
                logger.error(f"Error loading avatar metadata: {e}")
                self.metadata = {"avatars": {}}
        else:
            self.metadata = {"avatars": {}}

    def _save_metadata(self) -> None:
        """Save avatar metadata to file."""
        if self.metadata_file:
            try:
                with open(self.metadata_file, 'w') as f:
                    json.dump(self.metadata, f, indent=2)
            except Exception as e:
                logger.error(f"Error saving avatar metadata: {e}")

    def _process_avatar_image(self, image_data: str, mime_type: str) -> bytes:
        """Process uploaded avatar image.
        
        Args:
            image_data: Base64-encoded image data
            mime_type: MIME type of the image
            
        Returns:
            Processed image as bytes (PNG format)
            
        Raises:
            ValueError: If image processing fails
        """
        if not PILLOW_AVAILABLE:
            raise ValueError("Image processing not available (Pillow not installed)")
        
        # Decode base64
        try:
            image_bytes = base64.b64decode(image_data)
        except Exception as e:
            raise ValueError(f"Invalid base64 image data: {e}")

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
            if img.mode in ('RGBA', 'LA'):
                background.paste(img, mask=img.split()[-1])
                img = background

        # Crop to center square
        width, height = img.size
        size = min(width, height)
        left = (width - size) // 2
        top = (height - size) // 2
        img = img.crop((left, top, left + size, top + size))

        # Resize to target size
        img = img.resize((self.image_size, self.image_size), Image.LANCZOS)

        # Save as PNG
        output = io.BytesIO()
        img.save(output, format='PNG', optimize=True)
        return output.getvalue()

    async def _handle_set_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar set event.

        Args:
            event: The set avatar event

        Returns:
            EventResponse with result
        """
        agent_id = event.source_id
        payload = event.payload or {}
        image_data = payload.get("image_data")
        mime_type = payload.get("mime_type", "image/png")

        logger.info(f"Setting avatar for {agent_id}")

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
                message=f"Image too large (max {self.max_file_size // 1024}KB)"
            )

        # Check if storage is available
        if not self.avatars_dir:
            return EventResponse(
                success=False,
                message="Avatar storage not available"
            )

        # Process image
        try:
            processed = self._process_avatar_image(image_data, mime_type)
        except Exception as e:
            logger.error(f"Error processing avatar for {agent_id}: {e}")
            return EventResponse(
                success=False,
                message=f"Invalid image: {str(e)}"
            )

        # Save
        avatar_path = self.avatars_dir / f"{agent_id}.png"
        try:
            avatar_path.write_bytes(processed)
        except Exception as e:
            logger.error(f"Error saving avatar for {agent_id}: {e}")
            return EventResponse(
                success=False,
                message=f"Error saving avatar: {str(e)}"
            )

        # Update metadata
        self.metadata["avatars"][agent_id] = {
            "uploaded_at": time.time(),
            "file_size": len(processed),
            "original_mime_type": mime_type
        }
        self._save_metadata()

        logger.info(f"Avatar set successfully for {agent_id}")

        return EventResponse(
            success=True,
            message="Avatar updated successfully",
            data={
                "agent_id": agent_id,
                "avatar_url": f"/api/avatars/{agent_id}.png",
                "updated_at": self.metadata["avatars"][agent_id]["uploaded_at"]
            }
        )

    async def _handle_clear_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar clear event.

        Args:
            event: The clear avatar event

        Returns:
            EventResponse with result
        """
        agent_id = event.source_id

        logger.info(f"Clearing avatar for {agent_id}")

        # Check if storage is available
        if not self.avatars_dir:
            return EventResponse(
                success=False,
                message="Avatar storage not available"
            )

        # Remove avatar file if exists
        avatar_path = self.avatars_dir / f"{agent_id}.png"
        if avatar_path.exists():
            try:
                avatar_path.unlink()
            except Exception as e:
                logger.error(f"Error deleting avatar for {agent_id}: {e}")
                return EventResponse(
                    success=False,
                    message=f"Error deleting avatar: {str(e)}"
                )

        # Remove metadata
        if agent_id in self.metadata["avatars"]:
            del self.metadata["avatars"][agent_id]
            self._save_metadata()

        logger.info(f"Avatar cleared successfully for {agent_id}")

        return EventResponse(
            success=True,
            message="Avatar cleared successfully",
            data={
                "agent_id": agent_id
            }
        )

    async def _handle_get_avatar(self, event: Event) -> Optional[EventResponse]:
        """Handle avatar get event.

        Args:
            event: The get avatar event

        Returns:
            EventResponse with avatar info
        """
        payload = event.payload or {}
        agent_id = payload.get("agent_id")
        include_data = payload.get("include_data", False)

        if not agent_id:
            return EventResponse(
                success=False,
                message="No agent_id provided"
            )

        logger.info(f"Getting avatar for {agent_id}")

        avatar_info = self._get_avatar_info(agent_id, include_data)

        return EventResponse(
            success=True,
            data={
                "agent_id": avatar_info.agent_id,
                "has_avatar": avatar_info.has_avatar,
                "avatar_url": avatar_info.avatar_url,
                "avatar_data": getattr(avatar_info, 'avatar_data', None) if include_data else None,
                "updated_at": avatar_info.updated_at,
                "file_size": avatar_info.file_size
            }
        )

    async def _handle_get_batch(self, event: Event) -> Optional[EventResponse]:
        """Handle batch avatar get event.

        Args:
            event: The batch get event

        Returns:
            EventResponse with multiple avatar info
        """
        payload = event.payload or {}
        agent_ids = payload.get("agent_ids", [])

        logger.info(f"Getting batch avatars for {len(agent_ids)} agents")

        avatars = {}
        for agent_id in agent_ids:
            avatar_info = self._get_avatar_info(agent_id, include_data=False)
            avatars[agent_id] = {
                "has_avatar": avatar_info.has_avatar,
                "avatar_url": avatar_info.avatar_url
            }

        return EventResponse(
            success=True,
            data={
                "avatars": avatars
            }
        )

    def _get_avatar_info(self, agent_id: str, include_data: bool = False) -> AvatarInfo:
        """Get avatar information for an agent.

        Args:
            agent_id: Agent ID
            include_data: Whether to include base64 image data

        Returns:
            AvatarInfo object
        """
        if not self.avatars_dir:
            return AvatarInfo(
                agent_id=agent_id,
                has_avatar=False
            )

        avatar_path = self.avatars_dir / f"{agent_id}.png"
        has_avatar = avatar_path.exists()

        metadata = self.metadata.get("avatars", {}).get(agent_id, {})

        info = AvatarInfo(
            agent_id=agent_id,
            has_avatar=has_avatar,
            file_path=str(avatar_path) if has_avatar else None,
            avatar_url=f"/api/avatars/{agent_id}.png" if has_avatar else None,
            updated_at=metadata.get("uploaded_at"),
            file_size=metadata.get("file_size")
        )

        # Include base64 data if requested
        if include_data and has_avatar:
            try:
                with open(avatar_path, 'rb') as f:
                    image_bytes = f.read()
                    info.avatar_data = base64.b64encode(image_bytes).decode()
            except Exception as e:
                logger.error(f"Error reading avatar file for {agent_id}: {e}")

        return info

    def get_avatar_file_path(self, agent_id: str) -> Optional[Path]:
        """Get the file path for an agent's avatar.

        Args:
            agent_id: Agent ID

        Returns:
            Path to avatar file, or None if not exists
        """
        if not self.avatars_dir:
            return None

        avatar_path = self.avatars_dir / f"{agent_id}.png"
        return avatar_path if avatar_path.exists() else None
