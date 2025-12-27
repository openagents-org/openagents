"""
A2A (Agent2Agent) Protocol Models for OpenAgents.

This module provides Pydantic models for the A2A protocol, enabling
interoperability with external A2A-compatible agents.

Based on A2A Protocol Specification v0.3:
https://a2a-protocol.org/latest/specification/
"""

from enum import Enum
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field, ConfigDict
import uuid
import time


# === ENUMS ===


class TaskState(str, Enum):
    """A2A Task states following the protocol specification."""

    UNKNOWN = "unknown"
    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"
    INPUT_REQUIRED = "input-required"
    AUTH_REQUIRED = "auth-required"


class PartType(str, Enum):
    """A2A Part types for message content."""

    TEXT = "text"
    FILE = "file"
    DATA = "data"


class Role(str, Enum):
    """A2A Message roles."""

    USER = "user"
    AGENT = "agent"


# === PARTS ===


class TextPart(BaseModel):
    """Text content part."""

    model_config = ConfigDict(populate_by_name=True)

    type: str = "text"
    text: str
    metadata: Optional[Dict[str, Any]] = None


class FilePart(BaseModel):
    """File content part."""

    model_config = ConfigDict(populate_by_name=True)

    type: str = "file"
    name: str
    mime_type: Optional[str] = Field(default=None, alias="mimeType")
    uri: Optional[str] = None
    bytes_data: Optional[str] = Field(default=None, alias="bytes")  # Base64 encoded
    metadata: Optional[Dict[str, Any]] = None


class DataPart(BaseModel):
    """Structured data part."""

    model_config = ConfigDict(populate_by_name=True)

    type: str = "data"
    data: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


# Union type for all parts
Part = Union[TextPart, FilePart, DataPart]


# === MESSAGES ===


class A2AMessage(BaseModel):
    """A2A Message containing parts with a role."""

    model_config = ConfigDict(populate_by_name=True)

    role: Role
    parts: List[Part]
    metadata: Optional[Dict[str, Any]] = None


# === ARTIFACTS ===


class Artifact(BaseModel):
    """A2A Artifact - output produced by a task."""

    model_config = ConfigDict(populate_by_name=True)

    name: Optional[str] = None
    description: Optional[str] = None
    parts: List[Part]
    index: int = 0
    append: bool = False
    last_chunk: bool = Field(default=True, alias="lastChunk")
    metadata: Optional[Dict[str, Any]] = None


# === TASK ===


class TaskStatus(BaseModel):
    """A2A Task status with state and optional message."""

    model_config = ConfigDict(populate_by_name=True)

    state: TaskState
    message: Optional[A2AMessage] = None
    timestamp: int = Field(default_factory=lambda: int(time.time()))


class Task(BaseModel):
    """A2A Task representing a unit of work."""

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    context_id: Optional[str] = Field(default=None, alias="contextId")
    status: TaskStatus
    artifacts: List[Artifact] = Field(default_factory=list)
    history: List[A2AMessage] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


# === AGENT CARD ===


class AgentSkill(BaseModel):
    """A2A Agent skill describing a capability."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    input_modes: List[str] = Field(default_factory=lambda: ["text"], alias="inputModes")
    output_modes: List[str] = Field(
        default_factory=lambda: ["text"], alias="outputModes"
    )
    examples: List[str] = Field(default_factory=list)


class AgentCapabilities(BaseModel):
    """A2A Agent capabilities."""

    model_config = ConfigDict(populate_by_name=True)

    streaming: bool = False
    push_notifications: bool = Field(default=False, alias="pushNotifications")
    state_transition_history: bool = Field(
        default=False, alias="stateTransitionHistory"
    )


class AgentProvider(BaseModel):
    """A2A Agent provider information."""

    model_config = ConfigDict(populate_by_name=True)

    organization: str
    url: Optional[str] = None


class SecurityScheme(BaseModel):
    """A2A Security scheme definition."""

    model_config = ConfigDict(populate_by_name=True)

    type: str  # "bearer", "apiKey", "oauth2", "openIdConnect", "mutualTLS"
    description: Optional[str] = None
    # Additional fields based on type
    name: Optional[str] = None  # For apiKey
    in_location: Optional[str] = Field(default=None, alias="in")  # For apiKey
    scheme: Optional[str] = None  # For http
    bearer_format: Optional[str] = Field(default=None, alias="bearerFormat")


class AgentCard(BaseModel):
    """A2A Agent Card describing an agent's identity and capabilities."""

    model_config = ConfigDict(populate_by_name=True)

    name: str
    version: str = "1.0.0"
    description: Optional[str] = None
    url: str
    protocol_version: str = Field(default="0.3", alias="protocolVersion")
    skills: List[AgentSkill] = Field(default_factory=list)
    capabilities: AgentCapabilities = Field(default_factory=AgentCapabilities)
    provider: Optional[AgentProvider] = None
    security_schemes: Dict[str, SecurityScheme] = Field(
        default_factory=dict, alias="securitySchemes"
    )
    security: List[Dict[str, List[str]]] = Field(default_factory=list)
    default_input_modes: List[str] = Field(
        default_factory=lambda: ["text"], alias="defaultInputModes"
    )
    default_output_modes: List[str] = Field(
        default_factory=lambda: ["text"], alias="defaultOutputModes"
    )


