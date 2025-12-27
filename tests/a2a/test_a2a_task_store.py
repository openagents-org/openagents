"""Tests for A2A Task Store."""

import pytest
from openagents.models.a2a import (
    Task,
    TaskState,
    TaskStatus,
    A2AMessage,
    Artifact,
    TextPart,
    Role,
    create_text_message,
    create_task,
)
from openagents.core.a2a_task_store import TaskStore, InMemoryTaskStore


class TestInMemoryTaskStore:
    """Tests for InMemoryTaskStore."""

    @pytest.fixture
    def store(self):
        """Create a fresh task store for each test."""
        return InMemoryTaskStore(max_tasks=100)

    @pytest.fixture
    def sample_task(self):
        """Create a sample task."""
        message = create_text_message("Test task", Role.USER)
        return create_task(message)

    @pytest.mark.asyncio
    async def test_create_task(self, store, sample_task):
        """Test creating a task."""
        created = await store.create_task(sample_task)

        assert created.id == sample_task.id
        assert store.task_count() == 1

    @pytest.mark.asyncio
    async def test_get_task(self, store, sample_task):
        """Test getting a task by ID."""
        await store.create_task(sample_task)
        retrieved = await store.get_task(sample_task.id)

        assert retrieved is not None
        assert retrieved.id == sample_task.id

    @pytest.mark.asyncio
    async def test_get_nonexistent_task(self, store):
        """Test getting a task that doesn't exist."""
        result = await store.get_task("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_update_status(self, store, sample_task):
        """Test updating task status."""
        await store.create_task(sample_task)

        new_status = TaskStatus(state=TaskState.WORKING)
        updated = await store.update_status(sample_task.id, new_status)

        assert updated is not None
        assert updated.status.state == TaskState.WORKING

    @pytest.mark.asyncio
    async def test_update_status_nonexistent(self, store):
        """Test updating status of nonexistent task."""
        new_status = TaskStatus(state=TaskState.WORKING)
        result = await store.update_status("nonexistent", new_status)
        assert result is None

    @pytest.mark.asyncio
    async def test_update_task_state(self, store, sample_task):
        """Test convenience method for updating task state."""
        await store.create_task(sample_task)

        updated = await store.update_task_state(sample_task.id, TaskState.COMPLETED)

        assert updated is not None
        assert updated.status.state == TaskState.COMPLETED

    @pytest.mark.asyncio
    async def test_add_artifact(self, store, sample_task):
        """Test adding an artifact to a task."""
        await store.create_task(sample_task)

        artifact = Artifact(
            name="result",
            parts=[TextPart(text="Final result")],
        )
        updated = await store.add_artifact(sample_task.id, artifact)

        assert updated is not None
        assert len(updated.artifacts) == 1
        assert updated.artifacts[0].name == "result"

    @pytest.mark.asyncio
    async def test_add_artifact_nonexistent(self, store):
        """Test adding artifact to nonexistent task."""
        artifact = Artifact(name="test", parts=[TextPart(text="Test")])
        result = await store.add_artifact("nonexistent", artifact)
        assert result is None

    @pytest.mark.asyncio
    async def test_add_message(self, store, sample_task):
        """Test adding a message to task history."""
        await store.create_task(sample_task)
        initial_count = len(sample_task.history)

        new_message = create_text_message("Response", Role.AGENT)
        updated = await store.add_message(sample_task.id, new_message)

        assert updated is not None
        assert len(updated.history) == initial_count + 1

    @pytest.mark.asyncio
    async def test_add_message_nonexistent(self, store):
        """Test adding message to nonexistent task."""
        message = create_text_message("Test", Role.USER)
        result = await store.add_message("nonexistent", message)
        assert result is None

    @pytest.mark.asyncio
    async def test_list_tasks_empty(self, store):
        """Test listing tasks from empty store."""
        tasks = await store.list_tasks()
        assert tasks == []

    @pytest.mark.asyncio
    async def test_list_tasks(self, store):
        """Test listing all tasks."""
        # Create multiple tasks
        for i in range(5):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            await store.create_task(task)

        tasks = await store.list_tasks()
        assert len(tasks) == 5

    @pytest.mark.asyncio
    async def test_list_tasks_by_context(self, store):
        """Test listing tasks filtered by context ID."""
        # Create tasks in different contexts
        context_a = "context_a"
        context_b = "context_b"

        for i in range(3):
            message = create_text_message(f"Task A{i}", Role.USER)
            task = create_task(message, context_id=context_a)
            await store.create_task(task)

        for i in range(2):
            message = create_text_message(f"Task B{i}", Role.USER)
            task = create_task(message, context_id=context_b)
            await store.create_task(task)

        tasks_a = await store.list_tasks(context_id=context_a)
        tasks_b = await store.list_tasks(context_id=context_b)

        assert len(tasks_a) == 3
        assert len(tasks_b) == 2

    @pytest.mark.asyncio
    async def test_list_tasks_with_limit(self, store):
        """Test listing tasks with limit."""
        for i in range(10):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            await store.create_task(task)

        tasks = await store.list_tasks(limit=5)
        assert len(tasks) == 5

    @pytest.mark.asyncio
    async def test_list_tasks_with_offset(self, store):
        """Test listing tasks with offset."""
        for i in range(10):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            await store.create_task(task)

        tasks = await store.list_tasks(offset=3, limit=5)
        assert len(tasks) == 5

    @pytest.mark.asyncio
    async def test_delete_task(self, store, sample_task):
        """Test deleting a task."""
        await store.create_task(sample_task)
        assert store.task_count() == 1

        result = await store.delete_task(sample_task.id)

        assert result is True
        assert store.task_count() == 0
        assert await store.get_task(sample_task.id) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_task(self, store):
        """Test deleting a task that doesn't exist."""
        result = await store.delete_task("nonexistent")
        assert result is False

    @pytest.mark.asyncio
    async def test_get_tasks_by_state(self, store):
        """Test getting tasks by state."""
        # Create tasks with different states
        for state in [TaskState.SUBMITTED, TaskState.WORKING, TaskState.COMPLETED]:
            message = create_text_message(f"Task {state.value}", Role.USER)
            task = create_task(message)
            task.status = TaskStatus(state=state)
            await store.create_task(task)

        working_tasks = await store.get_tasks_by_state(TaskState.WORKING)
        assert len(working_tasks) == 1
        assert working_tasks[0].status.state == TaskState.WORKING

    @pytest.mark.asyncio
    async def test_get_context_tasks(self, store):
        """Test getting all tasks in a context."""
        context_id = "test_context"

        for i in range(3):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message, context_id=context_id)
            await store.create_task(task)

        tasks = await store.get_context_tasks(context_id)
        assert len(tasks) == 3

    @pytest.mark.asyncio
    async def test_clear(self, store):
        """Test clearing all tasks."""
        for i in range(5):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            await store.create_task(task)

        assert store.task_count() == 5

        await store.clear()

        assert store.task_count() == 0
        assert store.context_count() == 0


