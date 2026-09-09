# -*- coding: utf-8 -*-
"""
Truth-table tests for the push-notification filter logic.

These tests exercise the pure decision function `_should_push(event, agent_names)`
and the per-device preference gate `_prefs_allow`, without touching the
database or FCM. Network behavior is tested separately.
"""

from app.services.push import (
    _extract_mentions,
    _is_intermediate_step,
    _is_terminal_status,
    _prefs_allow,
    _should_push,
    _structured_status_kind,
)


def _make_event(*, source="openagents:claude-agent", message_type="chat",
                content="hi", event_type="workspace.message.posted",
                target="channel/general", payload_extra=None,
                metadata=None) -> dict:
    payload = {"content": content, "message_type": message_type}
    if payload_extra:
        payload.update(payload_extra)
    return {
        "id": "evt-1",
        "type": event_type,
        "source": source,
        "target": target,
        "payload": payload,
        "metadata": metadata or {},
        "timestamp": 0,
    }


class TestShouldPushChat:
    def test_agent_chat_pushes(self):
        ev = _make_event(message_type="chat", source="openagents:claude-agent")
        ok, reason, _target = _should_push(ev, set())
        assert ok and reason == "chat"

    def test_human_chat_pushes(self):
        # Human chat reaches the fan-out — the channel-membership filter in
        # _fanout_impl decides recipients, and the sender's own devices are
        # filtered out there. The classifier only says "yes, this is push-worthy."
        ev = _make_event(message_type="chat", source="human:user")
        ok, reason, _target = _should_push(ev, set())
        assert ok and reason == "chat"


class TestShouldPushStatus:
    def test_thinking_placeholder_skipped(self):
        ev = _make_event(message_type="status", content="thinking…")
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_terminal_stopped_pushed(self):
        ev = _make_event(message_type="status", content="Execution stopped by user")
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "status"

    def test_terminal_session_restarted_pushed(self):
        ev = _make_event(message_type="status",
                         content="Session restarted — next message starts fresh.")
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "status"

    def test_stopping_failed_pushed(self):
        ev = _make_event(message_type="status", content="Stopping failed: backend timeout")
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "status"

    def test_thinking_type_skipped(self):
        ev = _make_event(message_type="thinking", content="planning next step…")
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_bash_status_with_done_in_for_loop_not_pushed(self):
        # Regression: a Bash › for-loop ending with `done | head` used to
        # trip the substring filter on "done" and fire a push every time
        # the agent iterated over files.
        ev = _make_event(
            message_type="status",
            content=(
                "Bash › cd /tmp\n"
                "for f in $(grep -rliE 'foo' . 2>/dev/null); do\n"
                "  echo \"$f\"\n"
                "done | head -20"
            ),
        )
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_bash_status_with_failed_substring_not_pushed(self):
        # `grep "failed"` inside a Bash command shouldn't push.
        ev = _make_event(
            message_type="status",
            content='Bash › grep -i "failed" logs/*.txt',
        )
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_compacting_status_not_pushed(self):
        ev = _make_event(message_type="status", content="Compacting conversation...")
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_mcp_tool_call_status_not_pushed(self):
        ev = _make_event(
            message_type="status",
            content='mcp__insforge__run-raw-sql › SELECT COUNT(*) FROM events',
        )
        ok, _r, _t = _should_push(ev, set())
        assert not ok


class TestShouldPushMention:
    def test_mention_of_known_agent_in_chat_pushes(self):
        ev = _make_event(
            source="openagents:another-agent",
            message_type="chat",
            content="hey @claude-agent please look at this",
        )
        ok, reason, _t = _should_push(ev, {"claude-agent"})
        assert ok and reason == "mention"

    def test_mention_of_unknown_name_falls_through_to_chat(self):
        ev = _make_event(message_type="chat", content="see @random-username")
        ok, reason, _t = _should_push(ev, {"claude-agent"})
        # Falls through to chat rule (since source is agent by default).
        assert ok and reason == "chat"

    def test_mention_in_thinking_does_not_push(self):
        # Agent's intermediate "thinking" text often contains @names from
        # the user's original prompt. Should never push.
        ev = _make_event(
            message_type="thinking",
            content="I should ask @claude-agent about the next step",
        )
        ok, _r, _t = _should_push(ev, {"claude-agent"})
        assert not ok

    def test_mention_inside_bash_status_does_not_push(self):
        # `grep "@bary"` inside a Bash › status is intermediate process
        # output; the @ is incidental.
        ev = _make_event(
            message_type="status",
            content='Bash › grep -r "@claude-agent" /tmp/notes.md',
        )
        ok, _r, _t = _should_push(ev, {"claude-agent"})
        assert not ok


