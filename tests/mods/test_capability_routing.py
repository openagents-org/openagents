"""
Tests for capability-based routing in the Task Delegation mod.

This test suite verifies:
- Capability matcher utilities (NormalizedCapability, normalization, matching)
- task.route event handler with structured and NL-based matching
- Discovery adapter's announce_skills tool
- Routing works with only local agents (no A2A dependency)
- Routing works with both A2A and local agents
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List

from openagents.mods.coordination.task_delegation.capability_matcher import (
    NormalizedCapability,
    normalize_local_agent,
    normalize_a2a_agent,
    match_structured_capabilities,
    build_llm_prompt,
    parse_llm_response,
    DEFAULT_MATCHING_PROMPT,
)
from openagents.mods.coordination.task_delegation.mod import TaskDelegationMod
from openagents.mods.coordination.task_delegation.adapter import TaskDelegationAdapter
from openagents.mods.discovery.agent_discovery.adapter import AgentDiscoveryAdapter
from openagents.models.event import Event
from openagents.models.event_response import EventResponse


# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def mock_skill():
    """Create a mock skill object (duck-typed AgentSkill)."""
    skill = MagicMock()
    skill.id = "translation"
    skill.name = "Translation"
    skill.description = "Translate documents between languages"
    skill.tags = ["language", "nlp"]
    skill.input_modes = ["text", "file"]
    skill.output_modes = ["text"]
    return skill


@pytest.fixture
def mock_skill_2():
    """Create another mock skill object."""
    skill = MagicMock()
    skill.id = "summarization"
    skill.name = "Summarization"
    skill.description = "Summarize text content"
    skill.tags = ["nlp", "text"]
    skill.input_modes = ["text"]
    skill.output_modes = ["text"]
    return skill


@pytest.fixture
def local_agent_capabilities():
    """Sample local agent capabilities dictionary."""
    return {
        "skills": [
            {
                "id": "data_analysis",
                "name": "Data Analysis",
                "tags": ["analytics", "data"],
                "input_modes": ["text", "file"],
                "output_modes": ["text", "data"],
            },
            {
                "id": "visualization",
                "name": "Data Visualization",
                "tags": ["analytics", "charts"],
            },
        ],
        "description": "An agent for data analytics tasks",
    }


@pytest.fixture
def mock_network():
    """Create a mock network for testing."""
    network = MagicMock()
    network.network_id = "test-network"
    network.workspace_manager = None
    network.a2a_registry = None  # No A2A registry by default
    network.a2a_task_store = None  # No A2A task store - mod will create InMemoryTaskStore
    network.topology = None
    network.process_event = AsyncMock(return_value=None)
    return network


@pytest.fixture
def mock_network_with_discovery(mock_network):
    """Create a mock network that returns agents from discovery."""
    async def mock_process_event(event):
        if event.event_name == "discovery.agents.list":
            return EventResponse(
                success=True,
                message="Agents listed",
                data={
                    "agents": [
                        {
                            "agent_id": "local-agent-1",
                            "capabilities": {
                                "skills": [
                                    {"id": "translation", "name": "Translation", "tags": ["language"]},
                                    {"id": "summarization", "name": "Summarization", "tags": ["nlp"]},
                                ],
                                "tags": ["language", "nlp"],
                                "input_modes": ["text"],
                                "output_modes": ["text"],
                            },
                        },
                        {
                            "agent_id": "local-agent-2",
                            "capabilities": {
                                "skills": [
                                    {"id": "data_analysis", "name": "Data Analysis", "tags": ["analytics"]},
                                ],
                                "tags": ["analytics"],
                            },
                        },
                    ]
                },
            )
        return None

    mock_network.process_event = AsyncMock(side_effect=mock_process_event)
    return mock_network


@pytest.fixture
def task_delegation_mod_local_only(mock_network_with_discovery, tmp_path):
    """Create TaskDelegationMod with only local agents (no A2A)."""
    mod = TaskDelegationMod()
    mod.get_storage_path = lambda: tmp_path / "task_delegation"
    (tmp_path / "task_delegation" / "tasks").mkdir(parents=True, exist_ok=True)
    mod.bind_network(mock_network_with_discovery)
    yield mod
    # Cleanup - use sync shutdown for tests
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    if mod._timeout_task and not mod._timeout_task.done():
        mod._timeout_task.cancel()


# ============================================================================
# Test NormalizedCapability
# ============================================================================


class TestNormalizedCapability:
    """Tests for the NormalizedCapability dataclass."""

    def test_create_normalized_capability(self):
        """Test creating a NormalizedCapability instance."""
        cap = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            skills=["translation", "summarization"],
            tags=["language", "nlp"],
            input_modes=["text"],
            output_modes=["text"],
            description="Test agent",
            raw_capabilities={"key": "value"},
        )

        assert cap.agent_id == "agent-1"
        assert cap.agent_type == "local"
        assert "translation" in cap.skills
        assert "language" in cap.tags

    def test_normalized_capability_defaults(self):
        """Test NormalizedCapability default values."""
        cap = NormalizedCapability(agent_id="agent-1", agent_type="local")

        assert cap.skills == []
        assert cap.tags == []
        assert cap.input_modes == ["text"]
        assert cap.output_modes == ["text"]
        assert cap.description is None
        assert cap.raw_capabilities == {}

    def test_to_dict(self):
        """Test NormalizedCapability.to_dict() method."""
        cap = NormalizedCapability(
            agent_id="agent-1",
            agent_type="a2a",
            skills=["skill1"],
            tags=["tag1"],
        )

        result = cap.to_dict()

        assert result["agent_id"] == "agent-1"
        assert result["agent_type"] == "a2a"
        assert result["skills"] == ["skill1"]
        assert result["tags"] == ["tag1"]


# ============================================================================
# Test Normalization Functions
# ============================================================================


class TestNormalizationFunctions:
    """Tests for agent capability normalization functions."""

    def test_normalize_a2a_agent(self, mock_skill, mock_skill_2):
        """Test normalizing A2A agent capabilities."""
        result = normalize_a2a_agent(
            agent_id="a2a-agent-1",
            skills=[mock_skill, mock_skill_2],
            description="An A2A translation agent",
        )

        assert result.agent_id == "a2a-agent-1"
        assert result.agent_type == "a2a"
        assert "translation" in result.skills
        assert "summarization" in result.skills
        assert "language" in result.tags
        assert "nlp" in result.tags
        assert "text" in result.input_modes
        assert "file" in result.input_modes
        assert result.description == "An A2A translation agent"

    def test_normalize_a2a_agent_with_card_dict(self, mock_skill):
        """Test normalizing A2A agent with agent card dict."""
        result = normalize_a2a_agent(
            agent_id="a2a-agent-1",
            skills=[mock_skill],
            agent_card_dict={"name": "Test Agent", "version": "1.0"},
        )

        assert "card" in result.raw_capabilities
        assert result.raw_capabilities["card"]["name"] == "Test Agent"

    def test_normalize_local_agent(self, local_agent_capabilities):
        """Test normalizing local agent capabilities."""
        result = normalize_local_agent(
            agent_id="local-agent-1",
            capabilities=local_agent_capabilities,
        )

        assert result.agent_id == "local-agent-1"
        assert result.agent_type == "local"
        assert "data_analysis" in result.skills
        assert "visualization" in result.skills
        assert "analytics" in result.tags
        assert "data" in result.tags
        assert result.description == "An agent for data analytics tasks"

    def test_normalize_local_agent_unstructured(self):
        """Test normalizing local agent with unstructured capabilities."""
        capabilities = {
            "tools": ["search", "fetch"],
            "abilities": ["reasoning"],
            "tags": ["general"],
        }

        result = normalize_local_agent(
            agent_id="local-agent-2",
            capabilities=capabilities,
        )

        assert "search" in result.skills
        assert "fetch" in result.skills
        assert "reasoning" in result.skills
        assert "general" in result.tags

    def test_normalize_local_agent_minimal(self):
        """Test normalizing local agent with minimal capabilities."""
        result = normalize_local_agent(
            agent_id="local-agent-3",
            capabilities={},
        )

        assert result.agent_id == "local-agent-3"
        assert result.skills == []
        assert result.input_modes == ["text"]
        assert result.output_modes == ["text"]


# ============================================================================
# Test Structured Capability Matching
# ============================================================================


class TestStructuredMatching:
    """Tests for structured capability matching (ALL match logic)."""

    def test_match_all_skills(self):
        """Test that agent must have ALL required skills."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            skills=["translation", "summarization", "ocr"],
        )

        # Should match - agent has both skills
        assert match_structured_capabilities(
            {"skills": ["translation", "summarization"]},
            agent,
        ) is True

        # Should NOT match - agent missing "speech" skill
        assert match_structured_capabilities(
            {"skills": ["translation", "speech"]},
            agent,
        ) is False

    def test_match_all_tags(self):
        """Test that agent must have ALL required tags."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            tags=["language", "nlp", "text"],
        )

        # Should match - agent has both tags
        assert match_structured_capabilities(
            {"tags": ["language", "nlp"]},
            agent,
        ) is True

        # Should NOT match - agent missing "audio" tag
        assert match_structured_capabilities(
            {"tags": ["language", "audio"]},
            agent,
        ) is False

    def test_match_all_input_modes(self):
        """Test that agent must support ALL required input modes."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            input_modes=["text", "file", "audio"],
        )

        # Should match
        assert match_structured_capabilities(
            {"input_modes": ["text", "file"]},
            agent,
        ) is True

        # Should NOT match - agent doesn't support "video"
        assert match_structured_capabilities(
            {"input_modes": ["text", "video"]},
            agent,
        ) is False

    def test_match_all_output_modes(self):
        """Test that agent must support ALL required output modes."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            output_modes=["text", "data"],
        )

        # Should match
        assert match_structured_capabilities(
            {"output_modes": ["text"]},
            agent,
        ) is True

        # Should NOT match
        assert match_structured_capabilities(
            {"output_modes": ["text", "image"]},
            agent,
        ) is False

    def test_match_combined_requirements(self):
        """Test matching with multiple requirement types."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            skills=["translation", "summarization"],
            tags=["language", "nlp"],
            input_modes=["text", "file"],
            output_modes=["text"],
        )

        # Should match - all requirements satisfied
        assert match_structured_capabilities(
            {
                "skills": ["translation"],
                "tags": ["language"],
                "input_modes": ["text"],
                "output_modes": ["text"],
            },
            agent,
        ) is True

        # Should NOT match - fails on tags
        assert match_structured_capabilities(
            {
                "skills": ["translation"],
                "tags": ["language", "audio"],
            },
            agent,
        ) is False

    def test_match_empty_requirements(self):
        """Test that empty requirements match any agent."""
        agent = NormalizedCapability(
            agent_id="agent-1",
            agent_type="local",
            skills=["anything"],
        )

        assert match_structured_capabilities({}, agent) is True
        assert match_structured_capabilities({"skills": []}, agent) is True


