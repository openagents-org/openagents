from typing import Any, Dict
from openagents.models.messages import Event, EventNames


def parse_message_dict(message_dict: Dict[str, Any]) -> Event:
    """
    Parse a message dictionary into an Event instance.
    This function now uses the unified Event system.

    Args:
        message_dict: A dictionary containing message data

    Returns:
        An Event instance with proper event_name based on message_type
    """
    message_type = message_dict.get("message_type", "event")

    # Map legacy message_type to proper event_name
    event_name_map = {
        "direct_message": "agent.message",
        "broadcast_message": "agent.broadcast_message.sent",
        "mod_message": "mod.generic.message_received",
        "channel_message": "channel.message.posted",
    }

    # Get event_name from message_type or use provided event_name
    event_name = message_dict.get(
        "event_name", event_name_map.get(message_type, "network.transport.sent")
    )

    # Handle transport message payload merging for mod_message
    if message_type == "mod_message" and "payload" in message_dict:
        # Merge payload fields into main message dict
        merged_dict = message_dict.copy()
        payload = merged_dict.pop("payload", {})

        # Copy all payload fields to merged_dict, with payload taking precedence for None/empty values
        for key, value in payload.items():
            existing_value = merged_dict.get(key)
            # Override if key doesn't exist, is None, or is an empty dict/list
            if (
                key not in merged_dict
                or existing_value is None
                or (isinstance(existing_value, (dict, list)) and not existing_value)
            ):
                merged_dict[key] = value

        # Handle special case for relevant_agent_id from target_id
        if "relevant_agent_id" not in merged_dict and "target_id" in message_dict:
            merged_dict["target_agent_id"] = message_dict["target_id"]

        # Ensure relevant_mod field is set properly
        if merged_dict.get("relevant_mod") is None:
            merged_dict["relevant_mod"] = merged_dict.get("mod", "generic")

        # Ensure source_id is present (required for Event)
        if "source_id" not in merged_dict:
            merged_dict["source_id"] = merged_dict.get("sender_id", "unknown")

        # Remove event_name from merged_dict to avoid duplicate parameter
        merged_dict.pop("event_name", None)
        return Event(event_name=event_name, **merged_dict)

    # Ensure source_id is present for all events
    if "source_id" not in message_dict:
        message_dict = message_dict.copy()
        message_dict["source_id"] = message_dict.get("sender_id", "unknown")

    # Remove event_name from message_dict to avoid duplicate parameter
    message_dict = message_dict.copy()
    message_dict.pop("event_name", None)

    # Create unified Event regardless of original message type
    return Event(event_name=event_name, **message_dict)


def get_direct_event_thread_id(opponent_id: str) -> str:
    """
    Get the thread ID for a direct message.
    """
    return f"direct_message:{opponent_id}"


def get_broadcast_event_thread_id() -> str:
    """
    Get the thread ID for a broadcast message.
    """
    return "broadcast_message"


def get_mod_event_thread_id(mod_name: str) -> str:
    """
    Get the thread ID for a mod message.
    """
    return f"mod_message:{mod_name}"
