"""Telegram sendMessage payloads produced by the outbound workspace bridge."""

import json

import httpx
import pytest
from app.services import integrations as svc


@pytest.fixture
def telegram(monkeypatch):
    requests = []
    responses = []

    def send(request):
        assert request.url.path == "/bottest-token/sendMessage"
        requests.append(json.loads(request.content))
        status, data = responses.pop(0) if responses else (200, {"ok": True})
        return httpx.Response(status, json=data)

    client_cls = httpx.Client
    monkeypatch.setattr(svc.httpx, "Client", lambda **kw: client_cls(transport=httpx.MockTransport(send), **kw))
    return requests, responses


def marked_text(payload):
    # Telegram counts UTF-16 code units, including two units for an emoji.
    text = payload["text"].encode("utf-16-le")
    return [
        (e["type"], text[2 * e["offset"] : 2 * (e["offset"] + e["length"])].decode("utf-16-le"), e.get("url"))
        for e in payload.get("entities", [])
    ]


def test_markdown_reaches_send_message_with_unicode_offsets(telegram):
    requests, _ = telegram
    svc._send_telegram("test-token", "42", "**Bot**", "😀 **重点** and `x < y`\n[Docs](https://example.org/guide)")
    [payload] = requests
    assert payload["chat_id"] == "42"
    assert payload["text"] == "**Bot**:\n😀 重点 and x < y\nDocs"
    assert marked_text(payload) == [
        ("bold", "重点", None),
        ("code", "x < y", None),
        ("text_link", "Docs", "https://example.org/guide"),
    ]


def test_code_fence_crosses_message_boundary(telegram):
    requests, _ = telegram
    code = "😀x" * 2300 + " **literal** <tag>"
    svc._send_telegram("test-token", "42", "bot", f"Before\n\n```python\n{code}\n```\n\nAfter")
    assert len(requests) == 2
    assert "".join(p["text"] for p in requests) == f"bot:\nBefore\n\n{code}\n\nAfter"
    assert "".join(value for p in requests for kind, value, _ in marked_text(p) if kind == "pre") == code


def test_truncation_marker_outside_formatting(telegram):
    requests, _ = telegram
    svc._send_telegram("test-token", "42", "bot", "**" + "a" * 15000 + "**")
    assert len(requests) == 3
    assert all(len(p["text"]) <= 4096 for p in requests)
    assert requests[-1]["text"].endswith("\n… (truncated)")
    assert marked_text(requests[-1]) == [("bold", "a" * 4000, None)]


def test_unsupported_blocks_and_plain_html_stay_readable(telegram):
    requests, _ = telegram
    svc._send_telegram(
        "test-token", "42", "bot", "# Report\n\n| A | B |\n|---|---|\n| x | y |\n\n<tag> file_name **unfinished"
    )
    assert requests[0]["text"] == "bot:\nReport\n\n| A | B |\n|---|---|\n| x | y |\n\n<tag> file_name **unfinished"


def test_format_rejection_retries_only_the_rejected_chunk(telegram):
    requests, responses = telegram
    responses.extend([(200, {"ok": True}), (400, {"ok": False, "description": "Bad Request: can't parse entities"})])
    svc._send_telegram("test-token", "42", "bot", "**" + "x" * 4100 + "**")
    first, rejected, retry = requests
    assert "entities" in first and "entities" in rejected
    assert retry == {"chat_id": "42", "text": rejected["text"]}


def test_delivery_failure_is_not_retried_as_plain_text(telegram):
    requests, responses = telegram
    responses.append((403, {"ok": False, "description": "Forbidden"}))
    with pytest.raises(RuntimeError, match="Forbidden"):
        svc._send_telegram("test-token", "42", "bot", "**hello**")
    assert len(requests) == 1


def test_links_preserve_code_labels_and_relative_destinations(telegram):
    requests, _ = telegram
    svc._send_telegram("test-token", "42", "bot", "[`guide`](https://example.org) and [notes](./notes.md)")
    assert requests[0]["text"] == "bot:\nguide and notes (./notes.md)"
    assert marked_text(requests[0]) == [("text_link", "guide", "https://example.org")]


def test_human_message_preserves_literal_markdown(telegram):
    requests, _ = telegram
    svc._send_telegram("test-token", "42", "Jane", "keep **this** and `that`", markdown=False)
    assert requests == [{"chat_id": "42", "text": "Jane:\nkeep **this** and `that`"}]
