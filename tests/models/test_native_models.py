"""Tests for Native OpenAgents Models.

Tests for Skill, Artifact, Task, AgentProfile models and their
bidirectional conversion to/from A2A protocol models.
"""

import pytest
from openagents.models.skill import Skill
from openagents.models.artifact import Artifact, ArtifactType
from openagents.models.task import Task, TaskState, TaskPriority
from openagents.models.profile import AgentProfile
from openagents.models.a2a import (
    AgentSkill,
    Artifact as A2AArtifact,
    Task as A2ATask,
    TaskState as A2ATaskState,
    TaskStatus,
    TextPart,
    AgentCard,
    AgentCapabilities,
)
from openagents.utils.native_converters import (
    skill_to_a2a,
    a2a_to_skill,
    artifact_to_a2a,
    a2a_to_artifact,
    task_to_a2a,
    a2a_to_task,
    profile_to_a2a_card,
    a2a_card_to_profile,
)


class TestSkill:
    """Tests for native Skill model."""

    def test_skill_creation(self):
        """Test basic skill creation."""
        skill = Skill(
            id="translate",
            name="Translation",
            description="Translate text between languages",
        )
        assert skill.id == "translate"
        assert skill.name == "Translation"
        assert skill.description == "Translate text between languages"

    def test_skill_defaults(self):
        """Test skill default values."""
        skill = Skill(id="test", name="Test Skill")
        assert skill.tags == []
        assert skill.input_modes == ["text"]
        assert skill.output_modes == ["text"]
        assert skill.examples == []
        assert skill.version is None
        assert skill.is_enabled is True
        assert skill.metadata is None

    def test_skill_with_extensions(self):
        """Test skill with OpenAgents extensions."""
        skill = Skill(
            id="analyze",
            name="Analyzer",
            version="2.0.0",
            is_enabled=False,
            metadata={"custom_field": "value"},
        )
        assert skill.version == "2.0.0"
        assert skill.is_enabled is False
        assert skill.metadata == {"custom_field": "value"}

    def test_skill_with_modes(self):
        """Test skill with custom input/output modes."""
        skill = Skill(
            id="multimedia",
            name="Multimedia Processor",
            input_modes=["text", "image", "audio"],
            output_modes=["text", "file"],
        )
        assert skill.input_modes == ["text", "image", "audio"]
        assert skill.output_modes == ["text", "file"]

    def test_skill_to_a2a(self):
        """Test conversion from native Skill to A2A AgentSkill."""
        skill = Skill(
            id="chat",
            name="Chat",
            description="General chat",
            tags=["general", "conversation"],
            input_modes=["text"],
            output_modes=["text"],
            examples=["Hello!", "How are you?"],
        )
        a2a_skill = skill.to_a2a_skill()

        assert isinstance(a2a_skill, AgentSkill)
        assert a2a_skill.id == "chat"
        assert a2a_skill.name == "Chat"
        assert a2a_skill.description == "General chat"
        assert a2a_skill.tags == ["general", "conversation"]
        assert a2a_skill.input_modes == ["text"]
        assert a2a_skill.output_modes == ["text"]
        assert a2a_skill.examples == ["Hello!", "How are you?"]

    def test_skill_from_a2a(self):
        """Test conversion from A2A AgentSkill to native Skill."""
        a2a_skill = AgentSkill(
            id="search",
            name="Search",
            description="Search the web",
            tags=["search", "web"],
            input_modes=["text"],
            output_modes=["text", "data"],
        )
        skill = Skill.from_a2a_skill(a2a_skill)

        assert isinstance(skill, Skill)
        assert skill.id == "search"
        assert skill.name == "Search"
        assert skill.description == "Search the web"
        assert skill.tags == ["search", "web"]
        # Extensions should have defaults
        assert skill.version is None
        assert skill.is_enabled is True

    def test_skill_roundtrip(self):
        """Test native -> A2A -> native preserves data."""
        original = Skill(
            id="code",
            name="Code Assistant",
            description="Help with coding",
            tags=["programming"],
            version="1.2.0",
            is_enabled=True,
            metadata={"priority": 1},
        )
        a2a = original.to_a2a_skill()
        restored = Skill.from_a2a_skill(a2a)

        # A2A fields preserved
        assert restored.id == original.id
        assert restored.name == original.name
        assert restored.description == original.description
        assert restored.tags == original.tags


