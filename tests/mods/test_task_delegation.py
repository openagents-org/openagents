"""
Tests for the Task Delegation mod.

This test suite verifies the task delegation mod functionality:
- Task delegation between agents
- Progress reporting
- Task completion
- Task failure
- Task timeout
- Task listing and filtering
- Access control
- Notifications
"""

import pytest
import time
import uuid
from unittest.mock import AsyncMock, MagicMock

from openagents.mods.coordination.task_delegation.mod import TaskDelegationMod
from openagents.models.task import Task, TaskState

# Compatibility aliases for old constant names
# Note: New tasks start as "submitted", not "working"
STATUS_SUBMITTED = TaskState.SUBMITTED.value
STATUS_IN_PROGRESS = TaskState.WORKING.value  # Tasks move to "working" when accepted
STATUS_COMPLETED = TaskState.COMPLETED.value
STATUS_FAILED = TaskState.FAILED.value
STATUS_TIMED_OUT = "timed_out"  # This may need to be mapped to FAILED
from openagents.mods.coordination.task_delegation.adapter import TaskDelegationAdapter
from openagents.models.event import Event


@pytest.fixture
def mock_network():
    """Create a mock network for testing."""
    network = MagicMock()
    network.network_id = "test-network"
    network.workspace_manager = None  # Will use temp directory
    network.process_event = AsyncMock(return_value=None)
    # Set a2a_task_store to None so mod creates its own InMemoryTaskStore
    network.a2a_task_store = None
    return network


@pytest.fixture
def task_delegation_mod(mock_network, tmp_path):
    """Create a TaskDelegationMod instance for testing."""
    # Patch get_storage_path to use tmp_path
    mod = TaskDelegationMod()

    # Mock the get_storage_path to return a tmp directory
    mod.get_storage_path = lambda: tmp_path / "task_delegation"
    (tmp_path / "task_delegation").mkdir(parents=True, exist_ok=True)

    # Bind the mock network - this sets up the real task_store
    mod.bind_network(mock_network)

    yield mod

    # Cleanup - shutdown is async now
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(mod.shutdown())
    except RuntimeError:
        # No running loop, just skip async shutdown
        pass


@pytest.fixture
def task_delegation_adapter():
    """Create a TaskDelegationAdapter instance for testing."""
    adapter = TaskDelegationAdapter()
    adapter._agent_id = "test-agent"
    return adapter


