"""
Global configuration constants for OpenAgents.

This module contains global constants used throughout the OpenAgents system,
including mod names, default values, and other system-wide configuration.
"""

# ===== MOD NAMES =====
# Standard mod names used throughout the system

# Workspace mods
WORKSPACE_DEFAULT_MOD_NAME = "openagents.mods.workspace.default"

# Communication mods
THREAD_MESSAGING_MOD_NAME = "openagents.mods.communication.thread_messaging"
SIMPLE_MESSAGING_MOD_NAME = "openagents.mods.communication.simple_messaging"

# Discovery mods
AGENT_DISCOVERY_MOD_NAME = "openagents.mods.discovery.agent_discovery"
OPENCONVERT_DISCOVERY_MOD_NAME = "openagents.mods.discovery.openconvert_discovery"

# Work mods
SHARED_DOCUMENT_MOD_NAME = "openagents.mods.work.shared_document"

# ===== DEFAULT VALUES =====
# Default configuration values

# Network defaults
DEFAULT_NETWORK_PORT = 8570
DEFAULT_NETWORK_HOST = "localhost"

# Client defaults
DEFAULT_CLIENT_TIMEOUT = 30.0
DEFAULT_MAX_MESSAGE_SIZE = 104857600  # 100MB

# Workspace defaults
DEFAULT_WORKSPACE_CLIENT_PREFIX = "workspace-client"

# Channel defaults
DEFAULT_CHANNELS = ["#general", "#dev", "#support"]

# ===== SYSTEM CONSTANTS =====
# System-wide constants

# Message types
MOD_MESSAGE_TYPE = "mod_message"
DIRECT_MESSAGE_TYPE = "direct_message"
BROADCAST_MESSAGE_TYPE = "broadcast_message"

# Mod directions
MOD_DIRECTION_INBOUND = "inbound"
MOD_DIRECTION_OUTBOUND = "outbound"
