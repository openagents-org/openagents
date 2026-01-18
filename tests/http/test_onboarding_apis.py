"""
Comprehensive tests for onboarding APIs.

Tests the following APIs:
1. POST /api/network/initialize/admin-password
2. POST /api/network/initialize/template
3. POST /api/network/initialize/model-config
4. POST /api/register (admin login verification)
"""

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

import aiohttp
import pytest
import yaml

# Test configuration
TEST_PORT = 18700
TEST_GRPC_PORT = 18600
TEST_HOST = "127.0.0.1"
TEST_ADMIN_PASSWORD = "TestSecurePassword123!"


def hash_password(password: str) -> str:
    """Hash password using SHA-256 (same as backend)."""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def create_minimal_network_config(workspace_dir: Path) -> Path:
    """Create a minimal network config for testing."""
    from openagents import __version__

    config = {
        "network": {
            "name": "TestNetwork",
            "mode": "centralized",
            "node_id": "test-node-1",
            "transports": [
                {
                    "type": "http",
                    "config": {
                        "port": TEST_PORT,
                        "host": TEST_HOST,
                        "serve_studio": False,
                        "serve_mcp": False,
                    }
                },
                {
                    "type": "grpc",
                    "config": {
                        "port": TEST_GRPC_PORT,
                        "host": TEST_HOST,
                    }
                }
            ],
            "default_agent_group": "guest",
            "requires_password": False,
            "agent_groups": {},
            "mods": [],
            "initialized": False,  # Fresh network needs onboarding
            "created_by_version": __version__,  # Mark as new config (not legacy)
        },
        "log_level": "DEBUG",
        "data_dir": str(workspace_dir / "data"),
    }

    config_path = workspace_dir / "network.yaml"
    with open(config_path, 'w') as f:
        yaml.dump(config, f, default_flow_style=False)

    return config_path


@pytest.fixture
def workspace_dir():
    """Create a temporary workspace directory."""
    temp_dir = tempfile.mkdtemp(prefix="test_onboarding_")
    yield Path(temp_dir)
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
async def network_instance(workspace_dir):
    """Start a network instance for testing."""
    from openagents.core.network import AgentNetwork

    config_path = create_minimal_network_config(workspace_dir)

    network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))

    # Initialize the network (this also starts it)
    success = await network.initialize()
    assert success, "Failed to initialize network"

    yield network

    # Cleanup
    await network.shutdown()


@pytest.fixture
def base_url():
    """Get the base URL for API calls."""
    return f"http://{TEST_HOST}:{TEST_PORT}"


