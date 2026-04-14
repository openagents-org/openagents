"""
Test cases for Exa search tool.

Tests cover API response parsing, content snippet fallback logic,
and disabled state when EXA_API_KEY is unset.
"""

import os
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from openagents.tools.exa_search import _extract_snippet, _get_client, search_exa

# --- Fixtures ---

SAMPLE_RESULT_HIGHLIGHTS = MagicMock(
    title="Exa: AI-Powered Search",
    url="https://exa.ai",
    published_date="2024-06-15",
    highlights=["Exa provides AI-powered web search.", "Built for developers."],
    summary="Exa is a search engine for AI.",
    text="Full page text content here.",
)

SAMPLE_RESULT_SUMMARY_ONLY = MagicMock(
    title="Neural Search Guide",
    url="https://example.com/neural-search",
    published_date=None,
    highlights=None,
    summary="A comprehensive guide to neural search techniques.",
    text=None,
)

SAMPLE_RESULT_TEXT_ONLY = MagicMock(
    title="Deep Learning Paper",
    url="https://arxiv.org/abs/1234",
    published_date="2024-01-10",
    highlights=None,
    summary=None,
    text="This paper explores deep learning approaches to information retrieval...",
)

SAMPLE_RESULT_EMPTY = MagicMock(
    title=None,
    url="",
    published_date=None,
    highlights=None,
    summary=None,
    text=None,
)

SAMPLE_RESPONSE = MagicMock(results=[SAMPLE_RESULT_HIGHLIGHTS, SAMPLE_RESULT_SUMMARY_ONLY])
EMPTY_RESPONSE = MagicMock(results=[])


# --- Tests ---


class TestExtractSnippet:
    """Tests for content snippet extraction with fallback logic."""

    def test_highlights_preferred(self):
        """Highlights should be used when available."""
        snippet = _extract_snippet(SAMPLE_RESULT_HIGHLIGHTS)
        assert "Exa provides AI-powered web search." in snippet
        assert "Built for developers." in snippet

    def test_fallback_to_summary(self):
        """Summary should be used when highlights are missing."""
        snippet = _extract_snippet(SAMPLE_RESULT_SUMMARY_ONLY)
        assert snippet == "A comprehensive guide to neural search techniques."

    def test_fallback_to_text(self):
        """Text should be used when both highlights and summary are missing."""
        snippet = _extract_snippet(SAMPLE_RESULT_TEXT_ONLY)
        assert "deep learning approaches" in snippet

    def test_text_truncation(self):
        """Long text should be truncated to 500 characters."""
        long_result = MagicMock(
            highlights=None,
            summary=None,
            text="x" * 600,
        )
        snippet = _extract_snippet(long_result)
        assert len(snippet) == 503  # 500 + "..."
        assert snippet.endswith("...")

    def test_empty_result(self):
        """Empty result should return empty string."""
        snippet = _extract_snippet(SAMPLE_RESULT_EMPTY)
        assert snippet == ""


