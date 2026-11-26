"""Keep text the database cannot store out of every row the app writes.

PostgreSQL rejects two things clients do send:
* NUL characters (``\\u0000``) in TEXT values and inside JSON/JSONB;
* unpaired UTF-16 surrogates (``\\udc4b``), typically from a client that cut
  a string in the middle of an emoji. JSONB refuses them ("Unicode low
  surrogate must follow a high surrogate") and they cannot be encoded as
  UTF-8 for TEXT either.

Either one used to fail the whole write: one node's heartbeat failed every
10 s for hours because its agent's reply preview ended in half an emoji, and
agent messages containing NUL were never saved. Before any ORM insert or
update, NULs are dropped and lone surrogates become U+FFFD in every string,
JSON or TEXT column value that is loaded on the instance.
"""
import re

from sqlalchemy import JSON, String, event, inspect

_BAD = re.compile("[\x00\ud800-\udfff]")


def _fix(match):
    return "" if match.group() == "\x00" else "\ufffd"


def clean(value):
    """Return (cleaned, changed) for str / dict / list values, recursively."""
    if isinstance(value, str):
        if _BAD.search(value) is None:
            return value, False
        return _BAD.sub(_fix, value), True
    if isinstance(value, dict):
        out, changed = {}, False
        for k, v in value.items():
            ck, kc = clean(k)
            cv, vc = clean(v)
            out[ck] = cv
            changed = changed or kc or vc
        return (out, True) if changed else (value, False)
    if isinstance(value, (list, tuple)):
        items = [clean(v) for v in value]
        if any(c for _, c in items):
            seq = [v for v, _ in items]
            return (seq if isinstance(value, list) else tuple(seq)), True
        return value, False
    return value, False


def _text_keys(mapper):
    keys = []
    for prop in mapper.column_attrs:
        if any(isinstance(col.type, (JSON, String)) for col in prop.columns):
            keys.append(prop.key)
    return keys


def _sanitize(mapper, connection, target):
    state = inspect(target)
    loaded = state.dict
    for key in _text_keys(mapper):
        if key not in loaded:      # never load an expired attribute here
            continue
        cleaned, changed = clean(loaded[key])
        if changed:
            setattr(target, key, cleaned)


def install_text_sanitizer(base):
    event.listen(base, "before_insert", _sanitize, propagate=True)
    event.listen(base, "before_update", _sanitize, propagate=True)