class TestOnboardingAPIs:
    """Test class for onboarding APIs."""

    @pytest.mark.asyncio
    async def test_admin_password_initialization(self, network_instance, base_url):
        """Test setting admin password on a fresh network."""
        async with aiohttp.ClientSession() as session:
            # Check that network is not yet initialized
            async with session.get(f"{base_url}/api/health") as resp:
                assert resp.status == 200
                health_data = await resp.json()
                data = health_data.get("data", health_data)  # Handle nested or flat response
                assert data.get("initialized") is False or data.get("initialized") is None

            # Set admin password
            async with session.post(
                f"{base_url}/api/network/initialize/admin-password",
                json={"password": TEST_ADMIN_PASSWORD}
            ) as resp:
                assert resp.status == 200, f"Failed: {await resp.text()}"
                data = await resp.json()
                assert data["success"] is True
                assert "Admin password initialized" in data["message"]

            # Verify network is now initialized
            async with session.get(f"{base_url}/api/health") as resp:
                assert resp.status == 200
                health_data = await resp.json()
                data = health_data.get("data", health_data)  # Handle nested or flat response
                assert data.get("initialized") is True

            # Verify can't set password again
            async with session.post(
                f"{base_url}/api/network/initialize/admin-password",
                json={"password": "AnotherPassword123!"}
            ) as resp:
                assert resp.status == 400
                data = await resp.json()
                assert data["success"] is False
                assert "already initialized" in data["message"].lower()

    @pytest.mark.asyncio
    async def test_admin_registration_with_password(self, network_instance, base_url):
        """Test that admin can register with correct password."""
        async with aiohttp.ClientSession() as session:
            # First set the admin password
            async with session.post(
                f"{base_url}/api/network/initialize/admin-password",
                json={"password": TEST_ADMIN_PASSWORD}
            ) as resp:
                assert resp.status == 200

            # Now try to register as admin with correct password
            password_hash = hash_password(TEST_ADMIN_PASSWORD)
            async with session.post(
                f"{base_url}/api/register",
                json={
                    "agent_id": "test-admin",
                    "metadata": {"display_name": "Test Admin"},
                    "password_hash": password_hash,
                    "agent_group": "admin"
                }
            ) as resp:
                assert resp.status == 200, f"Registration failed: {await resp.text()}"
                data = await resp.json()
                assert data["success"] is True
                # Secret may be at top level or in data dict
                secret = data.get("secret") or data.get("data", {}).get("secret")
                assert secret is not None, "Secret not found in response"

            # Unregister
            async with session.post(
                f"{base_url}/api/unregister",
                json={"agent_id": "test-admin", "secret": secret}
            ) as resp:
                assert resp.status == 200

    @pytest.mark.asyncio
    async def test_admin_registration_with_wrong_password(self, network_instance, base_url):
        """Test that admin registration fails with wrong password."""
        async with aiohttp.ClientSession() as session:
            # First set the admin password
            async with session.post(
                f"{base_url}/api/network/initialize/admin-password",
                json={"password": TEST_ADMIN_PASSWORD}
            ) as resp:
                assert resp.status == 200

            # Try to register with wrong password
            wrong_hash = hash_password("WrongPassword123!")
            async with session.post(
                f"{base_url}/api/register",
                json={
                    "agent_id": "test-admin",
                    "metadata": {"display_name": "Test Admin"},
                    "password_hash": wrong_hash,
                    "agent_group": "admin"
                }
            ) as resp:
                # HTTP status may be 200 or 500 depending on implementation
                data = await resp.json()
                assert data["success"] is False
                assert "invalid credentials" in data.get("message", "").lower() or "invalid credentials" in data.get("error_message", "").lower()


class TestTemplateApplication:
    """Test template application API."""

    @pytest.mark.asyncio
    async def test_template_application(self, workspace_dir):
        """Test applying a template to a fresh network."""
        from openagents.core.network import AgentNetwork

        # Create fresh config
        config_path = create_minimal_network_config(workspace_dir)

        network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))
        await network.initialize()

        try:
            async with aiohttp.ClientSession() as session:
                base_url = f"http://{TEST_HOST}:{TEST_PORT}"

                # Apply template
                async with session.post(
                    f"{base_url}/api/network/initialize/template",
                    json={"template_name": "information-hub"}
                ) as resp:
                    assert resp.status == 200, f"Failed: {await resp.text()}"
                    data = await resp.json()
                    assert data["success"] is True
                    assert "information-hub" in data.get("template", "")

                # Verify config was updated
                with open(config_path, 'r') as f:
                    updated_config = yaml.safe_load(f)

                assert "network" in updated_config
                network_config = updated_config.get("network", {})
                # Template should have updated the config
                assert network_config.get("name") == "InformationHub"
        finally:
            await network.shutdown()

    @pytest.mark.asyncio
    async def test_template_preserves_admin_password(self, workspace_dir):
        """Test that applying template preserves previously set admin password."""
        from openagents.core.network import AgentNetwork

        # Create fresh config
        config_path = create_minimal_network_config(workspace_dir)

        network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))
        await network.initialize()

        try:
            async with aiohttp.ClientSession() as session:
                base_url = f"http://{TEST_HOST}:{TEST_PORT}"

                # First set admin password
                async with session.post(
                    f"{base_url}/api/network/initialize/admin-password",
                    json={"password": TEST_ADMIN_PASSWORD}
                ) as resp:
                    assert resp.status == 200, f"Failed: {await resp.text()}"

                # Get the password hash that was set
                expected_hash = hash_password(TEST_ADMIN_PASSWORD)

                # Template should fail because network is initialized
                async with session.post(
                    f"{base_url}/api/network/initialize/template",
                    json={"template_name": "information-hub"}
                ) as resp:
                    # Should fail because initialized
                    data = await resp.json()
                    if resp.status == 400:
                        assert "already initialized" in data.get("message", "").lower()
                    else:
                        # If it succeeded, verify password is preserved
                        with open(config_path, 'r') as f:
                            config = yaml.safe_load(f)
                        admin_hash = config.get("network", {}).get("agent_groups", {}).get("admin", {}).get("password_hash")
                        assert admin_hash == expected_hash, "Admin password hash was not preserved"

                # Verify admin can still login
                async with session.post(
                    f"{base_url}/api/register",
                    json={
                        "agent_id": "test-admin-2",
                        "metadata": {"display_name": "Test Admin 2"},
                        "password_hash": expected_hash,
                        "agent_group": "admin"
                    }
                ) as resp:
                    data = await resp.json()
                    assert data["success"] is True, f"Admin login failed after template: {data}"
        finally:
            await network.shutdown()


