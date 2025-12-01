"""
Test cases for feed mod functionality.

Tests post creation, search, access control, pagination and filtering.
"""

import pytest
import tempfile
import time
import json
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

from openagents.mods.workspace.feed.mod import (
    FeedNetworkMod,
    FeedPost,
    Attachment,
    VALID_CATEGORIES,
)
from openagents.models.event import Event


class TestFeedPostModel:
    """Test FeedPost data model."""

    def test_post_creation(self):
        """Test basic post creation."""
        post = FeedPost(
            post_id="test-123",
            title="Test Post",
            content="This is test content",
            author_id="agent-1",
            created_at=time.time(),
        )

        assert post.post_id == "test-123"
        assert post.title == "Test Post"
        assert post.content == "This is test content"
        assert post.author_id == "agent-1"
        assert post.category is None
        assert post.tags == []
        assert post.allowed_groups == []
        assert post.attachments == []

    def test_post_with_all_fields(self):
        """Test post creation with all fields."""
        attachment = Attachment(
            file_id="file-1",
            filename="test.pdf",
            content_type="application/pdf",
            size=1024,
        )

        post = FeedPost(
            post_id="test-456",
            title="Full Post",
            content="Content with **markdown**",
            author_id="agent-2",
            created_at=time.time(),
            category="announcements",
            tags=["important", "team-a"],
            allowed_groups=["group-1", "group-2"],
            attachments=[attachment],
        )

        assert post.category == "announcements"
        assert "important" in post.tags
        assert "team-a" in post.tags
        assert len(post.allowed_groups) == 2
        assert len(post.attachments) == 1
        assert post.attachments[0].filename == "test.pdf"

    def test_post_to_dict(self):
        """Test post serialization to dictionary."""
        post = FeedPost(
            post_id="test-789",
            title="Dict Test",
            content="Test content",
            author_id="agent-3",
            created_at=1700000000.0,
            category="updates",
            tags=["release"],
        )

        post_dict = post.to_dict()

        assert post_dict["post_id"] == "test-789"
        assert post_dict["title"] == "Dict Test"
        assert post_dict["category"] == "updates"
        assert post_dict["tags"] == ["release"]

    def test_post_from_dict(self):
        """Test post deserialization from dictionary."""
        data = {
            "post_id": "test-abc",
            "title": "From Dict",
            "content": "Loaded content",
            "author_id": "agent-4",
            "created_at": 1700000000.0,
            "category": "info",
            "tags": ["test"],
            "allowed_groups": [],
            "attachments": [
                {
                    "file_id": "f-1",
                    "filename": "doc.txt",
                    "content_type": "text/plain",
                    "size": 100,
                }
            ],
        }

        post = FeedPost.from_dict(data)

        assert post.post_id == "test-abc"
        assert post.title == "From Dict"
        assert post.category == "info"
        assert len(post.attachments) == 1


class TestFeedPersistence:
    """Test feed mod persistence functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod(self, temp_workspace):
        """Create a feed mod with test workspace."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        return mod

    def test_feed_data_persistence_cycle(self, feed_mod, temp_workspace):
        """Test complete save/load cycle for feed data."""
        # Initialize mod
        feed_mod.initialize()

        # Create test post
        post = FeedPost(
            post_id="test_post_1",
            title="Test Post",
            content="This is a test post",
            author_id="test_agent_1",
            created_at=time.time(),
            category="announcements",
            tags=["test", "important"],
        )

        # Save the post
        feed_mod._save_post(post)
        feed_mod._save_metadata(["test_post_1"])

        # Verify files were created
        expected_files = [
            temp_workspace / "posts" / "test_post_1.json",
            temp_workspace / "metadata.json",
        ]

        for file_path in expected_files:
            assert file_path.exists(), f"Expected file {file_path} was not created"
            assert file_path.stat().st_size > 0, f"File {file_path} is empty"

        # Verify data was restored
        assert len(feed_mod.posts) == 1, "Expected 1 post after loading"

        loaded_post = feed_mod.posts["test_post_1"]
        assert loaded_post.title == "Test Post"
        assert loaded_post.content == "This is a test post"
        assert loaded_post.author_id == "test_agent_1"
        assert loaded_post.category == "announcements"
        assert "test" in loaded_post.tags
        assert "important" in loaded_post.tags

        # Verify metadata was restored
        assert feed_mod.post_order_recent == ["test_post_1"]

        print("Feed persistence cycle test passed!")

    def test_feed_empty_storage(self, feed_mod, temp_workspace):
        """Test loading from empty storage directory."""
        # Initialize should work with empty storage
        assert feed_mod.initialize() == True

        # Should have empty state
        assert len(feed_mod.posts) == 0
        assert len(feed_mod.post_order_recent) == 0