class TestArtifact:
    """Tests for native Artifact model."""

    def test_artifact_creation(self):
        """Test basic artifact creation."""
        artifact = Artifact(
            parts=[TextPart(text="Result data")],
            name="output",
            description="Operation result",
        )
        assert artifact.name == "output"
        assert artifact.description == "Operation result"
        assert len(artifact.parts) == 1

    def test_artifact_defaults(self):
        """Test artifact default values."""
        artifact = Artifact(parts=[TextPart(text="Data")])
        assert artifact.index == 0
        assert artifact.append is False
        assert artifact.last_chunk is True
        assert artifact.artifact_type == ArtifactType.RESULT
        assert artifact.source_task_id is None
        assert artifact.source_agent_id is None

    def test_artifact_types(self):
        """Test all artifact types."""
        for art_type in ArtifactType:
            artifact = Artifact(
                parts=[TextPart(text="Test")],
                artifact_type=art_type,
            )
            assert artifact.artifact_type == art_type

    def test_artifact_with_extensions(self):
        """Test artifact with OpenAgents extensions."""
        artifact = Artifact(
            parts=[TextPart(text="Log entry")],
            artifact_type=ArtifactType.LOG,
            source_task_id="task_123",
            source_agent_id="agent_456",
        )
        assert artifact.artifact_type == ArtifactType.LOG
        assert artifact.source_task_id == "task_123"
        assert artifact.source_agent_id == "agent_456"

    def test_artifact_to_a2a(self):
        """Test conversion from native Artifact to A2A Artifact."""
        artifact = Artifact(
            parts=[TextPart(text="Result")],
            name="result",
            description="Final result",
            index=1,
        )
        a2a_artifact = artifact.to_a2a_artifact()

        assert isinstance(a2a_artifact, A2AArtifact)
        assert a2a_artifact.name == "result"
        assert a2a_artifact.description == "Final result"
        assert a2a_artifact.index == 1

    def test_artifact_from_a2a(self):
        """Test conversion from A2A Artifact to native Artifact."""
        a2a_artifact = A2AArtifact(
            parts=[TextPart(text="Data")],
            name="data",
            index=0,
        )
        artifact = Artifact.from_a2a_artifact(a2a_artifact)

        assert isinstance(artifact, Artifact)
        assert artifact.name == "data"
        # Extensions should have defaults
        assert artifact.artifact_type == ArtifactType.RESULT
        assert artifact.source_task_id is None

    def test_artifact_roundtrip(self):
        """Test native -> A2A -> native preserves data."""
        original = Artifact(
            parts=[TextPart(text="Important data")],
            name="important",
            artifact_type=ArtifactType.INTERMEDIATE,
            source_task_id="task_abc",
        )
        a2a = original.to_a2a_artifact()
        restored = Artifact.from_a2a_artifact(a2a)

        # A2A fields preserved
        assert restored.name == original.name
        assert len(restored.parts) == len(original.parts)