class TestModelConfigAPI:
    """Test model configuration API."""

    @pytest.mark.asyncio
    async def test_model_config_save(self, workspace_dir):
        """Test saving model configuration."""
        from openagents.core.network import AgentNetwork

        # Create fresh config
        config_path = create_minimal_network_config(workspace_dir)

        network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))
        await network.initialize()

        try:
            async with aiohttp.ClientSession() as session:
                base_url = f"http://{TEST_HOST}:{TEST_PORT}"

                # Set model config
                async with session.post(
                    f"{base_url}/api/network/initialize/model-config",
                    json={
                        "provider": "openai",
                        "model_name": "gpt-4o",
                        "api_key": "sk-test-key-12345"
                    }
                ) as resp:
                    assert resp.status == 200, f"Failed: {await resp.text()}"
                    data = await resp.json()
                    assert data["success"] is True

                # Verify config was saved to .env file
                env_file = workspace_dir / ".env"

                assert env_file.exists(), f"Global env file not created at {env_file}"

                # Read and parse .env file
                from dotenv import dotenv_values
                env_vars = dotenv_values(env_file)

                assert env_vars.get("DEFAULT_LLM_PROVIDER") == "openai"
                assert env_vars.get("DEFAULT_LLM_MODEL_NAME") == "gpt-4o"
                assert env_vars.get("DEFAULT_LLM_API_KEY") == "sk-test-key-12345"
        finally:
            await network.shutdown()


