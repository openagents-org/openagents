"""
Test cases for forum and wiki mod persistence functionality.

Tests that forum topics/comments and wiki pages/proposals are saved to and loaded from storage.
"""

import pytest
import tempfile
import time
import json
from pathlib import Path
from unittest.mock import MagicMock

from openagents.mods.workspace.forum.mod import ForumNetworkMod
from openagents.mods.workspace.wiki.mod import WikiNetworkMod
from openagents.models.event import Event


class TestForumPersistence:
    """Test forum mod persistence functionality."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)
    
    @pytest.fixture
    def forum_mod(self, temp_workspace):
        """Create a forum mod with test workspace."""
        mod = ForumNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        return mod
    
    def test_forum_data_persistence_cycle(self, forum_mod, temp_workspace):
        """Test complete save/load cycle for forum data."""
        # Create test data
        forum_mod.initialize()  # This should load empty data initially
        
        # Simulate topic creation
        from openagents.mods.workspace.forum.mod import ForumTopic, ForumComment
        
        topic = ForumTopic(
            topic_id="test_topic_1",
            title="Test Topic",
            content="This is a test topic",
            owner_id="test_agent_1",
            timestamp=time.time()
        )
        topic.upvotes = 5
        topic.downvotes = 2
        topic.comment_count = 1
        
        # Add a comment
        comment = ForumComment(
            comment_id="test_comment_1",
            topic_id="test_topic_1",
            content="This is a test comment",
            author_id="test_agent_2",
            timestamp=time.time()
        )
        comment.upvotes = 3
        
        topic.comments["test_comment_1"] = comment
        topic.root_comments = ["test_comment_1"]
        
        # Use new storage methods
        forum_mod._save_topic(topic)
        forum_mod._save_user_votes("test_agent_1", {"test_topic_1": "upvote"})
        forum_mod._save_metadata(["test_topic_1"], ["test_topic_1"])
        
        # Verify files were created (new individual file structure)
        expected_files = [
            temp_workspace / "topics" / "test_topic_1.json",  # Individual topic file
            temp_workspace / "votes.json", 
            temp_workspace / "metadata.json"
        ]
        
        for file_path in expected_files:
            assert file_path.exists(), f"Expected file {file_path} was not created"
            assert file_path.stat().st_size > 0, f"File {file_path} is empty"
        
        # Data is now loaded from storage on each access - no cache to clear
        
        # Verify data was restored
        assert len(forum_mod.topics) == 1, "Expected 1 topic after loading"
        
        loaded_topic = forum_mod.topics["test_topic_1"]
        assert loaded_topic.title == "Test Topic"
        assert loaded_topic.content == "This is a test topic"
        assert loaded_topic.owner_id == "test_agent_1"
        assert loaded_topic.upvotes == 5
        assert loaded_topic.downvotes == 2
        assert loaded_topic.comment_count == 1
        
        # Verify comment was restored
        assert len(loaded_topic.comments) == 1
        loaded_comment = loaded_topic.comments["test_comment_1"]
        assert loaded_comment.content == "This is a test comment"
        assert loaded_comment.author_id == "test_agent_2"
        assert loaded_comment.upvotes == 3
        
        # Verify votes were restored
        assert forum_mod.user_votes["test_agent_1"]["test_topic_1"] == "upvote"
        
        # Verify metadata was restored
        assert forum_mod.topic_order_recent == ["test_topic_1"]
        
        print("✅ Forum persistence cycle test passed!")
    
    def test_forum_empty_storage(self, forum_mod, temp_workspace):
        """Test loading from empty storage directory."""
        # Initialize should work with empty storage
        assert forum_mod.initialize() == True
        
        # Should have empty state
        assert len(forum_mod.topics) == 0
        assert len(forum_mod.user_votes) == 0
        assert len(forum_mod.topic_order_recent) == 0


class TestWikiPersistence:
    """Test wiki mod persistence functionality."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)
    
    @pytest.fixture
    def wiki_mod(self, temp_workspace):
        """Create a wiki mod with test workspace."""
        mod = WikiNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        # Mock network for initialization by setting _network directly
        mod._network = MagicMock()
        mod._network.event_gateway = MagicMock()
        return mod
    
    def test_wiki_data_persistence_cycle(self, wiki_mod, temp_workspace):
        """Test complete save/load cycle for wiki data."""
        # Create test data
        wiki_mod.initialize()  # This should load empty data initially
        
        # Simulate page creation
        from openagents.mods.workspace.wiki.wiki_messages import WikiPage, WikiPageVersion, WikiEditProposal
        
        page = WikiPage(
            page_path="/test/page",
            title="Test Page",
            content="This is test content",
            created_by="test_agent_1",
            created_timestamp=int(time.time()),
            current_version=1
        )
        
        version = WikiPageVersion(
            version_id="version_1",
            page_path="/test/page",
            version_number=1,
            content="This is test content", 
            edited_by="test_agent_1",
            edit_timestamp=int(time.time()),
            edit_type="direct"
        )
        
        proposal = WikiEditProposal(
            proposal_id="proposal_1",
            page_path="/test/page",
            proposed_content="Updated content",
            proposed_by="test_agent_2",
            rationale="Testing proposal system",
            created_timestamp=int(time.time())
        )
        
        # Use new individual file save methods
        wiki_mod._save_page(page)
        wiki_mod._save_page_versions("/test/page", [version])
        wiki_mod._save_proposal(proposal)
        wiki_mod._save_metadata({"/test/page": ["proposal_1"]})
        
        # Verify files were created (new individual file structure)
        expected_files = [
            temp_workspace / "pages" / "_SLASH_test_SLASH_page.json",  # Individual page file (encoded path)
            temp_workspace / "versions" / "_SLASH_test_SLASH_page.json",  # Individual version file
            temp_workspace / "proposals" / "proposal_1.json",  # Individual proposal file
            temp_workspace / "metadata.json"
        ]
        
        for file_path in expected_files:
            assert file_path.exists(), f"Expected file {file_path} was not created"
            assert file_path.stat().st_size > 0, f"File {file_path} is empty"
        
        # Data is now loaded from storage on each access - no cache to clear
        
        # Verify data was restored
        assert len(wiki_mod.pages) == 1, "Expected 1 page after loading"
        
        loaded_page = wiki_mod.pages["/test/page"]
        assert loaded_page.title == "Test Page"
        assert loaded_page.content == "This is test content"
        assert loaded_page.created_by == "test_agent_1"
        
        # Verify versions were restored
        assert len(wiki_mod.page_versions) == 1
        loaded_versions = wiki_mod.page_versions["/test/page"]
        assert len(loaded_versions) == 1
        assert loaded_versions[0].content == "This is test content"
        assert loaded_versions[0].edited_by == "test_agent_1"
        assert loaded_versions[0].edit_type == "direct"
        
        # Verify proposals were restored
        assert len(wiki_mod.proposals) == 1
        loaded_proposal = wiki_mod.proposals["proposal_1"]
        assert loaded_proposal.proposed_content == "Updated content"
        assert loaded_proposal.proposed_by == "test_agent_2"
        assert loaded_proposal.rationale == "Testing proposal system"
        
        # Verify metadata was restored
        assert wiki_mod.page_proposals["/test/page"] == ["proposal_1"]
        
        print("✅ Wiki persistence cycle test passed!")
    
    def test_wiki_empty_storage(self, wiki_mod, temp_workspace):
        """Test loading from empty storage directory."""
        # Initialize should work with empty storage
        assert wiki_mod.initialize() == True
        
        # Should have empty state
        assert len(wiki_mod.pages) == 0
        assert len(wiki_mod.page_versions) == 0
        assert len(wiki_mod.proposals) == 0
        assert len(wiki_mod.page_proposals) == 0


