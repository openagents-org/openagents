#!/usr/bin/env python3
"""
Comprehensive HTTP API test suite for the Forum mod.

This test suite covers all forum functionality using HTTP API endpoints:
1. Topic creation, editing, and deletion
2. Comment posting and nested threading (up to 5 levels)
3. Voting system for topics and comments
4. Search and browsing capabilities
5. Query operations (list, search, get specific topics)
6. Error handling and ownership restrictions

Usage:
    # Run all tests
    pytest tests/studio/test_forum_mod_with_http_api.py -v
    
    # Run specific test methods
    pytest tests/studio/test_forum_mod_with_http_api.py::TestForumFlow::test_topic_management_flow -v
    pytest tests/studio/test_forum_mod_with_http_api.py::TestForumFlow::test_comment_threading_flow -v
    
    # Run as standalone script
    python tests/studio/test_forum_mod_with_http_api.py
"""

import pytest
import aiohttp
import time
import json
import random
import string
import logging
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional

from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config

# Configure logging to file
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/tmp/test_forum_mod_with_http_api.log'),
        logging.StreamHandler()  # Also print to console
    ]
)
logger = logging.getLogger(__name__)


class ForumHTTPClient:
    """HTTP client for testing the OpenAgents Forum mod API."""
    
    def __init__(self, base_url: str, agent_id: str):
        self.base_url = base_url.rstrip('/')
        self.agent_id = agent_id
        self.session = None
        self.registered = False
        
    async def __aenter__(self):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
            self.session = None
            
    async def ensure_session(self):
        """Ensure session is created if not already created."""
        if self.session is None:
            self.session = aiohttp.ClientSession()
            
    async def close(self):
        """Close the session."""
        if self.session:
            await self.session.close()
            self.session = None
        
    async def register(self) -> bool:
        """Register the agent with the network."""
        await self.ensure_session()
        url = f"{self.base_url}/api/register"
        payload = {
            "agent_id": self.agent_id,
            "metadata": {
                "display_name": self.agent_id,
                "user_agent": "Python Forum Test Client",
                "platform": "test"
            }
        }
        
        # Retry logic for registration
        for attempt in range(3):
            try:
                logger.info(f"📤 {self.agent_id}: POST {url} (attempt {attempt + 1})")
                logger.info(f"📋 Request payload: {json.dumps(payload, indent=2)}")
                
                # Add a small delay between attempts
                if attempt > 0:
                    await asyncio.sleep(5)
                
                async with self.session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as response:
                    logger.info(f"📥 Response status: {response.status}")
                    logger.info(f"📋 Response headers: {dict(response.headers)}")
                    
                    response.raise_for_status()
                    result = await response.json()
                    
                    logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                    
                    if result.get("success", False):
                        self.registered = True
                        print(f"✅ {self.agent_id}: Registered successfully on attempt {attempt + 1}")
                        return True
                    else:
                        print(f"❌ {self.agent_id}: Registration failed on attempt {attempt + 1} - {result.get('message', 'Unknown error')}")
                        if attempt == 2:  # Last attempt
                            return False
                    
            except Exception as e:
                logger.error(f"❌ {self.agent_id}: Registration error on attempt {attempt + 1} - {e}")
                print(f"❌ {self.agent_id}: Registration error on attempt {attempt + 1} - {e}")
                if attempt == 2:  # Last attempt
                    return False
        
        return False
    
    async def unregister(self) -> bool:
        """Unregister the agent from the network."""
        try:
            self.registered = False
            print(f"✅ {self.agent_id}: Marked as unregistered (cleanup)")
            return True
        except Exception as e:
            print(f"❌ {self.agent_id}: Unregistration error - {e}")
            return False
    
    def generate_event_id(self) -> str:
        """Generate a unique event ID."""
        timestamp = int(time.time() * 1000)
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))
        return f"{self.agent_id}_{timestamp}_{random_suffix}"
    
    async def send_event(self, event_name: str, payload: Dict[str, Any], 
                   target_agent_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Send an event to the network."""
        await self.ensure_session()
        url = f"{self.base_url}/api/send_event"
        
        event_payload = {
            "event_id": self.generate_event_id(),
            "event_name": event_name,
            "source_id": self.agent_id,
            "payload": payload,
            "metadata": {},
            "visibility": "network"
        }
        
        if target_agent_id:
            event_payload["target_agent_id"] = target_agent_id
            
        try:
            logger.info(f"📤 {self.agent_id}: POST {url}")
            logger.info(f"📋 Request payload: {json.dumps(event_payload, indent=2)}")
            
            async with self.session.post(url, json=event_payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
                logger.info(f"📥 Response status: {response.status}")
                logger.info(f"📋 Response headers: {dict(response.headers)}")
                
                response.raise_for_status()
                result = await response.json()
                
                logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                
                if result.get("success", False):
                    print(f"✅ {self.agent_id}: Sent {event_name} successfully")
                    return result
                else:
                    print(f"❌ {self.agent_id}: Failed to send {event_name} - {result.get('message', 'Unknown error')}")
                    return None
                
        except Exception as e:
            logger.error(f"❌ {self.agent_id}: Error sending {event_name} - {e}")
            print(f"❌ {self.agent_id}: Error sending {event_name} - {e}")
            return None
    
    # === Forum Topic Operations ===
    
    async def create_forum_topic(self, title: str, content: str) -> Optional[Dict[str, Any]]:
        """Create a new forum topic."""
        payload = {
            "action": "create",
            "title": title,
            "content": content
        }
        return await self.send_event("forum.topic.create", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def edit_forum_topic(self, topic_id: str, title: str = None, content: str = None) -> Optional[Dict[str, Any]]:
        """Edit an existing forum topic."""
        payload = {
            "action": "edit",
            "topic_id": topic_id
        }
        if title:
            payload["title"] = title
        if content:
            payload["content"] = content
        return await self.send_event("forum.topic.edit", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def delete_forum_topic(self, topic_id: str) -> Optional[Dict[str, Any]]:
        """Delete a forum topic."""
        payload = {
            "action": "delete",
            "topic_id": topic_id
        }
        return await self.send_event("forum.topic.delete", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    # === Forum Comment Operations ===
    
    async def post_forum_comment(self, topic_id: str, content: str, parent_comment_id: str = None) -> Optional[Dict[str, Any]]:
        """Post a comment on a topic or reply to a comment."""
        payload = {
            "action": "reply" if parent_comment_id else "post",
            "topic_id": topic_id,
            "content": content
        }
        if parent_comment_id:
            payload["parent_comment_id"] = parent_comment_id
        
        event_name = "forum.comment.reply" if parent_comment_id else "forum.comment.post"
        return await self.send_event(event_name, payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def edit_forum_comment(self, topic_id: str, comment_id: str, content: str) -> Optional[Dict[str, Any]]:
        """Edit an existing comment."""
        payload = {
            "action": "edit",
            "topic_id": topic_id,
            "comment_id": comment_id,
            "content": content
        }
        return await self.send_event("forum.comment.edit", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def delete_forum_comment(self, topic_id: str, comment_id: str) -> Optional[Dict[str, Any]]:
        """Delete a comment."""
        payload = {
            "action": "delete",
            "topic_id": topic_id,
            "comment_id": comment_id
        }
        return await self.send_event("forum.comment.delete", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    # === Forum Voting Operations ===
    
    async def vote_on_topic(self, topic_id: str, vote_type: str) -> Optional[Dict[str, Any]]:
        """Vote on a forum topic."""
        payload = {
            "action": "cast",
            "target_type": "topic",
            "target_id": topic_id,
            "vote_type": vote_type
        }
        return await self.send_event("forum.vote.cast", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def vote_on_comment(self, comment_id: str, vote_type: str) -> Optional[Dict[str, Any]]:
        """Vote on a forum comment."""
        payload = {
            "action": "cast",
            "target_type": "comment",
            "target_id": comment_id,
            "vote_type": vote_type
        }
        return await self.send_event("forum.vote.cast", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def remove_vote(self, target_type: str, target_id: str) -> Optional[Dict[str, Any]]:
        """Remove a vote from topic or comment."""
        payload = {
            "action": "remove",
            "target_type": target_type,
            "target_id": target_id
        }
        return await self.send_event("forum.vote.remove", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    # === Forum Query Operations ===
    
    async def list_forum_topics(self, limit: int = 50, offset: int = 0, sort_by: str = "recent") -> Optional[Dict[str, Any]]:
        """List topics in the forum."""
        payload = {
            "query_type": "list_topics",
            "limit": limit,
            "offset": offset,
            "sort_by": sort_by
        }
        return await self.send_event("forum.topics.list", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def search_forum_topics(self, query: str, limit: int = 50, offset: int = 0) -> Optional[Dict[str, Any]]:
        """Search topics by keywords."""
        payload = {
            "query_type": "search_topics",
            "query": query,
            "limit": limit,
            "offset": offset
        }
        return await self.send_event("forum.topics.search", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def get_forum_topic(self, topic_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific topic with all its comments."""
        payload = {
            "query_type": "get_topic",
            "topic_id": topic_id
        }
        return await self.send_event("forum.topic.get", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def get_popular_topics(self, limit: int = 50, offset: int = 0) -> Optional[Dict[str, Any]]:
        """Get popular topics."""
        payload = {
            "query_type": "popular_topics",
            "limit": limit,
            "offset": offset
        }
        return await self.send_event("forum.popular.topics", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def get_recent_topics(self, limit: int = 50, offset: int = 0) -> Optional[Dict[str, Any]]:
        """Get recent topics."""
        payload = {
            "query_type": "recent_topics",
            "limit": limit,
            "offset": offset
        }
        return await self.send_event("forum.recent.topics", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def get_user_topics(self, agent_id: str = None, limit: int = 50, offset: int = 0) -> Optional[Dict[str, Any]]:
        """Get topics created by a specific user."""
        payload = {
            "query_type": "user_topics",
            "limit": limit,
            "offset": offset
        }
        if agent_id:
            payload["agent_id"] = agent_id
        return await self.send_event("forum.user.topics", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    async def get_user_comments(self, agent_id: str = None, limit: int = 50, offset: int = 0) -> Optional[Dict[str, Any]]:
        """Get comments made by a specific user."""
        payload = {
            "query_type": "user_comments",
            "limit": limit,
            "offset": offset
        }
        if agent_id:
            payload["agent_id"] = agent_id
        return await self.send_event("forum.user.comments", payload, target_agent_id="mod:openagents.mods.workspace.forum")
    
    # === Polling for Notifications ===
    
    async def poll_messages(self) -> List[Dict[str, Any]]:
        """Poll for new messages/notifications."""
        await self.ensure_session()
        url = f"{self.base_url}/api/poll"
        params = {"agent_id": self.agent_id}
        
        try:
            logger.info(f"📤 {self.agent_id}: GET {url}")
            logger.info(f"📋 Request params: {params}")
            
            async with self.session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as response:
                logger.info(f"📥 Response status: {response.status}")
                logger.info(f"📋 Response headers: {dict(response.headers)}")
                
                response.raise_for_status()
                result = await response.json()
                
                logger.info(f"📋 Response body: {json.dumps(result, indent=2)}")
                
                if result.get("success", False) and "messages" in result:
                    messages = result["messages"]
                    if messages:
                        print(f"📨 {self.agent_id}: Received {len(messages)} message(s) via polling")
                        logger.info(f"📨 {self.agent_id}: Received {len(messages)} message(s) via polling")
                    return messages
                
                return []
            
        except Exception as e:
            logger.error(f"❌ {self.agent_id}: Polling error - {e}")
            print(f"❌ {self.agent_id}: Polling error - {e}")
            return []


@pytest.fixture(scope="function")
async def test_network():
    """Create and start a network with forum mod using workspace config."""
    # Use the existing workspace test config that includes the forum mod
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the HTTP transport port to use random port
    http_port = random.randint(25000, 26000)
    grpc_port = http_port + 100  # Ensure different ports
    
    for transport in config.network.transports:
        if transport.type == "http":
            transport.config["port"] = http_port
        elif transport.type == "grpc":
            transport.config["port"] = grpc_port
    
    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()
    
    # Give network time to start up and mods to initialize
    await asyncio.sleep(5.0)
    
    yield network, http_port
    
    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def base_url(test_network):
    """Base URL for the OpenAgents HTTP API."""
    network, http_port = test_network
    return f"http://localhost:{http_port}"


@pytest.fixture
async def client_a(base_url):
    """Client A for testing."""
    client = ForumHTTPClient(base_url, "ForumClientA_Test")
    try:
        yield client
    finally:
        if client.registered:
            await client.unregister()
        await client.close()


@pytest.fixture
async def client_b(base_url):
    """Client B for testing."""
    client = ForumHTTPClient(base_url, "ForumClientB_Test")
    try:
        yield client
    finally:
        if client.registered:
            await client.unregister()
        await client.close()


class TestForumFlow:
    """Test comprehensive forum flow scenarios."""
    
    @pytest.mark.asyncio
    async def test_topic_management_flow(self, client_a, client_b):
        """
        Test: Complete topic lifecycle - create, edit, delete, and access controls
        """
        print("\n🧪 Test: Topic Management Flow")
        print("-" * 40)
        
        # Add extra delay to ensure network is fully ready
        await asyncio.sleep(5)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # === Topic Creation ===
        test_title = f"Test Topic {int(time.time())}"
        test_content = f"This is a test topic created at {int(time.time())} for testing purposes."
        
        topic_result = await client_a.create_forum_topic(test_title, test_content)
        assert topic_result is not None, "Topic creation should succeed"
        assert topic_result.get("success") == True, "Topic creation response should indicate success"
        
        topic_id = topic_result.get("data", {}).get("topic_id")
        assert topic_id is not None, "Topic creation should return topic_id"
        print(f"✅ Topic created with ID: {topic_id}")
        print(f"   Title: {test_title}")
        print(f"   Content: {test_content}")
        
        await asyncio.sleep(1)
        
        # === Topic Retrieval ===
        retrieved_topic = await client_b.get_forum_topic(topic_id)
        assert retrieved_topic is not None, "Topic retrieval should succeed"
        assert retrieved_topic.get("success") == True, "Topic retrieval should be successful"
        
        topic_data = retrieved_topic.get("data", {})
        assert topic_data.get("title") == test_title, "Retrieved topic should have correct title"
        assert topic_data.get("content") == test_content, "Retrieved topic should have correct content"
        assert topic_data.get("owner_id") == "ForumClientA_Test", "Topic should have correct owner"
        assert topic_data.get("comment_count") == 0, "New topic should have 0 comments"
        assert topic_data.get("vote_score") == 0, "New topic should have 0 vote score"
        print(f"✅ Topic retrieved successfully by Client B")
        
        # === Topic Editing (by owner) ===
        updated_title = f"Updated {test_title}"
        updated_content = f"Updated content: {test_content}"
        
        edit_result = await client_a.edit_forum_topic(topic_id, title=updated_title, content=updated_content)
        assert edit_result is not None, "Topic editing should succeed"
        assert edit_result.get("success") == True, "Topic editing should be successful"
        print(f"✅ Topic edited by owner (Client A)")
        
        # Verify changes
        updated_topic = await client_b.get_forum_topic(topic_id)
        topic_data = updated_topic.get("data", {})
        assert topic_data.get("title") == updated_title, "Topic should have updated title"
        assert topic_data.get("content") == updated_content, "Topic should have updated content"
        print(f"✅ Topic changes verified")
        
        # === Topic Editing (unauthorized - should fail) ===
        unauthorized_edit = await client_b.edit_forum_topic(topic_id, title="Unauthorized Edit")
        assert unauthorized_edit is None or unauthorized_edit.get("success") == False, "Unauthorized edit should fail"
        print(f"✅ Unauthorized edit correctly rejected")
        
        # === Topic Deletion (unauthorized - should fail) ===
        unauthorized_delete = await client_b.delete_forum_topic(topic_id)
        assert unauthorized_delete is None or unauthorized_delete.get("success") == False, "Unauthorized deletion should fail"
        print(f"✅ Unauthorized deletion correctly rejected")
        
        # === Topic Deletion (by owner) ===
        delete_result = await client_a.delete_forum_topic(topic_id)
        assert delete_result is not None, "Topic deletion should succeed"
        assert delete_result.get("success") == True, "Topic deletion should be successful"
        print(f"✅ Topic deleted by owner (Client A)")
        
        # Verify topic is gone
        deleted_topic = await client_b.get_forum_topic(topic_id)
        assert deleted_topic is None or deleted_topic.get("success") == False, "Deleted topic should not be accessible"
        print(f"✅ Topic deletion verified")
    
    @pytest.mark.asyncio
    async def test_comment_threading_flow(self, client_a, client_b):
        """
        Test: Comment posting and nested threading up to 5 levels
        """
        print("\n🧪 Test: Comment Threading Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Create a topic for commenting
        topic_title = f"Comment Threading Topic {int(time.time())}"
        topic_content = "This topic is for testing comment threading."
        
        topic_result = await client_a.create_forum_topic(topic_title, topic_content)
        topic_id = topic_result.get("data", {}).get("topic_id")
        assert topic_id is not None, "Topic creation should succeed"
        print(f"✅ Topic created for threading test: {topic_id}")
        
        # === Level 1: Root Comment ===
        root_comment_text = f"Root comment posted at {int(time.time())}"
        root_comment_result = await client_b.post_forum_comment(topic_id, root_comment_text)
        assert root_comment_result is not None, "Root comment posting should succeed"
        
        root_comment_id = root_comment_result.get("data", {}).get("comment_id")
        assert root_comment_id is not None, "Root comment should return comment_id"
        print(f"✅ Level 1 (Root) comment posted: {root_comment_id}")
        
        # === Level 2: Reply to Root ===
        level2_comment_text = f"Level 2 reply at {int(time.time())}"
        level2_result = await client_a.post_forum_comment(topic_id, level2_comment_text, root_comment_id)
        assert level2_result is not None, "Level 2 comment should succeed"
        
        level2_comment_id = level2_result.get("data", {}).get("comment_id")
        print(f"✅ Level 2 comment posted: {level2_comment_id}")
        
        # === Level 3: Reply to Level 2 ===
        level3_comment_text = f"Level 3 reply at {int(time.time())}"
        level3_result = await client_b.post_forum_comment(topic_id, level3_comment_text, level2_comment_id)
        assert level3_result is not None, "Level 3 comment should succeed"
        
        level3_comment_id = level3_result.get("data", {}).get("comment_id")
        print(f"✅ Level 3 comment posted: {level3_comment_id}")
        
        # === Level 4: Reply to Level 3 ===
        level4_comment_text = f"Level 4 reply at {int(time.time())}"
        level4_result = await client_a.post_forum_comment(topic_id, level4_comment_text, level3_comment_id)
        assert level4_result is not None, "Level 4 comment should succeed"
        
        level4_comment_id = level4_result.get("data", {}).get("comment_id")
        print(f"✅ Level 4 comment posted: {level4_comment_id}")
        
        # === Level 5: Reply to Level 4 (Maximum depth) ===
        level5_comment_text = f"Level 5 reply at {int(time.time())}"
        level5_result = await client_b.post_forum_comment(topic_id, level5_comment_text, level4_comment_id)
        assert level5_result is not None, "Level 5 comment should succeed"
        
        level5_comment_id = level5_result.get("data", {}).get("comment_id")
        print(f"✅ Level 5 comment posted (max depth): {level5_comment_id}")
        
        # === Level 6: Should fail (exceeds max depth) ===
        level6_comment_text = f"Level 6 reply (should fail) at {int(time.time())}"
        level6_result = await client_a.post_forum_comment(topic_id, level6_comment_text, level5_comment_id)
        assert level6_result is None or level6_result.get("success") == False, "Level 6 comment should fail (max depth exceeded)"
        print(f"✅ Level 6 comment correctly rejected (max depth protection)")
        
        # === Verify Comment Structure ===
        topic_with_comments = await client_a.get_forum_topic(topic_id)
        topic_data = topic_with_comments.get("data", {})
        assert topic_data.get("comment_count") == 5, "Topic should have exactly 5 comments"
        
        comments = topic_data.get("comments", [])
        assert len(comments) > 0, "Topic should have comment structure"
        print(f"✅ Comment threading structure verified (5 levels)")
        
        # === Comment Editing ===
        edited_content = f"Edited: {root_comment_text}"
        edit_comment_result = await client_b.edit_forum_comment(topic_id, root_comment_id, edited_content)
        assert edit_comment_result is not None, "Comment editing should succeed"
        assert edit_comment_result.get("success") == True, "Comment editing should be successful"
        print(f"✅ Comment edited by author")
        
        # === Unauthorized Comment Edit (should fail) ===
        unauthorized_edit = await client_a.edit_forum_comment(topic_id, root_comment_id, "Unauthorized edit")
        assert unauthorized_edit is None or unauthorized_edit.get("success") == False, "Unauthorized comment edit should fail"
        print(f"✅ Unauthorized comment edit correctly rejected")
        
        # === Comment Deletion ===
        delete_comment_result = await client_b.delete_forum_comment(topic_id, root_comment_id)
        assert delete_comment_result is not None, "Comment deletion should succeed"
        assert delete_comment_result.get("success") == True, "Comment deletion should be successful"
        print(f"✅ Comment and its replies deleted by author")
        
        # Verify deletion affected the tree
        updated_topic = await client_a.get_forum_topic(topic_id)
        updated_data = updated_topic.get("data", {})
        # Deleting root comment should delete entire tree
        assert updated_data.get("comment_count") == 0, "All comments should be deleted with root"
        print(f"✅ Comment tree deletion verified")
    
    @pytest.mark.asyncio
    async def test_voting_system_flow(self, client_a, client_b):
        """
        Test: Voting system for topics and comments
        """
        print("\n🧪 Test: Voting System Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Create a topic for voting
        topic_title = f"Voting Test Topic {int(time.time())}"
        topic_content = "This topic is for testing the voting system."
        
        topic_result = await client_a.create_forum_topic(topic_title, topic_content)
        topic_id = topic_result.get("data", {}).get("topic_id")
        print(f"✅ Topic created for voting test: {topic_id}")
        
        # === Topic Voting ===
        # Client B upvotes the topic
        upvote_result = await client_b.vote_on_topic(topic_id, "upvote")
        assert upvote_result is not None, "Topic upvoting should succeed"
        assert upvote_result.get("success") == True, "Topic upvoting should be successful"
        
        vote_data = upvote_result.get("data", {})
        assert vote_data.get("upvotes") == 1, "Topic should have 1 upvote"
        assert vote_data.get("downvotes") == 0, "Topic should have 0 downvotes"
        assert vote_data.get("vote_score") == 1, "Topic should have vote score of 1"
        print(f"✅ Topic upvoted by Client B (score: {vote_data.get('vote_score')})")
        
        # Client B tries to upvote again (should fail)
        duplicate_vote = await client_b.vote_on_topic(topic_id, "upvote")
        assert duplicate_vote is None or duplicate_vote.get("success") == False, "Duplicate vote should fail"
        print(f"✅ Duplicate vote correctly rejected")
        
        # Client B changes vote to downvote
        downvote_result = await client_b.vote_on_topic(topic_id, "downvote")
        assert downvote_result is not None, "Vote change should succeed"
        
        vote_data = downvote_result.get("data", {})
        assert vote_data.get("upvotes") == 0, "Topic should have 0 upvotes after change"
        assert vote_data.get("downvotes") == 1, "Topic should have 1 downvote after change"
        assert vote_data.get("vote_score") == -1, "Topic should have vote score of -1"
        print(f"✅ Vote changed to downvote (score: {vote_data.get('vote_score')})")
        
        # === Comment Voting ===
        # Add a comment to vote on
        comment_text = f"Comment for voting test at {int(time.time())}"
        comment_result = await client_a.post_forum_comment(topic_id, comment_text)
        comment_id = comment_result.get("data", {}).get("comment_id")
        print(f"✅ Comment posted for voting test: {comment_id}")
        
        # Client B upvotes the comment
        comment_vote_result = await client_b.vote_on_comment(comment_id, "upvote")
        assert comment_vote_result is not None, "Comment voting should succeed"
        assert comment_vote_result.get("success") == True, "Comment voting should be successful"
        
        comment_vote_data = comment_vote_result.get("data", {})
        assert comment_vote_data.get("upvotes") == 1, "Comment should have 1 upvote"
        assert comment_vote_data.get("vote_score") == 1, "Comment should have vote score of 1"
        print(f"✅ Comment upvoted by Client B (score: {comment_vote_data.get('vote_score')})")
        
        # === Vote Removal ===
        # Remove vote from topic
        remove_topic_vote = await client_b.remove_vote("topic", topic_id)
        assert remove_topic_vote is not None, "Topic vote removal should succeed"
        assert remove_topic_vote.get("success") == True, "Topic vote removal should be successful"
        
        remove_data = remove_topic_vote.get("data", {})
        assert remove_data.get("vote_score") == 0, "Topic score should be 0 after vote removal"
        print(f"✅ Topic vote removed (score: {remove_data.get('vote_score')})")
        
        # Remove vote from comment
        remove_comment_vote = await client_b.remove_vote("comment", comment_id)
        assert remove_comment_vote is not None, "Comment vote removal should succeed"
        print(f"✅ Comment vote removed")
        
        # === Multiple Voters ===
        # Client A votes on its own topic (should work)
        self_vote_result = await client_a.vote_on_topic(topic_id, "upvote")
        assert self_vote_result is not None, "Self-voting should be allowed"
        print(f"✅ Self-voting allowed")
        
        # Both clients vote on the comment
        await client_a.vote_on_comment(comment_id, "upvote")
        await client_b.vote_on_comment(comment_id, "downvote")
        
        # Verify final state
        final_topic = await client_a.get_forum_topic(topic_id)
        topic_data = final_topic.get("data", {})
        print(f"✅ Final topic vote score: {topic_data.get('vote_score')}")
        
        comments = topic_data.get("comments", [])
        if comments:
            comment_score = comments[0].get("vote_score", 0)
            print(f"✅ Final comment vote score: {comment_score}")
    
    @pytest.mark.asyncio
    async def test_search_and_browsing_flow(self, client_a, client_b):
        """
        Test: Topic search and browsing capabilities
        """
        print("\n🧪 Test: Search and Browsing Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # Create multiple topics with different content
        topics = [
            ("Python Programming Discussion", "Let's discuss Python programming techniques and best practices."),
            ("JavaScript Framework Comparison", "Comparing React, Vue, and Angular frameworks for web development."),
            ("Machine Learning with Python", "Using Python libraries like TensorFlow and PyTorch for ML projects."),
            ("Database Design Principles", "Fundamentals of relational database design and normalization."),
            ("Web Security Best Practices", "Essential security measures for web applications."),
        ]
        
        created_topics = []
        for title, content in topics:
            result = await client_a.create_forum_topic(title, content)
            if result and result.get("success"):
                topic_id = result.get("data", {}).get("topic_id")
                created_topics.append((topic_id, title, content))
                print(f"✅ Created topic: {title}")
                await asyncio.sleep(0.5)  # Small delay for ordering
        
        assert len(created_topics) == 5, "All topics should be created successfully"
        
        # === Topic Listing ===
        # List all topics (recent order)
        list_result = await client_b.list_forum_topics(limit=10, sort_by="recent")
        assert list_result is not None, "Topic listing should succeed"
        assert list_result.get("success") == True, "Topic listing should be successful"
        
        list_data = list_result.get("data", {})
        assert len(list_data.get("topics", [])) >= 5, "Should list at least 5 topics"
        assert list_data.get("total_count") >= 5, "Total count should be at least 5"
        print(f"✅ Listed {len(list_data.get('topics', []))} topics (recent order)")
        
        # Test pagination
        paginated_result = await client_b.list_forum_topics(limit=3, offset=0)
        paginated_data = paginated_result.get("data", {})
        assert len(paginated_data.get("topics", [])) == 3, "Should return exactly 3 topics with limit"
        assert paginated_data.get("has_more") == True, "Should indicate more topics available"
        print(f"✅ Pagination works correctly")
        
        # === Topic Search ===
        # Search for Python topics
        search_result = await client_b.search_forum_topics("Python")
        assert search_result is not None, "Search should succeed"
        assert search_result.get("success") == True, "Search should be successful"
        
        search_data = search_result.get("data", {})
        python_topics = search_data.get("topics", [])
        assert len(python_topics) == 2, "Should find exactly 2 Python topics"
        
        # Verify search results contain Python-related topics
        python_titles = [topic.get("title", "") for topic in python_topics]
        assert any("Python Programming" in title for title in python_titles), "Should find Python Programming topic"
        assert any("Machine Learning with Python" in title for title in python_titles), "Should find ML Python topic"
        print(f"✅ Search found {len(python_topics)} Python-related topics")
        
        # Search for non-existent term
        empty_search = await client_b.search_forum_topics("NonExistentTerm12345")
        empty_data = empty_search.get("data", {})
        assert len(empty_data.get("topics", [])) == 0, "Should find no topics for non-existent term"
        print(f"✅ Empty search results handled correctly")
        
        # === Topic Retrieval ===
        # Get specific topic with comments
        topic_id = created_topics[0][0]
        get_result = await client_b.get_forum_topic(topic_id)
        assert get_result is not None, "Topic retrieval should succeed"
        
        get_data = get_result.get("data", {})
        assert get_data.get("topic_id") == topic_id, "Should retrieve correct topic"
        assert "comments" in get_data, "Should include comments structure"
        print(f"✅ Topic retrieval with comments successful")
        
        # === Voting and Popular Topics ===
        # Add votes to make topics popular
        await client_b.vote_on_topic(created_topics[0][0], "upvote")
        await client_b.vote_on_topic(created_topics[1][0], "upvote")
        await client_a.vote_on_topic(created_topics[0][0], "upvote")  # Double vote for first topic
        
        # Get popular topics
        popular_result = await client_b.get_popular_topics(limit=5)
        assert popular_result is not None, "Popular topics retrieval should succeed"
        
        popular_data = popular_result.get("data", {})
        popular_topics = popular_data.get("topics", [])
        assert len(popular_topics) >= 3, "Should have popular topics"
        
        # First topic should be most popular (has 2 votes)
        if len(popular_topics) > 0:
            most_popular = popular_topics[0]
            print(f"✅ Most popular topic: '{most_popular.get('title')}' (score: {most_popular.get('vote_score')})")
        
        # === User-specific Queries ===
        # Get topics created by Client A
        user_topics_result = await client_b.get_user_topics("ForumClientA_Test")
        assert user_topics_result is not None, "User topics retrieval should succeed"
        
        user_data = user_topics_result.get("data", {})
        user_topics = user_data.get("topics", [])
        assert len(user_topics) == 5, "Should find all 5 topics created by Client A"
        print(f"✅ Found {len(user_topics)} topics by ForumClientA_Test")
        
        # Get comments by user (should be empty as no comments were posted)
        user_comments_result = await client_b.get_user_comments("ForumClientA_Test")
        user_comments_data = user_comments_result.get("data", {})
        user_comments = user_comments_data.get("comments", [])
        print(f"✅ Found {len(user_comments)} comments by ForumClientA_Test")
    
    @pytest.mark.asyncio
    async def test_error_handling_flow(self, client_a, client_b):
        """
        Test: Error handling and edge cases
        """
        print("\n🧪 Test: Error Handling Flow")
        print("-" * 40)
        
        # Register both clients
        assert await client_a.register(), "Client A registration should succeed"
        assert await client_b.register(), "Client B registration should succeed"
        await asyncio.sleep(1)
        
        # === Invalid Topic Operations ===
        # Create topic with empty title
        empty_title_result = await client_a.create_forum_topic("", "Valid content")
        assert empty_title_result is None or empty_title_result.get("success") == False, "Empty title should be rejected"
        print(f"✅ Empty title correctly rejected")
        
        # Create topic with empty content
        empty_content_result = await client_a.create_forum_topic("Valid Title", "")
        assert empty_content_result is None or empty_content_result.get("success") == False, "Empty content should be rejected"
        print(f"✅ Empty content correctly rejected")
        
        # Edit non-existent topic
        fake_topic_id = "non-existent-topic-id"
        edit_fake_result = await client_a.edit_forum_topic(fake_topic_id, title="New Title")
        assert edit_fake_result is None or edit_fake_result.get("success") == False, "Editing non-existent topic should fail"
        print(f"✅ Non-existent topic edit correctly rejected")
        
        # Delete non-existent topic
        delete_fake_result = await client_a.delete_forum_topic(fake_topic_id)
        assert delete_fake_result is None or delete_fake_result.get("success") == False, "Deleting non-existent topic should fail"
        print(f"✅ Non-existent topic deletion correctly rejected")
        
        # === Invalid Comment Operations ===
        # Create a valid topic first
        topic_result = await client_a.create_forum_topic("Test Topic for Errors", "Valid content")
        topic_id = topic_result.get("data", {}).get("topic_id")
        
        # Comment on non-existent topic
        comment_fake_topic = await client_a.post_forum_comment("fake-topic-id", "Valid comment")
        assert comment_fake_topic is None or comment_fake_topic.get("success") == False, "Comment on non-existent topic should fail"
        print(f"✅ Comment on non-existent topic correctly rejected")
        
        # Comment with empty content
        empty_comment_result = await client_a.post_forum_comment(topic_id, "")
        assert empty_comment_result is None or empty_comment_result.get("success") == False, "Empty comment should be rejected"
        print(f"✅ Empty comment correctly rejected")
        
        # Reply to non-existent comment
        reply_fake_comment = await client_a.post_forum_comment(topic_id, "Valid reply", "fake-comment-id")
        assert reply_fake_comment is None or reply_fake_comment.get("success") == False, "Reply to non-existent comment should fail"
        print(f"✅ Reply to non-existent comment correctly rejected")
        
        # === Invalid Voting Operations ===
        # Vote on non-existent topic
        vote_fake_topic = await client_a.vote_on_topic("fake-topic-id", "upvote")
        assert vote_fake_topic is None or vote_fake_topic.get("success") == False, "Vote on non-existent topic should fail"
        print(f"✅ Vote on non-existent topic correctly rejected")
        
        # Vote with invalid vote type
        invalid_vote_type = await client_a.vote_on_topic(topic_id, "invalid_vote")
        assert invalid_vote_type is None or invalid_vote_type.get("success") == False, "Invalid vote type should be rejected"
        print(f"✅ Invalid vote type correctly rejected")
        
        # Vote on non-existent comment
        vote_fake_comment = await client_a.vote_on_comment("fake-comment-id", "upvote")
        assert vote_fake_comment is None or vote_fake_comment.get("success") == False, "Vote on non-existent comment should fail"
        print(f"✅ Vote on non-existent comment correctly rejected")
        
        # === Invalid Query Operations ===
        # Get non-existent topic
        get_fake_topic = await client_a.get_forum_topic("fake-topic-id")
        assert get_fake_topic is None or get_fake_topic.get("success") == False, "Get non-existent topic should fail"
        print(f"✅ Get non-existent topic correctly rejected")
        
        # Search with empty query
        empty_search = await client_a.search_forum_topics("")
        assert empty_search is None or empty_search.get("success") == False, "Empty search query should be rejected"
        print(f"✅ Empty search query correctly rejected")
        
        # === Ownership and Permission Tests ===
        # Create a topic with Client A
        owned_topic_result = await client_a.create_forum_topic("Ownership Test", "Testing ownership rules")
        owned_topic_id = owned_topic_result.get("data", {}).get("topic_id")
        
        # Client B tries to edit Client A's topic
        unauthorized_edit = await client_b.edit_forum_topic(owned_topic_id, title="Unauthorized Edit")
        assert unauthorized_edit is None or unauthorized_edit.get("success") == False, "Unauthorized edit should fail"
        print(f"✅ Unauthorized topic edit correctly rejected")
        
        # Client B tries to delete Client A's topic
        unauthorized_delete = await client_b.delete_forum_topic(owned_topic_id)
        assert unauthorized_delete is None or unauthorized_delete.get("success") == False, "Unauthorized deletion should fail"
        print(f"✅ Unauthorized topic deletion correctly rejected")
        
        # Add a comment by Client B
        comment_result = await client_b.post_forum_comment(owned_topic_id, "Comment by Client B")
        comment_id = comment_result.get("data", {}).get("comment_id")
        
        # Client A tries to edit Client B's comment
        unauthorized_comment_edit = await client_a.edit_forum_comment(owned_topic_id, comment_id, "Unauthorized edit")
        assert unauthorized_comment_edit is None or unauthorized_comment_edit.get("success") == False, "Unauthorized comment edit should fail"
        print(f"✅ Unauthorized comment edit correctly rejected")
        
        # Client A tries to delete Client B's comment
        unauthorized_comment_delete = await client_a.delete_forum_comment(owned_topic_id, comment_id)
        assert unauthorized_comment_delete is None or unauthorized_comment_delete.get("success") == False, "Unauthorized comment deletion should fail"
        print(f"✅ Unauthorized comment deletion correctly rejected")


def run_standalone_tests():
    """Run tests when executed as standalone script."""
    print("🚀 Starting Comprehensive Forum HTTP API Tests")
    print("=" * 70)
    
    async def run_async_tests():
        # Setup dynamic network
        config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
        config = load_network_config(str(config_path))
        
        # Use random port to avoid conflicts
        http_port = random.randint(25000, 26000)
        grpc_port = http_port + 100
        
        for transport in config.network.transports:
            if transport.type == "http":
                transport.config["port"] = http_port
            elif transport.type == "grpc":
                transport.config["port"] = grpc_port
        
        # Create and initialize network
        network = create_network(config.network)
        await network.initialize()
        await asyncio.sleep(1.0)
        
        try:
            # Configuration
            base_url = f"http://localhost:{http_port}"
            
            # Create test instances
            test_forum = TestForumFlow()
            client_a = ForumHTTPClient(base_url, "ForumClientA_Test")
            client_b = ForumHTTPClient(base_url, "ForumClientB_Test")
            
            try:
                # Run all forum flow tests
                print(f"\n🧪 Running Forum Flow Tests on port {http_port}")
                print("-" * 50)
                
                await test_forum.test_topic_management_flow(client_a, client_b)
                print("✅ Topic management flow test passed")
                
                await test_forum.test_comment_threading_flow(client_a, client_b)
                print("✅ Comment threading flow test passed")
                
                await test_forum.test_voting_system_flow(client_a, client_b)
                print("✅ Voting system flow test passed")
                
                await test_forum.test_search_and_browsing_flow(client_a, client_b)
                print("✅ Search and browsing flow test passed")
                
                await test_forum.test_error_handling_flow(client_a, client_b)
                print("✅ Error handling flow test passed")
                
            finally:
                if client_a.registered:
                    await client_a.unregister()
                if client_b.registered:
                    await client_b.unregister()
                await client_a.close()
                await client_b.close()
        
        finally:
            await network.shutdown()
    
    asyncio.run(run_async_tests())
    print("\n🎉 All comprehensive forum tests completed successfully!")


if __name__ == "__main__":
    run_standalone_tests()