# === JSON-RPC ===


class JSONRPCRequest(BaseModel):
    """JSON-RPC 2.0 Request."""

    model_config = ConfigDict(populate_by_name=True)

    jsonrpc: str = "2.0"
    method: str
    params: Optional[Dict[str, Any]] = None
    id: Optional[Union[str, int]] = None


class JSONRPCError(BaseModel):
    """JSON-RPC 2.0 Error."""

    model_config = ConfigDict(populate_by_name=True)

    code: int
    message: str
    data: Optional[Any] = None


class JSONRPCResponse(BaseModel):
    """JSON-RPC 2.0 Response."""

    model_config = ConfigDict(populate_by_name=True)

    jsonrpc: str = "2.0"
    result: Optional[Any] = None
    error: Optional[JSONRPCError] = None
    id: Optional[Union[str, int]] = None


# === A2A ERROR CODES ===


class A2AErrorCode:
    """A2A Error codes following JSON-RPC and A2A specifications."""

    # JSON-RPC standard errors (-32700 to -32600)
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603

    # A2A specific errors (-32001 to -32099)
    TASK_NOT_FOUND = -32001
    TASK_NOT_CANCELABLE = -32002
    CONTENT_TYPE_NOT_SUPPORTED = -32003
    UNSUPPORTED_OPERATION = -32004
    PUSH_NOTIFICATION_NOT_SUPPORTED = -32005
    AUTH_REQUIRED = -32006
    VERSION_NOT_SUPPORTED = -32007


# === PUSH NOTIFICATIONS ===


class PushNotificationAuthInfo(BaseModel):
    """Authentication info for push notifications."""

    model_config = ConfigDict(populate_by_name=True)

    schemes: List[str] = Field(default_factory=list)
    credentials: Optional[str] = None


class PushNotificationConfig(BaseModel):
    """A2A Push notification configuration."""

    model_config = ConfigDict(populate_by_name=True)

    url: str
    token: Optional[str] = None
    authentication: Optional[PushNotificationAuthInfo] = None


# === REQUEST/RESPONSE PARAMS ===


class SendMessageParams(BaseModel):
    """Parameters for message/send method."""

    model_config = ConfigDict(populate_by_name=True)

    message: A2AMessage
    context_id: Optional[str] = Field(default=None, alias="contextId")
    task_id: Optional[str] = Field(default=None, alias="taskId")
    configuration: Optional[Dict[str, Any]] = None


class GetTaskParams(BaseModel):
    """Parameters for tasks/get method."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    history_length: Optional[int] = Field(default=None, alias="historyLength")


class ListTasksParams(BaseModel):
    """Parameters for tasks/list method."""

    model_config = ConfigDict(populate_by_name=True)

    context_id: Optional[str] = Field(default=None, alias="contextId")
    limit: int = 100
    offset: int = 0


class CancelTaskParams(BaseModel):
    """Parameters for tasks/cancel method."""

    model_config = ConfigDict(populate_by_name=True)

    id: str


# === HELPER FUNCTIONS ===


def parse_part(part_data: Dict[str, Any]) -> Part:
    """Parse a part from dictionary data."""
    part_type = part_data.get("type", "text")

    if part_type == "text":
        return TextPart(
            text=part_data.get("text", ""), metadata=part_data.get("metadata")
        )
    elif part_type == "file":
        return FilePart(
            name=part_data.get("name", "file"),
            mime_type=part_data.get("mimeType"),
            uri=part_data.get("uri"),
            bytes_data=part_data.get("bytes"),
            metadata=part_data.get("metadata"),
        )
    elif part_type == "data":
        return DataPart(data=part_data.get("data", {}), metadata=part_data.get("metadata"))
    else:
        # Default to text
        return TextPart(text=str(part_data), metadata=None)


def parse_parts(parts_data: List[Dict[str, Any]]) -> List[Part]:
    """Parse multiple parts from list of dictionaries."""
    return [parse_part(p) for p in parts_data]


def create_text_message(text: str, role: Role = Role.USER) -> A2AMessage:
    """Create a simple text message."""
    return A2AMessage(role=role, parts=[TextPart(text=text)])


def create_task(
    message: A2AMessage,
    context_id: Optional[str] = None,
    state: TaskState = TaskState.SUBMITTED,
) -> Task:
    """Create a new task from a message."""
    return Task(
        id=str(uuid.uuid4()),
        context_id=context_id or str(uuid.uuid4()),
        status=TaskStatus(state=state),
        history=[message],
        metadata={},
    )
