"""
Utility functions for handling protobuf objects and conversions.

This module provides utilities for converting between protobuf objects and
Python dictionaries, which is commonly needed when dealing with gRPC transport
messages that may contain nested protobuf structures.
"""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def safe_get(obj: Any, key: str, default: Any = None) -> Any:
    """Safely get a value from an object that might be dict or protobuf.

    This function handles both Python dictionaries and protobuf objects
    uniformly, providing a consistent interface for accessing nested data.

    Args:
        obj: The object to get the value from (dict or protobuf)
        key: The key/attribute name to access
        default: Default value to return if key is not found

    Returns:
        The value associated with the key, or the default value

    Examples:
        # Works with dictionaries
        data = {"name": "test", "value": 42}
        name = safe_get(data, "name")  # Returns "test"

        # Works with protobuf objects
        proto_obj = SomeProtoMessage(name="test", value=42)
        name = safe_get(proto_obj, "name")  # Returns "test"
    """
    if obj is None:
        return default
    if hasattr(obj, "get"):
        return obj.get(key, default)
    else:
        return getattr(obj, key, default)


def protobuf_to_dict(obj: Any) -> Dict[str, Any]:
    """Convert a protobuf object to a dictionary recursively.

    This function handles the conversion of protobuf objects (especially
    struct_value types from gRPC) to Python dictionaries. It recursively
    processes nested structures and handles different protobuf value types.

    Args:
        obj: The protobuf object to convert

    Returns:
        Dict containing the converted data

    Examples:
        # Convert a protobuf struct_value to dict
        proto_data = some_grpc_struct_value
        dict_data = protobuf_to_dict(proto_data)

        # Handles nested structures
        nested_proto = nested_struct_value
        nested_dict = protobuf_to_dict(nested_proto)
    """
    if obj is None:
        return {}

    # If it's already a dict, return as-is
    if hasattr(obj, "get"):
        return obj

    # Handle protobuf struct_value with fields
    if hasattr(obj, "fields"):
        result = {}
        try:
            for key, value in obj.fields.items():
                # Check for struct_value first (nested objects)
                if hasattr(value, "struct_value") and value.struct_value:
                    # Recursively convert nested struct_value
                    result[key] = protobuf_to_dict(value.struct_value)
                elif hasattr(value, "string_value"):
                    result[key] = value.string_value  # Allow empty strings
                elif hasattr(value, "number_value"):
                    result[key] = value.number_value
                elif hasattr(value, "bool_value"):
                    result[key] = value.bool_value
                elif hasattr(value, "null_value"):
                    result[key] = None
                else:
                    # Fallback for unknown types
                    result[key] = str(value)
                    logger.debug(
                        f"Unknown protobuf value type for key '{key}': {type(value)} = {value}"
                    )
            return result
        except Exception as e:
            logger.warning(f"Error converting protobuf fields to dict: {e}")
            return {}

    # If it's a simple value, try to extract common fields
    try:
        result = {}
        for field in [
            "text",
            "message_type",
            "sender_id",
            "channel",
            "timestamp",
            "event_id",
            "payload",
            "content",
        ]:
            if hasattr(obj, field):
                value = getattr(obj, field)
                if hasattr(value, "fields"):
                    result[field] = protobuf_to_dict(value)
                else:
                    result[field] = value
        return result if result else {}
    except Exception as e:
        logger.warning(f"Error extracting protobuf fields: {e}")
        return {}


def extract_text_from_protobuf_payload(payload: Any) -> str:
    """Extract text content from a protobuf payload structure.

    This function specifically handles the common case of extracting text
    from nested protobuf payloads that may have text stored in various
    nested locations like payload.text, payload.payload.text, etc.

    Args:
        payload: The protobuf payload to extract text from

    Returns:
        Extracted text string, or empty string if no text found

    Examples:
        # Extract from various nested structures
        text = extract_text_from_protobuf_payload(grpc_payload)
    """
    if not payload:
        return ""

    # Convert to dictionary for easier access
    payload_dict = protobuf_to_dict(payload)

    if isinstance(payload_dict, dict):
        # Try direct text field
        if "text" in payload_dict and payload_dict["text"]:
            return payload_dict["text"]

        # Try nested payload -> text
        elif (
            "payload" in payload_dict
            and isinstance(payload_dict["payload"], dict)
            and "text" in payload_dict["payload"]
        ):
            return payload_dict["payload"]["text"]

        # Try nested content -> text
        elif (
            "content" in payload_dict
            and isinstance(payload_dict["content"], dict)
            and "text" in payload_dict["content"]
        ):
            return payload_dict["content"]["text"]

    # Fallback: return string representation
    return str(payload) if payload else ""


def convert_protobuf_message_payload(raw_payload: Any) -> Dict[str, Any]:
    """Convert a raw transport message payload to a dictionary.

    This is a higher-level function that handles the common pattern of
    converting transport message payloads from protobuf to dictionary format
    for consistent access patterns throughout the codebase.

    Args:
        raw_payload: The raw payload from a transport message

    Returns:
        Dictionary representation of the payload

    Examples:
        # Convert transport message payload
        transport_msg = get_transport_message()
        payload_dict = convert_protobuf_message_payload(transport_msg.payload)
    """
    payload = {}
    if hasattr(raw_payload, "get"):
        # Already a dictionary
        payload = raw_payload
    else:
        # Convert protobuf-like object to dictionary
        try:
            # Try to extract common fields from protobuf object
            for field in [
                "relevant_mod",
                "target_channel",
                "target_agent_id",
                "payload",
                "mod",
                "direction",
                "source_id",
            ]:
                if hasattr(raw_payload, field):
                    payload[field] = getattr(raw_payload, field)
            logger.debug(f"Converted protobuf payload to dict: {list(payload.keys())}")
        except Exception as e:
            logger.warning(f"Could not convert payload to dict: {e}")
            payload = {}

    return payload
