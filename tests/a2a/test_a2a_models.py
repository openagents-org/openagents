"""Tests for A2A Protocol Models."""

import pytest
from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    DataPart,
    FilePart,
    Role,
    AgentCard,
    AgentSkill,
    AgentCapabilities,
    AgentProvider,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCError,
    A2AErrorCode,
    PushNotificationConfig,
    SendMessageParams,
    GetTaskParams,
    ListTasksParams,
    CancelTaskParams,
    parse_part,
    parse_parts,
    create_text_message,
    create_task,
)


class TestParts:
    """Tests for A2A Part types."""

    def test_text_part_creation(self):
        """Test TextPart creation."""
        part = TextPart(text="Hello, world!")
        assert part.type == "text"
        assert part.text == "Hello, world!"
        assert part.metadata is None

    def test_text_part_with_metadata(self):
        """Test TextPart with metadata."""
        part = TextPart(text="Hello", metadata={"key": "value"})
        assert part.metadata == {"key": "value"}

    def test_data_part_creation(self):
        """Test DataPart creation."""
        part = DataPart(data={"foo": "bar", "count": 42})
        assert part.type == "data"
        assert part.data == {"foo": "bar", "count": 42}

    def test_file_part_creation(self):
        """Test FilePart creation."""
        part = FilePart(
            name="document.pdf",
            mime_type="application/pdf",
            uri="https://example.com/doc.pdf",
        )
        assert part.type == "file"
        assert part.name == "document.pdf"
        assert part.mime_type == "application/pdf"
        assert part.uri == "https://example.com/doc.pdf"

    def test_parse_text_part(self):
        """Test parsing text part from dict."""
        part = parse_part({"type": "text", "text": "Hello"})
        assert isinstance(part, TextPart)
        assert part.text == "Hello"

    def test_parse_data_part(self):
        """Test parsing data part from dict."""
        part = parse_part({"type": "data", "data": {"key": "value"}})
        assert isinstance(part, DataPart)
        assert part.data == {"key": "value"}

    def test_parse_file_part(self):
        """Test parsing file part from dict."""
        part = parse_part({
            "type": "file",
            "name": "test.txt",
            "mimeType": "text/plain",
        })
        assert isinstance(part, FilePart)
        assert part.name == "test.txt"

    def test_parse_parts_list(self):
        """Test parsing multiple parts."""
        parts = parse_parts([
            {"type": "text", "text": "Hello"},
            {"type": "data", "data": {"x": 1}},
        ])
        assert len(parts) == 2
        assert isinstance(parts[0], TextPart)
        assert isinstance(parts[1], DataPart)


class TestA2AMessage:
    """Tests for A2A Message."""

    def test_user_message_creation(self):
        """Test creating a user message."""
        message = A2AMessage(
            role=Role.USER,
            parts=[TextPart(text="Hello!")],
        )
        assert message.role == Role.USER
        assert len(message.parts) == 1

    def test_agent_message_creation(self):
        """Test creating an agent message."""
        message = A2AMessage(
            role=Role.AGENT,
            parts=[TextPart(text="Hi there!")],
        )
        assert message.role == Role.AGENT

    def test_create_text_message_helper(self):
        """Test create_text_message helper."""
        message = create_text_message("Hello!", Role.USER)
        assert message.role == Role.USER
        assert len(message.parts) == 1
        assert isinstance(message.parts[0], TextPart)
        assert message.parts[0].text == "Hello!"

    def test_message_with_multiple_parts(self):
        """Test message with multiple parts."""
        message = A2AMessage(
            role=Role.USER,
            parts=[
                TextPart(text="Here's the data:"),
                DataPart(data={"value": 123}),
            ],
        )
        assert len(message.parts) == 2

    def test_message_serialization(self):
        """Test message serialization."""
        message = A2AMessage(
            role=Role.USER,
            parts=[TextPart(text="Test")],
            metadata={"custom": "data"},
        )
        data = message.model_dump()
        assert data["role"] == "user"
        assert len(data["parts"]) == 1
        assert data["metadata"] == {"custom": "data"}