if __name__ == "__main__":
    # Quick standalone test
    import sys
    import shutil
    sys.path.insert(0, "../../src")
    
    # Test forum persistence
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir)
    
    print("Running quick forum persistence test...")
    
    forum_mod = ForumNetworkMod()
    forum_mod.get_storage_path = lambda: temp_path
    
    # Test empty initialization
    assert forum_mod.initialize() == True
    
    # Test shutdown saves data (even if empty)
    assert forum_mod.shutdown() == True
    
    # Check files were created
    files_created = list(temp_path.glob("*.json"))
    print(f"Forum files created: {[f.name for f in files_created]}")
    
    # Cleanup
    shutil.rmtree(temp_dir)
    
    # Test wiki persistence
    temp_dir = tempfile.mkdtemp()
    temp_path = Path(temp_dir)
    
    print("Running quick wiki persistence test...")
    
    wiki_mod = WikiNetworkMod()
    wiki_mod.get_storage_path = lambda: temp_path
    wiki_mod._network = MagicMock()
    wiki_mod._network.event_gateway = MagicMock()
    
    # Test empty initialization
    assert wiki_mod.initialize() == True
    
    # Test shutdown saves data
    assert wiki_mod.shutdown() == True
    
    # Check files were created
    files_created = list(temp_path.glob("*.json"))
    print(f"Wiki files created: {[f.name for f in files_created]}")
    
    # Cleanup
    shutil.rmtree(temp_dir)
    
    print("✅ Quick persistence verification tests passed!")