class TestSearchExa:
    """Tests for the main search_exa function."""

    def test_missing_api_key(self):
        """Should return error message when EXA_API_KEY is not set."""
        with patch.dict(os.environ, {}, clear=True):
            # Remove EXA_API_KEY if present
            env = os.environ.copy()
            env.pop("EXA_API_KEY", None)
            with patch.dict(os.environ, env, clear=True):
                result = search_exa("test query")
                assert "EXA_API_KEY" in result
                assert "required" in result.lower() or "environment variable" in result.lower()

    @patch("openagents.tools.exa_search._get_client")
    def test_basic_search(self, mock_get_client):
        """Should format results correctly from a basic search."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        result = search_exa("AI search engines")

        assert "Exa: AI-Powered Search" in result
        assert "https://exa.ai" in result
        assert "Neural Search Guide" in result
        assert "Published: 2024-06-15" in result

        # Verify search was called with correct defaults
        mock_client.search.assert_called_once()
        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["query"] == "AI search engines"
        assert call_kwargs["num_results"] == 5
        assert call_kwargs["type"] == "auto"
        assert "highlights" in call_kwargs["contents"]

    @patch("openagents.tools.exa_search._get_client")
    def test_search_with_text_content_mode(self, mock_get_client):
        """Should request text content when content_mode is 'text'."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa("test", content_mode="text")

        call_kwargs = mock_client.search.call_args[1]
        assert "text" in call_kwargs["contents"]
        assert call_kwargs["contents"]["text"]["max_characters"] == 10000

    @patch("openagents.tools.exa_search._get_client")
    def test_search_with_summary_content_mode(self, mock_get_client):
        """Should request summary content when content_mode is 'summary'."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa("test", content_mode="summary")

        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["contents"] == {"summary": True}

    @patch("openagents.tools.exa_search._get_client")
    def test_search_with_no_content(self, mock_get_client):
        """Should omit contents when content_mode is 'none'."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa("test", content_mode="none")

        call_kwargs = mock_client.search.call_args[1]
        assert "contents" not in call_kwargs

    @patch("openagents.tools.exa_search._get_client")
    def test_empty_results(self, mock_get_client):
        """Should return 'no results' message when search returns empty."""
        mock_client = MagicMock()
        mock_client.search.return_value = EMPTY_RESPONSE
        mock_get_client.return_value = mock_client

        result = search_exa("nonexistent query xyz")
        assert "No results found" in result

    @patch("openagents.tools.exa_search._get_client")
    def test_domain_filtering(self, mock_get_client):
        """Should pass domain filters to the API."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa(
            "test",
            include_domains="arxiv.org, github.com",
            exclude_domains="twitter.com",
        )

        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["include_domains"] == ["arxiv.org", "github.com"]
        assert call_kwargs["exclude_domains"] == ["twitter.com"]

    @patch("openagents.tools.exa_search._get_client")
    def test_category_and_date_filtering(self, mock_get_client):
        """Should pass category and date filters to the API."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa(
            "AI research",
            category="research paper",
            start_published_date="2024-01-01T00:00:00.000Z",
            end_published_date="2024-12-31T23:59:59.000Z",
        )

        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["category"] == "research paper"
        assert call_kwargs["start_published_date"] == "2024-01-01T00:00:00.000Z"
        assert call_kwargs["end_published_date"] == "2024-12-31T23:59:59.000Z"

    @patch("openagents.tools.exa_search._get_client")
    def test_text_filtering(self, mock_get_client):
        """Should pass text include/exclude filters to the API."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa("test", include_text="python", exclude_text="java")

        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["include_text"] == ["python"]
        assert call_kwargs["exclude_text"] == ["java"]

    @patch("openagents.tools.exa_search._get_client")
    def test_num_results_capped_at_100(self, mock_get_client):
        """Should cap num_results at 100."""
        mock_client = MagicMock()
        mock_client.search.return_value = SAMPLE_RESPONSE
        mock_get_client.return_value = mock_client

        search_exa("test", num_results=200)

        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["num_results"] == 100

    @patch("openagents.tools.exa_search._get_client")
    def test_api_error_handling(self, mock_get_client):
        """Should return error message when API call fails."""
        mock_client = MagicMock()
        mock_client.search.side_effect = Exception("API rate limit exceeded")
        mock_get_client.return_value = mock_client

        result = search_exa("test query")
        assert "Exa search error" in result
        assert "rate limit" in result

    @patch("openagents.tools.exa_search._get_client")
    def test_null_title_handling(self, mock_get_client):
        """Should handle results with null titles gracefully."""
        mock_client = MagicMock()
        mock_client.search.return_value = MagicMock(results=[SAMPLE_RESULT_EMPTY])
        mock_get_client.return_value = mock_client

        result = search_exa("test")
        assert "No Title" in result


class TestGetClient:
    """Tests for client initialization."""

    def test_client_requires_api_key(self):
        """Should raise ValueError when EXA_API_KEY is not set."""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="EXA_API_KEY"):
                _get_client()

    def test_client_sets_tracking_header(self):
        """Should set x-exa-integration tracking header."""
        mock_client = MagicMock()
        mock_client.headers = {}

        # Create a fake exa_py module so the local import resolves
        fake_exa_py = types.ModuleType("exa_py")
        fake_exa_py.Exa = MagicMock(return_value=mock_client)

        with patch.dict(os.environ, {"EXA_API_KEY": "test-key"}):
            with patch.dict(sys.modules, {"exa_py": fake_exa_py}):
                client = _get_client()
                assert client.headers["x-exa-integration"] == "openagents"
