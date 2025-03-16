from typing import Any, Dict
from openagents.models.messages import BaseMessage, DirectMessage, BroadcastMessage, ProtocolMessage

def parse_message_dict(message_dict: Dict[str, Any]) -> BaseMessage:
    """
    Parse a message dictionary into a BaseMessage instance.

    Args:
        message_dict: A dictionary containing message data

    Returns:
        A BaseMessage instance
    """
    message_type = message_dict.get("message_type")
    if message_type == "direct_message":
        return DirectMessage.model_validate(message_dict)
    elif message_type == "broadcast_message":
        return BroadcastMessage.model_validate(message_dict)
    elif message_type == "protocol_message":
        return ProtocolMessage.model_validate(message_dict)
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

def get_protocol_message_thread_id(protocol_name: str) -> str:
    """
    Get the thread ID for a protocol message.
    """
    return f"protocol_message:{protocol_name}"

