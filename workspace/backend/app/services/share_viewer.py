# -*- coding: utf-8 -*-
"""The page a public artifact link opens: https://<share host>/<token>.

Served by the backend on the separate share domain (app/routers/public_shares.py),
so a shared link never reads as part of the product. The page is plain HTML
with no script of its own: images, video, audio and PDFs load from the
token's own paths; markdown and tables are rendered here; an HTML page or web
project is framed, sandboxed, under a banner saying a workspace member made
it. Everything the person shared is escaped or framed — nothing they wrote
runs on this page.
"""

import html
import re
from typing import Optional
from urllib.parse import quote

from markdown_it import MarkdownIt

from app.models import PublicShare
from app.services import public_shares as shares

MAX_TEXT_BYTES = 2 * 1024 * 1024
MAX_SHEET_ROWS = 500

# Raw HTML in a document is shown as text, never parsed: the "html" option off
# escapes it, and markdown-it refuses javascript: and similar link schemes.
_md = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table").enable("strikethrough")

_STRINGS = {
    "en": {
        "title": "Shared file",
        "download": "Download",
        "open": "Open full page",
        "shared": "Shared {date}",
        "expires": "Link expires {date}",
        "gone": "This link is no longer available. It may have been turned off, or the file was deleted.",
        "expired": "This link has expired.",
        "no_preview": "This file can’t be previewed here. Download it to open.",
        "user_content": "This page was made by a workspace member, not by OpenAgents. Never enter a password or payment details here.",
        "truncated": "Showing the first {shown} of {total} rows. Download the file for the rest.",
        "footer": "Shared from an OpenAgents workspace",
    },
    "zh": {
        "title": "分享的文件",
        "download": "下载",
        "open": "打开完整页面",
        "shared": "分享于 {date}",
        "expires": "链接 {date} 失效",
        "gone": "此链接已失效，可能已被关闭或文件已删除。",
        "expired": "此链接已过期。",
        "no_preview": "此类文件无法在线预览，请下载后查看。",
        "user_content": "此页面由工作区成员制作，并非 OpenAgents 官方页面。请勿在此输入密码或支付信息。",
        "truncated": "仅显示前 {shown} 行（共 {total} 行），完整内容请下载文件。",
        "footer": "分享自 OpenAgents 工作区",
    },
}

# The page's own lockdown: no script, nothing from anywhere but this host, no
# forms. The framed site carries its own, stricter policy.
PAGE_CSP = ("default-src 'none'; img-src 'self' data:; media-src 'self'; frame-src 'self'; "
            "style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")

_CSS = """
*{box-sizing:border-box}body{margin:0;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#18181b;background:#fff;display:flex;flex-direction:column;min-height:100vh}
header{display:flex;align-items:center;gap:12px;padding:12px 24px;border-bottom:1px solid #e4e4e7}
header .t{flex:1;min-width:0}h1{margin:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header p{margin:0;font-size:12px;color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
a.btn{display:inline-flex;align-items:center;padding:6px 12px;border-radius:6px;font-size:13px;text-decoration:none;white-space:nowrap}
a.primary{background:#18181b;color:#fff}a.outline{border:1px solid #e4e4e7;color:#18181b}
.warn{padding:8px 24px;font-size:12px;background:#fffbeb;color:#78350f;border-bottom:1px solid #fde68a}
main{flex:1;min-height:0;display:flex;flex-direction:column}
.center{flex:1;display:flex;align-items:center;justify-content:center;padding:16px}
.center img,.center video{max-width:100%;max-height:85vh}
iframe{flex:1;width:100%;min-height:80vh;border:0;background:#fff}
article{max-width:768px;width:100%;margin:0 auto;padding:24px}
article img{max-width:100%}article pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto}
article code{background:#f4f4f5;padding:1px 4px;border-radius:4px}article pre code{padding:0;background:none}
article table,.sheet table{border-collapse:collapse}article th,article td{border:1px solid #e4e4e7;padding:4px 10px}
article blockquote{margin:0;padding-left:12px;border-left:3px solid #e4e4e7;color:#52525b}
pre.text{max-width:1024px;width:100%;margin:0 auto;padding:24px;white-space:pre-wrap;word-break:break-word}
.sheet{padding:16px;overflow:auto}.sheet table{font-size:12px}.sheet th{background:#f4f4f5;text-align:left;position:sticky;top:0}
.sheet th,.sheet td{border:1px solid #e4e4e7;padding:4px 10px;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis}
.note{font-size:12px;color:#71717a;padding:8px 16px}
.msg{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;color:#52525b}
footer{padding:10px 24px;font-size:12px;color:#a1a1aa;border-top:1px solid #f4f4f5}footer a{color:inherit}
"""


