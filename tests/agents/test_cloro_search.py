"""
Test cases for the cloro search tool.

Tests cover the request for each engine, response parsing, the error
envelope, and the disabled state when CLORO_API_KEY is unset.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from openagents.tools.cloro_search import search_cloro

GOOGLE_RESPONSE = {
    "success": True,
    "result": {
        "organicResults": [
            {"position": 1, "title": "OpenAgents", "link": "https://openagents.org", "snippet": "Open agent networks."},
            {
                "position": 2,
                "title": "OpenAgents on GitHub",
                "link": "https://github.com/openagents-org/openagents",
                "snippet": "",
            },
        ]
    },
}

AIMODE_RESPONSE = {
    "success": True,
    "result": {
        "text": "Plain answer.",
        "markdown": "**Markdown** answer.",
        "sources": [
            {
                "position": 1,
                "label": "OpenAgents docs",
                "url": "https://openagents.org/docs",
                "description": "Getting started.",
            },
        ],
    },
}


def _response(payload, ok=True, status_code=200):
    response = MagicMock(ok=ok, status_code=status_code)
    response.json.return_value = payload
    return response


@pytest.fixture
def api_key():
    with patch.dict(os.environ, {"CLORO_API_KEY": "test-key"}):
        yield


class TestSearchCloro:
    def test_missing_api_key_returns_message(self):
        with patch.dict(os.environ, {}, clear=True):
            result = search_cloro("test")
        assert "CLORO_API_KEY" in result

    def test_unknown_engine_returns_message(self, api_key):
        with patch("openagents.tools.cloro_search.requests.post") as post:
            result = search_cloro("test", engine="unknown")
        post.assert_not_called()
        assert "engine must be one of" in result

    def test_google_sends_query_and_formats_results(self, api_key):
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(GOOGLE_RESPONSE)) as post:
            result = search_cloro("openagents", country="DE")

        url = post.call_args.args[0]
        kwargs = post.call_args.kwargs
        assert url == "https://api.cloro.dev/v1/monitor/google"
        assert kwargs["json"] == {"query": "openagents", "country": "DE"}
        assert kwargs["headers"]["Authorization"] == "Bearer test-key"
        assert "1. OpenAgents" in result
        assert "URL: https://openagents.org" in result
        assert "Open agent networks." in result
        assert "Answer:" not in result

    def test_num_results_limits_output(self, api_key):
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(GOOGLE_RESPONSE)):
            result = search_cloro("openagents", num_results=1)
        assert "1. OpenAgents" in result
        assert "2. " not in result

    @pytest.mark.parametrize("engine,path", [("aimode", "aimode"), ("bing_aimode", "bing/aimode")])
    def test_ai_mode_sends_prompt_and_returns_answer_with_sources(self, api_key, engine, path):
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(AIMODE_RESPONSE)) as post:
            result = search_cloro("what is openagents", engine=engine)

        assert post.call_args.args[0] == f"https://api.cloro.dev/v1/monitor/{path}"
        assert post.call_args.kwargs["json"] == {
            "prompt": "what is openagents",
            "country": "US",
            "include": {"markdown": True},
        }
        assert "Answer:\n**Markdown** answer." in result
        assert "1. OpenAgents docs" in result
        assert "URL: https://openagents.org/docs" in result

    def test_ai_mode_falls_back_to_text(self, api_key):
        payload = {"success": True, "result": {"text": "Plain answer.", "sources": []}}
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(payload)):
            result = search_cloro("test", engine="aimode")
        assert "Answer:\nPlain answer." in result

    def test_error_envelope_returns_message(self, api_key):
        payload = {"success": False, "error": {"code": "INSUFFICIENT_CREDITS", "message": "Not enough credits"}}
        with patch(
            "openagents.tools.cloro_search.requests.post", return_value=_response(payload, ok=False, status_code=402)
        ):
            result = search_cloro("test")
        assert result == "cloro search error: Not enough credits"

    def test_non_object_json_returns_message(self, api_key):
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(["unexpected"])):
            result = search_cloro("test")
        assert result == "cloro search error: unexpected response (HTTP 200)"

    def test_request_exception_returns_message(self, api_key):
        with patch("openagents.tools.cloro_search.requests.post", side_effect=Exception("connection reset")):
            result = search_cloro("test")
        assert result == "cloro search error: connection reset"

    def test_empty_results(self, api_key):
        payload = {"success": True, "result": {"organicResults": []}}
        with patch("openagents.tools.cloro_search.requests.post", return_value=_response(payload)):
            result = search_cloro("nothing here")
        assert result == "No results found for: nothing here"
