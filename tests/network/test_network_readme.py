"""
Test cases for the network README feature.

This module contains tests for:
- network_profile.readme (priority 1)
- README.md file fallback (priority 2)
- No readme available
"""

import pytest
import tempfile
import os
from pathlib import Path

from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.network_profile import NetworkProfile


SAMPLE_README_CONTENT = """# Test Network

Welcome to the test network!

## Features
- Feature 1
- Feature 2

## Getting Started
```python
agent.connect("http://localhost:8700")
```
"""

SAMPLE_README_FILE_CONTENT = """# README from File

This README was loaded from a file.

## Usage
Follow the instructions below.
"""


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
async def network_with_profile_readme():
    """Create a test network with readme in network_profile."""
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        network_profile=NetworkProfile(
            name="Test Network",
            description="A test network",
            readme=SAMPLE_README_CONTENT,
            required_openagents_version="0.6.0",
        ),
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    await network.shutdown()


@pytest.fixture
async def network_with_readme_file(temp_workspace):
    """Create a test network with README.md file in workspace."""
    # Create README.md file in workspace
    readme_file = temp_workspace / "README.md"
    readme_file.write_text(SAMPLE_README_FILE_CONTENT, encoding="utf-8")

    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
    )

    network = AgentNetwork.create_from_config(config, workspace_path=str(temp_workspace))
    await network.initialize()

    yield network

    await network.shutdown()


@pytest.fixture
async def network_without_readme(temp_workspace):
    """Create a test network without any readme."""
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
    )

    network = AgentNetwork.create_from_config(config, workspace_path=str(temp_workspace))
    await network.initialize()

    yield network

    await network.shutdown()


@pytest.mark.asyncio
async def test_readme_from_network_profile(network_with_profile_readme):
    """Test that readme from network_profile is returned correctly."""
    network = network_with_profile_readme

    # Test get_readme() method via network_context
    readme = network.topology.network_context.get_readme()
    assert readme is not None, "README should not be None"
    assert readme == SAMPLE_README_CONTENT, "README content should match network_profile"

    # Test that readme is included in network stats
    stats = network.get_network_stats()
    assert "readme" in stats, "Stats should include readme field"
    assert stats["readme"] == SAMPLE_README_CONTENT, "Stats readme should match network_profile"


@pytest.mark.asyncio
async def test_readme_file_fallback(network_with_readme_file):
    """Test that README.md file is used as fallback when no inline readme."""
    network = network_with_readme_file

    # Test get_readme() method via network_context
    readme = network.topology.network_context.get_readme()
    assert readme is not None, "README should not be None"
    assert readme == SAMPLE_README_FILE_CONTENT, "README content should match file"

    # Test that readme is included in network stats
    stats = network.get_network_stats()
    assert "readme" in stats, "Stats should include readme field"
    assert stats["readme"] == SAMPLE_README_FILE_CONTENT, "Stats readme should match file"


@pytest.mark.asyncio
async def test_no_readme_available(network_without_readme):
    """Test that None is returned when no readme is available."""
    network = network_without_readme

    # Test get_readme() method via network_context
    readme = network.topology.network_context.get_readme()
    assert readme is None, "README should be None when not configured"

    # Test that readme is None in network stats
    stats = network.get_network_stats()
    assert "readme" in stats, "Stats should include readme field"
    assert stats["readme"] is None, "Stats readme should be None"


@pytest.mark.asyncio
async def test_network_profile_readme_priority_over_file(temp_workspace):
    """Test that network_profile.readme takes priority over README.md file."""
    # Create README.md file in workspace
    readme_file = temp_workspace / "README.md"
    readme_file.write_text(SAMPLE_README_FILE_CONTENT, encoding="utf-8")

    # Create config with network_profile readme
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        network_profile=NetworkProfile(
            name="Test Network",
            description="A test network",
            readme=SAMPLE_README_CONTENT,
            required_openagents_version="0.6.0",
        ),
    )

    network = AgentNetwork.create_from_config(config, workspace_path=str(temp_workspace))
    await network.initialize()

    try:
        # network_profile.readme should take priority over file
        readme = network.topology.network_context.get_readme()
        assert readme == SAMPLE_README_CONTENT, "network_profile.readme should take priority over file"

        stats = network.get_network_stats()
        assert stats["readme"] == SAMPLE_README_CONTENT
    finally:
        await network.shutdown()


@pytest.mark.asyncio
async def test_readme_with_unicode_content(temp_workspace):
    """Test that README with unicode content is handled correctly."""
    unicode_readme = """# 欢迎使用测试网络

这是一个包含中文的README文件。

## 功能特点
- 实时消息传递
- 共享存储

## 表情符号测试 🎉🚀✨
"""
    # Create README.md file with unicode content
    readme_file = temp_workspace / "README.md"
    readme_file.write_text(unicode_readme, encoding="utf-8")

    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
    )

    network = AgentNetwork.create_from_config(config, workspace_path=str(temp_workspace))
    await network.initialize()

    try:
        readme = network.topology.network_context.get_readme()
        assert readme == unicode_readme, "Unicode README content should be read correctly"
    finally:
        await network.shutdown()


@pytest.mark.asyncio
async def test_readme_from_yaml_config():
    """Test loading README from YAML config file with network_profile."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "network_readme.yaml"

    if not config_path.exists():
        pytest.skip(f"Test config not found: {config_path}")

    network = AgentNetwork.load(str(config_path))
    await network.initialize()

    try:
        readme = network.topology.network_context.get_readme()
        assert readme is not None, "README should be loaded from YAML config"
        assert "# Test Network README" in readme, "README should contain expected content"
        assert "network_profile" in readme, "README should mention network_profile"

        stats = network.get_network_stats()
        assert stats["readme"] == readme
    finally:
        await network.shutdown()