class TestFeedPostCreation:
    """Test feed post creation functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod(self, temp_workspace):
        """Create a feed mod with test workspace."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        mod._network = MagicMock()
        mod._network.process_event = AsyncMock()
        mod.initialize()
        return mod

    @pytest.mark.asyncio
    async def test_create_post_success(self, feed_mod):
        """Test successful post creation."""
        event = Event(
            event_name="feed.post.create",
            source_id="agent-1",
            payload={
                "title": "New Announcement",
                "content": "Important information here",
                "category": "announcements",
                "tags": ["urgent"],
            },
        )

        response = await feed_mod._create_post(event)

        assert response.success == True
        assert "post_id" in response.data
        assert response.data["title"] == "New Announcement"
        assert response.data["category"] == "announcements"

    @pytest.mark.asyncio
    async def test_create_post_empty_title(self, feed_mod):
        """Test post creation with empty title fails."""
        event = Event(
            event_name="feed.post.create",
            source_id="agent-1",
            payload={
                "title": "",
                "content": "Some content",
            },
        )

        response = await feed_mod._create_post(event)

        assert response.success == False
        assert "title" in response.message.lower()

    @pytest.mark.asyncio
    async def test_create_post_title_too_long(self, feed_mod):
        """Test post creation with title exceeding 200 chars fails."""
        event = Event(
            event_name="feed.post.create",
            source_id="agent-1",
            payload={
                "title": "x" * 201,
                "content": "Some content",
            },
        )

        response = await feed_mod._create_post(event)

        assert response.success == False
        assert "200" in response.message

    @pytest.mark.asyncio
    async def test_create_post_invalid_category(self, feed_mod):
        """Test post creation with invalid category fails."""
        event = Event(
            event_name="feed.post.create",
            source_id="agent-1",
            payload={
                "title": "Test",
                "content": "Content",
                "category": "invalid_category",
            },
        )

        response = await feed_mod._create_post(event)

        assert response.success == False
        assert "category" in response.message.lower()


class TestFeedSearch:
    """Test feed search functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod_with_posts(self, temp_workspace):
        """Create a feed mod with test posts."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        mod._network = MagicMock()
        mod._network.process_event = AsyncMock()
        mod.initialize()

        # Create test posts
        posts = [
            FeedPost(
                post_id="post-1",
                title="Release Notes v2.0",
                content="New features and bug fixes",
                author_id="agent-1",
                created_at=time.time() - 3600,
                category="announcements",
                tags=["release", "v2"],
            ),
            FeedPost(
                post_id="post-2",
                title="Weekly Update",
                content="This week we worked on release preparation",
                author_id="agent-2",
                created_at=time.time() - 1800,
                category="updates",
                tags=["weekly"],
            ),
            FeedPost(
                post_id="post-3",
                title="System Alert",
                content="Maintenance scheduled for tomorrow",
                author_id="agent-1",
                created_at=time.time(),
                category="alerts",
                tags=["maintenance"],
            ),
        ]

        for post in posts:
            mod._save_post(post)

        mod._save_metadata(["post-3", "post-2", "post-1"])

        return mod

    @pytest.mark.asyncio
    async def test_search_by_keyword(self, feed_mod_with_posts):
        """Test searching posts by keyword."""
        event = Event(
            event_name="feed.posts.search",
            source_id="agent-1",
            payload={
                "query": "release",
                "limit": 50,
            },
        )

        response = await feed_mod_with_posts._search_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 2  # "Release Notes" and "Weekly Update"

    @pytest.mark.asyncio
    async def test_search_with_category_filter(self, feed_mod_with_posts):
        """Test searching with category filter."""
        event = Event(
            event_name="feed.posts.search",
            source_id="agent-1",
            payload={
                "query": "release",
                "category": "announcements",
                "limit": 50,
            },
        )

        response = await feed_mod_with_posts._search_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 1
        assert response.data["posts"][0]["title"] == "Release Notes v2.0"

    @pytest.mark.asyncio
    async def test_search_empty_query(self, feed_mod_with_posts):
        """Test search with empty query fails."""
        event = Event(
            event_name="feed.posts.search",
            source_id="agent-1",
            payload={
                "query": "",
                "limit": 50,
            },
        )

        response = await feed_mod_with_posts._search_posts(event)

        assert response.success == False
        assert "empty" in response.message.lower()


