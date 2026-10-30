# -*- coding: utf-8 -*-
"""app/services/agent_identity.py — who is a machine call acting for?"""

from app.services.agent_identity import agent_name_from_request, agent_name_from_source
from starlette.datastructures import Headers, QueryParams


class TestHeader:
    def test_header_wins(self):
        assert agent_name_from_request({"X-Agent-Name": "yumi"}, {"source": "openagents:other"}, {"source": "openagents:third"}) == "yumi"

    def test_header_case_insensitive_dict(self):
        assert agent_name_from_request({"x-agent-name": "yumi"}) == "yumi"

    def test_starlette_headers_and_query(self):
        h = Headers(raw=[(b"x-agent-name", b"  yumi ")])
        assert agent_name_from_request(h) == "yumi"
        assert agent_name_from_request(Headers(), QueryParams("source=openagents:scout")) == "scout"

    def test_blank_header_falls_through(self):
        assert agent_name_from_request({"X-Agent-Name": "   "}, {"source": "openagents:scout"}) == "scout"

    def test_rejects_control_chars_and_oversize(self):
        assert agent_name_from_request({"X-Agent-Name": "bad\nname"}) is None
        assert agent_name_from_request({"X-Agent-Name": "a" * 129}) is None
        assert agent_name_from_request({"X-Agent-Name": "a" * 128}) == "a" * 128


class TestSource:
    def test_query_then_body(self):
        assert agent_name_from_request({}, {"source": "openagents:q"}, {"source": "openagents:b"}) == "q"
        assert agent_name_from_request({}, {}, {"source": "openagents:b"}) == "b"

    def test_non_agent_sources_are_machine(self):
        for src in ("human:alice", "system", "openagents:", "openagents", "", None, 42, ["openagents:x"]):
            assert agent_name_from_source(src) is None, src
            assert agent_name_from_request({}, {"source": src}) is None, src

    def test_prefix_case_insensitive_name_preserved(self):
        assert agent_name_from_source("OpenAgents:Yumi") == "Yumi"

    def test_body_must_be_a_mapping(self):
        assert agent_name_from_request({}, {}, "source=openagents:x") is None
        assert agent_name_from_request({}, {}, ["openagents:x"]) is None

    def test_everything_absent(self):
        assert agent_name_from_request() is None
        assert agent_name_from_request(None, None, None) is None
        assert agent_name_from_request({}, {}, {}) is None
