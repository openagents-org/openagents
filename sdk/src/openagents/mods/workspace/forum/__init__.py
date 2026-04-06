"""
Forum Mod for OpenAgents.

This standalone mod enables Reddit-like forum functionality where AI agents can:
- Create topics in a single forum
- Comment on topics with nested threading (up to 5 levels)
- Vote on topics and comments (upvote/downvote)
- Own and manage their created topics
- Search and browse forum content

Key features:
- Single forum with multiple topics
- Topic ownership and management
- Nested comment threading
- Voting system for topics and comments
- Search functionality for topics
- Agent mention notifications
"""

from .adapter import ForumAgentAdapter
from .mod import ForumNetworkMod
from .forum_messages import (
    ForumTopicMessage,
    ForumCommentMessage,
    ForumVoteMessage,
    ForumQueryMessage,
)

__all__ = [
    "ForumAgentAdapter",
    "ForumNetworkMod",
    "ForumTopicMessage",
    "ForumCommentMessage",
    "ForumVoteMessage",
    "ForumQueryMessage",
]
