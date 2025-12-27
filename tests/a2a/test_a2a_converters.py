"""Tests for A2A Converters and Event Names."""

import pytest
from openagents.models.event import Event
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
    create_text_message,
)
from openagents.utils.a2a_converters import (
    A2ATaskEventNames,
    TASK_STATE_TO_EVENT,
    EVENT_TO_TASK_STATE,
    a2a_message_to_event,
    event_to_a2a_message,
    event_to_a2a_artifact,
    create_task_from_message,
    create_task_status_event,
    create_artifact_event,
    extract_text_from_parts,
    extract_data_from_parts,
)


class TestA2ATaskEventNames:
    """Tests for A2A event name constants."""

    def test_lifecycle_events_exist(self):
        """Test lifecycle event names exist."""
        assert A2ATaskEventNames.CREATED == "agent.task.created"
        assert A2ATaskEventNames.SUBMITTED == "agent.task.submitted"
        assert A2ATaskEventNames.WORKING == "agent.task.working"
        assert A2ATaskEventNames.COMPLETED == "agent.task.completed"
        assert A2ATaskEventNames.FAILED == "agent.task.failed"
        assert A2ATaskEventNames.CANCELED == "agent.task.canceled"

    def test_operation_events_exist(self):
        """Test operation event names exist."""
        assert A2ATaskEventNames.MESSAGE_RECEIVED == "agent.task.message.received"
        assert A2ATaskEventNames.MESSAGE_SENT == "agent.task.message.sent"
        assert A2ATaskEventNames.ARTIFACT_ADDED == "agent.task.artifact.added"
        assert A2ATaskEventNames.STATUS_UPDATED == "agent.task.status.updated"

    def test_notification_events_exist(self):
        """Test notification event names exist."""
        assert A2ATaskEventNames.NOTIFICATION_SENT == "agent.task.notification.sent"
        assert A2ATaskEventNames.NOTIFICATION_FAILED == "agent.task.notification.failed"

    def test_transport_events_exist(self):
        """Test transport event names exist."""
        assert A2ATaskEventNames.TRANSPORT_STARTED == "agent.task.transport.started"
        assert A2ATaskEventNames.TRANSPORT_STOPPED == "agent.task.transport.stopped"

    def test_outbound_events_exist(self):
        """Test outbound event names exist."""
        assert A2ATaskEventNames.OUTBOUND_CREATED == "agent.task.outbound.created"
        assert A2ATaskEventNames.OUTBOUND_SENT == "agent.task.outbound.sent"
        assert A2ATaskEventNames.OUTBOUND_COMPLETED == "agent.task.outbound.completed"

    def test_event_names_follow_convention(self):
        """Test all event names follow agent.task.* convention."""
        for name in dir(A2ATaskEventNames):
            if not name.startswith("_"):
                value = getattr(A2ATaskEventNames, name)
                if isinstance(value, str):
                    assert value.startswith("agent.task."), f"{name} should start with agent.task."


class TestTaskStateMapping:
    """Tests for task state to event mapping."""

    def test_task_state_to_event_mapping(self):
        """Test TaskState to event name mapping."""
        assert TASK_STATE_TO_EVENT[TaskState.SUBMITTED] == A2ATaskEventNames.SUBMITTED
        assert TASK_STATE_TO_EVENT[TaskState.WORKING] == A2ATaskEventNames.WORKING
        assert TASK_STATE_TO_EVENT[TaskState.COMPLETED] == A2ATaskEventNames.COMPLETED
        assert TASK_STATE_TO_EVENT[TaskState.FAILED] == A2ATaskEventNames.FAILED

    def test_event_to_task_state_mapping(self):
        """Test event name to TaskState reverse mapping."""
        assert EVENT_TO_TASK_STATE[A2ATaskEventNames.SUBMITTED] == TaskState.SUBMITTED
        assert EVENT_TO_TASK_STATE[A2ATaskEventNames.COMPLETED] == TaskState.COMPLETED

    def test_mappings_are_inverse(self):
        """Test that mappings are inverse of each other."""
        for state, event_name in TASK_STATE_TO_EVENT.items():
            assert EVENT_TO_TASK_STATE[event_name] == state


