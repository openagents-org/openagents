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
WORKSPACE_MESSAGING_MOD_NAME = "openagents.mods.workspace.messaging"
SIMPLE_MESSAGING_MOD_NAME = "openagents.mods.communication.simple_messaging"

# Discovery mods
AGENT_DISCOVERY_MOD_NAME = "openagents.mods.discovery.agent_discovery"

# Work mods
SHARED_DOCUMENT_MOD_NAME = "openagents.mods.workspace.documents"

# ===== DEFAULT VALUES =====
# Default configuration values

DEFAULT_HTTP_TRANSPORT_PORT = 8700

# Network defaults
DEFAULT_TRANSPORT_ADDRESS = {
    "http": {"host": "0.0.0.0", "port": DEFAULT_HTTP_TRANSPORT_PORT},
    "websocket": {"host": "0.0.0.0", "port": 8400},
    "grpc": {"host": "0.0.0.0", "port": 8600},
    "libp2p": {"host": "0.0.0.0", "port": 0},
}

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

# ===== SYSTEM EVENT NAMES =====
SYSTEM_EVENT_HEALTH_CHECK = "system.health_check"
SYSTEM_EVENT_REGISTER_AGENT = "system.register_agent"
SYSTEM_EVENT_UNREGISTER_AGENT = "system.unregister_agent"
SYSTEM_EVENT_LIST_AGENTS = "system.list_agents"
SYSTEM_EVENT_LIST_MODS = "system.list_mods"
SYSTEM_EVENT_GET_MOD_MANIFEST = "system.get_mod_manifest"
SYSTEM_EVENT_GET_NETWORK_INFO = "system.get_network_info"
SYSTEM_EVENT_PING_AGENT = "system.ping_agent"
SYSTEM_EVENT_HEARTBEAT = "system.heartbeat"
SYSTEM_EVENT_CLAIM_AGENT_ID = "system.claim_agent_id"
SYSTEM_EVENT_VALIDATE_CERTIFICATE = "system.validate_certificate"
SYSTEM_EVENT_POLL_MESSAGES = "system.poll_messages"
SYSTEM_EVENT_SUBSCRIBE_EVENTS = "system.subscribe_events"
SYSTEM_EVENT_UNSUBSCRIBE_EVENTS = "system.unsubscribe_events"
SYSTEM_EVENT_ADD_CHANNEL_MEMBER = "system.add_channel_member"
SYSTEM_EVENT_REMOVE_CHANNEL_MEMBER = "system.remove_channel_member"
SYSTEM_EVENT_GET_CHANNEL_MEMBERS = "system.get_channel_members"
SYSTEM_EVENT_REMOVE_CHANNEL = "system.remove_channel"
SYSTEM_EVENT_LIST_CHANNELS = "system.list_channels"
SYSTEM_EVENT_VERIFY_PASSWORD = "system.verify_password"
SYSTEM_EVENT_KICK_AGENT = "system.kick_agent"
SYSTEM_EVENT_UPDATE_NETWORK_PROFILE = "system.update_network_profile"
SYSTEM_EVENT_UPDATE_AGENT_GROUPS = "system.update_agent_groups"
SYSTEM_EVENT_REPORT_LLM_LOG = "system.report_llm_log"

SYSTEM_NOTIFICAITON_REGISTER_AGENT = "system.notification.register_agent"
SYSTEM_NOTIFICAITON_UNREGISTER_AGENT = "system.notification.unregister_agent"
SYSTEM_NOTIFICATION_AGENT_KICKED = "system.agent_kicked"

AGENT_EVENT_MESSAGE = "agent.message"

SYSTEM_AGENT_ID = "system:system"
BROADCAST_AGENT_ID = "agent:broadcast"

# ===== THREAD IDS =====
THREAD_ID_UNCATEGORIZED = "uncategorized"

# ===== SYSTEM METADATA =====
DEFAULT_AGENT_GROUP = "guest"

# ===== OpenAgents Discovery Server =====
OPENAGENTS_DISCOVERY_SERVER_URL = "https://endpoint.openagents.org/v1"