class TestStructuredStatusKind:
    """The structured 'the turn is over' marker — the replacement for the
    substring matching that fired on every bash `done`."""

    def test_completed_in_metadata_is_task_completed(self):
        # agent-connector's sendResponse() writes it here.
        ev = _make_event(message_type="chat", metadata={"status_kind": "completed"})
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "task_completed"

    def test_completed_in_payload_is_task_completed(self):
        # A caller POSTing /v1/events by hand naturally puts it in payload.
        ev = _make_event(message_type="status",
                         payload_extra={"status_kind": "completed"})
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "task_completed"

    def test_error_kind_maps_to_error_reason(self):
        ev = _make_event(message_type="chat", metadata={"status_kind": "error"})
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "error"

    def test_error_message_type_maps_to_error_reason(self):
        # opencode's _sendClassifiedError posts message_type=error, which the
        # old classifier dropped on the floor.
        ev = _make_event(message_type="error", content="⚠️ OpenCode couldn't run")
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "error"

    def test_mention_still_wins_over_completion(self):
        ev = _make_event(message_type="chat", content="done, over to you @bary-bot",
                         metadata={"status_kind": "completed"})
        ok, reason, _t = _should_push(ev, {"bary-bot"})
        assert ok and reason == "mention"

    def test_absent_marker_leaves_behavior_unchanged(self):
        # Back-compat: an adapter that never learned the field still gets the
        # plain chat classification.
        ev = _make_event(message_type="chat")
        ok, reason, _t = _should_push(ev, set())
        assert ok and reason == "chat"

    def test_completed_word_in_status_text_alone_does_not_push(self):
        # Regression guard on the whole point of the structured field: the
        # WORD completed must still not be enough.
        ev = _make_event(message_type="status", content="Run completed in 4s")
        ok, _r, _t = _should_push(ev, set())
        assert not ok

    def test_kind_extraction(self):
        assert _structured_status_kind(_make_event(metadata={"status_kind": "COMPLETED"})) == "completed"
        assert _structured_status_kind(_make_event()) == ""


class TestPrefsGate:
    def test_null_prefs_allows_everything(self):
        for reason in ("mention", "chat", "status", "task_completed", "error"):
            assert _prefs_allow(None, reason)

    def test_missing_key_allows(self):
        assert _prefs_allow({"mentions": False}, "chat")

    def test_switch_off_blocks_its_reason(self):
        assert not _prefs_allow({"allMessages": False}, "chat")
        assert not _prefs_allow({"mentions": False}, "mention")
        assert not _prefs_allow({"agentErrors": False}, "error")
        assert not _prefs_allow({"taskCompletions": False}, "task_completed")
        assert not _prefs_allow({"taskCompletions": False}, "status")

    def test_switch_on_allows(self):
        assert _prefs_allow({"allMessages": True}, "chat")

    def test_task_completion_survives_all_messages_off(self):
        # The default mobile config: firehose off, completions on.
        prefs = {"allMessages": False, "taskCompletions": True, "mentions": True}
        assert not _prefs_allow(prefs, "chat")
        assert _prefs_allow(prefs, "task_completed")
        assert _prefs_allow(prefs, "mention")

    def test_garbage_prefs_do_not_silence_a_device(self):
        assert _prefs_allow("not-a-dict", "chat")
        assert _prefs_allow({"allMessages": None}, "chat")


class TestShouldPushOther:
    def test_non_message_event_skipped(self):
        ev = _make_event(event_type="workspace.agent.control", content="")
        ok, _r, _t = _should_push(ev, set())
        assert not ok


class TestHelpers:
    def test_terminal_status_matches(self):
        for s in [
            "Execution stopped by user",
            "Stopping failed",
            "Session restarted — next message starts fresh.",
            "Restart failed: timeout",
        ]:
            assert _is_terminal_status(s), f"expected terminal: {s!r}"

    def test_terminal_status_skips_non_terminal(self):
        # Including the words we INTENTIONALLY no longer match — these
        # appear too often inside bash/tool-call content.
        for s in [
            "thinking…",
            "running tool: bash",
            "tool: edit",
            "Run completed",
            "Done",
            "failed to connect",
            "Error: out of context",
        ]:
            assert not _is_terminal_status(s), f"expected non-terminal: {s!r}"

    def test_intermediate_step_detection(self):
        for s in [
            "Bash › cd /tmp && ls",
            "Edit › notes.md",
            "Read › /etc/hosts",
            "Grep › foo",
            "mcp__insforge__run-raw-sql › SELECT 1",
            "ToolSearch › select:Read",
            "TodoWrite › {...}",
            "WebFetch › https://example.com",
            "Skill › {\"skill\":\"foo\"}",
            "**Using tool:** `Bash`",
            "**Running:** `cat file`",
            "**Editing:** `notes.md`",
            "**Thinking:** working on it",
            "thinking...",
            "Compacting conversation...",
            "processing queued message",
            "message queued — will process after current task",
        ]:
            assert _is_intermediate_step(s), f"expected intermediate: {s!r}"

    def test_intermediate_step_excludes_real_status(self):
        for s in [
            "Execution stopped by user",
            "Session restarted — next message starts fresh.",
            "Stopping failed",
            "Hello, how can I help you?",
        ]:
            assert not _is_intermediate_step(s), f"expected non-intermediate: {s!r}"

    def test_extract_mentions(self):
        assert _extract_mentions("hey @alice and @bob-bot") == {"alice", "bob-bot"}
        assert _extract_mentions("no mentions here") == set()
        assert _extract_mentions("email me@example.com is not a mention") == {"example"}  # naive regex; OK
