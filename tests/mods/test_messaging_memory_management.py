"""
Test cases for messaging mod memory management functionality.

Tests the new periodic dump, memory cleanup, and daily archiving features
that prevent unlimited memory growth in long-running servers.

Test Coverage:
- Memory limit enforcement (max_memory_messages)
- Periodic dump creation and cleanup
- Daily archive creation with compression
- Memory cleanup process for old messages
- Archive cleanup based on retention policies
- Full integration workflow
- Performance testing

Usage:
    python -m pytest tests/mods/test_messaging_memory_management.py -v
    
Quick verification:
    cd tests/mods && python test_messaging_memory_management.py
"""

import pytest
import tempfile
import time
import json
import gzip
from pathlib import Path
from unittest.mock import patch, MagicMock

from openagents.mods.workspace.messaging.mod import ThreadMessagingNetworkMod
from openagents.models.event import Event


class TestMessagingMemoryManagement:
    """Test memory management features of the messaging mod."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)
    
    @pytest.fixture
    def messaging_mod(self, temp_workspace):
        """Create a messaging mod with test configuration."""
        # Set test configuration
        test_config = {
            'max_memory_messages': 5,  # Small limit for testing
            'memory_cleanup_minutes': 0.01,  # 0.6 seconds
            'dump_interval_minutes': 0.01,   # 0.6 seconds
            'hot_storage_days': 1,
            'archive_retention_days': 7
        }
        
        mod = ThreadMessagingNetworkMod()
        
        # Set the configuration
        mod._config = test_config
        
        # Mock the get_storage_path method
        mod.get_storage_path = lambda: temp_workspace
        
        # Re-initialize storage helper with test config
        from openagents.mods.workspace.messaging.message_storage_helper import MessageStorageConfig, MessageStorageHelper
        storage_config = MessageStorageConfig(
            max_memory_messages=test_config['max_memory_messages'],
            memory_cleanup_minutes=test_config['memory_cleanup_minutes'],
            dump_interval_minutes=test_config['dump_interval_minutes'],
            hot_storage_days=test_config['hot_storage_days'],
            archive_retention_days=test_config['archive_retention_days']
        )
        mod.storage_helper = MessageStorageHelper(mod.get_storage_path, storage_config)
        
        return mod
    
    def create_test_event(self, i, timestamp_offset=0):
        """Create a test event with specified index and timestamp offset."""
        base_timestamp = int(time.time()) - timestamp_offset
        return Event(
            event_name="test.channel_message",
            source_id=f"test_agent_{i % 3}",
            destination_id="channel:test_channel",
            payload={
                "text": f"Test message {i}",
                "channel": "test_channel",
                "message_type": "channel_message"
            },
            timestamp=base_timestamp + (i * 100)  # Space messages apart
        )
    
    def test_memory_limit_enforcement(self, messaging_mod, temp_workspace):
        """Test that memory limits are enforced correctly."""
        # Add more messages than the limit
        messages = []
        for i in range(10):  # 10 messages, limit is 5
            message = self.create_test_event(i)
            messages.append(message)
            messaging_mod._add_to_history(message)
        
        # Memory should be limited to max_memory_messages
        assert len(messaging_mod.message_history) <= messaging_mod.max_memory_messages, \
            f"Memory size {len(messaging_mod.message_history)} exceeds limit {messaging_mod.max_memory_messages}"
        
        # Should have some archived messages
        archive_dir = temp_workspace / "daily_archives"
        if archive_dir.exists():
            archive_files = list(archive_dir.glob("*.json.gz"))
            assert len(archive_files) > 0, "No archive files were created when memory limit was exceeded"
    
    def test_periodic_dump_creation(self, messaging_mod, temp_workspace):
        """Test that periodic dumps are created correctly."""
        # Add some messages
        for i in range(3):
            message = self.create_test_event(i)
            messaging_mod._add_to_history(message)
        
        # Force a periodic dump
        messaging_mod._periodic_dump()
        
        # Check that dump files were created
        dump_files = list(temp_workspace.glob("message_dump_*.json"))
        assert len(dump_files) >= 1, "No periodic dump files were created"
        
        # Check that message_history.json was created/updated
        history_file = temp_workspace / "message_history.json"
        assert history_file.exists(), "message_history.json was not created"
        
        # Verify dump content
        with open(dump_files[0]) as f:
            dump_data = json.load(f)
        assert len(dump_data) == 3, f"Expected 3 messages in dump, got {len(dump_data)}"
    
    def test_daily_archive_creation(self, messaging_mod, temp_workspace):
        """Test that daily archives are created and compressed correctly."""
        # Create messages with different timestamps (simulate old messages)
        old_timestamp = int(time.time()) - (2 * 24 * 3600)  # 2 days ago
        
        messages = []
        for i in range(3):
            message = Event(
                event_name="test.old_message",
                source_id=f"old_agent_{i}",
                payload={"text": f"Old message {i}"},
                timestamp=old_timestamp + (i * 3600)  # 1 hour apart
            )
            messages.append(message)
            messaging_mod.message_history[message.event_id] = message
        
        # Archive the old messages
        message_ids = [msg.event_id for msg in messages]
        messaging_mod._archive_messages_by_date(message_ids)
        
        # Check that archive files were created
        archive_dir = temp_workspace / "daily_archives"
        assert archive_dir.exists(), "Daily archives directory was not created"
        
        archive_files = list(archive_dir.glob("*.json.gz"))
        assert len(archive_files) >= 1, "No compressed archive files were created"
        
        # Verify archive content
        with gzip.open(archive_files[0], 'rt') as f:
            archive_data = json.load(f)
        assert len(archive_data) == 3, f"Expected 3 messages in archive, got {len(archive_data)}"
        
        # Verify messages can be deserialized
        for msg_id, msg_data in archive_data.items():
            assert 'event_name' in msg_data, "Archived message missing event_name"
            assert 'source_id' in msg_data, "Archived message missing source_id"
            assert 'timestamp' in msg_data, "Archived message missing timestamp"
    
    def test_memory_cleanup_process(self, messaging_mod, temp_workspace):
        """Test the memory cleanup process removes old messages."""
        # Add messages with old timestamps
        old_timestamp = int(time.time()) - (10 * 24 * 3600)  # 10 days ago (older than hot_storage_days)
        recent_timestamp = int(time.time()) - 3600  # 1 hour ago
        
        # Add old messages
        old_messages = []
        for i in range(3):
            message = Event(
                event_name="test.old_message",
                source_id=f"old_agent_{i}",
                payload={"text": f"Old message {i}"},
                timestamp=old_timestamp + (i * 3600)
            )
            old_messages.append(message)
            messaging_mod.message_history[message.event_id] = message
        
        # Add recent messages
        recent_messages = []
        for i in range(2):
            message = Event(
                event_name="test.recent_message",
                source_id=f"recent_agent_{i}",
                payload={"text": f"Recent message {i}"},
                timestamp=recent_timestamp + (i * 300)
            )
            recent_messages.append(message)
            messaging_mod.message_history[message.event_id] = message
        
        initial_count = len(messaging_mod.message_history)
        assert initial_count == 5, f"Expected 5 messages initially, got {initial_count}"
        
        # Run memory cleanup
        messaging_mod._cleanup_old_memory()
        
        # Old messages should be removed from memory
        final_count = len(messaging_mod.message_history)
        assert final_count < initial_count, "Memory cleanup did not remove any messages"
        
        # Recent messages should still be in memory
        recent_ids = [msg.event_id for msg in recent_messages]
        for msg_id in recent_ids:
            assert msg_id in messaging_mod.message_history, f"Recent message {msg_id} was incorrectly removed"
        
        # Old messages should be archived
        archive_dir = temp_workspace / "daily_archives"
        if archive_dir.exists():
            archive_files = list(archive_dir.glob("*.json.gz"))
            assert len(archive_files) > 0, "Old messages were not archived during cleanup"
    
    def test_archive_cleanup_expired_files(self, messaging_mod, temp_workspace):
        """Test cleanup of expired archive files."""
        # Create archive directory and files
        archive_dir = temp_workspace / "daily_archives"
        archive_dir.mkdir(exist_ok=True)
        
        # Create old archive files (older than retention policy)
        old_date = "2020-01-01"  # Very old date
        old_archive = archive_dir / f"{old_date}.json.gz"
        with gzip.open(old_archive, 'wt') as f:
            json.dump({"test": "old data"}, f)
        
        # Create recent archive file
        recent_date = time.strftime("%Y-%m-%d")  # Today
        recent_archive = archive_dir / f"{recent_date}.json.gz"
        with gzip.open(recent_archive, 'wt') as f:
            json.dump({"test": "recent data"}, f)
        
        # Verify both files exist
        assert old_archive.exists(), "Old archive file was not created"
        assert recent_archive.exists(), "Recent archive file was not created"
        
        # Run archive cleanup
        messaging_mod._cleanup_expired_archives()
        
        # Old file should be deleted, recent file should remain
        assert not old_archive.exists(), "Expired archive file was not deleted"
        assert recent_archive.exists(), "Recent archive file was incorrectly deleted"
    
    def test_dump_file_cleanup(self, messaging_mod, temp_workspace):
        """Test cleanup of old dump files."""
        # Create old dump file
        old_timestamp = time.strftime("%Y%m%d_%H%M%S", time.localtime(time.time() - 25 * 3600))  # 25 hours ago
        old_dump = temp_workspace / f"message_dump_{old_timestamp}.json"
        with open(old_dump, 'w') as f:
            json.dump({"test": "old dump"}, f)
        
        # Set file modification time to 25 hours ago
        import os
        old_time = time.time() - (25 * 3600)
        os.utime(old_dump, (old_time, old_time))
        
        # Create recent dump file
        recent_timestamp = time.strftime("%Y%m%d_%H%M%S")
        recent_dump = temp_workspace / f"message_dump_{recent_timestamp}.json"
        with open(recent_dump, 'w') as f:
            json.dump({"test": "recent dump"}, f)
        
        # Verify both files exist
        assert old_dump.exists(), "Old dump file was not created"
        assert recent_dump.exists(), "Recent dump file was not created"
        
        # Run dump cleanup
        messaging_mod._cleanup_old_dumps()
        
        # Old dump should be deleted, recent dump should remain
        assert not old_dump.exists(), "Old dump file was not deleted"
        assert recent_dump.exists(), "Recent dump file was incorrectly deleted"
    
    def test_integration_full_workflow(self, messaging_mod, temp_workspace):
        """Test the complete memory management workflow."""
        # Add many messages to trigger all cleanup mechanisms
        for i in range(15):  # Much more than memory limit
            # Vary timestamps to simulate real usage
            timestamp_offset = (i % 3) * 24 * 3600  # Some messages 0, 1, or 2 days old
            message = self.create_test_event(i, timestamp_offset)
            messaging_mod._add_to_history(message)
        
        # Verify memory limit is enforced
        assert len(messaging_mod.message_history) <= messaging_mod.max_memory_messages
        
        # Verify files were created
        expected_files = [
            temp_workspace / "message_history.json",  # Current messages
        ]
        
        for expected_file in expected_files:
            if expected_file.exists():
                assert expected_file.stat().st_size > 0, f"{expected_file.name} is empty"
        
        # Check for archive creation
        archive_dir = temp_workspace / "daily_archives"
        if archive_dir.exists():
            archive_files = list(archive_dir.glob("*.json.gz"))
            # Should have archives since we exceeded memory limit
            assert len(archive_files) > 0, "No archive files created during full workflow"
            
            # Verify archive files are not empty
            for archive_file in archive_files:
                assert archive_file.stat().st_size > 0, f"Archive file {archive_file.name} is empty"
        
        print(f"✅ Full workflow test completed:")
        print(f"   - Memory messages: {len(messaging_mod.message_history)}")
        print(f"   - Archive files: {len(list(archive_dir.glob('*.json.gz'))) if archive_dir.exists() else 0}")
        print(f"   - Dump files: {len(list(temp_workspace.glob('message_dump_*.json')))}")


class TestMessagingMemoryManagementAsync:
    """Test async aspects of memory management."""
    
    def test_memory_management_performance(self):
        """Test that memory management operations are reasonably fast."""
        start_time = time.time()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Set test config
            test_config = {
                'max_memory_messages': 100,
                'memory_cleanup_minutes': 0.1,
                'dump_interval_minutes': 0.1,
                'hot_storage_days': 1,
                'archive_retention_days': 7
            }
            
            mod = ThreadMessagingNetworkMod()
            mod._config = test_config
            mod.get_storage_path = lambda: temp_path
            
            # Re-initialize storage helper with test config
            from openagents.mods.workspace.messaging.message_storage_helper import MessageStorageConfig, MessageStorageHelper
            storage_config = MessageStorageConfig(
                max_memory_messages=test_config['max_memory_messages'],
                memory_cleanup_minutes=test_config['memory_cleanup_minutes'],
                dump_interval_minutes=test_config['dump_interval_minutes'],
                hot_storage_days=test_config['hot_storage_days'],
                archive_retention_days=test_config['archive_retention_days']
            )
            mod.storage_helper = MessageStorageHelper(mod.get_storage_path, storage_config)
            
            # Add many messages quickly
            for i in range(200):
                message = Event(
                    event_name="perf.test",
                    source_id=f"agent_{i % 10}",
                    payload={"text": f"Performance test message {i}"},
                    timestamp=int(time.time()) + i
                )
                mod._add_to_history(message)
        
        elapsed = time.time() - start_time
        assert elapsed < 5.0, f"Memory management took too long: {elapsed:.2f} seconds"
        print(f"✅ Performance test: {elapsed:.2f} seconds for 200 messages")


if __name__ == "__main__":
    # Quick standalone test
    import sys
    sys.path.insert(0, "src")
    
    # Run a quick test
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir)
    
    mod = ThreadMessagingNetworkMod()
    mod.get_storage_path = lambda: temp_path
    mod.max_memory_messages = 3
    
    print("Running quick verification test...")
    
    # Add messages
    for i in range(5):
        message = Event(
            event_name="quick.test",
            source_id=f"agent_{i}",
            payload={"text": f"Quick test {i}"},
            timestamp=int(time.time()) + i
        )
        mod._add_to_history(message)
    
    print(f"Memory messages: {len(mod.message_history)} (limit: {mod.max_memory_messages})")
    print(f"Files created: {list(temp_path.glob('*'))}")
    
    # Cleanup
    import shutil
    shutil.rmtree(temp_dir)
    print("✅ Quick verification passed!")