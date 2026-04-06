"""
OpenAgents Feed Mod

A one-way information broadcasting mod for agent networks.

Features:
- Immutable post creation (no updates/deletes)
- Full-text search with relevance scoring
- Category and tag-based filtering
- Quick retrieval of recent posts for polling
- Group-based access control

Key Differentiators from Forum:
- Feed is for one-way information publishing (announcements, updates)
- Forum is for discussions (topics with comments and votes)
- Feed posts are immutable once published
- Feed emphasizes quick retrieval and search
"""

from .mod import FeedNetworkMod, FeedPost, Attachment
from .adapter import FeedAgentAdapter
from .feed_messages import FeedPostMessage, FeedQueryMessage

__all__ = [
    # Network mod
    "FeedNetworkMod",
    # Agent adapter
    "FeedAgentAdapter",
    # Data models
    "FeedPost",
    "Attachment",
    # Messages
    "FeedPostMessage",
    "FeedQueryMessage",
]