def language(accept_language: Optional[str]) -> str:
    first = (accept_language or "").split(",")[0].strip().lower()
    return "zh" if first.startswith("zh") else "en"


def _size(n: Optional[int]) -> str:
    n = n or 0
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return ""


def _shell(title: str, header: str, body: str, lang: str, banner: str = "") -> str:
    s = _STRINGS[lang]
    return (f"<!doctype html><html lang=\"{lang}\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta name=\"referrer\" content=\"no-referrer\"><meta name=\"robots\" content=\"noindex,nofollow\">"
            f"<title>{html.escape(title)}</title><style>{_CSS}</style></head><body>"
            f"{header}{banner}<main>{body}</main>"
            f"<footer>{html.escape(s['footer'])} · <a href=\"https://openagents.org\" rel=\"noopener noreferrer\">openagents.org</a></footer>"
            "</body></html>")


def error_page(why: str, lang: str) -> str:
    s = _STRINGS[lang]
    message = s["expired"] if "expired" in (why or "").lower() else s["gone"]
    return _shell(s["title"], "", f"<div class=\"msg\"><h1>{html.escape(s['title'])}</h1><p>{html.escape(message)}</p></div>", lang)


def _kind(link: PublicShare) -> str:
    type_ = (link.content_type or "").lower()
    name = (link.title or "").lower()
    if link.entrypoint:
        return "page"
    if shares.is_web_project(link.content_type):
        return "none"
    if link.resource_kind == "knowledge" or shares.is_markdown(type_, name):
        return "markdown"
    if type_ in ("text/csv", "text/tab-separated-values") or name.endswith((".csv", ".tsv")):
        return "sheet"
    if type_.startswith("image/"):
        return "image"
    if type_.startswith("video/"):
        return "video"
    if type_.startswith("audio/"):
        return "audio"
    if "pdf" in type_:
        return "pdf"
    if type_.startswith("text/") or type_ == "application/json" or name.endswith((".json", ".txt", ".log", ".yaml", ".yml")):
        return "text"
    return "none"


def _parse_delimited(text: str, delimiter: str) -> list:
    """RFC 4180-ish: quoted cells, doubled quotes, embedded newlines."""
    rows, row, cell, quoted, i = [], [], "", False, 0
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == '"':
                if text[i + 1:i + 2] == '"':
                    cell += '"'
                    i += 1
                else:
                    quoted = False
            else:
                cell += ch
        elif ch == '"':
            quoted = True
        elif ch == delimiter:
            row.append(cell)
            cell = ""
        elif ch == "\n":
            row.append(cell)
            rows.append(row)
            row, cell = [], ""
        elif ch != "\r":
            cell += ch
        i += 1
    if cell or row:
        row.append(cell)
        rows.append(row)
    return rows


