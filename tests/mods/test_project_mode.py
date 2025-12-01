"""
Test project mod functionality directly using events.
"""
import pytest
from pathlib import Path
import yaml

from openagents.mods.workspace.project.mod import DefaultProjectNetworkMod
from openagents.models.event import Event


@pytest.mark.asyncio
async def test_project_mod_with_config():
    """Test project mod directly with configuration from project_mode.yaml."""
    # Load the actual project mode config
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "project_mode.yaml"
    
    with open(config_path, 'r') as f:
        config_data = yaml.safe_load(f)
    
    # Get the project mod configuration
    project_mod_config = None
    for mod_config in config_data['network'].get('mods', []):
        if mod_config['name'] == 'openagents.mods.workspace.project':
            project_mod_config = mod_config['config']
            break
    
    assert project_mod_config is not None, "Project mod config not found in project_mode.yaml"
    
    # Create and configure the project mod
    mod = DefaultProjectNetworkMod()
    mod.update_config(project_mod_config)
    mod.initialize()
    
    # Test template listing
    template_event = Event(
        event_name="project.template.list",
        source_id="test-agent",
        payload={}
    )
    
    response = await mod.process_system_message(template_event)
    assert response.success
    assert len(response.data["templates"]) == 4
    
    template_ids = [t["template_id"] for t in response.data["templates"]]
    assert "software_development" in template_ids
    assert "research_analysis" in template_ids
    assert "quality_assurance" in template_ids
    assert "general_collaboration" in template_ids
    
    print("✅ Template listing test passed!")


@pytest.mark.asyncio
async def test_project_lifecycle():
    """Test complete project lifecycle."""
    # Load config and set up mod
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "project_mode.yaml"
    
    with open(config_path, 'r') as f:
        config_data = yaml.safe_load(f)
    
    project_mod_config = None
    for mod_config in config_data['network'].get('mods', []):
        if mod_config['name'] == 'openagents.mods.workspace.project':
            project_mod_config = mod_config['config']
            break
    
    mod = DefaultProjectNetworkMod()
    mod.update_config(project_mod_config)
    mod.initialize()
    
    # Test project creation
    start_event = Event(
        event_name="project.start",
        source_id="test-agent",
        payload={
            "template_id": "software_development",
            "goal": "Build a test application",
            "name": "Test Project",
            "collaborators": ["dev2"]
        }
    )
    
    response = await mod.process_system_message(start_event)
    assert response.success
    assert "project_id" in response.data
    
    project_id = response.data["project_id"]
    print(f"✅ Project created with ID: {project_id}")
    
    # Test getting project details
    get_event = Event(
        event_name="project.get",
        source_id="test-agent",
        payload={"project_id": project_id}
    )
    
    response = await mod.process_system_message(get_event)
    assert response.success
    assert response.data["project"]["goal"] == "Build a test application"
    assert response.data["project"]["status"] == "running"
    
    print("✅ Project retrieval test passed!")
    
    # Test project completion
    complete_event = Event(
        event_name="project.complete",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "summary": "Successfully completed the test project"
        }
    )
    
    response = await mod.process_system_message(complete_event)
    assert response.success
    
    # Verify completion
    response = await mod.process_system_message(get_event)
    assert response.success
    assert response.data["project"]["status"] == "completed"
    
    print("✅ Project completion test passed!")


@pytest.mark.asyncio
async def test_project_state_management():
    """Test project state management operations."""
    # Load config and set up mod
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "project_mode.yaml"
    
    with open(config_path, 'r') as f:
        config_data = yaml.safe_load(f)
    
    project_mod_config = None
    for mod_config in config_data['network'].get('mods', []):
        if mod_config['name'] == 'openagents.mods.workspace.project':
            project_mod_config = mod_config['config']
            break
    
    mod = DefaultProjectNetworkMod()
    mod.update_config(project_mod_config)
    mod.initialize()
    
    # Create a project first
    start_event = Event(
        event_name="project.start",
        source_id="test-agent",
        payload={
            "template_id": "general_collaboration",
            "goal": "Test state management"
        }
    )
    
    start_response = await mod.process_system_message(start_event)
    project_id = start_response.data["project_id"]
    
    # Test global state operations
    set_event = Event(
        event_name="project.global_state.set",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "status",
            "value": "in_progress"
        }
    )
    
    response = await mod.process_system_message(set_event)
    assert response.success
    
    # Get global state
    get_event = Event(
        event_name="project.global_state.get",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "status"
        }
    )
    
    response = await mod.process_system_message(get_event)
    assert response.success
    assert response.data["value"] == "in_progress"
    
    print("✅ Global state management test passed!")
    
    # Test agent state operations
    agent_set_event = Event(
        event_name="project.agent_state.set",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "current_task",
            "value": "testing state management"
        }
    )
    
    response = await mod.process_system_message(agent_set_event)
    assert response.success
    
    # Get agent state
    agent_get_event = Event(
        event_name="project.agent_state.get",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "current_task"
        }
    )
    
    response = await mod.process_system_message(agent_get_event)
    assert response.success
    assert response.data["value"] == "testing state management"
    
    print("✅ Agent state management test passed!")