class TestFullOnboardingFlow:
    """Test the complete onboarding flow as it happens in the frontend."""

    @pytest.mark.asyncio
    async def test_complete_onboarding_flow(self, workspace_dir):
        """Test the complete onboarding flow: template -> password -> model -> login."""
        from openagents.core.network import AgentNetwork

        # Create fresh config
        config_path = create_minimal_network_config(workspace_dir)

        network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))
        await network.initialize()

        try:
            async with aiohttp.ClientSession() as session:
                base_url = f"http://{TEST_HOST}:{TEST_PORT}"

                # Step 1: Apply template (simulates OnboardingStep2)
                print("\n=== Step 1: Applying template ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/template",
                    json={"template_name": "information-hub"}
                ) as resp:
                    data = await resp.json()
                    print(f"Template response: {data}")
                    assert resp.status == 200, f"Template failed: {data}"
                    assert data["success"] is True

                # Step 2: Set admin password (simulates deployment step)
                print("\n=== Step 2: Setting admin password ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/admin-password",
                    json={"password": TEST_ADMIN_PASSWORD}
                ) as resp:
                    data = await resp.json()
                    print(f"Admin password response: {data}")
                    assert resp.status == 200, f"Admin password failed: {data}"
                    assert data["success"] is True

                # Step 3: Set model config
                print("\n=== Step 3: Setting model config ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/model-config",
                    json={
                        "provider": "anthropic",
                        "model_name": "claude-3-5-sonnet",
                        "api_key": "sk-ant-test-key"
                    }
                ) as resp:
                    data = await resp.json()
                    print(f"Model config response: {data}")
                    assert resp.status == 200, f"Model config failed: {data}"
                    assert data["success"] is True

                # Step 4: Admin login (simulates OnboardingSuccess)
                print("\n=== Step 4: Admin login ===")
                password_hash = hash_password(TEST_ADMIN_PASSWORD)
                async with session.post(
                    f"{base_url}/api/register",
                    json={
                        "agent_id": "admin",
                        "metadata": {
                            "display_name": "admin",
                            "platform": "web",
                            "verification_only": True
                        },
                        "password_hash": password_hash,
                        "agent_group": "admin"
                    }
                ) as resp:
                    data = await resp.json()
                    print(f"Admin login response: {data}")
                    assert resp.status == 200, f"Admin login request failed"
                    assert data["success"] is True, f"Admin login failed: {data.get('message', data)}"

                    # Secret may be at top level or in data dict
                    secret = data.get("secret") or data.get("data", {}).get("secret")
                    assert secret is not None, "Secret not found in response"
                    print(f"Admin login successful! Secret: {secret[:8]}...")

                # Cleanup: unregister
                async with session.post(
                    f"{base_url}/api/unregister",
                    json={"agent_id": "admin", "secret": secret}
                ) as resp:
                    assert resp.status == 200

                print("\n=== All onboarding steps passed! ===")
        finally:
            await network.shutdown()

    @pytest.mark.asyncio
    async def test_frontend_flow_order(self, workspace_dir):
        """
        Test the exact flow as implemented in frontend:
        1. OnboardingStep2: Apply template
        2. handleDeployment: admin-password -> template (fails) -> model-config
        3. OnboardingSuccess: Admin login
        """
        from openagents.core.network import AgentNetwork

        config_path = create_minimal_network_config(workspace_dir)

        network = AgentNetwork.load(str(config_path), workspace_path=str(workspace_dir))
        await network.initialize()

        try:
            async with aiohttp.ClientSession() as session:
                base_url = f"http://{TEST_HOST}:{TEST_PORT}"

                # OnboardingStep2: Apply template
                print("\n=== OnboardingStep2: Apply template ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/template",
                    json={"template_name": "information-hub"}
                ) as resp:
                    data = await resp.json()
                    print(f"Template (Step2): {data}")
                    assert data["success"] is True

                # handleDeployment Step 1: Set admin password
                print("\n=== handleDeployment: Set admin password ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/admin-password",
                    json={"password": TEST_ADMIN_PASSWORD}
                ) as resp:
                    data = await resp.json()
                    print(f"Admin password: {data}")
                    assert data["success"] is True

                # handleDeployment Step 2: Apply template again (should fail, frontend ignores)
                print("\n=== handleDeployment: Template again (expected to fail) ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/template",
                    json={"template_name": "information-hub"}
                ) as resp:
                    data = await resp.json()
                    print(f"Template (deployment): status={resp.status}, data={data}")
                    # This should fail because network is already initialized
                    assert resp.status == 400 or data["success"] is False

                # handleDeployment Step 3: Set model config
                print("\n=== handleDeployment: Set model config ===")
                async with session.post(
                    f"{base_url}/api/network/initialize/model-config",
                    json={
                        "provider": "openai",
                        "model_name": "gpt-4o-mini",
                        "api_key": "sk-test"
                    }
                ) as resp:
                    data = await resp.json()
                    print(f"Model config: {data}")
                    assert data["success"] is True

                # OnboardingSuccess: Admin login
                print("\n=== OnboardingSuccess: Admin login ===")
                password_hash = hash_password(TEST_ADMIN_PASSWORD)
                async with session.post(
                    f"{base_url}/api/register",
                    json={
                        "agent_id": "admin",
                        "metadata": {
                            "display_name": "admin",
                            "platform": "web",
                            "verification_only": True
                        },
                        "password_hash": password_hash,
                        "agent_group": "admin"
                    }
                ) as resp:
                    data = await resp.json()
                    print(f"Admin login: {data}")
                    assert data["success"] is True, f"CRITICAL: Admin login failed! {data}"

                print("\n=== Frontend flow test PASSED! ===")
        finally:
            await network.shutdown()


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v", "-s"])
