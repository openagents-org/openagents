"""
Wiki message types for OpenAgents wiki mod.

This module defines the message types used for wiki operations including
page creation, editing, proposals, and version management.
"""

import time
import uuid
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from openagents.models.event import Event


class WikiPageCreateMessage(BaseModel):
    """Message for creating a new wiki page."""

    event_name: str = "wiki.page.create"
    source_id: str = Field(..., description="ID of the agent creating the page")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    title: str = Field(..., description="Title of the wiki page")
    wiki_content: str = Field(..., description="Content of the wiki page in markdown")
    category: Optional[str] = Field(None, description="Category for the page")
    tags: List[str] = Field(default_factory=list, description="Tags for the page")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageEditMessage(BaseModel):
    """Message for editing an existing wiki page (owner only)."""

    event_name: str = "wiki.page.edit"
    source_id: str = Field(..., description="ID of the agent editing the page")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    wiki_content: str = Field(..., description="Updated content of the wiki page")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageGetMessage(BaseModel):
    """Message for retrieving a wiki page."""

    event_name: str = "wiki.page.get"
    source_id: str = Field(..., description="ID of the agent requesting the page")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    version: Optional[int] = Field(None, description="Specific version to retrieve")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageSearchMessage(BaseModel):
    """Message for searching wiki pages."""

    event_name: str = "wiki.pages.search"
    source_id: str = Field(..., description="ID of the agent searching")
    query: str = Field(..., description="Search query")
    limit: int = Field(10, description="Maximum number of results")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageListMessage(BaseModel):
    """Message for listing wiki pages."""

    event_name: str = "wiki.pages.list"
    source_id: str = Field(..., description="ID of the agent listing pages")
    category: Optional[str] = Field(None, description="Filter by category")
    limit: int = Field(50, description="Maximum number of pages to return")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageEditProposalMessage(BaseModel):
    """Message for proposing an edit to a wiki page."""

    event_name: str = "wiki.page.proposal.create"
    source_id: str = Field(..., description="ID of the agent proposing the edit")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    wiki_content: str = Field(..., description="Proposed content for the wiki page")
    rationale: str = Field(..., description="Rationale for the proposed edit")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiEditProposalListMessage(BaseModel):
    """Message for listing edit proposals."""

    event_name: str = "wiki.proposals.list"
    source_id: str = Field(..., description="ID of the agent listing proposals")
    page_path: Optional[str] = Field(None, description="Filter by specific page")
    status: str = Field("pending", description="Filter by proposal status")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiEditProposalResolveMessage(BaseModel):
    """Message for resolving an edit proposal."""

    event_name: str = "wiki.proposal.resolve"
    source_id: str = Field(..., description="ID of the agent resolving the proposal")
    proposal_id: str = Field(..., description="ID of the proposal to resolve")
    action: str = Field(..., description="Action to take: approve or reject")
    comments: Optional[str] = Field(None, description="Optional comments")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageHistoryMessage(BaseModel):
    """Message for retrieving page history."""

    event_name: str = "wiki.page.history"
    source_id: str = Field(..., description="ID of the agent requesting history")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    limit: int = Field(20, description="Maximum number of versions to return")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


class WikiPageRevertMessage(BaseModel):
    """Message for reverting a page to a previous version."""

    event_name: str = "wiki.page.revert"
    source_id: str = Field(..., description="ID of the agent reverting the page")
    page_path: str = Field(..., description="Path/identifier for the wiki page")
    target_version: int = Field(..., description="Version number to revert to")
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))


# Data models for internal use


class WikiPage(BaseModel):
    """Internal model for wiki pages."""

    page_path: str
    title: str
    content: str
    category: Optional[str] = None
    created_by: str
    created_timestamp: int
    current_version: int = 1
    is_locked: bool = False
    protection_level: str = "open"
    tags: List[str] = Field(default_factory=list)


class WikiPageVersion(BaseModel):
    """Internal model for wiki page versions."""

    version_id: str
    page_path: str
    version_number: int
    content: str
    edited_by: str
    edit_timestamp: int
    edit_type: str  # direct, proposal_approved, revert
    parent_version: Optional[int] = None


class WikiEditProposal(BaseModel):
    """Internal model for edit proposals."""

    proposal_id: str
    page_path: str
    proposed_content: str
    rationale: str
    proposed_by: str
    created_timestamp: int
    status: str = "pending"  # pending, approved, rejected, superseded
    resolved_by: Optional[str] = None
    resolved_timestamp: Optional[int] = None
    resolution_comments: Optional[str] = None


class WikiProposalReview(BaseModel):
    """Internal model for proposal reviews."""

    review_id: str
    proposal_id: str
    reviewer_id: str
    action: str  # approve, reject
    comments: Optional[str] = None
    review_timestamp: int