class TestA2AMessageToEvent:
    """Tests for a2a_message_to_event conversion."""

    def test_basic_text_message_conversion(self):
        """Test converting a basic text message to event."""
        message = create_text_message("Hello, world!", Role.USER)
        event = a2a_message_to_event(message, "task_123")

        assert event.event_name == A2ATaskEventNames.MESSAGE_RECEIVED
        assert event.source_id == "a2a:external"
        assert event.payload["text"] == "Hello, world!"
        assert event.payload["role"] == "user"
        assert event.metadata["a2a_task_id"] == "task_123"

    def test_message_with_context_id(self):
        """Test conversion with context ID."""
        message = create_text_message("Test", Role.USER)
        event = a2a_message_to_event(message, "task_123", context_id="ctx_456")

        assert event.thread_name == "a2a:ctx_456"
        assert event.metadata["a2a_context_id"] == "ctx_456"

    def test_message_without_context_id(self):
        """Test conversion without context ID uses task ID."""
        message = create_text_message("Test", Role.USER)
        event = a2a_message_to_event(message, "task_123")

        assert event.thread_name == "a2a:task_123"

    def test_message_with_data_part(self):
        """Test conversion with data part."""
        message = A2AMessage(
            role=Role.USER,
            parts=[
                TextPart(text="Here's data:"),
                DataPart(data={"key": "value", "count": 42}),
            ],
        )
        event = a2a_message_to_event(message, "task_123")

        assert "Here's data:" in event.payload["text"]
        assert event.payload["data"]["key"] == "value"
        assert event.payload["data"]["count"] == 42

    def test_message_with_file_part(self):
        """Test conversion with file part."""
        message = A2AMessage(
            role=Role.USER,
            parts=[
                FilePart(
                    name="doc.pdf",
                    mime_type="application/pdf",
                    uri="https://example.com/doc.pdf",
                ),
            ],
        )
        event = a2a_message_to_event(message, "task_123")

        assert len(event.payload["files"]) == 1
        assert event.payload["files"][0]["name"] == "doc.pdf"
        assert event.payload["files"][0]["mime_type"] == "application/pdf"

    def test_custom_source_and_destination(self):
        """Test custom source and destination IDs."""
        message = create_text_message("Test", Role.USER)
        event = a2a_message_to_event(
            message,
            "task_123",
            source_id="a2a:client_1",
            destination_id="agent:target",
        )

        assert event.source_id == "a2a:client_1"
        assert event.destination_id == "agent:target"


class TestEventToA2AMessage:
    """Tests for event_to_a2a_message conversion."""

    def test_basic_event_conversion(self):
        """Test converting a basic event to A2A message."""
        event = Event(
            event_name="agent.task.message.received",
            source_id="agent:test",
            source_type="agent",
            payload={"text": "Hello!"},
        )
        message = event_to_a2a_message(event)

        assert message.role == Role.AGENT
        assert len(message.parts) >= 1
        # Check text is in parts
        text_found = any(
            isinstance(p, TextPart) and "Hello" in p.text
            for p in message.parts
        )
        assert text_found

    def test_event_with_role_in_payload(self):
        """Test event with role specified in payload."""
        event = Event(
            event_name="agent.task.message.received",
            source_id="a2a:external",
            source_type="agent",
            payload={"text": "User message", "role": "user"},
        )
        message = event_to_a2a_message(event)

        assert message.role == Role.USER

    def test_event_with_data_payload(self):
        """Test event with data in payload."""
        event = Event(
            event_name="agent.task.message.received",
            source_id="agent:test",
            payload={
                "text": "Result",
                "data": {"x": 1, "y": 2},
            },
        )
        message = event_to_a2a_message(event)

        # Should have both text and data parts
        has_data_part = any(isinstance(p, DataPart) for p in message.parts)
        assert has_data_part

    def test_event_with_files(self):
        """Test event with files in payload."""
        event = Event(
            event_name="agent.task.message.received",
            source_id="agent:test",
            payload={
                "files": [
                    {"name": "test.txt", "mime_type": "text/plain", "uri": "https://example.com/test.txt"},
                ],
            },
        )
        message = event_to_a2a_message(event)

        has_file_part = any(isinstance(p, FilePart) for p in message.parts)
        assert has_file_part

    def test_event_with_text_representation(self):
        """Test event using text_representation."""
        event = Event(
            event_name="agent.task.message.received",
            source_id="agent:test",
            payload={},
            text_representation="Fallback text",
        )
        message = event_to_a2a_message(event)

        has_text = any(
            isinstance(p, TextPart) and "Fallback" in p.text
            for p in message.parts
        )
        assert has_text


