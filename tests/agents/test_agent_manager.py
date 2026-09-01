"""
Tests for AgentManager auto-start functionality.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from openagents.sdk.agent_manager import AgentManager


@pytest.fixture
def tmp_workspace(tmp_path):
    """Create a temporary workspace directory."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "agents").mkdir()
    (workspace / "logs").mkdir()
    (workspace / "config").mkdir()
    return workspace


@pytest.mark.asyncio
async def test_auto_start_enabled(tmp_workspace):
    """Test that agents are auto-started when auto_start_agents=True."""
    manager = AgentManager(tmp_workspace, auto_start_agents=True)
    
    # Mock the methods
    manager.get_all_agents_status = MagicMock(return_value=[
        {"agent_id": "agent1", "status": "stopped"},
        {"agent_id": "agent2", "status": "stopped"},
    ])
    manager.start_agent = AsyncMock(return_value={"success": True})
    
    # Start the manager
    await manager.start()
    
    # Verify start_agent was called for each agent
    assert manager.start_agent.call_count == 2
    manager.start_agent.assert_any_call("agent1")
    manager.start_agent.assert_any_call("agent2")


@pytest.mark.asyncio
async def test_auto_start_disabled(tmp_workspace):
    """Test that agents are not auto-started when auto_start_agents=False."""
    manager = AgentManager(tmp_workspace, auto_start_agents=False)
    
    # Mock the methods
    manager.get_all_agents_status = MagicMock(return_value=[
        {"agent_id": "agent1", "status": "stopped"},
    ])
    manager.start_agent = AsyncMock(return_value={"success": True})
    
    # Start the manager
    await manager.start()
    
    # Verify start_agent was never called
    manager.start_agent.assert_not_called()


@pytest.mark.asyncio
async def test_auto_start_filters_running_agents(tmp_workspace):
    """Test that running agents are not restarted."""
    manager = AgentManager(tmp_workspace, auto_start_agents=True)
    
    # Mock agents with mixed status
    manager.get_all_agents_status = MagicMock(return_value=[
        {"agent_id": "agent1", "status": "running"},
        {"agent_id": "agent2", "status": "stopped"},
        {"agent_id": "agent3", "status": "running"},
    ])
    manager.start_agent = AsyncMock(return_value={"success": True})
    
    # Start the manager
    await manager.start()
    
    # Only agent2 should be started
    assert manager.start_agent.call_count == 1
    manager.start_agent.assert_called_with("agent2")


@pytest.mark.asyncio
async def test_auto_start_with_empty_agents(tmp_workspace):
    """Test auto-start handles empty agent list gracefully."""
    manager = AgentManager(tmp_workspace, auto_start_agents=True)
    
    # Mock empty agent list
    manager.get_all_agents_status = MagicMock(return_value=[])
    manager.start_agent = AsyncMock(return_value={"success": True})
    
    # Start the manager - should not raise any errors
    await manager.start()
    
    # No agents to start
    manager.start_agent.assert_not_called()


@pytest.mark.asyncio
async def test_auto_start_continues_on_failure(tmp_workspace):
    """Test that auto-start continues even if one agent fails."""
    manager = AgentManager(tmp_workspace, auto_start_agents=True)
    
    # Mock agents
    manager.get_all_agents_status = MagicMock(return_value=[
        {"agent_id": "agent1", "status": "stopped"},
        {"agent_id": "agent2", "status": "stopped"},
        {"agent_id": "agent3", "status": "stopped"},
    ])
    
    # Make agent2 fail
    async def mock_start_agent(agent_id):
        if agent_id == "agent2":
            return {"success": False, "message": "Start failed"}
        return {"success": True}
    
    manager.start_agent = AsyncMock(side_effect=mock_start_agent)
    
    # Start the manager
    await manager.start()
    
    # All agents should be attempted
    assert manager.start_agent.call_count == 3
