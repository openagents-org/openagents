from typing import Any, Dict
from openagents.models.messages import DirectMessage, BroadcastMessage, ModMessage
from openagents.models.event import Event

def parse_message_dict(message_dict: Dict[str, Any]) -> Event:
    """
    Parse a message dictionary into an Event instance.

    Args:
        message_dict: A dictionary containing message data

    Returns:
        An Event instance (DirectMessage, BroadcastMessage, or ModMessage)
    """
    message_type = message_dict.get("message_type")
    
    # Handle transport message payload merging for mod_message
    if message_type == "mod_message" and "payload" in message_dict:
        # Merge payload fields into main message dict for ModMessage
        merged_dict = message_dict.copy()
        payload = merged_dict.pop("payload", {})
        
        # Debug logging removed for production
        
        # Copy all payload fields to merged_dict, with payload taking precedence for None/empty values
        for key, value in payload.items():
            existing_value = merged_dict.get(key)
            # Override if key doesn't exist, is None, or is an empty dict/list
            if (key not in merged_dict or 
                existing_value is None or 
                (isinstance(existing_value, (dict, list)) and not existing_value)):
                merged_dict[key] = value
        
        # Handle special case for relevant_agent_id from target_id
        if "relevant_agent_id" not in merged_dict and "target_id" in message_dict:
            merged_dict["relevant_agent_id"] = message_dict["target_id"]
            
        # Ensure mod field is not None
        if merged_dict.get("mod") is None:
            merged_dict["mod"] = "unknown"  # Default value to prevent validation error
            
        # Ensure relevant_agent_id is present 
        if "relevant_agent_id" not in merged_dict:
            merged_dict["relevant_agent_id"] = "unknown"  # Default value to prevent validation error
            
        return ModMessage(**merged_dict)
    
    if message_type == "direct_message":
        return DirectMessage(**message_dict)
    elif message_type == "broadcast_message":
        return BroadcastMessage(**message_dict)
    elif message_type == "mod_message":
        return ModMessage(**message_dict)
    else:
        raise ValueError(f"Unknown message type: {message_type}")

def get_direct_message_thread_id(opponent_id: str) -> str:
    """
    Get the thread ID for a direct message.
    """
    return f"direct_message:{opponent_id}"

def get_broadcast_message_thread_id() -> str:
    """
    Get the thread ID for a broadcast message.
    """
    return "broadcast_message"

def get_mod_message_thread_id(mod_name: str) -> str:
    """
    Get the thread ID for a mod message.
    """
    return f"mod_message:{mod_name}"