class TestTaskStoreLRUEviction:
    """Tests for LRU eviction in InMemoryTaskStore."""

    @pytest.mark.asyncio
    async def test_eviction_when_max_reached(self):
        """Test that oldest tasks are evicted when max is reached."""
        store = InMemoryTaskStore(max_tasks=3)

        task_ids = []
        for i in range(5):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            task_ids.append(task.id)
            await store.create_task(task)

        # Should only have 3 tasks
        assert store.task_count() == 3

        # First two tasks should be evicted
        assert await store.get_task(task_ids[0]) is None
        assert await store.get_task(task_ids[1]) is None

        # Last three should exist
        assert await store.get_task(task_ids[2]) is not None
        assert await store.get_task(task_ids[3]) is not None
        assert await store.get_task(task_ids[4]) is not None

    @pytest.mark.asyncio
    async def test_access_updates_lru_order(self):
        """Test that accessing a task updates its LRU position."""
        store = InMemoryTaskStore(max_tasks=3)

        task_ids = []
        for i in range(3):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message)
            task_ids.append(task.id)
            await store.create_task(task)

        # Access the first task (making it most recent)
        await store.get_task(task_ids[0])

        # Add a new task (should evict task_ids[1], not task_ids[0])
        message = create_text_message("New Task", Role.USER)
        new_task = create_task(message)
        await store.create_task(new_task)

        # Task 0 should still exist (was accessed)
        assert await store.get_task(task_ids[0]) is not None
        # Task 1 should be evicted (oldest not accessed)
        assert await store.get_task(task_ids[1]) is None
        # Task 2 and new task should exist
        assert await store.get_task(task_ids[2]) is not None
        assert await store.get_task(new_task.id) is not None


