"""
Test cases for the Forum mod using GRPC client.

This test suite validates the forum functionality including:
- Topic creation, editing, and deletion
- Comment posting with nested threading
- Voting system for topics and comments
- Search and browsing capabilities
"""

import pytest
import asyncio
import logging
import time
from typing import Dict, Any, Optional

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.event import Event
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.mods.workspace.forum import ForumNetworkMod, ForumAgentAdapter

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TestForumMod:
    """Test cases for the Forum mod."""
    
    @pytest.fixture
    async def network_with_forum(self):
        """Create a network with the forum mod."""
        # Create network config with both HTTP and gRPC transports
        from openagents.models.transport import TransportType
        from openagents.models.network_config import TransportConfigItem
        import random
        
        # Use random ports to avoid conflicts - Forum test range: 20000-21999
        http_port = random.randint(20000, 21999)
        grpc_port = http_port + 2000  # gRPC port should be different
        
        config = NetworkConfig(
            name="TestForumNetwork", 
            mode=NetworkMode.CENTRALIZED,
            transports=[
                TransportConfigItem(type=TransportType.HTTP, config={"port": http_port}),
                TransportConfigItem(type=TransportType.GRPC, config={"port": grpc_port})
            ]
        )
        network = AgentNetwork(config, workspace_path=None)
        
        # Add forum mod
        forum_mod = ForumNetworkMod()
        forum_mod.bind_network(network)
        network.mods["forum"] = forum_mod
        
        # Initialize network
        await network.initialize()
        
        yield {"network": network, "http_port": http_port, "grpc_port": grpc_port}
        
        # Cleanup
        await network.shutdown()
    
    @pytest.fixture
    async def forum_agents(self, network_with_forum):
        """Create test agents with forum adapters."""
        network_info = network_with_forum
        network = network_info["network"]
        http_port = network_info["http_port"]
        grpc_port = network_info["grpc_port"]
        
        # Create test agents
        agent1 = AgentClient("test_agent_1")
        agent2 = AgentClient("test_agent_2")
        
        # Add forum adapters
        forum_adapter1 = ForumAgentAdapter()
        forum_adapter2 = ForumAgentAdapter()
        
        agent1.register_mod_adapter(forum_adapter1)
        agent2.register_mod_adapter(forum_adapter2)
        
        # Connect agents to network (use HTTP port for discovery, gRPC for communication)
        await agent1.connect_to_server("localhost", http_port)
        await agent2.connect_to_server("localhost", http_port)
        
        yield {
            'network': network,
            'agent1': agent1,
            'agent2': agent2,
            'forum1': forum_adapter1,
            'forum2': forum_adapter2
        }
        
        # Cleanup
        await agent1.disconnect()
        await agent2.disconnect()
    
    @pytest.mark.asyncio
    async def test_topic_creation(self, forum_agents):
        """Test creating forum topics."""
        agent1 = forum_agents['agent1']
        forum1 = forum_agents['forum1']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Test Topic",
            content="This is a test topic for the forum."
        )
        
        assert topic_id is not None
        assert isinstance(topic_id, str)
        logger.info(f"Created topic: {topic_id}")
        
        # Verify topic exists by retrieving it
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data is not None
        assert topic_data['title'] == "Test Topic"
        assert topic_data['content'] == "This is a test topic for the forum."
        assert topic_data['owner_id'] == "test_agent_1"
        assert topic_data['comment_count'] == 0
        assert topic_data['vote_score'] == 0
    
    @pytest.mark.asyncio
    async def test_topic_editing(self, forum_agents):
        """Test editing forum topics."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Original Title",
            content="Original content."
        )
        assert topic_id is not None
        
        # Edit the topic (by owner)
        success = await forum1.edit_forum_topic(
            topic_id=topic_id,
            title="Updated Title",
            content="Updated content."
        )
        assert success is True
        
        # Verify changes
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data['title'] == "Updated Title"
        assert topic_data['content'] == "Updated content."
        
        # Try to edit by non-owner (should fail)
        success = await forum2.edit_forum_topic(
            topic_id=topic_id,
            title="Unauthorized Edit"
        )
        assert success is False
    
    @pytest.mark.asyncio
    async def test_topic_deletion(self, forum_agents):
        """Test deleting forum topics."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Topic to Delete",
            content="This topic will be deleted."
        )
        assert topic_id is not None
        
        # Try to delete by non-owner (should fail)
        success = await forum2.delete_forum_topic(topic_id)
        assert success is False
        
        # Delete by owner (should succeed)
        success = await forum1.delete_forum_topic(topic_id)
        assert success is True
        
        # Verify topic is gone
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data is None
    
    @pytest.mark.asyncio
    async def test_comment_posting(self, forum_agents):
        """Test posting comments on topics."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Topic for Comments",
            content="This topic will have comments."
        )
        assert topic_id is not None
        
        # Post a comment
        comment_id = await forum2.post_forum_topic_comment(
            topic_id=topic_id,
            content="This is a test comment."
        )
        assert comment_id is not None
        
        # Verify comment exists
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data['comment_count'] == 1
        assert len(topic_data['comments']) == 1
        
        comment = topic_data['comments'][0]
        assert comment['content'] == "This is a test comment."
        assert comment['author_id'] == "test_agent_2"
        assert comment['thread_level'] == 1
        assert comment['parent_comment_id'] is None
    
    @pytest.mark.asyncio
    async def test_comment_threading(self, forum_agents):
        """Test nested comment threading."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Threading Test",
            content="Testing comment threading."
        )
        assert topic_id is not None
        
        # Post root comment
        root_comment_id = await forum1.post_forum_topic_comment(
            topic_id=topic_id,
            content="Root comment"
        )
        assert root_comment_id is not None
        
        # Post reply to root comment
        reply_comment_id = await forum2.post_forum_topic_comment(
            topic_id=topic_id,
            content="Reply to root",
            parent_comment_id=root_comment_id
        )
        assert reply_comment_id is not None
        
        # Verify threading structure
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data['comment_count'] == 2
        
        # Find root comment and verify it has replies
        root_comment = None
        for comment in topic_data['comments']:
            if comment['comment_id'] == root_comment_id:
                root_comment = comment
                break
        
        assert root_comment is not None
        assert len(root_comment['replies']) == 1
        
        reply_comment = root_comment['replies'][0]
        assert reply_comment['content'] == "Reply to root"
        assert reply_comment['parent_comment_id'] == root_comment_id
        assert reply_comment['thread_level'] == 2
    
    @pytest.mark.asyncio
    async def test_voting_system(self, forum_agents):
        """Test voting on topics and comments."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Voting Test Topic",
            content="Test voting on this topic."
        )
        assert topic_id is not None
        
        # Vote on topic
        success = await forum2.vote_on_forum_topic(topic_id, "upvote")
        assert success is True
        
        # Verify vote
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data['upvotes'] == 1
        assert topic_data['downvotes'] == 0
        assert topic_data['vote_score'] == 1
        
        # Post a comment
        comment_id = await forum1.post_forum_topic_comment(
            topic_id=topic_id,
            content="Comment to vote on"
        )
        assert comment_id is not None
        
        # Vote on comment
        success = await forum2.vote_on_forum_comment(comment_id, "downvote")
        assert success is True
        
        # Verify comment vote
        topic_data = await forum1.get_forum_topic(topic_id)
        comment = topic_data['comments'][0]
        assert comment['upvotes'] == 0
        assert comment['downvotes'] == 1
        assert comment['vote_score'] == -1
    
    @pytest.mark.asyncio
    async def test_topic_listing(self, forum_agents):
        """Test listing forum topics."""
        agent1 = forum_agents['agent1']
        agent2 = forum_agents['agent2']
        forum1 = forum_agents['forum1']
        forum2 = forum_agents['forum2']
        
        # Create multiple topics
        topic_ids = []
        for i in range(3):
            topic_id = await forum1.create_forum_topic(
                title=f"Topic {i+1}",
                content=f"Content for topic {i+1}"
            )
            assert topic_id is not None
            topic_ids.append(topic_id)
            
            # Small delay to ensure different timestamps
            await asyncio.sleep(0.1)
        
        # List topics
        topics_data = await forum2.list_forum_topics(limit=10, offset=0, sort_by="recent")
        assert topics_data is not None
        assert len(topics_data['topics']) == 3
        assert topics_data['total_count'] == 3
        assert topics_data['has_more'] is False
        
        # Verify topics are sorted by recency (newest first)
        topics = topics_data['topics']
        assert topics[0]['title'] == "Topic 3"
        assert topics[1]['title'] == "Topic 2"
        assert topics[2]['title'] == "Topic 1"
        
        # Test pagination
        topics_data = await forum2.list_forum_topics(limit=2, offset=0)
        assert len(topics_data['topics']) == 2
        assert topics_data['has_more'] is True
        
        topics_data = await forum2.list_forum_topics(limit=2, offset=2)
        assert len(topics_data['topics']) == 1
        assert topics_data['has_more'] is False
    
    @pytest.mark.asyncio
    async def test_topic_search(self, forum_agents):
        """Test searching forum topics."""
        import asyncio
        
        agent1 = forum_agents['agent1']
        forum1 = forum_agents['forum1']
        
        # Create topics with different content and store their IDs
        topic_ids = []
        
        topic_id1 = await forum1.create_forum_topic(
            title="Python Programming",
            content="Discussion about Python programming language"
        )
        assert topic_id1 is not None, "Failed to create first topic"
        topic_ids.append(topic_id1)
        
        topic_id2 = await forum1.create_forum_topic(
            title="JavaScript Frameworks",
            content="Comparing different JavaScript frameworks"
        )
        assert topic_id2 is not None, "Failed to create second topic"
        topic_ids.append(topic_id2)
        
        topic_id3 = await forum1.create_forum_topic(
            title="Machine Learning with Python",
            content="Using Python for machine learning projects"
        )
        assert topic_id3 is not None, "Failed to create third topic"
        topic_ids.append(topic_id3)
        
        # Wait for all topics to be properly indexed and events processed
        await asyncio.sleep(0.1)
        
        # Verify all topics exist before searching
        for topic_id in topic_ids:
            topic_data = await forum1.get_forum_topic(topic_id)
            assert topic_data is not None, f"Topic {topic_id} not found after creation"
        
        # Search for Python topics
        search_results = await forum1.search_forum_topics("Python")
        assert search_results is not None
        assert len(search_results['topics']) == 2
        assert search_results['total_count'] == 2
        
        # Verify search results contain Python topics
        titles = [topic['title'] for topic in search_results['topics']]
        assert "Python Programming" in titles
        assert "Machine Learning with Python" in titles
        assert "JavaScript Frameworks" not in titles
        
        # Search for non-existent term
        search_results = await forum1.search_forum_topics("NonExistent")
        assert search_results is not None
        assert len(search_results['topics']) == 0
        assert search_results['total_count'] == 0
    
    @pytest.mark.asyncio
    async def test_error_handling(self, forum_agents):
        """Test error handling in forum operations."""
        agent1 = forum_agents['agent1']
        forum1 = forum_agents['forum1']
        
        # Test creating topic with empty title
        topic_id = await forum1.create_forum_topic("", "Content")
        assert topic_id is None
        
        # Test creating topic with empty content
        topic_id = await forum1.create_forum_topic("Title", "")
        assert topic_id is None
        
        # Test editing non-existent topic
        success = await forum1.edit_forum_topic("non_existent_id", title="New Title")
        assert success is False
        
        # Test deleting non-existent topic
        success = await forum1.delete_forum_topic("non_existent_id")
        assert success is False
        
        # Test commenting on non-existent topic
        comment_id = await forum1.post_forum_topic_comment("non_existent_id", "Comment")
        assert comment_id is None
        
        # Test voting on non-existent topic
        success = await forum1.vote_on_forum_topic("non_existent_id", "upvote")
        assert success is False
        
        # Test getting non-existent topic
        topic_data = await forum1.get_forum_topic("non_existent_id")
        assert topic_data is None
    
    @pytest.mark.asyncio
    async def test_thread_depth_limit(self, forum_agents):
        """Test maximum thread depth limit (5 levels)."""
        agent1 = forum_agents['agent1']
        forum1 = forum_agents['forum1']
        
        # Create a topic
        topic_id = await forum1.create_forum_topic(
            title="Deep Threading Test",
            content="Testing maximum thread depth."
        )
        assert topic_id is not None
        
        # Create nested comments up to the limit
        parent_id = None
        comment_ids = []
        
        for level in range(5):  # Levels 1-5
            comment_id = await forum1.post_forum_topic_comment(
                topic_id=topic_id,
                content=f"Comment at level {level + 1}",
                parent_comment_id=parent_id
            )
            assert comment_id is not None
            comment_ids.append(comment_id)
            parent_id = comment_id
        
        # Try to create a 6th level comment (should fail)
        comment_id = await forum1.post_forum_topic_comment(
            topic_id=topic_id,
            content="This should fail - level 6",
            parent_comment_id=parent_id
        )
        assert comment_id is None  # Should fail due to depth limit
        
        # Verify the topic has exactly 5 comments
        topic_data = await forum1.get_forum_topic(topic_id)
        assert topic_data['comment_count'] == 5

if __name__ == "__main__":
    # Run a simple test
    async def run_basic_test():
        """Run a basic test to verify the forum mod works."""
        logger.info("Starting basic forum mod test...")
        
        # Create network with forum mod
        from openagents.models.transport import TransportType
        from openagents.models.network_config import TransportConfigItem
        config = NetworkConfig(
            name="TestForumNetwork", 
            mode=NetworkMode.CENTRALIZED,
            transports=[TransportConfigItem(type=TransportType.HTTP, config={"port": 8702})]
        )
        network = AgentNetwork(config, workspace_path=None)
        forum_mod = ForumNetworkMod()
        forum_mod.bind_network(network)
        network.mods["forum"] = forum_mod
        await network.initialize()
        
        # Create test agent
        agent = AgentClient("test_agent")
        forum_adapter = ForumAgentAdapter()
        agent.register_mod_adapter(forum_adapter)
        await agent.connect_to_server("localhost", 8702)
        
        try:
            # Test topic creation
            logger.info("Testing topic creation...")
            topic_id = await forum_adapter.create_forum_topic(
                title="Test Topic",
                content="This is a test topic."
            )
            logger.info(f"Created topic: {topic_id}")
            
            # Test topic retrieval
            logger.info("Testing topic retrieval...")
            topic_data = await forum_adapter.get_forum_topic(topic_id)
            logger.info(f"Retrieved topic: {topic_data['title']}")
            
            # Test comment posting
            logger.info("Testing comment posting...")
            comment_id = await forum_adapter.post_forum_topic_comment(
                topic_id=topic_id,
                content="This is a test comment."
            )
            logger.info(f"Posted comment: {comment_id}")
            
            # Test voting
            logger.info("Testing voting...")
            success = await forum_adapter.vote_on_forum_topic(topic_id, "upvote")
            logger.info(f"Vote cast: {success}")
            
            # Test topic listing
            logger.info("Testing topic listing...")
            topics_data = await forum_adapter.list_forum_topics()
            logger.info(f"Listed {len(topics_data['topics'])} topics")
            
            logger.info("Basic forum mod test completed successfully!")
            
        except Exception as e:
            logger.error(f"Test failed: {e}")
            raise
        finally:
            # Cleanup
            await agent.disconnect()
            await network.shutdown()
    
    # Run the basic test
    asyncio.run(run_basic_test())
