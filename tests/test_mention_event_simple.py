#!/usr/bin/env python3
"""
Simple test for the new channel.message.mentioned event.
"""

import asyncio
import sys
import os
import pytest

# Skip this entire test file - uses deprecated workspace events
pytest.skip("Mention event tests use deprecated workspace events", allow_module_level=True)

# Add the project root to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

async def test_mention_event():
    """Simple test of the mention event functionality."""
    
    print("🧪 Testing channel.message.mentioned Event")
    print("=" * 45)
    
    try:
        from src.openagents.core.events import EventType
        
        # Verify the new event type exists
        assert hasattr(EventType, 'CHANNEL_MESSAGE_MENTIONED'), "CHANNEL_MESSAGE_MENTIONED should exist"
        assert EventType.CHANNEL_MESSAGE_MENTIONED.value == "channel.message.mentioned", "Event value should be correct"
        
        print("✅ Event type verification passed")
        
        # Test that it's in the list of available events
        all_events = [et.value for et in EventType]
        assert "channel.message.mentioned" in all_events, "Mention event should be in available events"
        
        print("✅ Event availability verification passed")
        
        # Test event creation
        from src.openagents.core.events import WorkspaceEvent
        
        mention_event = WorkspaceEvent(
            event_type=EventType.CHANNEL_MESSAGE_MENTIONED,
            source_agent_id="bob",
            target_agent_id="alice",
            channel="#general",
            data={
                "text": "Hey @alice, check this out!",
                "mention_type": "text_mention"
            }
        )
        
        assert mention_event.event_name == "channel.message.mentioned", "Event name should be correct"
        assert mention_event.source_agent_id == "bob", "Source agent should be correct"
        assert mention_event.target_agent_id == "alice", "Target agent should be correct"
        assert mention_event.data["mention_type"] == "text_mention", "Mention type should be correct"
        
        print("✅ Event object creation passed")
        
        print(f"\n📊 Test Results:")
        print(f"   Event name: {mention_event.event_name}")
        print(f"   Source: {mention_event.source_agent_id}")
        print(f"   Target: {mention_event.target_agent_id}")
        print(f"   Channel: {mention_event.channel}")
        print(f"   Mention type: {mention_event.data['mention_type']}")
        
        print(f"\n🎉 All tests passed! Total events available: {len(all_events)}")
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_mention_event())
    sys.exit(0 if success else 1)