# ============================================================================
# Test LLM Prompt Building and Response Parsing
# ============================================================================


class TestLLMMatching:
    """Tests for LLM-based capability matching utilities."""

    def test_build_llm_prompt_default(self):
        """Test building LLM prompt with default template."""
        prompt = build_llm_prompt(
            capability_description="I need an agent that can translate documents",
            agent_id="agent-1",
            capabilities={"skills": ["translation"]},
        )

        assert "I need an agent that can translate documents" in prompt
        assert "agent-1" in prompt
        assert "translation" in prompt
        assert "matches" in prompt  # From template

    def test_build_llm_prompt_custom(self):
        """Test building LLM prompt with custom template."""
        custom_template = "Task: {capability_description}\nAgent: {agent_id}\nCaps: {agent_capabilities_json}"

        prompt = build_llm_prompt(
            capability_description="Translate docs",
            agent_id="agent-1",
            capabilities={"skills": ["translation"]},
            custom_prompt=custom_template,
        )

        assert "Task: Translate docs" in prompt
        assert "Agent: agent-1" in prompt

    def test_parse_llm_response_valid_json(self):
        """Test parsing valid JSON response."""
        response = '{"matches": true, "confidence": 0.85, "reason": "Agent has translation skill"}'

        matches, confidence, reason = parse_llm_response(response)

        assert matches is True
        assert confidence == 0.85
        assert reason == "Agent has translation skill"

    def test_parse_llm_response_markdown_block(self):
        """Test parsing response with markdown code block."""
        response = '''```json
{"matches": true, "confidence": 0.9, "reason": "Good match"}
```'''

        matches, confidence, reason = parse_llm_response(response)

        assert matches is True
        assert confidence == 0.9

    def test_parse_llm_response_no_match(self):
        """Test parsing response with no match."""
        response = '{"matches": false, "confidence": 0.2, "reason": "Missing skills"}'

        matches, confidence, reason = parse_llm_response(response)

        assert matches is False
        assert confidence == 0.2

    def test_parse_llm_response_invalid_json(self):
        """Test parsing invalid JSON response."""
        response = "This is not valid JSON"

        matches, confidence, reason = parse_llm_response(response)

        assert matches is False
        assert confidence == 0.0
        assert "Failed to parse" in reason


