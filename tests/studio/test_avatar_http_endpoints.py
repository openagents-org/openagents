"""
Integration test for avatar mod HTTP endpoints.

This test verifies that avatar images can be uploaded via events
and retrieved via HTTP endpoints.
"""

import pytest
import asyncio
import aiohttp
import base64
import io
import tempfile
from pathlib import Path

from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig, ModConfig
from openagents.models.transport import TransportType
from openagents.models.event import Event

# Skip tests if Pillow not available
try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False


def create_test_image(width=100, height=100, format='PNG') -> str:
    """Create a test image and return base64-encoded data."""
    if not PILLOW_AVAILABLE:
        pytest.skip("Pillow not available")
    
    # Create a simple colored image
    img = Image.new('RGB', (width, height), color='blue')
    output = io.BytesIO()
    img.save(output, format=format)
    image_bytes = output.getvalue()
    return base64.b64encode(image_bytes).decode()


@pytest.mark.skipif(not PILLOW_AVAILABLE, reason="Pillow not available")
@pytest.mark.asyncio
async def test_avatar_http_endpoints():
    """Test avatar upload via events and retrieval via HTTP endpoints."""
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create a minimal network configuration
        config = NetworkConfig(
            name="avatar_test_network",
            mode="centralized",
            mods=[
                ModConfig(name="openagents.mods.misc.avatar", enabled=True, config={})
            ]
        )
        
        # Create network with workspace
        network = AgentNetwork.create_from_config(config, workspace_path=tmpdir)
        
        # Get avatar mod and re-initialize to ensure it has workspace
        avatar_mod = network.mod_registry.get("openagents.mods.misc.avatar")
        if avatar_mod:
            avatar_mod.initialize()
        
        try:
            # Initialize network
            success = await network.initialize()
            assert success, "Network initialization should succeed"
            
            # Get the actual port that was assigned
            http_transport = network.topology.transports.get("http")
            assert http_transport is not None, "HTTP transport should be available"
            port = http_transport._listen_port
            base_url = f"http://127.0.0.1:{port}"
            
            # Give network time to initialize
            await asyncio.sleep(2)
            
            # Create test image
            image_data = create_test_image()
            
            # Set avatar via event
            set_event = Event(
                event_name="avatar.set",
                source_id="test_agent",
                destination_id="",
                payload={
                    "image_data": image_data,
                    "mime_type": "image/png"
                }
            )
            
            # Process event through network
            response = await network.process_external_event(set_event)
            assert response is not None, "Set avatar should return response"
            assert response.success is True, "Set avatar should succeed"
            
            # Give time for avatar to be saved
            await asyncio.sleep(1)
            
            # Test HTTP endpoint - get avatar image
            async with aiohttp.ClientSession() as session:
                # Get avatar image
                async with session.get(f"{base_url}/api/avatars/test_agent.png") as resp:
                    assert resp.status == 200, f"Avatar image should be retrievable, got {resp.status}"
                    assert resp.content_type == "image/png", "Content type should be image/png"
                    image_bytes = await resp.read()
                    assert len(image_bytes) > 0, "Image data should not be empty"
                    
                    # Verify it's a valid PNG
                    img = Image.open(io.BytesIO(image_bytes))
                    assert img.size == (256, 256), "Avatar should be resized to 256x256"
                    assert img.format == "PNG", "Avatar should be PNG format"
                
                # Test batch endpoint
                async with session.post(
                    f"{base_url}/api/avatars/batch",
                    json={"agent_ids": ["test_agent", "nonexistent_agent"]}
                ) as resp:
                    assert resp.status == 200, "Batch endpoint should work"
                    data = await resp.json()
                    assert "avatars" in data, "Response should have avatars"
                    assert data["avatars"]["test_agent"] == "/api/avatars/test_agent.png"
                    assert data["avatars"]["nonexistent_agent"] is None
                
                # Test 404 for nonexistent avatar
                async with session.get(f"{base_url}/api/avatars/nonexistent.png") as resp:
                    assert resp.status == 404, "Nonexistent avatar should return 404"
            
            print("✅ All avatar HTTP endpoint tests passed")
            
        finally:
            # Cleanup
            await network.shutdown()
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(test_avatar_http_endpoints())