@pytest.mark.asyncio
async def test_project_artifacts():
    """Test project artifact management."""
    # Load config and set up mod
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "project_mode.yaml"
    
    with open(config_path, 'r') as f:
        config_data = yaml.safe_load(f)
    
    project_mod_config = None
    for mod_config in config_data['network'].get('mods', []):
        if mod_config['name'] == 'openagents.mods.workspace.project':
            project_mod_config = mod_config['config']
            break
    
    mod = DefaultProjectNetworkMod()
    mod.update_config(project_mod_config)
    mod.initialize()
    
    # Create a project first
    start_event = Event(
        event_name="project.start",
        source_id="test-agent",
        payload={
            "template_id": "software_development",
            "goal": "Test artifacts"
        }
    )
    
    start_response = await mod.process_system_message(start_event)
    project_id = start_response.data["project_id"]
    
    # Set artifact
    set_event = Event(
        event_name="project.artifact.set",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "design_document",
            "value": "# Project Design\n\nThis is a comprehensive design document."
        }
    )
    
    response = await mod.process_system_message(set_event)
    assert response.success
    
    # Get artifact
    get_event = Event(
        event_name="project.artifact.get",
        source_id="test-agent",
        payload={
            "project_id": project_id,
            "key": "design_document"
        }
    )
    
    response = await mod.process_system_message(get_event)
    assert response.success
    assert "# Project Design" in response.data["value"]
    
    # List artifacts
    list_event = Event(
        event_name="project.artifact.list",
        source_id="test-agent",
        payload={"project_id": project_id}
    )
    
    response = await mod.process_system_message(list_event)
    assert response.success
    assert "design_document" in response.data["artifacts"]
    
    print("✅ Artifact management test passed!")


@pytest.mark.asyncio
async def test_permission_system():
    """Test project permission system.
    
    The permission system allows relaxed read access for project.get to support
    Studio project mode where users might reconnect with a different agent_id.
    Write operations (stop, complete, state changes, artifacts) still require
    strict authorization.
    """
    # Load config and set up mod
    config_path = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "project_mode.yaml"
    
    with open(config_path, 'r') as f:
        config_data = yaml.safe_load(f)
    
    project_mod_config = None
    for mod_config in config_data['network'].get('mods', []):
        if mod_config['name'] == 'openagents.mods.workspace.project':
            project_mod_config = mod_config['config']
            break
    
    mod = DefaultProjectNetworkMod()
    mod.update_config(project_mod_config)
    mod.initialize()
    
    # Create project with agent1
    start_event = Event(
        event_name="project.start",
        source_id="agent1",
        payload={
            "template_id": "software_development",
            "goal": "Test permissions"
        }
    )
    
    response = await mod.process_system_message(start_event)
    project_id = response.data["project_id"]
    
    # Test 1: Read access (project.get) is allowed for any agent
    # This is intentional to support Studio project mode reconnection scenarios
    get_event = Event(
        event_name="project.get",
        source_id="unauthorized-agent",
        payload={"project_id": project_id}
    )
    
    response = await mod.process_system_message(get_event)
    assert response.success
    assert "project" in response.data
    
    # Test 2: Write operations require strict authorization
    # Test project.stop - should be denied
    stop_event = Event(
        event_name="project.stop",
        source_id="unauthorized-agent",
        payload={"project_id": project_id, "reason": "Test stop"}
    )
    
    response = await mod.process_system_message(stop_event)
    assert not response.success
    assert "Access denied" in response.message
    
    # Test 3: Artifact operations require strict authorization
    artifact_event = Event(
        event_name="project.artifact.set",
        source_id="unauthorized-agent",
        payload={"project_id": project_id, "key": "test", "value": "data"}
    )
    
    response = await mod.process_system_message(artifact_event)
    assert not response.success
    assert "Access denied" in response.message
    
    # Test 4: Global state operations require strict authorization
    state_event = Event(
        event_name="project.global_state.set",
        source_id="unauthorized-agent",
        payload={"project_id": project_id, "key": "test", "value": "data"}
    )
    
    response = await mod.process_system_message(state_event)
    assert not response.success
    assert "Access denied" in response.message
    
    # Test 5: Authorized agent (agent1) can perform write operations
    artifact_event_authorized = Event(
        event_name="project.artifact.set",
        source_id="agent1",
        payload={"project_id": project_id, "key": "test_artifact", "value": "test_data"}
    )
    
    response = await mod.process_system_message(artifact_event_authorized)
    assert response.success
    
    print("✅ Permission system test passed!")


if __name__ == "__main__":
    import asyncio
    
    async def run_all_tests():
        print("🧪 Running project mod tests...")
        
        await test_project_mod_with_config()
        await test_project_lifecycle() 
        await test_project_state_management()
        await test_project_artifacts()
        await test_permission_system()
        
        print("\n🎉 All tests passed successfully!")
    
    asyncio.run(run_all_tests())