# -*- coding: utf-8 -*-
"""Tests for ONM addressing module."""

import pytest

from openagents.sdk.onm_addressing import (
    Address,
    make_agent_address,
    make_channel_address,
    make_human_address,
    make_resource_address,
    parse_address,
)


# ---------------------------------------------------------------------------
# parse_address — basic entity types
# ---------------------------------------------------------------------------

class TestParseLocal:
    """Parsing local (no network scope) addresses."""

    def test_agent(self):
        addr = parse_address("agent:charlie")
        assert addr.network == "local"
        assert addr.entity_type == "agent"
        assert addr.name == "charlie"
        assert addr.is_agent
        assert addr.is_local
        assert not addr.is_broadcast

    def test_openagents(self):
        addr = parse_address("openagents:claude-7f3a")
        assert addr.entity_type == "openagents"
        assert addr.name == "claude-7f3a"
        assert addr.is_agent

    def test_human(self):
        addr = parse_address("human:user@example.com")
        assert addr.entity_type == "human"
        assert addr.name == "user@example.com"
        assert addr.is_human
        assert not addr.is_agent

    def test_channel(self):
        addr = parse_address("channel/session-abc")
        assert addr.entity_type == "channel"
        assert addr.name == "session-abc"
        assert addr.is_channel

    def test_mod(self):
        addr = parse_address("mod/persistence")
        assert addr.entity_type == "mod"
        assert addr.name == "persistence"
        assert addr.is_mod

    def test_group(self):
        addr = parse_address("group/team-alpha")
        assert addr.entity_type == "group"
        assert addr.name == "team-alpha"
        assert addr.is_group

    def test_resource_tool(self):
        addr = parse_address("resource/tool/search_web")
        assert addr.entity_type == "resource"
        assert addr.name == "tool/search_web"
        assert addr.is_resource

    def test_resource_file(self):
        addr = parse_address("resource/file/requirements.md")
        assert addr.entity_type == "resource"
        assert addr.name == "file/requirements.md"

    def test_resource_context(self):
        addr = parse_address("resource/context/project-brief")
        assert addr.entity_type == "resource"
        assert addr.name == "context/project-brief"

    def test_core(self):
        addr = parse_address("core")
        assert addr.entity_type == "core"
        assert addr.name == ""
        assert addr.is_core

    def test_broadcast(self):
        addr = parse_address("agent:broadcast")
        assert addr.entity_type == "agent"
        assert addr.name == "broadcast"
        assert addr.is_broadcast

    def test_bare_string_defaults_to_agent(self):
        addr = parse_address("charlie")
        assert addr.entity_type == "agent"
        assert addr.name == "charlie"
        assert addr.is_agent


# ---------------------------------------------------------------------------
# parse_address — network scoping
# ---------------------------------------------------------------------------

class TestParseNetworkScoped:
    """Parsing cross-network addresses with :: separator."""

    def test_cross_network_agent(self):
        addr = parse_address("net123::agent:charlie")
        assert addr.network == "net123"
        assert addr.entity_type == "agent"
        assert addr.name == "charlie"
        assert not addr.is_local

    def test_cross_network_openagents(self):
        addr = parse_address("net123::openagents:bob")
        assert addr.network == "net123"
        assert addr.entity_type == "openagents"
        assert addr.name == "bob"

    def test_cross_network_channel(self):
        addr = parse_address("net123::channel/general")
        assert addr.network == "net123"
        assert addr.entity_type == "channel"
        assert addr.name == "general"

    def test_cross_network_core(self):
        addr = parse_address("net123::core")
        assert addr.network == "net123"
        assert addr.is_core

    def test_explicit_local(self):
        addr = parse_address("local::agent:charlie")
        assert addr.network == "local"
        assert addr.entity_type == "agent"
        assert addr.name == "charlie"
        assert addr.is_local

    def test_cross_network_bare_string(self):
        addr = parse_address("net123::charlie")
        assert addr.network == "net123"
        assert addr.entity_type == "agent"
        assert addr.name == "charlie"


# ---------------------------------------------------------------------------
# parse_address — edge cases
# ---------------------------------------------------------------------------

class TestParseEdgeCases:
    """Edge cases and error conditions."""

    def test_empty_string_raises(self):
        with pytest.raises(ValueError, match="cannot be empty"):
            parse_address("")

    def test_whitespace_raises(self):
        with pytest.raises(ValueError, match="cannot be empty"):
            parse_address("   ")

    def test_empty_network_raises(self):
        with pytest.raises(ValueError, match="empty network"):
            parse_address("::agent:charlie")

    def test_raw_preserved(self):
        raw = "net123::openagents:claude-7f3a"
        addr = parse_address(raw)
        assert addr.raw == raw

    def test_agent_name_with_hyphens(self):
        addr = parse_address("agent:my-long-agent-name-123")
        assert addr.name == "my-long-agent-name-123"

    def test_human_email(self):
        addr = parse_address("human:foo+bar@example.co.uk")
        assert addr.name == "foo+bar@example.co.uk"

    def test_resource_nested_path(self):
        addr = parse_address("resource/file/path/to/deep/file.txt")
        assert addr.entity_type == "resource"
        assert addr.name == "file/path/to/deep/file.txt"


# ---------------------------------------------------------------------------
# __str__ round-trip
# ---------------------------------------------------------------------------

class TestAddressStr:
    """Verify __str__ produces valid addresses."""

    def test_local_agent(self):
        addr = parse_address("agent:charlie")
        assert str(addr) == "agent:charlie"

    def test_local_openagents(self):
        addr = parse_address("openagents:claude-7f3a")
        assert str(addr) == "openagents:claude-7f3a"

    def test_local_channel(self):
        addr = parse_address("channel/general")
        assert str(addr) == "channel/general"

    def test_local_core(self):
        addr = parse_address("core")
        assert str(addr) == "core"

    def test_cross_network(self):
        addr = parse_address("net123::agent:charlie")
        assert str(addr) == "net123::agent:charlie"

    def test_human(self):
        addr = parse_address("human:user@example.com")
        assert str(addr) == "human:user@example.com"


# ---------------------------------------------------------------------------
# Address factory helpers
# ---------------------------------------------------------------------------

class TestAddressHelpers:

    def test_make_agent_local(self):
        assert make_agent_address("charlie") == "agent:charlie"

    def test_make_agent_global(self):
        assert make_agent_address("claude-7f3a", global_agent=True) == "openagents:claude-7f3a"

    def test_make_human(self):
        assert make_human_address("user@example.com") == "human:user@example.com"

    def test_make_channel(self):
        assert make_channel_address("session-abc") == "channel/session-abc"

    def test_make_resource(self):
        assert make_resource_address("tool", "search_web") == "resource/tool/search_web"
