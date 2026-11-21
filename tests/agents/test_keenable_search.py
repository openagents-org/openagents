"""
Test cases for the Keenable search tool.

Tests cover the keyless and keyed requests, response parsing, error
handling and input validation. HTTP is mocked; no network calls are made.
"""

import os
from unittest.mock import MagicMock, patch

import requests

from openagents.tools.keenable_search import KEYED_URL, KEYLESS_URL, search_keenable

RESPONSE = {
    "results": [
        {"title": "OpenAgents", "url": "https://openagents.org", "snippet": "Open agent networks.", "description": ""},
        {"title": "", "url": "https://github.com/openagents-org/openagents", "description": "Source code."},
        {"title": "no url"},
    ]
}


def _response(payload=None, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = payload
    return response


class TestSearchKeenable:
    def test_keyless_request_and_formatting(self):
        with patch.dict(os.environ, {}, clear=False) as env, patch(
            "openagents.tools.keenable_search.requests.post", return_value=_response(RESPONSE)
        ) as post:
            env.pop("KEENABLE_API_KEY", None)
            result = search_keenable("open agent networks", num_results=50)

        args, kwargs = post.call_args
        assert args[0] == KEYLESS_URL
        assert kwargs["headers"]["X-Keenable-Title"] == "OpenAgents"
        assert "X-API-Key" not in kwargs["headers"]
        assert kwargs["json"] == {"query": "open agent networks", "max_results": 20}
        assert kwargs["allow_redirects"] is False
        assert result == (
            "Search results for 'open agent networks':\n\n"
            "1. OpenAgents\n   URL: https://openagents.org\n   Open agent networks.\n\n"
            "2. No Title\n   URL: https://github.com/openagents-org/openagents\n   Source code."
        )

    def test_keyed_request(self):
        with patch.dict(os.environ, {"KEENABLE_API_KEY": "test-key"}), patch(
            "openagents.tools.keenable_search.requests.post", return_value=_response({"results": []})
        ) as post:
            result = search_keenable("query")

        args, kwargs = post.call_args
        assert args[0] == KEYED_URL
        assert kwargs["headers"]["X-API-Key"] == "test-key"
        assert "X-Keenable-Title" not in kwargs["headers"]
        assert kwargs["json"]["max_results"] == 5
        assert result == "No results found for: query"

    def test_rate_limit_and_http_error(self):
        with patch("openagents.tools.keenable_search.requests.post", return_value=_response(status_code=429)):
            assert "rate limit reached" in search_keenable("q")
        with patch("openagents.tools.keenable_search.requests.post", return_value=_response(status_code=500)):
            assert search_keenable("q") == "Keenable search error: HTTP 500"
        with patch("openagents.tools.keenable_search.requests.post", return_value=_response(status_code=307)):
            assert search_keenable("q") == "Keenable search error: HTTP 307"

    def test_request_exception(self):
        with patch("openagents.tools.keenable_search.requests.post", side_effect=requests.Timeout("secret detail")):
            assert search_keenable("q") == "Keenable search error: Timeout"

    def test_invalid_json(self):
        response = _response()
        response.json.side_effect = ValueError("bad")
        with patch("openagents.tools.keenable_search.requests.post", return_value=response):
            assert search_keenable("q") == "Keenable search error: invalid JSON response"

    def test_empty_query_sends_nothing(self):
        with patch("openagents.tools.keenable_search.requests.post") as post:
            assert search_keenable("  ") == "Keenable search error: query must not be empty"
        post.assert_not_called()
