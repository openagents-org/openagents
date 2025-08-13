"""
OpenConvert Discovery Mod for OpenAgents.

This mod allows agents to announce their MIME file format conversion capabilities 
to the network and for other agents to discover agents that can perform specific 
MIME format conversions.

Key features:
- MIME conversion capability announcement
- MIME conversion capability discovery
- MIME format pair matching
- Optional text description support
"""

from .adapter import OpenConvertDiscoveryAdapter
from .mod import OpenConvertDiscoveryMod

__all__ = ["OpenConvertDiscoveryAdapter", "OpenConvertDiscoveryMod"] 