class TestEventToA2AArtifact:
    """Tests for event_to_a2a_artifact conversion."""

    def test_basic_artifact_conversion(self):
        """Test converting event to artifact."""
        event = Event(
            event_name="agent.task.artifact.added",
            source_id="agent:test",
            payload={
                "text": "Result data",
                "artifact_name": "result",
                "artifact_description": "The final result",
            },
        )
        artifact = event_to_a2a_artifact(event)

        assert artifact.name == "result"
        assert artifact.description == "The final result"
        assert len(artifact.parts) >= 1

    def test_artifact_with_index(self):
        """Test artifact with custom index."""
        event = Event(
            event_name="agent.task.artifact.added",
            source_id="agent:test",
            payload={"text": "Data"},
        )
        artifact = event_to_a2a_artifact(event, index=2)

        assert artifact.index == 2


class TestCreateTaskFromMessage:
    """Tests for create_task_from_message."""

    def test_basic_task_creation(self):
        """Test creating task from message."""
        message = create_text_message("Start task", Role.USER)
        task = create_task_from_message(message)

        assert task.id is not None
        assert task.context_id is not None
        assert task.status.state == TaskState.SUBMITTED
        assert len(task.history) == 1
        assert task.history[0] == message

    def test_task_with_context_id(self):
        """Test creating task with specific context ID."""
        message = create_text_message("Continue", Role.USER)
        task = create_task_from_message(message, context_id="ctx_123")

        assert task.context_id == "ctx_123"


class TestCreateStatusEvent:
    """Tests for create_task_status_event."""

    def test_status_event_creation(self):
        """Test creating status event."""
        event = create_task_status_event("task_123", TaskState.WORKING)

        assert event.event_name == A2ATaskEventNames.WORKING
        assert event.payload["task_id"] == "task_123"
        assert event.payload["state"] == "working"

    def test_status_event_with_message(self):
        """Test status event with message."""
        event = create_task_status_event(
            "task_123",
            TaskState.FAILED,
            message="Something went wrong",
        )

        assert event.payload["message"] == "Something went wrong"

    def test_status_event_with_context(self):
        """Test status event with context ID."""
        event = create_task_status_event(
            "task_123",
            TaskState.COMPLETED,
            context_id="ctx_456",
        )

        assert event.metadata["a2a_context_id"] == "ctx_456"


class TestCreateArtifactEvent:
    """Tests for create_artifact_event."""

    def test_artifact_event_creation(self):
        """Test creating artifact event."""
        artifact = Artifact(
            name="result",
            parts=[TextPart(text="Done!")],
        )
        event = create_artifact_event("task_123", artifact)

        assert event.event_name == A2ATaskEventNames.ARTIFACT_ADDED
        assert event.payload["task_id"] == "task_123"
        assert "artifact" in event.payload


class TestExtractHelpers:
    """Tests for extract helper functions."""

    def test_extract_text_from_parts(self):
        """Test extracting text from parts."""
        parts = [
            TextPart(text="Hello "),
            DataPart(data={"x": 1}),
            TextPart(text="World"),
        ]
        text = extract_text_from_parts(parts)

        assert "Hello" in text
        assert "World" in text

    def test_extract_data_from_parts(self):
        """Test extracting data from parts."""
        parts = [
            TextPart(text="Text"),
            DataPart(data={"a": 1}),
            DataPart(data={"b": 2}),
        ]
        data = extract_data_from_parts(parts)

        assert data["a"] == 1
        assert data["b"] == 2

    def test_extract_text_empty_parts(self):
        """Test extracting text from empty parts."""
        text = extract_text_from_parts([])
        assert text == ""

    def test_extract_data_empty_parts(self):
        """Test extracting data from empty parts."""
        data = extract_data_from_parts([])
        assert data == {}
