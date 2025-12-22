"""
Avatar mod for OpenAgents.

Provides agent visual identity through avatar images with upload,
storage, retrieval, and HTTP endpoints for Studio integration.
"""

from openagents.mods.misc.avatar.mod import AvatarNetworkMod, AvatarInfo
from openagents.mods.misc.avatar.adapter import AvatarAdapter

__all__ = ["AvatarNetworkMod", "AvatarAdapter", "AvatarInfo"]