class TestFeedAccessControl:
    """Test feed access control functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod(self, temp_workspace):
        """Create a feed mod with test workspace."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace

        # Mock network with topology
        mod._network = MagicMock()
        mod._network.topology = MagicMock()
        mod._network.topology.agent_group_membership = {
            "agent-1": "team-a",
            "agent-2": "team-b",
            "agent-3": "team-a",
        }
        mod._network.process_event = AsyncMock()

        mod.initialize()

        # Create posts with different access controls
        public_post = FeedPost(
            post_id="public-post",
            title="Public Announcement",
            content="Everyone can see this",
            author_id="agent-1",
            created_at=time.time(),
            allowed_groups=[],
        )

        restricted_post = FeedPost(
            post_id="restricted-post",
            title="Team A Only",
            content="Only team A can see this",
            author_id="agent-1",
            created_at=time.time(),
            allowed_groups=["team-a"],
        )

        mod._save_post(public_post)
        mod._save_post(restricted_post)
        mod._save_metadata(["restricted-post", "public-post"])

        return mod

    def test_public_post_visible_to_all(self, feed_mod):
        """Test that public posts are visible to all agents."""
        post = feed_mod._load_post("public-post")

        assert feed_mod._can_agent_view_post("agent-1", post) == True
        assert feed_mod._can_agent_view_post("agent-2", post) == True
        assert feed_mod._can_agent_view_post("agent-3", post) == True

    def test_restricted_post_visible_to_allowed_groups(self, feed_mod):
        """Test that restricted posts are only visible to allowed groups."""
        post = feed_mod._load_post("restricted-post")

        # Agent-1 and Agent-3 are in team-a (allowed)
        assert feed_mod._can_agent_view_post("agent-1", post) == True
        assert feed_mod._can_agent_view_post("agent-3", post) == True

        # Agent-2 is in team-b (not allowed)
        assert feed_mod._can_agent_view_post("agent-2", post) == False

    @pytest.mark.asyncio
    async def test_get_post_access_denied(self, feed_mod):
        """Test that getting a restricted post returns access denied."""
        event = Event(
            event_name="feed.post.get",
            source_id="agent-2",  # In team-b
            payload={
                "post_id": "restricted-post",
            },
        )

        response = await feed_mod._get_post(event)

        assert response.success == False
        assert "permission denied" in response.message.lower()

    @pytest.mark.asyncio
    async def test_list_posts_filters_by_access(self, feed_mod):
        """Test that listing posts filters by access control."""
        # Agent-2 should only see public post
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-2",
            payload={"limit": 50},
        )

        response = await feed_mod._list_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 1
        assert response.data["posts"][0]["post_id"] == "public-post"