class TestTaskStoreCallbacks:
    """Tests for task store callbacks."""

    @pytest.mark.asyncio
    async def test_callback_on_create(self):
        """Test callback is called on task creation."""
        store = InMemoryTaskStore()
        callback_events = []

        async def callback(task, update_type):
            callback_events.append((task.id, update_type))

        store.register_callback(callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await store.create_task(task)

        assert len(callback_events) == 1
        assert callback_events[0] == (task.id, "created")

    @pytest.mark.asyncio
    async def test_callback_on_status_update(self):
        """Test callback is called on status update."""
        store = InMemoryTaskStore()
        callback_events = []

        async def callback(task, update_type):
            callback_events.append((task.id, update_type))

        store.register_callback(callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await store.create_task(task)

        new_status = TaskStatus(state=TaskState.WORKING)
        await store.update_status(task.id, new_status)

        assert len(callback_events) == 2
        assert callback_events[1] == (task.id, "status")

    @pytest.mark.asyncio
    async def test_callback_on_artifact_add(self):
        """Test callback is called on artifact addition."""
        store = InMemoryTaskStore()
        callback_events = []

        async def callback(task, update_type):
            callback_events.append((task.id, update_type))

        store.register_callback(callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await store.create_task(task)

        artifact = Artifact(name="test", parts=[TextPart(text="Result")])
        await store.add_artifact(task.id, artifact)

        assert len(callback_events) == 2
        assert callback_events[1] == (task.id, "artifact")

    @pytest.mark.asyncio
    async def test_callback_on_message_add(self):
        """Test callback is called on message addition."""
        store = InMemoryTaskStore()
        callback_events = []

        async def callback(task, update_type):
            callback_events.append((task.id, update_type))

        store.register_callback(callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await store.create_task(task)

        response = create_text_message("Response", Role.AGENT)
        await store.add_message(task.id, response)

        assert len(callback_events) == 2
        assert callback_events[1] == (task.id, "message")

    @pytest.mark.asyncio
    async def test_unregister_callback(self):
        """Test unregistering a callback."""
        store = InMemoryTaskStore()
        callback_events = []

        async def callback(task, update_type):
            callback_events.append((task.id, update_type))

        store.register_callback(callback)
        store.unregister_callback(callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)
        await store.create_task(task)

        # Callback should not be called
        assert len(callback_events) == 0

    @pytest.mark.asyncio
    async def test_callback_error_handling(self):
        """Test that callback errors don't break the store."""
        store = InMemoryTaskStore()

        async def bad_callback(task, update_type):
            raise Exception("Callback error")

        store.register_callback(bad_callback)

        message = create_text_message("Test", Role.USER)
        task = create_task(message)

        # Should not raise even though callback fails
        created = await store.create_task(task)
        assert created is not None


class TestTaskStoreContextIndex:
    """Tests for context indexing in TaskStore."""

    @pytest.mark.asyncio
    async def test_context_count(self):
        """Test context count tracking."""
        store = InMemoryTaskStore()

        # Create tasks in different contexts
        for ctx_id in ["ctx_1", "ctx_2", "ctx_3"]:
            message = create_text_message(f"Task in {ctx_id}", Role.USER)
            task = create_task(message, context_id=ctx_id)
            await store.create_task(task)

        assert store.context_count() == 3

    @pytest.mark.asyncio
    async def test_context_index_after_delete(self):
        """Test context index is updated on task deletion."""
        store = InMemoryTaskStore()
        context_id = "test_ctx"

        message = create_text_message("Test", Role.USER)
        task = create_task(message, context_id=context_id)
        await store.create_task(task)

        tasks = await store.get_context_tasks(context_id)
        assert len(tasks) == 1

        await store.delete_task(task.id)

        tasks = await store.get_context_tasks(context_id)
        assert len(tasks) == 0

    @pytest.mark.asyncio
    async def test_multiple_tasks_same_context(self):
        """Test multiple tasks in the same context."""
        store = InMemoryTaskStore()
        context_id = "shared_ctx"

        task_ids = []
        for i in range(5):
            message = create_text_message(f"Task {i}", Role.USER)
            task = create_task(message, context_id=context_id)
            task_ids.append(task.id)
            await store.create_task(task)

        tasks = await store.get_context_tasks(context_id)
        assert len(tasks) == 5

        # All task IDs should be present
        retrieved_ids = [t.id for t in tasks]
        for tid in task_ids:
            assert tid in retrieved_ids
