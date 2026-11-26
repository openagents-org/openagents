"""Text PostgreSQL cannot store (NUL, lone surrogates) is cleaned before writes."""
import asyncio
import logging
from uuid import uuid4

from app.db_text import clean
from app.models import EventRecord

HALF_EMOJI = "Responded …\udc4b"      # a reply preview cut inside an emoji


def test_clean_drops_nul_and_replaces_lone_surrogates():
    assert clean("a\x00b") == ("ab", True)
    assert clean(HALF_EMOJI) == ("Responded …�", True)
    assert clean("ok \U0001F44B") == ("ok \U0001F44B", False)      # a whole emoji is fine
    value = {"agents": [{"name": "a", "reply": HALF_EMOJI}], "n": 1}
    cleaned, changed = clean(value)
    assert changed and cleaned["agents"][0]["reply"].endswith("�") and cleaned["n"] == 1
    untouched = {"a": ["b", 1]}
    assert clean(untouched) == (untouched, False) and clean(untouched)[0] is untouched


def test_rows_with_bad_text_save_cleaned_on_insert_and_update(db, workspace):
    row = EventRecord(id=str(uuid4()), network_id=workspace['id'], source="openagents:a\x00",
                      target="channel/general", type="workspace.message.posted", timestamp=1,
                      visibility="channel", payload={"content": "hi\x00", "reply": HALF_EMOJI})
    db.add(row)
    db.commit()            # failed before: SQLite cannot encode the lone surrogate either
    db.expire_all()
    saved = db.get(EventRecord, row.id)
    assert saved.source == "openagents:a"
    assert saved.payload == {"content": "hi", "reply": "Responded …�"}
    saved.payload = {"content": "edited \udc4b"}
    db.commit()
    db.expire_all()
    assert db.get(EventRecord, row.id).payload == {"content": "edited �"}


def test_stream_cancellations_at_worker_shutdown_are_not_logged_as_errors():
    from app.main import _StreamShutdownFilter
    f = _StreamShutdownFilter()
    def record(exc):
        return logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1, "Exception in ASGI application",
                                 None, (type(exc), exc, None))
    assert f.filter(record(asyncio.CancelledError("Task cancelled, timeout graceful shutdown exceeded"))) is False
    assert f.filter(record(RuntimeError("boom"))) is True