class TestArtifact:
    """Tests for A2A Artifact."""

    def test_artifact_creation(self):
        """Test artifact creation."""
        artifact = Artifact(
            name="result",
            description="The result of the operation",
            parts=[TextPart(text="Success!")],
        )
        assert artifact.name == "result"
        assert artifact.description == "The result of the operation"
        assert len(artifact.parts) == 1

    def test_artifact_defaults(self):
        """Test artifact default values."""
        artifact = Artifact(parts=[TextPart(text="Data")])
        assert artifact.index == 0
        assert artifact.append is False
        assert artifact.last_chunk is True

    def test_artifact_streaming_fields(self):
        """Test artifact streaming fields."""
        artifact = Artifact(
            parts=[TextPart(text="Chunk 1")],
            index=0,
            append=True,
            last_chunk=False,
        )
        assert artifact.append is True
        assert artifact.last_chunk is False


class TestTaskStatus:
    """Tests for A2A TaskStatus."""

    def test_status_creation(self):
        """Test status creation."""
        status = TaskStatus(state=TaskState.SUBMITTED)
        assert status.state == TaskState.SUBMITTED
        assert status.message is None
        assert status.timestamp > 0

    def test_status_with_message(self):
        """Test status with message."""
        message = create_text_message("Processing...", Role.AGENT)
        status = TaskStatus(state=TaskState.WORKING, message=message)
        assert status.state == TaskState.WORKING
        assert status.message is not None

    def test_all_task_states(self):
        """Test all task states are valid."""
        states = [
            TaskState.UNKNOWN,
            TaskState.SUBMITTED,
            TaskState.WORKING,
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELED,
            TaskState.REJECTED,
            TaskState.INPUT_REQUIRED,
            TaskState.AUTH_REQUIRED,
        ]
        for state in states:
            status = TaskStatus(state=state)
            assert status.state == state


class TestTask:
    """Tests for A2A Task."""

    def test_task_creation(self):
        """Test task creation."""
        message = create_text_message("Hello", Role.USER)
        task = Task(
            status=TaskStatus(state=TaskState.SUBMITTED),
            history=[message],
        )
        assert task.id is not None
        assert len(task.id) > 0
        assert task.status.state == TaskState.SUBMITTED
        assert len(task.history) == 1

    def test_create_task_helper(self):
        """Test create_task helper."""
        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        assert task.id is not None
        assert task.context_id is not None
        assert task.status.state == TaskState.SUBMITTED
        assert len(task.history) == 1

    def test_task_with_artifacts(self):
        """Test task with artifacts."""
        message = create_text_message("Hello", Role.USER)
        artifact = Artifact(parts=[TextPart(text="Result")])
        task = Task(
            status=TaskStatus(state=TaskState.COMPLETED),
            history=[message],
            artifacts=[artifact],
        )
        assert len(task.artifacts) == 1

    def test_task_serialization(self):
        """Test task serialization with aliases."""
        message = create_text_message("Hello", Role.USER)
        task = Task(
            context_id="ctx_123",
            status=TaskStatus(state=TaskState.WORKING),
            history=[message],
        )
        data = task.model_dump(by_alias=True)
        assert "contextId" in data
        assert data["contextId"] == "ctx_123"


