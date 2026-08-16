# -*- coding: utf-8 -*-
"""Workflow engine: kickoff + step advancement.

Drives the state machine directly via ``run_advance`` (session-injected) so the
tests don't need the background-task path or an LLM — with no router key the
step-complete judge advances and gates fall through, which is exactly the
sequential path we assert here.
"""

from sqlalchemy import select

from app.models import KanbanTask, WorkflowRun
from app.services.workflow import run_advance


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
    assert run["status"] == "in_progress"
    assert run["channel_name"] == f"task:{task['id']}"
    return task, f"task:{task['id']}"


def _agent_msg(channel, content="done"):
    return {"target": f"channel/{channel}", "source": "openagents:agent-alpha", "payload": {"content": content}}


def _human_msg(channel, content="looks good"):
    return {"target": f"channel/{channel}", "source": "human:user", "payload": {"content": content}}


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
