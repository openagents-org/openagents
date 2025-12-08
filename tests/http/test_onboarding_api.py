"""
Test onboarding API endpoints.

This test verifies that the onboarding API endpoints work correctly:
1. /api/network/summary returns network configuration
2. /api/agents/connected returns connected agents list
"""

import pytest
import asyncio
import random
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config


@pytest.fixture
async def test_network():
    """Create and start a network for testing onboarding APIs."""
    config_path = (
        Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    )

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Retry network initialization with different ports if there's a conflict
    network = None
    max_retries = 5
    for attempt in range(max_retries):
        grpc_port = random.randint(47000, 48000)
        http_port = grpc_port + 100

        for transport in config.network.transports:
            if transport.type == "grpc":
                transport.config["port"] = grpc_port
            elif transport.type == "http":
                transport.config["port"] = http_port

        # Create and initialize network
        network = create_network(config.network)
        success = await network.initialize()

        if success:
            print(
                f"✅ Network initialized successfully on attempt {attempt + 1} (ports: gRPC={grpc_port}, HTTP={http_port})"
            )
            break
        else:
            print(
                f"❌ Network initialization failed on attempt {attempt + 1}, retrying..."
            )
            try:
                await network.shutdown()
            except:
                pass
            if attempt == max_retries - 1:
                raise RuntimeError(
                    f"Failed to initialize network after {max_retries} attempts"
                )

    # Give network time to start up
    await asyncio.sleep(1.0)

    # Extract HTTP port for API calls
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
    await asyncio.sleep(0.5)


@pytest.mark.asyncio
@pytest.mark.integration
async def test_network_summary_api(test_network):
    """Test that /api/network/summary returns valid network configuration."""
    network, http_port = test_network

    # Make HTTP request to the API
    import aiohttp

    async with aiohttp.ClientSession() as session:
        url = f"http://localhost:{http_port}/api/network/summary"
        async with session.get(url) as response:
            assert response.status == 200
            data = await response.json()

            # Verify response structure
            assert data["success"] is True
            assert "data" in data

            summary = data["data"]
            assert "name" in summary
            assert "transports" in summary
            assert "mods" in summary
            assert "studio_enabled" in summary

            # Verify transports
            assert isinstance(summary["transports"], dict)
            if "http" in summary["transports"]:
                assert summary["transports"]["http"]["enabled"] is True
                assert summary["transports"]["http"]["port"] == http_port


@pytest.mark.asyncio
@pytest.mark.integration
async def test_connected_agents_api(test_network):
    """Test that /api/agents/connected returns list of connected agents."""
    network, http_port = test_network

    # Initially, no agents should be connected
    import aiohttp

    async with aiohttp.ClientSession() as session:
        url = f"http://localhost:{http_port}/api/agents/connected"
        async with session.get(url) as response:
            assert response.status == 200
            data = await response.json()

            # Verify response structure
            assert data["success"] is True
            assert "data" in data
            assert "agents" in data["data"]
            assert "count" in data["data"]
            assert isinstance(data["data"]["agents"], list)

    # Now connect an agent
    client = AgentClient(agent_id="test_onboarding_agent")

    try:
        await client.connect(
            network_host="localhost",
            network_port=http_port,
            enforce_transport_type="http",
        )
        await asyncio.sleep(1.0)

        # Check agents list again
        async with aiohttp.ClientSession() as session:
            url = f"http://localhost:{http_port}/api/agents/connected"
            async with session.get(url) as response:
                assert response.status == 200
                data = await response.json()

                # Verify agent is now in the list
                assert data["success"] is True
                assert data["data"]["count"] >= 1
                
                # Find our test agent
                agent_ids = [agent["agent_id"] for agent in data["data"]["agents"]]
                assert "test_onboarding_agent" in agent_ids

    finally:
        # Clean up
        try:
            await client.disconnect()
        except:
            pass
        await asyncio.sleep(0.5)
