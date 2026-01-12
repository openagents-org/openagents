"""
Configuration and fixtures for integration tests.

Provides shared fixtures for:
- Network setup with dynamic port allocation
- Agent creation and lifecycle management
- Client connections for message sending
"""

import pytest
import asyncio
import os
from pathlib import Path
from typing import Tuple

# Load .env file from project root if it exists
try:
    from dotenv import load_dotenv
    env_file = Path(__file__).parent.parent.parent / ".env"
    if env_file.exists():
        load_dotenv(env_file)
        print(f"Loaded environment from {env_file}")
except ImportError:
    pass  # python-dotenv not installed

from openagents.core.network import create_network
from openagents.core.client import AgentClient
from openagents.launchers.network_launcher import load_network_config
from openagents.utils.port_allocator import get_port_pair, release_port, wait_for_port_free


def check_llm_api_key():
    """Check if an LLM API key is available for tests."""
    # Check for OpenAI key
    if os.getenv("OPENAI_API_KEY"):
        return True
    # Check for auto model configuration
    if os.getenv("DEFAULT_LLM_API_KEY"):
        return True
    return False


def skip_without_api_key(reason: str = "Requires LLM API key (OPENAI_API_KEY or DEFAULT_LLM_API_KEY)"):
    """Skip decorator for tests requiring LLM API key."""
    return pytest.mark.skipif(not check_llm_api_key(), reason=reason)


@pytest.fixture
def hello_world_network_config_path() -> Path:
    """Get path to the Hello World demo network configuration."""
    return Path(__file__).parent.parent.parent / "demos" / "00_hello_world" / "network.yaml"


@pytest.fixture
def hello_world_agent_config_path() -> Path:
    """Get path to the Hello World demo Charlie agent configuration."""
    return Path(__file__).parent.parent.parent / "demos" / "00_hello_world" / "agents" / "charlie.yaml"


@pytest.fixture
async def hello_world_network(hello_world_network_config_path) -> Tuple:
    """Create and start the Hello World network with dynamic ports.

    Yields:
        Tuple of (network, config, grpc_port, http_port)
    """
    # Load config and use dynamic port allocation to avoid conflicts
    config = load_network_config(str(hello_world_network_config_path))

    # Get two guaranteed free ports for gRPC and HTTP transports
    grpc_port, http_port = get_port_pair()
    print(f"Hello World network using ports: gRPC={grpc_port}, HTTP={http_port}")

    # Update transport ports in config
    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port

    # Create and initialize network
    network = create_network(config.network)

    try:
        await network.initialize()
        print(f"Network initialized successfully on ports {grpc_port}, {http_port}")
    except Exception as e:
        print(f"Network initialization failed: {e}")
        release_port(grpc_port)
        release_port(http_port)
        raise

    # Give network time to start up
    await asyncio.sleep(1.0)

    # Verify network is ready with health check
    max_retries = 10
    for attempt in range(max_retries):
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                try:
                    async with session.get(f"http://localhost:{http_port}/api/health", timeout=1) as resp:
                        if resp.status == 200:
                            print(f"Network health check passed on attempt {attempt + 1}")
                            break
                except:
                    pass
        except:
            pass

        if attempt < max_retries - 1:
            await asyncio.sleep(0.5)
            print(f"Network not ready, retrying... (attempt {attempt + 1}/{max_retries})")
        else:
            print(f"Network may not be fully ready after {max_retries} attempts, proceeding anyway...")
            break

    yield network, config, grpc_port, http_port

    # Cleanup
    try:
        await network.shutdown()
        print(f"Network shutdown complete, releasing ports {grpc_port}, {http_port}")

        # Wait for ports to be freed by the OS
        await asyncio.gather(
            asyncio.create_task(asyncio.to_thread(wait_for_port_free, grpc_port, 'localhost', 5.0)),
            asyncio.create_task(asyncio.to_thread(wait_for_port_free, http_port, 'localhost', 5.0))
        )

        release_port(grpc_port)
        release_port(http_port)

        await asyncio.sleep(0.2)

    except Exception as e:
        print(f"Error during network shutdown: {e}")
        release_port(grpc_port)
        release_port(http_port)


@pytest.fixture
async def user_client(hello_world_network) -> AgentClient:
    """Create a user client for sending messages to the network.

    This simulates a human user sending messages through the UI.
    """
    network, config, grpc_port, http_port = hello_world_network

    client = AgentClient(agent_id="test_user")

    # Retry connection with exponential backoff
    max_retries = 5
    for attempt in range(max_retries):
        try:
            await client.connect("localhost", http_port)
            print(f"User client connected successfully on attempt {attempt + 1}")
            break
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (2 ** attempt)
                print(f"User client connection failed (attempt {attempt + 1}), retrying in {wait_time}s: {e}")
                await asyncio.sleep(wait_time)
            else:
                print(f"User client connection failed after {max_retries} attempts: {e}")
                raise

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
        print("User client disconnected")
    except Exception as e:
        print(f"Error disconnecting user client: {e}")
