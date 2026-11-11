# -*- coding: utf-8 -*-
"""Workflow engine: kickoff + step advancement.

Drives the state machine directly via ``run_advance`` (session-injected) so the
tests don't need the background-task path or a live LLM. Completion judgments
are explicit test inputs; unavailable judgments must leave the run waiting.
"""

from unittest.mock import Mock

import pytest
from sqlalchemy import select

from app.models import KanbanTask, WorkflowRun
from app.services.workflow import _judge as real_judge
from app.services.workflow import run_advance


@pytest.fixture(autouse=True)
def completion_judge(monkeypatch):
    judge = Mock(return_value="done")
    monkeypatch.setattr("app.services.workflow._judge", judge)
    return judge


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _make_workflow(client, workspace, steps):
    resp = client.post(
        "/v1/workflows",
        json={"network": workspace["id"], "name": "WF", "steps": steps},
        headers=_headers(workspace),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _agent_step(name, agent="agent-alpha"):
    return {"name": name, "instruction": f"do {name}", "assignee": {"kind": "agent", "agent": agent}}


def _human_step(name, human="alice"):
    return {"name": name, "instruction": f"review {name}", "assignee": {"kind": "human", "human": human}}


def _run_task_with_workflow(client, workspace, workflow):
    task = client.post(
        "/v1/tasks",
        json={"network": workspace["id"], "title": "Do it", "workflow_id": workflow["id"]},
        headers=_headers(workspace),
    ).json()["data"]
    assert task["workflow_id"] == workflow["id"]
    run = client.post(
        f"/v1/tasks/{task['id']}/assign",
        json={"network": workspace["id"]},
        headers=_headers(workspace),
    ).json()["data"]
    expected_status = "need_input" if workflow["steps"][0]["assignee"]["kind"] == "human" else "in_progress"
    assert run["status"] == expected_status
    assert run["channel_name"] == f"task:{task['id']}"
    return task, f"task:{task['id']}"


def _agent_msg(channel, content="done"):
    return {"target": f"channel/{channel}", "source": "openagents:agent-alpha", "payload": {"content": content}}


def _human_msg(channel, content="looks good"):
    return {"target": f"channel/{channel}", "source": "human:alice", "payload": {"content": content}}


class TestWorkflowRun:
    def test_kickoff_creates_run_on_first_step(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        _task, channel = _run_task_with_workflow(client, workspace, wf)

        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "running"
        assert run.current_step == wf["steps"][0]["id"]

    def test_sequential_advance_then_complete(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        task, channel = _run_task_with_workflow(client, workspace, wf)

        # Agent finishes step 1 → advance to step 2.
        assert run_advance(db, workspace["id"], _agent_msg(channel)) is True
        db.commit()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.current_step == wf["steps"][1]["id"]

        # Agent finishes step 2 (last) → run done, task done.
        assert run_advance(db, workspace["id"], _agent_msg(channel)) is True
        db.commit()
        db.expire_all()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "done"
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        assert row.status == "done"

    def test_non_assignee_message_is_ignored(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        _task, channel = _run_task_with_workflow(client, workspace, wf)
        # A human speaking during an agent step is not the step output.
        assert run_advance(db, workspace["id"], _human_msg(channel)) is False
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.current_step == wf["steps"][0]["id"]  # unchanged

    def test_stop_pauses_run_and_ignores_late_replies(self, client, workspace, db):
        """Stop (PATCH → backlog) pauses the run; a late agent reply is inert."""
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        task, channel = _run_task_with_workflow(client, workspace, wf)

        # Stop: move the task back to backlog via PATCH.
        resp = client.patch(
            f"/v1/tasks/{task['id']}",
            json={"network": workspace["id"], "status": "backlog"},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        db.refresh(run)
        assert run.status == "paused"

        # A late agent reply must NOT advance the paused run or move the card.
        assert run_advance(db, workspace["id"], _agent_msg(channel)) is False
        db.expire_all()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "paused"
        assert run.current_step == wf["steps"][0]["id"]
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        assert row.status == "backlog"

    def test_run_resumes_paused_run_at_current_step(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        task, channel = _run_task_with_workflow(client, workspace, wf)

        # Advance to step 2, then stop.
        run_advance(db, workspace["id"], _agent_msg(channel))
        db.commit()
        client.patch(
            f"/v1/tasks/{task['id']}",
            json={"network": workspace["id"], "status": "backlog"},
            headers=_headers(workspace),
        )

        # Run again → resumes at step 2 (not restarted at step 1).
        resp = client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"]},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        db.expire_all()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "running"
        assert run.current_step == wf["steps"][1]["id"]

    def test_run_after_done_restarts_fresh(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft")])
        task, channel = _run_task_with_workflow(client, workspace, wf)
        run_advance(db, workspace["id"], _agent_msg(channel))  # completes the 1-step run
        db.commit()

        resp = client.post(
            f"/v1/tasks/{task['id']}/assign",
            json={"network": workspace["id"]},
            headers=_headers(workspace),
        )
        assert resp.status_code == 200, resp.text
        db.expire_all()
        runs = db.execute(
            select(WorkflowRun).where(WorkflowRun.channel_name == channel)
        ).scalars().all()
        statuses = sorted(r.status for r in runs)
        assert statuses == ["done", "running"]  # old run kept, new run live

    def test_list_tasks_includes_run_summary(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _agent_step("Polish")])
        _task, _channel = _run_task_with_workflow(client, workspace, wf)
        listed = client.get(f"/v1/tasks?network={workspace['id']}", headers=_headers(workspace))
        wf_tasks = [x for x in listed.json()["data"]["tasks"] if x["workflow_id"] == wf["id"]]
        assert wf_tasks and wf_tasks[0]["run"] is not None
        info = wf_tasks[0]["run"]
        assert info["status"] == "running"
        assert info["step_index"] == 0
        assert info["step_count"] == 2
        assert info["step_name"] == "Draft"
        assert info["step_assignee"] == "agent-alpha"

    def test_step_delivery_cites_knowledge(self, client, workspace, db):
        """A step with knowledge_id gets its @knowledge:<slug> context section."""
        from app.models import EventRecord, KnowledgeEntry
        entry = KnowledgeEntry(
            workspace_id=workspace["id"], slug="style-guide", title="Style guide",
            created_by="human:user", status="active",
        )
        db.add(entry)
        db.commit()

        step = _agent_step("Draft")
        step["knowledge_id"] = entry.id
        wf = _make_workflow(client, workspace, [step])
        _task, channel = _run_task_with_workflow(client, workspace, wf)

        events = db.execute(
            select(EventRecord).where(
                EventRecord.target == f"channel/{channel}",
                EventRecord.type == "workspace.message.posted",
            )
        ).scalars().all()
        step_msg = next(e for e in events if "Workflow step" in ((e.payload or {}).get("content") or ""))
        assert "@knowledge:style-guide" in step_msg.payload["content"]
        assert "Style guide" in step_msg.payload["content"]

    def test_human_step_parks_then_advances_on_reply(self, client, workspace, db):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _human_step("Review")])
        task, channel = _run_task_with_workflow(client, workspace, wf)

        # Agent finishes step 1 → advance to the human step; task parks on need_input.
        run_advance(db, workspace["id"], _agent_msg(channel))
        db.commit()
        db.expire_all()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.current_step == wf["steps"][1]["id"]
        row = db.execute(select(KanbanTask).where(KanbanTask.id == task["id"])).scalar_one()
        assert row.status == "need_input"

        # Human replies → step output → run completes.
        assert run_advance(db, workspace["id"], _human_msg(channel)) is True
        db.commit()
        db.expire_all()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "done"


class TestWorkflowCompletionGuards:
    def test_human_conversation_does_not_start_deploy(self, client, workspace, db, completion_judge):
        review = _human_step("Approve production deploy", human=None)
        wf = _make_workflow(client, workspace, [review, _agent_step("Deploy and monitor")])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        completion_judge.return_value = "working"
        message = _human_msg(channel, "Maya can you take this up")
        assert run_advance(db, workspace["id"], message) is False
        completion_judge.assert_called_once()
        prompt = completion_judge.call_args.args[0]
        assert message["payload"]["content"] in prompt
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.current_step == wf["steps"][0]["id"]
        assert run.status == "running"

    def test_only_named_human_can_complete_step(self, client, workspace, db, completion_judge):
        wf = _make_workflow(client, workspace, [_human_step("Review", human="alice")])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        message = _human_msg(channel, "Approved")
        message["source"] = "human:bob"
        assert run_advance(db, workspace["id"], message) is False
        completion_judge.assert_not_called()
        message["source"] = "human:alice"
        assert run_advance(db, workspace["id"], message) is True

    @pytest.mark.parametrize("message_type", ["thinking", "status", "todos"])
    def test_intermediate_agent_output_never_completes_run(self, client, workspace, db, completion_judge, message_type):
        wf = _make_workflow(client, workspace, [_agent_step("Deploy and monitor")])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        message = _agent_msg(channel, "I will check approval and deploy")
        message["payload"]["message_type"] = message_type
        assert run_advance(db, workspace["id"], message) is False
        completion_judge.assert_not_called()
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "running"

    @pytest.mark.parametrize("step", [_agent_step("Deploy"), _human_step("Approve")])
    @pytest.mark.parametrize("verdict", [None, "", "not done", "working", "done or working"])
    def test_failed_or_uncertain_judgment_keeps_step_waiting(self, client, workspace, db, completion_judge, step, verdict):
        wf = _make_workflow(client, workspace, [step])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        completion_judge.return_value = verdict
        msg = _human_msg(channel) if step["assignee"]["kind"] == "human" else _agent_msg(channel)
        assert run_advance(db, workspace["id"], msg) is False
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.status == "running"

    def test_blocked_final_reply_does_not_finish_workflow(self, client, workspace, db, completion_judge):
        wf = _make_workflow(client, workspace, [_agent_step("Deploy and monitor")])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        completion_judge.return_value = "working"
        assert run_advance(db, workspace["id"], _agent_msg(channel, "Cannot deploy: approval is pending.")) is False


    @pytest.mark.parametrize("assignee", ["alice@example.test", "Alice Example"])
    def test_named_human_resolves_legacy_web_sender(self, client, workspace, db, assignee):
        from app.models import User
        db.add(User(email="alice@example.test", display_name="Alice Example"))
        db.commit()
        wf = _make_workflow(client, workspace, [_human_step("Review", human=assignee)])
        _, channel = _run_task_with_workflow(client, workspace, wf)
        message = _human_msg(channel, "I reviewed and approve the draft")
        message["source"] = "human:user"
        message["payload"]["sender_id"] = "alice@example.test"
        assert run_advance(db, workspace["id"], message) is True


class TestJudgeRequest:
    """Exercise the imported judge and state machine with only the SDK mocked."""

    @pytest.fixture
    def judge_client(self, monkeypatch):
        client = Mock()
        monkeypatch.setattr("app.services.workflow._judge", real_judge)
        monkeypatch.setattr("app.mods.workspace_mod._get_router_api_key", lambda: "test-key")
        monkeypatch.setattr("app.mods.workspace_mod._get_llm_client", lambda: (client, "openai"))
        monkeypatch.setattr("app.mods.workspace_mod._get_router_model", lambda: "deepseek-chat")
        return client

    @staticmethod
    def response(answer):
        return Mock(choices=[Mock(message=Mock(content=answer))])

    @pytest.mark.parametrize("purpose", ["completion", "gate"])
    @pytest.mark.parametrize(
        "provider,model",
        [
            ("openai", "deepseek-chat"),
            ("openai", "DeepSeek-V3.2"),
            ("openai", "gpt-4o-mini"),
            ("anthropic", "claude-haiku-4-5-20251001"),
        ],
    )
    def test_request_policy(self, monkeypatch, judge_client, provider, model, purpose):
        monkeypatch.setattr("app.mods.workspace_mod._get_llm_client", lambda: (judge_client, provider))
        monkeypatch.setattr("app.mods.workspace_mod._get_router_model", lambda: model)
        from app.services.workflow import _gate_met, _step_complete

        answer = " Done " if purpose == "completion" else " Yes "
        judge_client.chat.completions.create.return_value = self.response(answer)
        judge_client.messages.create.return_value = Mock(content=[Mock(type="text", text=answer)])
        if purpose == "completion":
            assert _step_complete(_agent_step("Draft"), "finished") is True
        else:
            assert _gate_met({"gate": {"condition": "needs revision"}}, "finished") is True
        create = judge_client.chat.completions.create if provider == "openai" else judge_client.messages.create
        kwargs = create.call_args.kwargs
        assert kwargs["model"] == model
        assert len(kwargs["messages"]) == 1
        assert kwargs["messages"][0]["role"] == "user"
        assert "finished" in kwargs["messages"][0]["content"]
        assert ("done | working" if purpose == "completion" else "yes | no") in kwargs["messages"][0]["content"]
        assert kwargs["max_tokens"] == 64
        if provider == "openai" and model.lower().startswith("deepseek"):
            assert kwargs["extra_body"] == {"thinking": {"type": "disabled"}}
        else:
            assert "extra_body" not in kwargs

    @pytest.mark.parametrize("provider", ["openai", "anthropic"])
    @pytest.mark.parametrize("answer", [None, "", "  "])
    def test_empty_verdict_is_logged_failure(self, monkeypatch, judge_client, caplog, provider, answer):
        monkeypatch.setattr("app.mods.workspace_mod._get_llm_client", lambda: (judge_client, provider))
        judge_client.chat.completions.create.return_value = self.response(answer)
        judge_client.messages.create.return_value = Mock(content=[Mock(type="text", text=answer)])
        assert real_judge("judge this") is None
        assert "empty verdict" in caplog.text

    def test_api_failure(self, judge_client, caplog):
        judge_client.chat.completions.create.side_effect = RuntimeError("offline")
        assert real_judge("judge this") is None
        assert "workflow judge failed" in caplog.text

    def test_missing_key(self, monkeypatch, judge_client):
        monkeypatch.setattr("app.mods.workspace_mod._get_router_api_key", lambda: "")
        assert real_judge("judge this") is None
        judge_client.chat.completions.create.assert_not_called()

    @pytest.mark.parametrize("answer", [None, "", "  ", "working", "done or working", "done"])
    def test_real_judge_controls_advancement(self, client, workspace, db, judge_client, answer):
        wf = _make_workflow(client, workspace, [_agent_step("Draft"), _human_step("Review")])
        _, channel = _run_task_with_workflow(client, workspace, wf)

        def respond(**kwargs):
            # Reproduce #908: reasoning consumes the short request's budget.
            if kwargs["max_tokens"] < 64 or kwargs.get("extra_body") != {"thinking": {"type": "disabled"}}:
                return self.response("")
            return self.response(answer)

        judge_client.chat.completions.create.side_effect = respond
        assert run_advance(db, workspace["id"], _agent_msg(channel)) is (answer == "done")
        run = db.execute(select(WorkflowRun).where(WorkflowRun.channel_name == channel)).scalar_one()
        assert run.current_step == wf["steps"][1 if answer == "done" else 0]["id"]
        assert run.status == "running"

    @pytest.mark.parametrize("answer,expected", [("yes", True), ("no", False), ("", False), (None, False)])
    def test_gate_uses_real_judge(self, judge_client, answer, expected):
        from app.services.workflow import _gate_met

        judge_client.chat.completions.create.return_value = self.response(answer)
        assert _gate_met({"gate": {"condition": "needs revision", "target": "draft"}}, "output") is expected
        assert judge_client.chat.completions.create.call_args.kwargs["extra_body"] == {
            "thinking": {"type": "disabled"},
        }

    @pytest.mark.parametrize("provider", ["openai", "anthropic"])
    def test_missing_response_blocks(self, monkeypatch, judge_client, caplog, provider):
        monkeypatch.setattr("app.mods.workspace_mod._get_llm_client", lambda: (judge_client, provider))
        judge_client.chat.completions.create.return_value = Mock(choices=[])
        judge_client.messages.create.return_value = Mock(content=[])
        assert real_judge("judge this") is None
        assert "empty verdict" in caplog.text

    @pytest.mark.parametrize("purpose", ["completion", "gate"])
    @pytest.mark.parametrize(
        "provider,model",
        [
            ("openai", "deepseek-chat"),
            ("openai", "gpt-4o-mini"),
            ("anthropic", "claude-haiku-4-5-20251001"),
        ],
    )
    @pytest.mark.parametrize("answer", [None, "", "  "])
    def test_empty_verdict_cannot_authorize(self, monkeypatch, judge_client, provider, model, purpose, answer):
        from app.services.workflow import _gate_met, _step_complete

        monkeypatch.setattr("app.mods.workspace_mod._get_llm_client", lambda: (judge_client, provider))
        monkeypatch.setattr("app.mods.workspace_mod._get_router_model", lambda: model)
        judge_client.chat.completions.create.return_value = self.response(answer)
        judge_client.messages.create.return_value = Mock(content=[Mock(type="text", text=answer)])
        if purpose == "completion":
            assert _step_complete(_agent_step("Draft"), "finished") is False
        else:
            assert _gate_met({"gate": {"condition": "needs revision"}}, "finished") is False