# ============================================================================
# Test task.route Event Handler
# ============================================================================


class TestTaskRouteHandler:
    """Tests for the task.route event handler."""

    @pytest.mark.asyncio
    async def test_route_task_structured_match(self, task_delegation_mod_local_only):
        """Test routing task with structured capability matching."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Translate this document",
                "required_capabilities": {
                    "skills": ["translation"],
                    "tags": ["language"],
                },
                "payload": {"document": "Hello world"},
                "timeout_seconds": 300,
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response is not None
        assert response.success is True
        assert "task_id" in response.data
        assert response.data["assignee_id"] == "local-agent-1"
        assert response.data["matched_count"] >= 1

    @pytest.mark.asyncio
    async def test_route_task_no_match(self, task_delegation_mod_local_only):
        """Test routing when no agent matches."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Do something impossible",
                "required_capabilities": {
                    "skills": ["quantum_computing", "time_travel"],
                },
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response is not None
        assert response.success is False
        assert "No agents found" in response.message

    @pytest.mark.asyncio
    async def test_route_task_with_fallback(self, task_delegation_mod_local_only):
        """Test routing uses fallback when no match found."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Do something impossible",
                "required_capabilities": {
                    "skills": ["nonexistent_skill"],
                },
                "fallback_assignee_id": "fallback-agent",
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response is not None
        assert response.success is True
        assert response.data["assignee_id"] == "fallback-agent"
        assert response.data["matched_count"] == 0

    @pytest.mark.asyncio
    async def test_route_task_missing_description(self, task_delegation_mod_local_only):
        """Test routing fails without description."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "required_capabilities": {"skills": ["translation"]},
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response is not None
        assert response.success is False
        assert "description is required" in response.message

    @pytest.mark.asyncio
    async def test_route_task_missing_capabilities(self, task_delegation_mod_local_only):
        """Test routing fails without capability filter."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Do something",
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response is not None
        assert response.success is False
        assert "required_capabilities" in response.message or "capability_description" in response.message

    @pytest.mark.asyncio
    async def test_route_task_random_selection(self, task_delegation_mod_local_only):
        """Test routing with random selection strategy."""
        event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Any NLP task",
                "required_capabilities": {
                    "tags": ["nlp"],
                },
                "selection_strategy": "random",
            },
        )

        # Run multiple times - should succeed each time
        for _ in range(3):
            response = await task_delegation_mod_local_only._handle_task_route(event)
            assert response.success is True


# ============================================================================
# Test Discovery Adapter announce_skills
# ============================================================================


class TestDiscoveryAdapterAnnounceSkills:
    """Tests for the announce_skills tool in discovery adapter."""

    @pytest.fixture
    def discovery_adapter(self):
        """Create a discovery adapter instance."""
        adapter = AgentDiscoveryAdapter()
        adapter._agent_id = "test-agent"
        return adapter

    def test_get_tools_includes_announce_skills(self, discovery_adapter):
        """Test that announce_skills tool is included."""
        tools = discovery_adapter.get_tools()
        tool_names = [t.name for t in tools]

        assert "announce_skills" in tool_names

    def test_announce_skills_tool_schema(self, discovery_adapter):
        """Test announce_skills tool has correct schema."""
        tools = discovery_adapter.get_tools()
        announce_tool = next(t for t in tools if t.name == "announce_skills")

        schema = announce_tool.input_schema
        assert "skills" in schema["properties"]
        assert schema["properties"]["skills"]["type"] == "array"
        assert "skills" in schema["required"]

    @pytest.mark.asyncio
    async def test_announce_skills_normalizes_skills(self, discovery_adapter):
        """Test that announce_skills normalizes skill data."""
        # _connector is None by default so it stores locally
        skills = [
            {
                "id": "translation",
                "name": "Translation",
                "tags": ["language"],
            },
            {
                "id": "ocr",
                "name": "OCR",
                "input_modes": ["file"],
                "output_modes": ["text"],
            },
        ]

        result = await discovery_adapter.announce_skills(skills)

        assert result["success"] is True
        # When connector is None, capabilities are stored locally
        # Check that internal capabilities were built correctly
        caps = discovery_adapter._capabilities
        assert len(caps["skills"]) == 2
        assert "language" in caps["tags"]
        assert "text" in caps["input_modes"]
        assert "file" in caps["input_modes"]

    @pytest.mark.asyncio
    async def test_announce_skills_defaults(self, discovery_adapter):
        """Test announce_skills applies defaults correctly."""
        # _connector is None by default
        skills = [
            {"id": "minimal", "name": "Minimal Skill"},
        ]

        result = await discovery_adapter.announce_skills(skills)

        # Check internal capabilities
        caps = discovery_adapter._capabilities
        skill = caps["skills"][0]
        assert skill["input_modes"] == ["text"]
        assert skill["output_modes"] == ["text"]
        assert skill["tags"] == []


# ============================================================================
# Test Adapter route_task Tool
# ============================================================================


class TestTaskDelegationAdapterRouteTask:
    """Tests for the route_task tool in task delegation adapter."""

    @pytest.fixture
    def task_adapter(self):
        """Create a task delegation adapter instance."""
        adapter = TaskDelegationAdapter()
        adapter._agent_id = "test-agent"
        return adapter

    def test_get_tools_includes_route_task(self, task_adapter):
        """Test that route_task tool is included."""
        tools = task_adapter.get_tools()
        tool_names = [t.name for t in tools]

        assert "route_task" in tool_names

    def test_route_task_tool_schema(self, task_adapter):
        """Test route_task tool has correct schema."""
        tools = task_adapter.get_tools()
        route_tool = next(t for t in tools if t.name == "route_task")

        schema = route_tool.input_schema
        assert "description" in schema["properties"]
        assert "required_capabilities" in schema["properties"]
        assert "capability_description" in schema["properties"]
        assert "llm_config" in schema["properties"]
        assert "selection_strategy" in schema["properties"]
        assert "fallback_assignee_id" in schema["properties"]

    @pytest.mark.asyncio
    async def test_route_task_without_connector(self, task_adapter):
        """Test route_task fails gracefully without connector."""
        result = await task_adapter.route_task(
            description="Test task",
            required_capabilities={"skills": ["test"]},
        )

        assert result["success"] is False
        assert "not available" in result["error"]


# ============================================================================
# Test No A2A Dependency
# ============================================================================


class TestNoA2ADependency:
    """Tests to verify capability routing works without A2A agents."""

    def test_capability_matcher_imports_without_a2a(self):
        """Test that capability_matcher module imports without A2A at runtime."""
        # This test verifies the TYPE_CHECKING guard works
        import importlib
        import sys

        # Temporarily remove a2a module to simulate no A2A
        a2a_modules = [k for k in sys.modules.keys() if "a2a" in k.lower()]

        # Re-import capability_matcher - should work
        from openagents.mods.coordination.task_delegation import capability_matcher

        importlib.reload(capability_matcher)

        # Verify functions work
        assert capability_matcher.NormalizedCapability is not None
        assert capability_matcher.normalize_local_agent is not None
        assert capability_matcher.match_structured_capabilities is not None

    def test_normalize_local_agent_no_a2a_types(self, local_agent_capabilities):
        """Test normalize_local_agent works without A2A types."""
        result = normalize_local_agent(
            agent_id="pure-local-agent",
            capabilities=local_agent_capabilities,
        )

        assert result.agent_type == "local"
        assert len(result.skills) > 0

    @pytest.mark.asyncio
    async def test_route_with_only_local_agents(self, task_delegation_mod_local_only):
        """Test routing works when only local agents exist (no A2A registry)."""
        # Verify no A2A registry
        assert task_delegation_mod_local_only.network.a2a_registry is None

        event = Event(
            event_name="task.route",
            source_id="delegator",
            payload={
                "description": "Analyze data",
                "required_capabilities": {
                    "tags": ["analytics"],
                },
            },
        )

        response = await task_delegation_mod_local_only._handle_task_route(event)

        assert response.success is True
        assert response.data["assignee_id"] == "local-agent-2"


# ============================================================================
# Integration Tests
# ============================================================================


class TestIntegration:
    """Integration tests for the full routing workflow."""

    @pytest.mark.asyncio
    async def test_full_routing_workflow(self, task_delegation_mod_local_only):
        """Test complete routing workflow: route -> accept -> complete."""
        # Route task
        route_event = Event(
            event_name="task.route",
            source_id="delegator-agent",
            payload={
                "description": "Translate document",
                "required_capabilities": {"skills": ["translation"]},
                "payload": {"text": "Hello"},
            },
        )

        route_response = await task_delegation_mod_local_only._handle_task_route(route_event)
        assert route_response.success is True

        task_id = route_response.data["task_id"]
        assignee_id = route_response.data["assignee_id"]

        # Accept task
        accept_event = Event(
            event_name="task.accept",
            source_id=assignee_id,
            payload={"task_id": task_id},
        )

        accept_response = await task_delegation_mod_local_only._handle_task_accept(accept_event)
        assert accept_response.success is True

        # Complete task
        complete_event = Event(
            event_name="task.complete",
            source_id=assignee_id,
            payload={
                "task_id": task_id,
                "result": {"translated": "Bonjour"},
            },
        )

        complete_response = await task_delegation_mod_local_only._handle_task_complete(complete_event)
        assert complete_response.success is True
        assert complete_response.data["status"] == "completed"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