class TestTask:
    """Tests for native Task model."""

    def test_task_creation(self):
        """Test basic task creation."""
        task = Task()
        assert task.id is not None
        assert len(task.id) > 0
        assert task.state == TaskState.PENDING

    def test_task_defaults(self):
        """Test task default values."""
        task = Task()
        assert task.context_id is None
        assert task.state == TaskState.PENDING
        assert task.artifacts == []
        assert task.metadata is None
        assert task.priority == TaskPriority.NORMAL
        assert task.delegator_id is None
        assert task.assignee_id is None

    def test_task_states(self):
        """Test all task states."""
        states = [
            TaskState.SUBMITTED,
            TaskState.WORKING,
            TaskState.COMPLETED,
            TaskState.FAILED,
            TaskState.CANCELED,
            TaskState.REJECTED,
            TaskState.INPUT_REQUIRED,
            TaskState.PENDING,
            TaskState.DELEGATED,
        ]
        for state in states:
            task = Task(state=state)
            assert task.state == state

    def test_task_priority(self):
        """Test all priority levels."""
        for priority in TaskPriority:
            task = Task(priority=priority)
            assert task.priority == priority

    def test_task_with_extensions(self):
        """Test task with OpenAgents extensions."""
        task = Task(
            state=TaskState.DELEGATED,
            priority=TaskPriority.HIGH,
            delegator_id="agent_a",
            assignee_id="agent_b",
        )
        assert task.state == TaskState.DELEGATED
        assert task.priority == TaskPriority.HIGH
        assert task.delegator_id == "agent_a"
        assert task.assignee_id == "agent_b"

    def test_task_with_artifacts(self):
        """Test task with artifacts."""
        artifact = Artifact(parts=[TextPart(text="Result")])
        task = Task(
            state=TaskState.COMPLETED,
            artifacts=[artifact],
        )
        assert len(task.artifacts) == 1
        assert task.artifacts[0].parts[0].text == "Result"

    def test_task_to_a2a(self):
        """Test conversion from native Task to A2A Task."""
        task = Task(
            id="task_123",
            context_id="ctx_456",
            state=TaskState.WORKING,
            priority=TaskPriority.HIGH,
            delegator_id="delegator_1",
        )
        a2a_task = task.to_a2a_task()

        assert isinstance(a2a_task, A2ATask)
        assert a2a_task.id == "task_123"
        assert a2a_task.context_id == "ctx_456"
        assert a2a_task.status.state == A2ATaskState.WORKING
        # Extensions stored in metadata
        assert "_native" in a2a_task.metadata
        assert a2a_task.metadata["_native"]["priority"] == "high"
        assert a2a_task.metadata["_native"]["delegator_id"] == "delegator_1"

    def test_task_to_a2a_state_mapping(self):
        """Test state mapping from native to A2A."""
        mappings = [
            (TaskState.SUBMITTED, A2ATaskState.SUBMITTED),
            (TaskState.WORKING, A2ATaskState.WORKING),
            (TaskState.COMPLETED, A2ATaskState.COMPLETED),
            (TaskState.FAILED, A2ATaskState.FAILED),
            (TaskState.CANCELED, A2ATaskState.CANCELED),
            (TaskState.REJECTED, A2ATaskState.REJECTED),
            (TaskState.INPUT_REQUIRED, A2ATaskState.INPUT_REQUIRED),
            # Extensions map to closest
            (TaskState.PENDING, A2ATaskState.SUBMITTED),
            (TaskState.DELEGATED, A2ATaskState.WORKING),
        ]
        for native_state, a2a_state in mappings:
            task = Task(state=native_state)
            a2a_task = task.to_a2a_task()
            assert a2a_task.status.state == a2a_state

    def test_task_from_a2a(self):
        """Test conversion from A2A Task to native Task."""
        a2a_task = A2ATask(
            id="task_789",
            context_id="ctx_abc",
            status=TaskStatus(state=A2ATaskState.COMPLETED),
        )
        task = Task.from_a2a_task(a2a_task)

        assert isinstance(task, Task)
        assert task.id == "task_789"
        assert task.context_id == "ctx_abc"
        assert task.state == TaskState.COMPLETED
        # Extensions have defaults
        assert task.priority == TaskPriority.NORMAL

    def test_task_from_a2a_with_native_metadata(self):
        """Test restoration of native extensions from metadata."""
        a2a_task = A2ATask(
            id="task_xyz",
            status=TaskStatus(state=A2ATaskState.WORKING),
            metadata={
                "_native": {
                    "state": "delegated",
                    "priority": "high",
                    "delegator_id": "agent_x",
                    "assignee_id": "agent_y",
                }
            },
        )
        task = Task.from_a2a_task(a2a_task)

        # Native extensions restored
        assert task.state == TaskState.DELEGATED
        assert task.priority == TaskPriority.HIGH
        assert task.delegator_id == "agent_x"
        assert task.assignee_id == "agent_y"

    def test_task_roundtrip(self):
        """Test native -> A2A -> native preserves all data."""
        original = Task(
            id="roundtrip_task",
            context_id="ctx_rt",
            state=TaskState.DELEGATED,
            priority=TaskPriority.LOW,
            delegator_id="del_1",
            assignee_id="asg_1",
            metadata={"custom": "data"},
        )
        a2a = original.to_a2a_task()
        restored = Task.from_a2a_task(a2a)

        assert restored.id == original.id
        assert restored.context_id == original.context_id
        assert restored.state == original.state
        assert restored.priority == original.priority
        assert restored.delegator_id == original.delegator_id
        assert restored.assignee_id == original.assignee_id
        assert restored.metadata == original.metadata