class TestAgentCard:
    """Tests for A2A AgentCard."""

    def test_minimal_agent_card(self):
        """Test minimal agent card."""
        card = AgentCard(
            name="TestAgent",
            url="http://localhost:8900/",
        )
        assert card.name == "TestAgent"
        assert card.url == "http://localhost:8900/"
        assert card.version == "1.0.0"
        assert card.protocol_version == "0.3"

    def test_agent_card_with_skills(self):
        """Test agent card with skills."""
        skill = AgentSkill(
            id="chat",
            name="Chat",
            description="General conversation",
            tags=["general"],
            input_modes=["text"],
            output_modes=["text"],
        )
        card = AgentCard(
            name="ChatAgent",
            url="http://localhost:8900/",
            skills=[skill],
        )
        assert len(card.skills) == 1
        assert card.skills[0].id == "chat"

    def test_agent_card_capabilities(self):
        """Test agent card capabilities."""
        caps = AgentCapabilities(
            streaming=True,
            push_notifications=True,
        )
        card = AgentCard(
            name="AdvancedAgent",
            url="http://localhost:8900/",
            capabilities=caps,
        )
        assert card.capabilities.streaming is True
        assert card.capabilities.push_notifications is True

    def test_agent_card_with_provider(self):
        """Test agent card with provider."""
        provider = AgentProvider(
            organization="OpenAgents",
            url="https://openagents.org",
        )
        card = AgentCard(
            name="OrgAgent",
            url="http://localhost:8900/",
            provider=provider,
        )
        assert card.provider.organization == "OpenAgents"

    def test_agent_card_serialization(self):
        """Test agent card serialization with aliases."""
        card = AgentCard(
            name="TestAgent",
            url="http://localhost:8900/",
            default_input_modes=["text", "data"],
        )
        data = card.model_dump(by_alias=True, exclude_none=True)
        assert "defaultInputModes" in data
        assert "protocolVersion" in data


class TestJSONRPC:
    """Tests for JSON-RPC types."""

    def test_jsonrpc_request(self):
        """Test JSON-RPC request."""
        request = JSONRPCRequest(
            method="message/send",
            params={"message": {"role": "user", "parts": []}},
            id=1,
        )
        assert request.jsonrpc == "2.0"
        assert request.method == "message/send"
        assert request.id == 1

    def test_jsonrpc_response_success(self):
        """Test JSON-RPC success response."""
        response = JSONRPCResponse(
            result={"id": "task_123", "status": {"state": "completed"}},
            id=1,
        )
        assert response.result is not None
        assert response.error is None

    def test_jsonrpc_response_error(self):
        """Test JSON-RPC error response."""
        error = JSONRPCError(
            code=A2AErrorCode.TASK_NOT_FOUND,
            message="Task not found",
        )
        response = JSONRPCResponse(error=error, id=1)
        assert response.error is not None
        assert response.error.code == -32001

    def test_error_codes(self):
        """Test A2A error codes."""
        assert A2AErrorCode.PARSE_ERROR == -32700
        assert A2AErrorCode.INVALID_REQUEST == -32600
        assert A2AErrorCode.METHOD_NOT_FOUND == -32601
        assert A2AErrorCode.TASK_NOT_FOUND == -32001


class TestRequestParams:
    """Tests for request parameter models."""

    def test_send_message_params(self):
        """Test SendMessageParams."""
        message = A2AMessage(role=Role.USER, parts=[TextPart(text="Hi")])
        params = SendMessageParams(
            message=message,
            context_id="ctx_123",
        )
        assert params.message.role == Role.USER
        assert params.context_id == "ctx_123"

    def test_get_task_params(self):
        """Test GetTaskParams."""
        params = GetTaskParams(id="task_123", history_length=10)
        assert params.id == "task_123"
        assert params.history_length == 10

    def test_list_tasks_params(self):
        """Test ListTasksParams."""
        params = ListTasksParams(context_id="ctx_123", limit=50, offset=10)
        assert params.context_id == "ctx_123"
        assert params.limit == 50
        assert params.offset == 10

    def test_cancel_task_params(self):
        """Test CancelTaskParams."""
        params = CancelTaskParams(id="task_123")
        assert params.id == "task_123"


class TestPushNotification:
    """Tests for push notification config."""

    def test_push_notification_config(self):
        """Test PushNotificationConfig."""
        config = PushNotificationConfig(
            url="https://example.com/webhook",
            token="secret_token",
        )
        assert config.url == "https://example.com/webhook"
        assert config.token == "secret_token"
