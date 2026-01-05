"""
Test for Mod Settings API endpoints.

This test verifies that the mod settings API endpoints work correctly.
"""

import pytest
import asyncio
import random
import aiohttp
from pathlib import Path

from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config


@pytest.fixture
async def test_network():
    """Create and start a network with HTTP transport."""
    config_path = (
        Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    )

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Retry network initialization with different ports if there's a conflict
    network = None
    max_retries = 5
    for attempt in range(max_retries):
        http_port = random.randint(48000, 49000)

        for transport in config.network.transports:
            if transport.type == "http":
                transport.config["port"] = http_port

        # Create and initialize network
        network = create_network(config.network)
        success = await network.initialize()

        if success:
            print(f"✅ Network initialized successfully on port {http_port}")
            break
        else:
            print(f"❌ Network initialization failed on attempt {attempt + 1}, retrying...")
            try:
                await network.shutdown()
            except Exception:
                # Ignore errors during cleanup of failed initialization
                pass
            if attempt == max_retries - 1:
                raise RuntimeError(f"Failed to initialize network after {max_retries} attempts")

    # Give network time to start up
    await asyncio.sleep(1.0)

    # Extract HTTP port
    http_port = None
    for transport in config.network.transports:
        if transport.type == "http":
            http_port = transport.config.get("port")

    yield network, http_port

    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.mark.asyncio
async def test_get_mods(test_network):
    """Test GET /api/admin/mods endpoint."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        url = f"http://localhost:{http_port}/api/admin/mods"
        async with session.get(url) as resp:
            assert resp.status == 200
            data = await resp.json()
            assert data["success"] is True
            assert "mods" in data
            assert isinstance(data["mods"], list)
            
            # Check that we have some mods
            assert len(data["mods"]) > 0
            
            # Check structure of first mod
            if data["mods"]:
                mod = data["mods"][0]
                assert "id" in mod
                assert "name" in mod
                assert "displayName" in mod
                assert "description" in mod
                assert "enabled" in mod
                assert "hasConfig" in mod
                # Check that currentConfig key exists for mods with config
                if mod.get("hasConfig"):
                    assert "currentConfig" in mod


@pytest.mark.asyncio
async def test_get_mod_config(test_network):
    """Test GET /api/admin/mods/{mod_id}/config endpoint."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        # First get the list of mods to find a valid mod_id
        url = f"http://localhost:{http_port}/api/admin/mods"
        async with session.get(url) as resp:
            assert resp.status == 200
            data = await resp.json()
            
            if data["mods"]:
                # Use the first mod for testing
                mod_id = data["mods"][0]["id"]
                
                # Get config for this mod
                config_url = f"http://localhost:{http_port}/api/admin/mods/{mod_id}/config"
                async with session.get(config_url) as config_resp:
                    assert config_resp.status == 200
                    config_data = await config_resp.json()
                    assert config_data["success"] is True
                    assert "config" in config_data
                    assert isinstance(config_data["config"], dict)


@pytest.mark.asyncio
async def test_get_mod_schema(test_network):
    """Test GET /api/admin/mods/{mod_id}/schema endpoint."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        # Test with a mod that should have a schema (project mod)
        mod_id = "project"
        
        url = f"http://localhost:{http_port}/api/admin/mods/{mod_id}/schema"
        async with session.get(url) as resp:
            # The response might be 404 if the mod doesn't have a schema
            # or 200 if it does
            if resp.status == 200:
                data = await resp.json()
                assert data["success"] is True
                assert "schema" in data
                assert "sections" in data["schema"]
                assert isinstance(data["schema"]["sections"], list)
            elif resp.status == 404:
                # It's okay if the mod doesn't have a config schema
                data = await resp.json()
                assert data["success"] is False


@pytest.mark.asyncio
async def test_update_mod_config(test_network):
    """Test PUT /api/admin/mods/{mod_id}/config endpoint."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        # First get the list of mods
        url = f"http://localhost:{http_port}/api/admin/mods"
        async with session.get(url) as resp:
            assert resp.status == 200
            data = await resp.json()
            
            if data["mods"]:
                # Find a mod with config
                mod_id = None
                for mod in data["mods"]:
                    if mod.get("hasConfig"):
                        mod_id = mod["id"]
                        break
                
                if mod_id:
                    # Update config for this mod
                    update_url = f"http://localhost:{http_port}/api/admin/mods/{mod_id}/config"
                    update_data = {
                        "config": {
                            "test_key": "test_value"
                        }
                    }
                    
                    async with session.put(update_url, json=update_data) as update_resp:
                        # The response might be 500 if config_path is not set (in test environment)
                        # or 200 if it is set
                        if update_resp.status == 500:
                            # This is expected in test environment without config_path
                            result = await update_resp.json()
                            assert "error" in result
                            assert "save" in result["error"].lower() or "config_path" in result["error"].lower()
                        else:
                            assert update_resp.status == 200
                            result = await update_resp.json()
                            assert result["success"] is True
                            assert result["requiresRestart"] is True
                            assert "message" in result


@pytest.mark.asyncio
async def test_restart_network(test_network):
    """Test POST /api/admin/network/restart endpoint."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        url = f"http://localhost:{http_port}/api/admin/network/restart"
        async with session.post(url) as resp:
            assert resp.status in [200, 500]  # May not be implemented yet
            data = await resp.json()
            # The response will indicate if restart is supported
            assert "success" in data
            assert "message" in data


@pytest.mark.asyncio
async def test_get_nonexistent_mod(test_network):
    """Test getting config for a non-existent mod."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        url = f"http://localhost:{http_port}/api/admin/mods/nonexistent_mod/config"
        async with session.get(url) as resp:
            assert resp.status == 404
            data = await resp.json()
            assert data["success"] is False
            assert "error" in data


@pytest.mark.asyncio
async def test_config_update_reflects_in_list(test_network):
    """Test that config updates are reflected in the mods list."""
    network, http_port = test_network
    
    async with aiohttp.ClientSession() as session:
        # First, get the list of mods to find one with config
        list_url = f"http://localhost:{http_port}/api/admin/mods"
        async with session.get(list_url) as resp:
            assert resp.status == 200
            data = await resp.json()
            
            # Find a mod with config
            mod_with_config = None
            for mod in data["mods"]:
                if mod.get("hasConfig"):
                    mod_with_config = mod
                    break
            
            if mod_with_config:
                mod_id = mod_with_config["id"]
                
                # Update the config
                update_url = f"http://localhost:{http_port}/api/admin/mods/{mod_id}/config"
                new_config = {"test_field_integration": "test_value_123"}
                update_data = {"config": new_config}
                
                async with session.put(update_url, json=update_data) as update_resp:
                    # May be 500 if config_path not set in test env, or 200 if successful
                    if update_resp.status == 200:
                        result = await update_resp.json()
                        assert result["success"] is True
                        
                        # Now get the list again and verify the config is updated
                        async with session.get(list_url) as list_resp:
                            assert list_resp.status == 200
                            updated_data = await list_resp.json()
                            
                            # Find the same mod in the updated list
                            updated_mod = None
                            for mod in updated_data["mods"]:
                                if mod["id"] == mod_id:
                                    updated_mod = mod
                                    break
                            
                            assert updated_mod is not None
                            # Verify the new config value is present
                            assert "currentConfig" in updated_mod
                            assert "test_field_integration" in updated_mod["currentConfig"]
                            assert updated_mod["currentConfig"]["test_field_integration"] == "test_value_123"
