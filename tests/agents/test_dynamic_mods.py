"""
Tests for dynamic mod loading and unloading.
"""

import pytest
import asyncio
from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig
from openagents.models.event import Event


@pytest.fixture
async def test_network():
    """Create a test network."""
    config = NetworkConfig(
        name="test_network",
        mode="centralized",
        host="127.0.0.1",
        port=9999,
    )
    network = AgentNetwork.create_from_config(config, workspace_path=None)
    await network.initialize()
    yield network
    await network.shutdown()


@pytest.mark.asyncio
async def test_load_mod_success(test_network):
    """Test successful mod loading."""
    mod_path = "openagents.mods.workspace.project"
    
    response = await test_network.load_mod(mod_path)
    
    assert response.success is True
    assert "project" in test_network._dynamic_mod_ids
    assert "openagents.mods.workspace.project" in test_network.mods


@pytest.mark.asyncio
async def test_load_mod_duplicate(test_network):
    """Test that loading the same mod twice fails."""
    mod_path = "openagents.mods.workspace.project"
    
    # First load should succeed
    response1 = await test_network.load_mod(mod_path)
    assert response1.success is True
    
    # Second load should fail
    response2 = await test_network.load_mod(mod_path)
    assert response2.success is False
    assert "already loaded" in response2.message.lower()


@pytest.mark.asyncio
async def test_unload_mod_success(test_network):
    """Test successful mod unloading."""
    mod_path = "openagents.mods.workspace.project"
    
    # Load the mod first
    load_response = await test_network.load_mod(mod_path)
    assert load_response.success is True
    
    # Unload the mod
    unload_response = await test_network.unload_mod(mod_path)
    assert unload_response.success is True
    assert "project" not in test_network._dynamic_mod_ids


@pytest.mark.asyncio
async def test_unload_nonexistent_mod(test_network):
    """Test that unloading a non-existent mod fails."""
    mod_path = "openagents.mods.workspace.nonexistent"
    
    response = await test_network.unload_mod(mod_path)
    assert response.success is False
    assert "not loaded" in response.message.lower()


@pytest.mark.asyncio
async def test_load_unload_cycle(test_network):
    """Test loading and unloading a mod multiple times."""
    mod_path = "openagents.mods.workspace.project"
    
    for i in range(10):
        # Load
        load_response = await test_network.load_mod(mod_path)
        assert load_response.success is True, f"Load failed on iteration {i}"
        assert "project" in test_network._dynamic_mod_ids

        # Unload
        unload_response = await test_network.unload_mod(mod_path)
        assert unload_response.success is True, f"Unload failed on iteration {i}"
        assert "project" not in test_network._dynamic_mod_ids


@pytest.mark.asyncio
async def test_system_mod_load_event(test_network):
    """Test system.mod.load event."""
    event = Event(
        event_name="system.mod.load",
        source_id="system:system",
        payload={
            "mod_path": "openagents.mods.workspace.project"
        }
    )
    
    response = await test_network._handle_system_mod_load(event)

    assert response.success is True
    assert "project" in test_network._dynamic_mod_ids


@pytest.mark.asyncio
async def test_system_mod_unload_event(test_network):
    """Test system.mod.unload event."""
    # Load first
    await test_network.load_mod("openagents.mods.workspace.project")
    
    event = Event(
        event_name="system.mod.unload",
        source_id="system:system",
        payload={
            "mod_path": "openagents.mods.workspace.project"
        }
    )
    
    response = await test_network._handle_system_mod_unload(event)

    assert response.success is True
    assert "project" not in test_network._dynamic_mod_ids


@pytest.mark.asyncio
async def test_get_loaded_mods(test_network):
    """Test getting information about loaded mods."""
    mod_path = "openagents.mods.workspace.project"
    
    # Initially empty
    loaded_mods = test_network.get_loaded_mods()
    assert len(loaded_mods) == 0
    
    # Load a mod
    await test_network.load_mod(mod_path)
    
    # Check loaded mods
    loaded_mods = test_network.get_loaded_mods()
    assert len(loaded_mods) == 1
    assert "project" in loaded_mods
    assert loaded_mods["project"]["mod_id"] == "project"
    assert loaded_mods["project"]["mod_path"] == mod_path
    assert "loaded_at" in loaded_mods["project"]


@pytest.mark.asyncio
async def test_health_api_includes_dynamic_mods(test_network):
    """Test that health API includes dynamic mods information."""
    # Load a mod
    await test_network.load_mod("openagents.mods.workspace.project")
    
    # Get network stats (used by health API)
    stats = test_network.get_network_stats()
    
    assert "dynamic_mods" in stats
    assert "loaded" in stats["dynamic_mods"]
    assert "count" in stats["dynamic_mods"]
    assert "details" in stats["dynamic_mods"]
    assert stats["dynamic_mods"]["count"] == 1
    assert "project" in stats["dynamic_mods"]["loaded"]


@pytest.mark.asyncio
async def test_mod_with_config(test_network):
    """Test loading a mod with configuration."""
    mod_path = "openagents.mods.workspace.project"
    config = {"test_key": "test_value"}
    
    response = await test_network.load_mod(mod_path, config=config)

    assert response.success is True
    assert "project" in test_network._dynamic_mod_ids
    mod_instance = test_network.mods.get(mod_path)
    assert mod_instance is not None