class TestAgentProfile:
    """Tests for native AgentProfile model."""

    def test_profile_creation(self):
        """Test basic profile creation."""
        profile = AgentProfile(name="TestAgent")
        assert profile.name == "TestAgent"
        assert profile.version == "1.0.0"

    def test_profile_defaults(self):
        """Test profile default values."""
        profile = AgentProfile(name="Agent")
        assert profile.description is None
        assert profile.url is None
        assert profile.protocol_version == "0.3"
        assert profile.skills == []
        assert profile.default_input_modes == ["text"]
        assert profile.default_output_modes == ["text"]
        assert profile.agent_id is None
        assert profile.agent_type == "local"
        assert profile.is_available is True
        assert profile.metadata is None

    def test_profile_with_skills(self):
        """Test profile with skills."""
        skill = Skill(id="code", name="Coding")
        profile = AgentProfile(
            name="CodeAgent",
            skills=[skill],
        )
        assert len(profile.skills) == 1
        assert profile.skills[0].id == "code"

    def test_profile_with_extensions(self):
        """Test profile with OpenAgents extensions."""
        profile = AgentProfile(
            name="ExtendedAgent",
            agent_id="agent_123",
            agent_type="a2a",
            is_available=False,
            metadata={"region": "us-west"},
        )
        assert profile.agent_id == "agent_123"
        assert profile.agent_type == "a2a"
        assert profile.is_available is False
        assert profile.metadata == {"region": "us-west"}

    def test_profile_to_a2a_card(self):
        """Test conversion from native AgentProfile to A2A AgentCard."""
        skill = Skill(id="chat", name="Chat", description="Chat skill")
        profile = AgentProfile(
            name="ChatAgent",
            version="2.0.0",
            description="A chat agent",
            url="http://localhost:8900/",
            skills=[skill],
        )
        card = profile.to_a2a_card()

        assert isinstance(card, AgentCard)
        assert card.name == "ChatAgent"
        assert card.version == "2.0.0"
        assert card.description == "A chat agent"
        assert card.url == "http://localhost:8900/"
        assert len(card.skills) == 1
        assert card.skills[0].id == "chat"

    def test_profile_to_a2a_card_no_url(self):
        """Test conversion handles missing URL (local agents)."""
        profile = AgentProfile(name="LocalAgent")
        card = profile.to_a2a_card()

        # URL should be empty string for A2A compatibility
        assert card.url == ""

    def test_profile_from_a2a_card(self):
        """Test conversion from A2A AgentCard to native AgentProfile."""
        a2a_skill = AgentSkill(
            id="search",
            name="Search",
            tags=["web"],
        )
        card = AgentCard(
            name="SearchAgent",
            version="1.5.0",
            url="http://external:9000/",
            skills=[a2a_skill],
        )
        profile = AgentProfile.from_a2a_card(card, agent_id="external_1")

        assert isinstance(profile, AgentProfile)
        assert profile.name == "SearchAgent"
        assert profile.version == "1.5.0"
        assert profile.url == "http://external:9000/"
        assert profile.agent_id == "external_1"
        assert profile.agent_type == "a2a"
        assert len(profile.skills) == 1
        assert profile.skills[0].id == "search"

    def test_profile_roundtrip(self):
        """Test native -> A2A -> native preserves A2A fields."""
        skill = Skill(id="analyze", name="Analyzer")
        original = AgentProfile(
            name="AnalyzerAgent",
            version="3.0.0",
            description="Analysis agent",
            url="http://localhost:8900/",
            skills=[skill],
            default_input_modes=["text", "data"],
            default_output_modes=["text"],
        )
        card = original.to_a2a_card()
        restored = AgentProfile.from_a2a_card(card)

        assert restored.name == original.name
        assert restored.version == original.version
        assert restored.description == original.description
        assert restored.url == original.url
        assert len(restored.skills) == len(original.skills)
        assert restored.default_input_modes == original.default_input_modes


class TestNativeConverters:
    """Tests for standalone converter functions."""

    def test_skill_to_a2a_function(self):
        """Test skill_to_a2a standalone function."""
        skill = Skill(id="test", name="Test")
        a2a = skill_to_a2a(skill)
        assert isinstance(a2a, AgentSkill)
        assert a2a.id == "test"

    def test_a2a_to_skill_function(self):
        """Test a2a_to_skill standalone function."""
        a2a_skill = AgentSkill(id="test", name="Test", tags=[])
        skill = a2a_to_skill(a2a_skill)
        assert isinstance(skill, Skill)
        assert skill.id == "test"

    def test_artifact_to_a2a_function(self):
        """Test artifact_to_a2a standalone function."""
        artifact = Artifact(parts=[TextPart(text="Data")])
        a2a = artifact_to_a2a(artifact)
        assert isinstance(a2a, A2AArtifact)

    def test_a2a_to_artifact_function(self):
        """Test a2a_to_artifact standalone function."""
        a2a_artifact = A2AArtifact(parts=[TextPart(text="Data")])
        artifact = a2a_to_artifact(a2a_artifact)
        assert isinstance(artifact, Artifact)

    def test_task_to_a2a_function(self):
        """Test task_to_a2a standalone function."""
        task = Task(state=TaskState.WORKING)
        a2a = task_to_a2a(task)
        assert isinstance(a2a, A2ATask)
        assert a2a.status.state == A2ATaskState.WORKING

    def test_a2a_to_task_function(self):
        """Test a2a_to_task standalone function."""
        a2a_task = A2ATask(status=TaskStatus(state=A2ATaskState.COMPLETED))
        task = a2a_to_task(a2a_task)
        assert isinstance(task, Task)
        assert task.state == TaskState.COMPLETED

    def test_profile_to_a2a_card_function(self):
        """Test profile_to_a2a_card standalone function."""
        profile = AgentProfile(name="Agent")
        card = profile_to_a2a_card(profile)
        assert isinstance(card, AgentCard)
        assert card.name == "Agent"

    def test_a2a_card_to_profile_function(self):
        """Test a2a_card_to_profile standalone function."""
        card = AgentCard(name="External", url="http://test/")
        profile = a2a_card_to_profile(card, agent_id="ext_1")
        assert isinstance(profile, AgentProfile)
        assert profile.name == "External"
        assert profile.agent_id == "ext_1"
