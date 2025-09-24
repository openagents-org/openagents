#!/usr/bin/env python3
"""
Single comprehensive test for workspace persistence functionality.
"""

import tempfile
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_workspace_persistence():
    """Single test that verifies workspace persistence works end-to-end."""
    
    logger.info("🧪 Testing workspace persistence...")
    
    from openagents.core.workspace_manager import WorkspaceManager
    from openagents.core.network import AgentNetwork
    from openagents.models.network_config import NetworkConfig, ModConfig
    from openagents.models.event import Event
    
    with tempfile.TemporaryDirectory(prefix="test_workspace_") as temp_dir:
        workspace_path = Path(temp_dir)
        logger.info(f"📁 Test workspace: {workspace_path}")
        
        # Create network with workspace and mods
        config = NetworkConfig(
            name="TestNetwork",
            mode="centralized", 
            host="localhost",
            port=8580,
            mods=[
                ModConfig(name="openagents.mods.workspace.messaging", enabled=True),
                ModConfig(name="openagents.mods.workspace.default", enabled=True)
            ]
        )
        
        network = AgentNetwork.create_from_config(config, workspace_path=str(workspace_path))
        workspace = network.workspace_manager
        
        # Test 1: Event storage
        event = Event(event_name="agent.test.event", source_id="agent1", destination_id="agent2")
        workspace.store_event(event)
        
        # Test 2: Agent registration
        workspace.register_agent("agent1", {"type": "test_agent"})
        
        # Test 3: Network state
        workspace.set_network_state("test_key", "test_value")
        
        # Test 4: Mod storage
        for mod_name, mod_instance in network.mods.items():
            storage_path = mod_instance.get_storage_path()
            if storage_path:
                test_file = storage_path / "test_data.json"
                test_file.write_text('{"persistent": true}')
                logger.info(f"✅ {mod_name} using persistent storage")
        
        # Test 5: Data persistence across "restart"
        del network
        
        # "Restart" - create new workspace manager
        new_workspace = WorkspaceManager(workspace_path)
        new_workspace.initialize_workspace()
        
        # Verify data persisted
        events = new_workspace.get_events()
        agents = new_workspace.get_agents()
        state = new_workspace.get_network_state("test_key")
        
        assert len(events) == 1, f"Expected 1 event, got {len(events)}"
        assert len(agents) == 1, f"Expected 1 agent, got {len(agents)}"
        assert state == "test_value", f"Expected 'test_value', got {state}"
        
        # Verify mod files persisted
        messaging_files = workspace_path / "mods" / "openagents.mods.workspace.messaging" / "test_data.json"
        default_files = workspace_path / "mods" / "openagents.mods.workspace.default" / "test_data.json"
        
        assert messaging_files.exists(), "Messaging mod files not persisted"
        assert default_files.exists(), "Default mod files not persisted"
        
        logger.info("🎉 Workspace persistence test passed!")
        logger.info(f"   📊 {len(events)} events persisted")
        logger.info(f"   👥 {len(agents)} agents persisted") 
        logger.info(f"   ⚙️ Network state persisted")
        logger.info(f"   📂 Mod storage persisted")

if __name__ == "__main__":
    try:
        test_workspace_persistence()
        print("✅ SUCCESS: Workspace persistence works correctly!")
    except Exception as e:
        print(f"❌ FAILED: {e}")
        import traceback
        traceback.print_exc()
        exit(1)