def _sheet(text: str, delimiter: str, s: dict) -> str:
    rows = _parse_delimited(text, delimiter)
    if not rows:
        return ""
    shown = rows[:MAX_SHEET_ROWS + 1]
    head, body = shown[0], shown[1:]
    esc = html.escape
    out = ["<div class=\"sheet\"><table><thead><tr>", *(f"<th>{esc(c)}</th>" for c in head), "</tr></thead><tbody>"]
    for row in body:
        out.append("<tr>" + "".join(f"<td title=\"{esc(c)}\">{esc(c)}</td>" for c in (row + [""] * (len(head) - len(row)))[:len(head)]) + "</tr>")
    out.append("</tbody></table></div>")
    if len(rows) - 1 > MAX_SHEET_ROWS:
        out.append(f"<p class=\"note\">{esc(s['truncated'].format(shown=MAX_SHEET_ROWS, total=len(rows) - 1))}</p>")
    return "".join(out)


def page(link: PublicShare, data: Optional[bytes], lang: str, format_date) -> str:
    """The viewer for a link ``resolve_public`` let through. ``data`` is the
    snapshot's bytes for the kinds rendered here (markdown, tables, text)."""
    s = _STRINGS[lang]
    esc = html.escape
    token = quote(link.token, safe="")
    kind = _kind(link)
    meta = [_size(link.size)]
    if link.snapshot_at:
        meta.append(s["shared"].format(date=format_date(link.snapshot_at)))
    if link.expires_at:
        meta.append(s["expires"].format(date=format_date(shares._aware(link.expires_at))))
    actions = ""
    if kind == "page":
        site = f"/v1/public/shares/{token}/site/{quote(link.entrypoint, safe='/')}"
        actions += f"<a class=\"btn outline\" href=\"{esc(site)}\" target=\"_blank\" rel=\"noopener noreferrer\">{esc(s['open'])}</a>"
    actions += f"<a class=\"btn primary\" href=\"/{token}/download\">{esc(s['download'])}</a>"
    header = (f"<header><div class=\"t\"><h1 title=\"{esc(link.title)}\">{esc(link.title)}</h1>"
              f"<p>{esc(' · '.join(meta))}</p></div>{actions}</header>")
    raw = f"/{token}/raw"
    banner = ""
    text = (data or b"")[:MAX_TEXT_BYTES].decode("utf-8", "replace") if data is not None else ""
    if kind == "page":
        banner = f"<div class=\"warn\">{esc(s['user_content'])}</div>"
        body = f"<iframe title=\"{esc(link.title)}\" src=\"{esc(site)}\" sandbox=\"allow-scripts\" referrerpolicy=\"no-referrer\"></iframe>"
    elif kind == "image":
        body = f"<div class=\"center\"><img src=\"{raw}\" alt=\"{esc(link.title)}\"></div>"
    elif kind == "video":
        body = f"<div class=\"center\"><video src=\"{raw}\" controls preload=\"metadata\"></video></div>"
    elif kind == "audio":
        body = f"<div class=\"center\"><audio src=\"{raw}\" controls preload=\"metadata\"></audio></div>"
    elif kind == "pdf":
        body = f"<iframe title=\"{esc(link.title)}\" src=\"{raw}\"></iframe>"
    elif kind == "markdown":
        text = re.sub(rf"{re.escape(shares.ASSET_SCHEME)}(\d+)", lambda m: f"/{token}/assets/{m.group(1)}", text)
        body = f"<article>{_md.render(text)}</article>"
    elif kind == "sheet":
        delimiter = "\t" if (link.title or "").lower().endswith(".tsv") or "tab-separated" in (link.content_type or "") else ","
        body = _sheet(text, delimiter, s)
    elif kind == "text":
        body = f"<pre class=\"text\">{esc(text)}</pre>"
    else:
        body = f"<div class=\"msg\"><p>{esc(s['no_preview'])}</p></div>"
    return _shell(link.title or s["title"], header, body, lang, banner)


def renders_from_bytes(link: PublicShare) -> bool:
    return _kind(link) in ("markdown", "sheet", "text")


def inline_kind(link: PublicShare) -> Optional[str]:
    """What /raw may serve inline: the media the page embeds, never HTML."""
    kind = _kind(link)
    return kind if kind in ("image", "video", "audio", "pdf") else None