class TestFeedPagination:
    """Test feed pagination and filtering functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod_with_many_posts(self, temp_workspace):
        """Create a feed mod with many test posts."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        mod._network = MagicMock()
        mod._network.process_event = AsyncMock()
        mod.initialize()

        # Create 10 test posts
        base_time = time.time()
        post_ids = []

        for i in range(10):
            post = FeedPost(
                post_id=f"post-{i}",
                title=f"Post {i}",
                content=f"Content for post {i}",
                author_id="agent-1" if i % 2 == 0 else "agent-2",
                created_at=base_time - (i * 100),  # Older posts have lower timestamps
                category="updates" if i % 2 == 0 else "info",
                tags=[f"tag-{i % 3}"],
            )
            mod._save_post(post)
            post_ids.append(post.post_id)

        mod._save_metadata(post_ids)

        return mod

    @pytest.mark.asyncio
    async def test_pagination_limit(self, feed_mod_with_many_posts):
        """Test pagination with limit."""
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-1",
            payload={"limit": 5, "offset": 0},
        )

        response = await feed_mod_with_many_posts._list_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 5
        assert response.data["has_more"] == True
        assert response.data["total_count"] == 10

    @pytest.mark.asyncio
    async def test_pagination_offset(self, feed_mod_with_many_posts):
        """Test pagination with offset."""
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-1",
            payload={"limit": 5, "offset": 5},
        )

        response = await feed_mod_with_many_posts._list_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 5
        assert response.data["has_more"] == False

    @pytest.mark.asyncio
    async def test_filter_by_author(self, feed_mod_with_many_posts):
        """Test filtering by author."""
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-1",
            payload={"limit": 50, "author_id": "agent-1"},
        )

        response = await feed_mod_with_many_posts._list_posts(event)

        assert response.success == True
        # Posts 0, 2, 4, 6, 8 are from agent-1
        assert response.data["total_count"] == 5
        for post in response.data["posts"]:
            assert post["author_id"] == "agent-1"

    @pytest.mark.asyncio
    async def test_filter_by_category(self, feed_mod_with_many_posts):
        """Test filtering by category."""
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-1",
            payload={"limit": 50, "category": "updates"},
        )

        response = await feed_mod_with_many_posts._list_posts(event)

        assert response.success == True
        for post in response.data["posts"]:
            assert post["category"] == "updates"

    @pytest.mark.asyncio
    async def test_filter_by_tags(self, feed_mod_with_many_posts):
        """Test filtering by tags."""
        event = Event(
            event_name="feed.posts.list",
            source_id="agent-1",
            payload={"limit": 50, "tags": ["tag-0"]},
        )

        response = await feed_mod_with_many_posts._list_posts(event)

        assert response.success == True
        for post in response.data["posts"]:
            assert "tag-0" in [t.lower() for t in post["tags"]]


class TestFeedRecentPosts:
    """Test getting recent posts functionality."""

    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def feed_mod(self, temp_workspace):
        """Create a feed mod with test posts at different times."""
        mod = FeedNetworkMod()
        mod.get_storage_path = lambda: temp_workspace
        mod._network = MagicMock()
        mod._network.process_event = AsyncMock()
        mod.initialize()

        now = time.time()

        # Create posts at different times
        old_post = FeedPost(
            post_id="old-post",
            title="Old Post",
            content="This is an old post",
            author_id="agent-1",
            created_at=now - 3600,  # 1 hour ago
        )

        recent_post = FeedPost(
            post_id="recent-post",
            title="Recent Post",
            content="This is a recent post",
            author_id="agent-1",
            created_at=now - 60,  # 1 minute ago
        )

        mod._save_post(old_post)
        mod._save_post(recent_post)
        mod._save_metadata(["recent-post", "old-post"])

        return mod, now

    @pytest.mark.asyncio
    async def test_get_posts_since_timestamp(self, feed_mod):
        """Test getting posts since a specific timestamp."""
        mod, now = feed_mod

        # Get posts from last 30 minutes
        event = Event(
            event_name="feed.posts.recent",
            source_id="agent-1",
            payload={
                "since_timestamp": now - 1800,  # 30 minutes ago
            },
        )

        response = await mod._get_recent_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 1
        assert response.data["posts"][0]["post_id"] == "recent-post"

    @pytest.mark.asyncio
    async def test_get_all_recent_posts(self, feed_mod):
        """Test getting all posts since 0."""
        mod, now = feed_mod

        event = Event(
            event_name="feed.posts.recent",
            source_id="agent-1",
            payload={
                "since_timestamp": 0,
            },
        )

        response = await mod._get_recent_posts(event)

        assert response.success == True
        assert len(response.data["posts"]) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
