"""
Test cases for the Autom search tool.

Tests cover the request for each engine, response parsing, the error
envelope, and the disabled state when AUTOM_API_KEY is unset.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from openagents.tools.autom_search import search_autom

SEARCH_RESPONSE = {
    "organic_results": [
        {"position": 1, "title": "OpenAgents", "link": "https://openagents.org", "snippet": "Open agent networks."},
        {"position": 2, "title": "No link", "link": "", "snippet": "Skipped."},
        {"position": 3, "title": "OpenAgents on GitHub", "link": "https://github.com/openagents-org/openagents"},
    ]
}

NEWS_RESPONSE = {
    "organic_results": [
        {"position": 1, "title": "Agents news", "link": "https://news.example.com/a", "snippet": "", "date": "2026-11-06"},
    ]
}


def _response(payload, ok=True, status_code=200):
    response = MagicMock(ok=ok, status_code=status_code)
    response.json.return_value = payload
    return response


@pytest.fixture
def api_key():
    with patch.dict(os.environ, {"AUTOM_API_KEY": "test-key"}):
        yield


class TestSearchAutom:
    def test_missing_api_key_returns_message(self):
        with patch.dict(os.environ, {}, clear=True):
            result = search_autom("test")
        assert "AUTOM_API_KEY" in result

    def test_unknown_engine_returns_message(self, api_key):
        with patch("openagents.tools.autom_search.requests.get") as get:
            result = search_autom("test", engine="unknown")
        get.assert_not_called()
        assert "engine must be one of" in result

    def test_google_sends_query_country_language_and_formats_results(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response(SEARCH_RESPONSE)) as get:
            result = search_autom("openagents", country="DE", language="de")

        assert get.call_args.args[0] == "https://api.autom.dev/v1/google/search"
        kwargs = get.call_args.kwargs
        assert kwargs["params"] == {"query": "openagents", "gl": "de", "hl": "de"}
        assert kwargs["headers"]["x-api-key"] == "test-key"
        assert "1. OpenAgents" in result
        assert "URL: https://openagents.org" in result
        assert "Open agent networks." in result
        assert "2. OpenAgents on GitHub" in result
        assert "No link" not in result

    @pytest.mark.parametrize(
        "engine,path",
        [
            ("google_news", "google/news"),
            ("brave", "brave/search"),
            ("duckduckgo", "duckduckgo/search"),
            ("yahoo", "yahoo/search"),
        ],
    )
    def test_each_engine_calls_its_endpoint(self, api_key, engine, path):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response(NEWS_RESPONSE)) as get:
            result = search_autom("agents", engine=engine)
        assert get.call_args.args[0] == f"https://api.autom.dev/v1/{path}"
        assert get.call_args.kwargs["params"] == {"query": "agents", "gl": "us"}
        assert "Date: 2026-11-06" in result

    def test_bing_takes_the_country_as_cc_and_no_language(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response(SEARCH_RESPONSE)) as get:
            search_autom("agents", engine="bing", country="FR", language="fr")
        assert get.call_args.args[0] == "https://api.autom.dev/v1/bing/search"
        assert get.call_args.kwargs["params"] == {"query": "agents", "cc": "fr"}

    def test_num_results_limits_output(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response(SEARCH_RESPONSE)):
            result = search_autom("openagents", num_results=1)
        assert "1. OpenAgents" in result
        assert "2. " not in result

    def test_error_envelope_returns_message(self, api_key):
        payload = {"error": "Invalid API Key"}
        with patch(
            "openagents.tools.autom_search.requests.get", return_value=_response(payload, ok=False, status_code=401)
        ):
            result = search_autom("test")
        assert result == "Autom search error: Invalid API Key"

    def test_non_object_json_returns_message(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response(["unexpected"])):
            result = search_autom("test")
        assert result == "Autom search error: unexpected response (HTTP 200)"

    def test_request_exception_returns_message(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", side_effect=Exception("connection reset")):
            result = search_autom("test")
        assert result == "Autom search error: connection reset"

    def test_empty_results(self, api_key):
        with patch("openagents.tools.autom_search.requests.get", return_value=_response({"organic_results": []})):
            result = search_autom("nothing here")
        assert result == "No results found for: nothing here"
