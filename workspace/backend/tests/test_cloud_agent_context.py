# -*- coding: utf-8 -*-
"""
Tests for the cloud-agent conversation context builder.

Covers the fixes for constraint loss in long conversations: the window now
holds real conversation messages (noise rows don't consume slots), the
triggering message is excluded by event id rather than by position, and the
window size follows CLOUD_AGENT_MAX_CONTEXT_MESSAGES.
"""

import uuid

import pytest

from app.config import config
from app.models import EventRecord
from app.services.cloud_agent import _build_conversation_context

WORKSPACE_ID = str(uuid.uuid4())
CHANNEL = "channel/general"
AGENT = "opus-bot"


def _add_message(db, ts, content, source="human:user1", message_type="chat",
                 event_id=None):
    event_id = event_id or f"ev-{ts}"
    db.add(EventRecord(
        id=event_id,
        network_id=WORKSPACE_ID,
        type="workspace.message.posted",
        source=source,
        target=CHANNEL,
        payload={"content": content, "message_type": message_type},
        metadata_={},
        timestamp=ts,
    ))
    return event_id


def _build(db, exclude_event_id=None):
    return _build_conversation_context(
        db, WORKSPACE_ID, CHANNEL, AGENT, exclude_event_id=exclude_event_id,
    )


class TestConversationWindow:
    def test_early_constraint_survives_long_conversation(self, db):
        """A constraint from turn 1 must still reach the model at turn 30."""
        _add_message(db, 1, "CONSTRAINT the user_id field is confirmed as uuid")
        for i in range(2, 60):
            role = "human:user1" if i % 2 == 0 else f"openagents:{AGENT}"
            _add_message(db, i, f"turn {i}", source=role)
        db.commit()

        messages = _build(db)

        assert any("CONSTRAINT" in m["content"] for m in messages)

    def test_noise_rows_do_not_consume_window_slots(self, db):
        """thinking/status/todos rows must not push real messages out."""
        _add_message(db, 1, "real early message")
        for i in range(2, 2 + config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES):
            _add_message(db, i, f"status {i}", source=f"openagents:{AGENT}",
                         message_type="status")
        db.commit()

        messages = _build(db)

        assert messages == [{"role": "user", "content": "real early message"}]

    def test_window_caps_at_max_messages(self, db):
        limit = config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES
        for i in range(limit + 20):
            _add_message(db, i, f"msg {i}")
        trigger_id = _add_message(db, limit + 20, "trigger")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id)

        assert len(messages) == limit
        # The window keeps the most recent messages, dropping the oldest.
        assert messages[-1]["content"] == f"msg {limit + 19}"
        assert messages[0]["content"] == f"msg {20}"

    def test_current_message_excluded_by_id_not_position(self, db):
        """A message that lands after the trigger must not evict history."""
        _add_message(db, 1, "history message")
        trigger_id = _add_message(db, 2, "trigger @opus-bot do the thing")
        _add_message(db, 3, "late concurrent message")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id)

        contents = [m["content"] for m in messages]
        assert "trigger @opus-bot do the thing" not in contents
        assert "history message" in contents
        assert "late concurrent message" in contents

    def test_without_exclude_id_drops_newest_row(self, db):
        """Legacy behavior is preserved when no event id is supplied."""
        _add_message(db, 1, "history message")
        _add_message(db, 2, "current message")
        db.commit()

        messages = _build(db)

        assert [m["content"] for m in messages] == ["history message"]

    def test_role_mapping(self, db):
        _add_message(db, 1, "from human", source="human:user1")
        _add_message(db, 2, "from own agent", source=f"openagents:{AGENT}")
        _add_message(db, 3, "from other agent", source="openagents:other-bot")
        trigger_id = _add_message(db, 4, "trigger")
        db.commit()

        messages = _build(db, exclude_event_id=trigger_id)

        assert messages == [
            {"role": "user", "content": "from human"},
            {"role": "assistant", "content": "from own agent"},
            {"role": "user", "content": "from other agent"},
        ]

    def test_empty_content_skipped(self, db):
        _add_message(db, 1, "kept")
        _add_message(db, 2, "")
        db.commit()

        messages = _build(db)

        assert [m["content"] for m in messages] == ["kept"]


class TestDefaultWindowSize:
    def test_default_covers_long_conversations(self):
        """The old default of 10 (5 turns) caused early-constraint loss by
        turn 6; the raised default must cover far longer conversations."""
        assert config.CLOUD_AGENT_MAX_CONTEXT_MESSAGES >= 100