class TestTaskDelegationMod:
    """Tests for the TaskDelegationMod network-level mod."""

    @pytest.mark.asyncio
    async def test_delegate_task_success(self, task_delegation_mod):
        """Test successful task delegation."""
        event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
                "payload": {"query": "AI trends 2025"},
                "timeout_seconds": 300,
            },
        )

        response = await task_delegation_mod._handle_task_delegate(event)

        assert response is not None
        assert response.success is True
        assert response.message == "Task delegated successfully"
        assert "task_id" in response.data
        assert response.data["status"] == STATUS_SUBMITTED  # New tasks start as submitted
        assert "created_at" in response.data

        # Verify task was stored
        task_id = response.data["task_id"]
        task = await task_delegation_mod.task_store.get_task(task_id)
        assert task is not None
        delegation = task.metadata.get("delegation", {})
        assert delegation.get("delegator_id") == "agent_alice"
        assert delegation.get("assignee_id") == "agent_bob"
        assert delegation.get("description") == "Search for AI trends"
        assert task.status.state.value == STATUS_SUBMITTED  # New tasks start as submitted

    @pytest.mark.asyncio
    async def test_delegate_task_missing_assignee(self, task_delegation_mod):
        """Test task delegation with missing assignee_id."""
        event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "description": "Search for AI trends",
            },
        )

        response = await task_delegation_mod._handle_task_delegate(event)

        assert response is not None
        assert response.success is False
        assert "assignee_id is required" in response.message

    @pytest.mark.asyncio
    async def test_delegate_task_missing_description(self, task_delegation_mod):
        """Test task delegation with missing description."""
        event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
            },
        )

        response = await task_delegation_mod._handle_task_delegate(event)

        assert response is not None
        assert response.success is False
        assert "description is required" in response.message

    @pytest.mark.asyncio
    async def test_report_progress_success(self, task_delegation_mod):
        """Test successful progress reporting."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Report progress as assignee
        report_event = Event(
            event_name="task.report",
            source_id="agent_bob",
            payload={
                "task_id": task_id,
                "progress": {
                    "message": "Searching web sources...",
                    "data": {"sources_checked": 3},
                },
            },
        )

        response = await task_delegation_mod._handle_task_report(report_event)

        assert response is not None
        assert response.success is True
        assert response.message == "Progress reported"
        assert response.data["task_id"] == task_id
        assert response.data["progress_count"] == 1

        # Verify progress was stored in task history
        task = await task_delegation_mod.task_store.get_task(task_id)
        assert len(task.history) >= 1
        # Progress message should contain the text
        last_message = task.history[-1]
        message_text = "".join(
            part.text for part in last_message.parts if hasattr(part, "text")
        )
        assert "Searching web sources" in message_text

    @pytest.mark.asyncio
    async def test_report_progress_unauthorized(self, task_delegation_mod):
        """Test that only assignee can report progress."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Try to report progress as a different agent
        report_event = Event(
            event_name="task.report",
            source_id="agent_charlie",  # Not the assignee
            payload={
                "task_id": task_id,
                "progress": {"message": "Some progress"},
            },
        )

        response = await task_delegation_mod._handle_task_report(report_event)

        assert response is not None
        assert response.success is False
        assert "assignee" in response.message.lower()

    @pytest.mark.asyncio
    async def test_complete_task_success(self, task_delegation_mod):
        """Test successful task completion."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Complete task as assignee
        complete_event = Event(
            event_name="task.complete",
            source_id="agent_bob",
            payload={
                "task_id": task_id,
                "result": {
                    "findings": ["Finding 1", "Finding 2"],
                    "summary": "AI is advancing rapidly",
                },
            },
        )

        response = await task_delegation_mod._handle_task_complete(complete_event)

        assert response is not None
        assert response.success is True
        assert response.message == "Task completed successfully"
        assert response.data["task_id"] == task_id
        assert response.data["status"] == STATUS_COMPLETED
        assert "completed_at" in response.data

        # Verify task was updated
        task = await task_delegation_mod.task_store.get_task(task_id)
        assert task.status.state.value == STATUS_COMPLETED
        # Result is stored in artifacts
        assert len(task.artifacts) >= 1
        result_artifact = task.artifacts[-1]
        # Check that result data is in the artifact parts
        result_data = None
        for part in result_artifact.parts:
            if hasattr(part, "data"):
                result_data = part.data
                break
        assert result_data is not None
        assert result_data.get("findings") == ["Finding 1", "Finding 2"]

    @pytest.mark.asyncio
    async def test_complete_task_unauthorized(self, task_delegation_mod):
        """Test that only assignee can complete task."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Try to complete as delegator (not assignee)
        complete_event = Event(
            event_name="task.complete",
            source_id="agent_alice",
            payload={
                "task_id": task_id,
                "result": {"some": "result"},
            },
        )

        response = await task_delegation_mod._handle_task_complete(complete_event)

        assert response is not None
        assert response.success is False
        assert "assignee" in response.message.lower()

    @pytest.mark.asyncio
    async def test_fail_task_success(self, task_delegation_mod):
        """Test successful task failure."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Fail task as assignee
        fail_event = Event(
            event_name="task.fail",
            source_id="agent_bob",
            payload={
                "task_id": task_id,
                "error": "Unable to complete search - network error",
            },
        )

        response = await task_delegation_mod._handle_task_fail(fail_event)

        assert response is not None
        assert response.success is True
        assert response.message == "Task marked as failed"
        assert response.data["task_id"] == task_id
        assert response.data["status"] == STATUS_FAILED

        # Verify task was updated
        task = await task_delegation_mod.task_store.get_task(task_id)
        assert task.status.state.value == STATUS_FAILED
        # Error is stored in error_details, not delegation
        error_details = task.metadata.get("error_details", {})
        assert error_details.get("error") == "Unable to complete search - network error"

    @pytest.mark.asyncio
    async def test_fail_task_unauthorized(self, task_delegation_mod):
        """Test that only assignee can fail task."""
        # First delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Try to fail as delegator (not assignee)
        fail_event = Event(
            event_name="task.fail",
            source_id="agent_alice",
            payload={
                "task_id": task_id,
                "error": "Some error",
            },
        )

        response = await task_delegation_mod._handle_task_fail(fail_event)

        assert response is not None
        assert response.success is False
        assert "assignee" in response.message.lower()

    @pytest.mark.asyncio
    async def test_list_tasks_delegated_by_me(self, task_delegation_mod):
        """Test listing tasks delegated by an agent."""
        # Delegate multiple tasks
        for i in range(3):
            delegate_event = Event(
                event_name="task.delegate",
                source_id="agent_alice",
                payload={
                    "assignee_id": "agent_bob",
                    "description": f"Task {i}",
                },
            )
            await task_delegation_mod._handle_task_delegate(delegate_event)

        # Also delegate a task from another agent
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_charlie",
            payload={
                "assignee_id": "agent_bob",
                "description": "Task from Charlie",
            },
        )
        await task_delegation_mod._handle_task_delegate(delegate_event)

        # List tasks delegated by Alice
        list_event = Event(
            event_name="task.list",
            source_id="agent_alice",
            payload={
                "filter": {"role": "delegated_by_me"},
                "limit": 10,
                "offset": 0,
            },
        )

        response = await task_delegation_mod._handle_task_list(list_event)

        assert response is not None
        assert response.success is True
        assert response.data["total_count"] == 3
        assert len(response.data["tasks"]) == 3
        for task in response.data["tasks"]:
            assert task["delegator_id"] == "agent_alice"

    @pytest.mark.asyncio
    async def test_list_tasks_assigned_to_me(self, task_delegation_mod):
        """Test listing tasks assigned to an agent."""
        # Delegate tasks from different agents to Bob
        for i in range(2):
            delegate_event = Event(
                event_name="task.delegate",
                source_id=f"agent_{i}",
                payload={
                    "assignee_id": "agent_bob",
                    "description": f"Task for Bob {i}",
                },
            )
            await task_delegation_mod._handle_task_delegate(delegate_event)

        # Delegate a task to another agent
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_charlie",
                "description": "Task for Charlie",
            },
        )
        await task_delegation_mod._handle_task_delegate(delegate_event)

        # List tasks assigned to Bob
        list_event = Event(
            event_name="task.list",
            source_id="agent_bob",
            payload={
                "filter": {"role": "assigned_to_me"},
                "limit": 10,
                "offset": 0,
            },
        )

        response = await task_delegation_mod._handle_task_list(list_event)

        assert response is not None
        assert response.success is True
        assert response.data["total_count"] == 2
        for task in response.data["tasks"]:
            assert task["assignee_id"] == "agent_bob"

    @pytest.mark.asyncio
    async def test_list_tasks_filter_by_status(self, task_delegation_mod):
        """Test listing tasks filtered by status."""
        # Create tasks with different statuses
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Task 1",
            },
        )
        response1 = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id_1 = response1.data["task_id"]

        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Task 2",
            },
        )
        response2 = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id_2 = response2.data["task_id"]

        # Complete task 1
        complete_event = Event(
            event_name="task.complete",
            source_id="agent_bob",
            payload={"task_id": task_id_1, "result": {}},
        )
        await task_delegation_mod._handle_task_complete(complete_event)

        # List only submitted tasks (not completed)
        list_event = Event(
            event_name="task.list",
            source_id="agent_alice",
            payload={
                "filter": {"role": "delegated_by_me", "status": ["submitted"]},
            },
        )

        response = await task_delegation_mod._handle_task_list(list_event)

        assert response is not None
        assert response.success is True
        assert response.data["total_count"] == 1
        assert response.data["tasks"][0]["task_id"] == task_id_2

    @pytest.mark.asyncio
    async def test_get_task_success(self, task_delegation_mod):
        """Test getting task details."""
        # Delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
                "payload": {"query": "AI trends 2025"},
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Get task as delegator
        get_event = Event(
            event_name="task.get",
            source_id="agent_alice",
            payload={"task_id": task_id},
        )

        response = await task_delegation_mod._handle_task_get(get_event)

        assert response is not None
        assert response.success is True
        assert response.data["task_id"] == task_id
        assert response.data["delegator_id"] == "agent_alice"
        assert response.data["assignee_id"] == "agent_bob"
        assert response.data["description"] == "Search for AI trends"
        assert response.data["payload"] == {"query": "AI trends 2025"}

    @pytest.mark.asyncio
    async def test_get_task_unauthorized(self, task_delegation_mod):
        """Test that only delegator or assignee can view task."""
        # Delegate a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Search for AI trends",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        # Try to get task as another agent
        get_event = Event(
            event_name="task.get",
            source_id="agent_charlie",
            payload={"task_id": task_id},
        )

        response = await task_delegation_mod._handle_task_get(get_event)

        assert response is not None
        assert response.success is False
        assert "not authorized" in response.message.lower()

    @pytest.mark.asyncio
    async def test_get_task_not_found(self, task_delegation_mod):
        """Test getting a non-existent task."""
        get_event = Event(
            event_name="task.get",
            source_id="agent_alice",
            payload={"task_id": "non-existent-task"},
        )

        response = await task_delegation_mod._handle_task_get(get_event)

        assert response is not None
        assert response.success is False
        assert "not found" in response.message.lower()

    @pytest.mark.asyncio
    async def test_timeout_task(self, task_delegation_mod, mock_network):
        """Test automatic task timeout."""
        from openagents.models.a2a import Task as A2ATask, TaskStatus, TaskState as A2ATaskState

        # Create a task with very short timeout using A2A Task
        task_id = str(uuid.uuid4())
        task = A2ATask(
            id=task_id,
            status=TaskStatus(state=A2ATaskState.WORKING),
            metadata={
                "delegation": {
                    "delegator_id": "agent_alice",
                    "assignee_id": "agent_bob",
                    "description": "Short timeout task",
                    "payload": {},
                    "timeout_seconds": 1,  # 1 second timeout
                    "created_at": time.time() - 2,  # Created 2 seconds ago
                }
            },
        )
        await task_delegation_mod.task_store.create_task(task)

        # Run timeout check
        await task_delegation_mod._check_timeouts()

        # Verify task was timed out
        updated_task = await task_delegation_mod.task_store.get_task(task_id)
        assert updated_task.status.state == A2ATaskState.FAILED
        assert updated_task.metadata.get("delegation", {}).get("completed_at") is not None

        # Verify notifications were sent
        assert mock_network.process_event.call_count >= 2  # At least 2 notifications

    @pytest.mark.asyncio
    async def test_get_state(self, task_delegation_mod):
        """Test getting mod state."""
        from openagents.models.a2a import Task as A2ATask, TaskStatus, TaskState as A2ATaskState

        # Add some tasks with different statuses using task_store
        task1 = A2ATask(
            id="task1",
            status=TaskStatus(state=A2ATaskState.WORKING),
            metadata={
                "delegation": {
                    "delegator_id": "alice",
                    "assignee_id": "bob",
                    "description": "Task 1",
                    "payload": {},
                    "timeout_seconds": 300,
                    "created_at": time.time(),
                }
            },
        )
        task2 = A2ATask(
            id="task2",
            status=TaskStatus(state=A2ATaskState.COMPLETED),
            metadata={
                "delegation": {
                    "delegator_id": "alice",
                    "assignee_id": "bob",
                    "description": "Task 2",
                    "payload": {},
                    "timeout_seconds": 300,
                    "created_at": time.time(),
                }
            },
        )
        task3 = A2ATask(
            id="task3",
            status=TaskStatus(state=A2ATaskState.FAILED),
            metadata={
                "delegation": {
                    "delegator_id": "alice",
                    "assignee_id": "bob",
                    "description": "Task 3",
                    "payload": {},
                    "timeout_seconds": 300,
                    "created_at": time.time(),
                }
            },
        )
        await task_delegation_mod.task_store.create_task(task1)
        await task_delegation_mod.task_store.create_task(task2)
        await task_delegation_mod.task_store.create_task(task3)

        state = task_delegation_mod.get_state()

        assert state["total_tasks"] == 3
        assert state["active_tasks"] == 1
        assert state["completed_tasks"] == 1
        assert state["failed_tasks"] == 1

    @pytest.mark.asyncio
    async def test_cannot_complete_already_completed_task(self, task_delegation_mod):
        """Test that completed tasks cannot be completed again."""
        # Delegate and complete a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Test task",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        complete_event = Event(
            event_name="task.complete",
            source_id="agent_bob",
            payload={"task_id": task_id, "result": {}},
        )
        await task_delegation_mod._handle_task_complete(complete_event)

        # Try to complete again
        response = await task_delegation_mod._handle_task_complete(complete_event)

        assert response is not None
        assert response.success is False
        assert "status" in response.message.lower() or "not in progress" in response.message.lower()

    @pytest.mark.asyncio
    async def test_cannot_report_progress_on_completed_task(self, task_delegation_mod):
        """Test that progress cannot be reported on completed tasks."""
        # Delegate and complete a task
        delegate_event = Event(
            event_name="task.delegate",
            source_id="agent_alice",
            payload={
                "assignee_id": "agent_bob",
                "description": "Test task",
            },
        )
        delegate_response = await task_delegation_mod._handle_task_delegate(delegate_event)
        task_id = delegate_response.data["task_id"]

        complete_event = Event(
            event_name="task.complete",
            source_id="agent_bob",
            payload={"task_id": task_id, "result": {}},
        )
        await task_delegation_mod._handle_task_complete(complete_event)

        # Try to report progress
        report_event = Event(
            event_name="task.report",
            source_id="agent_bob",
            payload={"task_id": task_id, "progress": {"message": "Progress"}},
        )
        response = await task_delegation_mod._handle_task_report(report_event)

        assert response is not None
        assert response.success is False
        assert "status" in response.message.lower() or "not in progress" in response.message.lower()


class TestTaskDelegationAdapter:
    """Tests for the TaskDelegationAdapter agent-level adapter."""

    def test_get_tools(self, task_delegation_adapter):
        """Test that adapter provides expected tools."""
        tools = task_delegation_adapter.get_tools()

        tool_names = [tool.name for tool in tools]
        expected_tools = [
            "delegate_task",
            "report_task_progress",
            "complete_task",
            "fail_task",
            "list_tasks",
            "get_task",
        ]

        for expected in expected_tools:
            assert expected in tool_names, f"Missing tool: {expected}"

    def test_tool_schemas(self, task_delegation_adapter):
        """Test that tool schemas are correctly defined."""
        tools = task_delegation_adapter.get_tools()

        # Check delegate_task tool
        delegate_tool = next(t for t in tools if t.name == "delegate_task")
        assert "assignee_id" in delegate_tool.input_schema["properties"]
        assert "description" in delegate_tool.input_schema["properties"]
        assert "assignee_id" in delegate_tool.input_schema["required"]
        assert "description" in delegate_tool.input_schema["required"]

        # Check complete_task tool
        complete_tool = next(t for t in tools if t.name == "complete_task")
        assert "task_id" in complete_tool.input_schema["properties"]
        assert "result" in complete_tool.input_schema["properties"]
        assert "task_id" in complete_tool.input_schema["required"]


class TestTaskDataClass:
    """Tests for the Task models (native and A2A)."""

    def test_task_creation(self):
        """Test creating a native Task instance."""
        # Native Task model uses 'id' and 'state', with delegator/assignee as direct fields
        task = Task(
            id="test-123",
            delegator_id="alice",
            assignee_id="bob",
            state=TaskState.WORKING,
        )

        assert task.id == "test-123"
        assert task.delegator_id == "alice"
        assert task.assignee_id == "bob"
        assert task.state == TaskState.WORKING
        assert task.artifacts == []
        assert task.metadata is None

    def test_task_to_dict(self):
        """Test Task model_dump method (Pydantic)."""
        task = Task(
            id="test-123",
            delegator_id="alice",
            assignee_id="bob",
            state=TaskState.WORKING,
            metadata={"key": "value"},
        )

        # Pydantic models use model_dump() instead of to_dict()
        task_dict = task.model_dump()

        assert task_dict["id"] == "test-123"
        assert task_dict["delegator_id"] == "alice"
        assert task_dict["assignee_id"] == "bob"
        assert task_dict["state"] == TaskState.WORKING
        assert task_dict["metadata"] == {"key": "value"}

    def test_task_from_dict(self):
        """Test Task creation from dict (Pydantic)."""
        task_data = {
            "id": "test-456",
            "delegator_id": "charlie",
            "assignee_id": "dave",
            "state": TaskState.COMPLETED,
            "metadata": {"outcome": "success"},
        }

        # Pydantic models can be created directly from dict or using model_validate()
        task = Task(**task_data)

        assert task.id == "test-456"
        assert task.delegator_id == "charlie"
        assert task.assignee_id == "dave"
        assert task.state == TaskState.COMPLETED
        assert task.metadata == {"outcome": "success"}


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
