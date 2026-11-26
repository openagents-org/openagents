"""Render workspace Markdown as Telegram sendMessage text and formatting entities."""

from itertools import chain

from markdown_it import MarkdownIt

# Unhandled block syntax (e.g. list markers and table pipes) remains readable text.
_md = MarkdownIt("zero").enable(
    [
        "fence",
        "code",
        "heading",
        "backticks",
        "emphasis",
        "strikethrough",
        "escape",
        "newline",
        "link",
        "autolink",
        "entity",
    ]
)
_STYLE = {"strong": "bold", "em": "italic", "s": "strikethrough"}
_CHUNK_SIZE = 4000  # Leave room under Telegram's 4096-character limit for the notice.
_MAX_CHUNKS = 3


def _inline_runs(tokens):
    """Yield text with its active Telegram entity types. Code cannot nest inside styles."""
    styles = []
    link_url = None
    for token in tokens:
        if token.nesting == 1:
            if token.type == "link_open":
                link_url = token.attrGet("href")
                supported = link_url.lower().startswith(("https://", "http://", "mailto:"))
                styles.append({"type": "text_link", "url": link_url} if supported else None)
            else:
                styles.append({"type": _STYLE[token.tag]})
        elif token.nesting == -1:
            style = styles.pop()
            if token.type == "link_close" and style is None:
                # Relative destinations cannot be Telegram text links. Keep them visible.
                yield f" ({link_url})", []
        elif token.type == "code_inline":
            # Telegram forbids overlapping code and link entities. Keep a linked
            # filename clickable even when the author used backticks for its label.
            links = [style for style in styles if style and style["type"] == "text_link"]
            yield token.content, links or [{"type": "code"}]
        elif token.type in ("softbreak", "hardbreak"):
            yield "\n", []
        else:
            yield token.content, [style for style in styles if style]


def _markdown_runs(content):
    """Retain the blank lines between parsed blocks, including fenced code."""
    last_end = None
    for token in _md.parse(content):
        if token.type not in ("inline", "code_block", "fence"):
            continue
        start, end = token.map
        if last_end is not None:
            yield "\n" * (start - last_end + 1), []
        last_end = end
        if token.type == "inline":
            yield from _inline_runs(token.children)
        else:
            yield token.content.removesuffix("\n"), [{"type": "pre"}]


def telegram_messages(sender: str, content: str, *, markdown: bool) -> list[dict]:
    """Split visible text first. Entity offsets start at zero in each message and use UTF-16."""
    body = _markdown_runs(content) if markdown else [(content, [])]
    chunks = [{"text": ""}]
    offset = 0
    for text, styles in chain([(f"{sender}:\n", [])], body):
        pos = 0
        while pos < len(text):
            chunk = chunks[-1]
            room = _CHUNK_SIZE - len(chunk["text"])
            if room == 0:
                if len(chunks) == _MAX_CHUNKS:
                    chunk["text"] += "\n… (truncated)"
                    return chunks
                chunks.append({"text": ""})
                offset = 0
                continue
            part = text[pos : pos + room]
            chunk["text"] += part
            units = len(part.encode("utf-16-le")) // 2
            if styles:
                # Telegram excludes trailing whitespace from an entity's length.
                length = len(part.rstrip().encode("utf-16-le")) // 2
                if length:
                    chunk.setdefault("entities", []).extend(
                        {**style, "offset": offset, "length": length} for style in styles
                    )
            offset += units
            pos += len(part)
    return chunks
