# -*- coding: utf-8 -*-
"""
SWE-bench evaluation tests.

Everything runs offline: a mock harness fixture replaces the real Docker
harness, a fake agent writes the patch directly, and dataset instances are
seeded into the local cache. No Docker, no network, no model account.
"""

import asyncio
import json
import os
import subprocess
import uuid
from types import SimpleNamespace

import pytest

from app.swebench import datasets as datasets_mod
from app.swebench import env as env_mod
from app.swebench import harness as harness_mod
from app.swebench import integrity as integrity_mod
from app.swebench import precheck as precheck_mod
from app.swebench import service as eval_service
from app.swebench import workdir as workdir_mod
from app.swebench.agent_runner import AgentRunResult
from app.swebench.config import config as swe_config
from app.swebench.runner import RunnerDeps, run_job

FAKE_HARNESS = os.path.join(os.path.dirname(__file__), "swebench_fake_harness.py")

# A dataset instance with both PUBLIC fields and SENSITIVE (gold/test) fields.
DEMO_INSTANCE = {
    "instance_id": "demo__demo-1",
    "repo": "demo/demo",
    "base_commit": "0" * 40,
    "problem_statement": "foo() crashes on empty input; make it return 0.",
    "version": "1.0",
    "environment_setup_commit": "1" * 40,
    "created_at": "2024-01-01T00:00:00Z",
    # ── sensitive (must never reach the agent) ──
    "patch": "diff --git a/src/foo.py b/src/foo.py\n@@ gold @@\n",
    "test_patch": (
        "diff --git a/tests/test_foo.py b/tests/test_foo.py\n"
        "--- a/tests/test_foo.py\n+++ b/tests/test_foo.py\n"
        "@@ -1 +1,2 @@\n test\n+more\n"
    ),
    "FAIL_TO_PASS": json.dumps(["tests/test_foo.py::test_bug"]),
    "PASS_TO_PASS": json.dumps(["tests/test_foo.py::test_ok"]),
    "hints_text": "the secret hint",
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def swe_env(tmp_path, monkeypatch):
    """Enable SWE-bench, isolate the work dir, point at the mock harness."""
    monkeypatch.setattr(swe_config, "ENABLED", True, raising=False)
    monkeypatch.setattr(swe_config, "WORK_DIR", str(tmp_path / "swebench"), raising=False)
    monkeypatch.setattr(swe_config, "HARNESS_POLL_INTERVAL_SECONDS", 0.05, raising=False)
    monkeypatch.setattr(swe_config, "AGENT_IDLE_SECONDS", 1, raising=False)
    monkeypatch.setenv("SWEBENCH_HARNESS_CMD", json.dumps(["python3", FAKE_HARNESS]))
    # Isolate artifact storage to the temp dir.
    from app import storage
    monkeypatch.setattr(storage, "_store", storage.LocalFileStore(str(tmp_path / "files")), raising=False)
    return swe_config


@pytest.fixture
def seed_dataset(swe_env):
    """Write the demo instance into the dataset cache (no network)."""
    path = datasets_mod.cache_path("swe_bench_lite", "test")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump([DEMO_INSTANCE], fh)
    return path


# ── git helpers for the fake working dir ──

def _git(args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def _init_repo(dest):
    os.makedirs(os.path.join(dest, "src"), exist_ok=True)
    with open(os.path.join(dest, "src", "foo.py"), "w") as fh:
        fh.write("def foo(x):\n    return x[0]\n")
    _git(["init", "-q"], dest)
    _git(["config", "user.email", "t@t.local"], dest)
    _git(["config", "user.name", "t"], dest)
    _git(["add", "-A"], dest)
    _git(["commit", "-q", "-m", "base"], dest)


def _head(dest):
    out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=dest,
                         stdout=subprocess.PIPE, text=True, check=True)
    return out.stdout.strip()


def make_fake_workdir():
    """A workdir module replacement that builds a *local* git repo (no clone)."""
    def fake_prepare(*, agent_working_dir, job_id, instance_id, repo, base_commit):
        dest = os.path.join(workdir_mod.instance_root(agent_working_dir, job_id), instance_id)
        os.makedirs(dest, exist_ok=True)
        _init_repo(dest)
        return workdir_mod.PreparedWorkdir(
            path=dest,
            relative_to_agent=os.path.join(workdir_mod.AGENT_SUBDIR, job_id, instance_id),
            repo=repo,
            base_commit=_head(dest),
        )

    return SimpleNamespace(
        prepare_instance_workdir=fake_prepare,
        collect_patch=workdir_mod.collect_patch,
        cleanup_job_workdir=workdir_mod.cleanup_job_workdir,
        cleanup_run_dir=workdir_mod.cleanup_run_dir,
        instance_root=workdir_mod.instance_root,
        WorkdirError=workdir_mod.WorkdirError,
    )


class FakeAgent:
    """Stands in for a connected coding agent: writes a patch (or not)."""

    def __init__(self, action, reason="sentinel", completed=True, cancel_db=None):
        self.action = action
        self.reason = reason
        self.completed = completed
        self.cancel_db = cancel_db  # (session_factory, job_id) to request cancel

    async def run(self, *, instance_abs_path, should_cancel, **kwargs):
        if should_cancel():
            return AgentRunResult(False, "cancelled", 0)
        if self.cancel_db is not None:
            from app.swebench.runner import _update_job
            _update_job(self.cancel_db[0], self.cancel_db[1], cancel_requested=True)
            return AgentRunResult(False, "cancelled", 0)
        if self.action:
            self.action(instance_abs_path)
        return AgentRunResult(self.completed, self.reason, 1)


def fix_foo(instance_dir):
    with open(os.path.join(instance_dir, "src", "foo.py"), "w") as fh:
        fh.write("def foo(x):\n    return x[0] if x else 0\n")


def edit_tests(instance_dir):
    fix_foo(instance_dir)
    tdir = os.path.join(instance_dir, "tests")
    os.makedirs(tdir, exist_ok=True)
    with open(os.path.join(tdir, "test_foo.py"), "w") as fh:
        fh.write("def test_ok():\n    assert True\n")


def _make_job(db_factory, workspace_id, *, agent="coder", working_dir, instance_id="demo__demo-1",
              dataset="swe_bench_lite", split="test", mode="strict"):
    """Insert a WorkspaceMember (with working_dir) + EvaluationJob; return job id."""
    from app.models import EvaluationJob, WorkspaceMember
    db = db_factory()
    try:
        if not db.query(WorkspaceMember).filter_by(workspace_id=workspace_id, agent_name=agent).first():
            db.add(WorkspaceMember(workspace_id=workspace_id, agent_name=agent,
                                   working_dir=working_dir, status="online"))
        job_id = str(uuid.uuid4())
        db.add(EvaluationJob(
            id=job_id, workspace_id=workspace_id, channel_name=f"swebench:{job_id[:8]}",
            created_by="human:user", dataset=dataset, split=split,
            instance_id=instance_id, selected_agent=agent, status="queued",
            integrity_mode=mode,
        ))
        db.commit()
        return job_id
    finally:
        db.close()


def _get_job(db_factory, job_id):
    from app.models import EvaluationJob
    db = db_factory()
    try:
        return db.query(EvaluationJob).filter_by(id=job_id).first()
    finally:
        db.close()


def run_one(job_id, db_factory, agent, workdir=None):
    deps = RunnerDeps(
        session_factory=db_factory,
        agent_runner=agent,
        datasets=datasets_mod,
        integrity=integrity_mod,
        harness=harness_mod,
        workdir=workdir or make_fake_workdir(),
        precheck=None,
    )
    asyncio.run(run_job(job_id, deps))


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------

class TestIntegrity:
    def test_changed_files(self):
        patch = ("diff --git a/src/foo.py b/src/foo.py\n+++ b/src/foo.py\n"
                 "diff --git a/tests/test_x.py b/tests/test_x.py\n+++ b/tests/test_x.py\n")
        assert integrity_mod.changed_files_from_patch(patch) == ["src/foo.py", "tests/test_x.py"]

    def test_is_test_file(self):
        assert integrity_mod.is_test_file("tests/test_foo.py")
        assert integrity_mod.is_test_file("pkg/foo_test.py")
        assert not integrity_mod.is_test_file("src/foo.py")

    def test_classify_protected(self):
        c = integrity_mod
        assert c.classify_protected("src/foo.py") is None
        assert c.classify_protected("tests/test_foo.py") in (c.CAT_TEST_DIR, c.CAT_TEST_FILE)
        assert c.classify_protected("pkg/foo_test.py") == c.CAT_TEST_FILE
        assert c.classify_protected("a/b/conftest.py") == c.CAT_TEST_RUNNER_CONFIG
        assert c.classify_protected("tox.ini") == c.CAT_TEST_RUNNER_CONFIG
        assert c.classify_protected("pytest.ini") == c.CAT_TEST_RUNNER_CONFIG
        assert c.classify_protected("noxfile.py") == c.CAT_TEST_RUNNER_CONFIG
        assert c.classify_protected(".github/workflows/ci.yml") == c.CAT_CI_CONFIG
        assert c.classify_protected(".gitlab-ci.yml") == c.CAT_CI_CONFIG
        assert c.classify_protected("setup.py") == c.CAT_DEPENDENCY_SCRIPT
        assert c.classify_protected("requirements-dev.txt") == c.CAT_DEPENDENCY_SCRIPT
        assert c.classify_protected("src/fixtures/data.json") == c.CAT_FIXTURE
        assert c.classify_protected("src/mock_client.py") == c.CAT_MOCK
        assert c.classify_protected("src/swebench_helper.py") == c.CAT_BENCHMARK_INFRA

    def test_instance_test_category(self):
        a = integrity_mod.analyze_patch(
            "diff --git a/x/y.py b/x/y.py\n+++ b/x/y.py\n", {"x/y.py"})
        assert a.has_violation
        assert a.hits[0]["category"] == integrity_mod.CAT_INSTANCE_TEST

    def test_analyze_clean_source(self):
        patch = "diff --git a/src/foo.py b/src/foo.py\n--- a/src/foo.py\n+++ b/src/foo.py\n@@ -1 +1 @@\n-a\n+b\n"
        a = integrity_mod.analyze_patch(patch, set())
        assert not a.has_violation and a.protected_files == []

    def test_analyze_flags_tests_and_ci(self):
        patch = (
            "diff --git a/src/foo.py b/src/foo.py\n+++ b/src/foo.py\n"
            "diff --git a/tests/test_foo.py b/tests/test_foo.py\n+++ b/tests/test_foo.py\n"
            "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n"
        )
        a = integrity_mod.analyze_patch(patch, set())
        assert a.has_violation
        assert "tests/test_foo.py" in a.protected_files
        assert ".github/workflows/ci.yml" in a.protected_files
        assert integrity_mod.CAT_CI_CONFIG in a.categories


# ---------------------------------------------------------------------------
# Datasets / integrity boundary
# ---------------------------------------------------------------------------

class TestDatasets:
    def test_public_view_excludes_sensitive(self, seed_dataset):
        inst = datasets_mod.get_instance("swe_bench_lite", "test", "demo__demo-1")
        view = datasets_mod.public_view(inst)
        for field in datasets_mod.SENSITIVE_FIELDS:
            assert field not in view
        assert view["repo"] == "demo/demo"
        assert view["problem_statement"]

    def test_list_instances_public_only(self, seed_dataset):
        result = datasets_mod.list_instances("swe_bench_lite", "test")
        assert result["total"] == 1
        item = result["items"][0]
        assert set(item.keys()) == {"instance_id", "repo", "base_commit", "version", "problem_summary"}
        # No sensitive field can sneak in.
        for field in datasets_mod.SENSITIVE_FIELDS:
            assert field not in item

    def test_get_missing_instance_raises(self, seed_dataset):
        with pytest.raises(datasets_mod.DatasetError):
            datasets_mod.get_instance("swe_bench_lite", "test", "nope")

    def test_fail_to_pass_decoded(self, seed_dataset):
        inst = datasets_mod.get_instance("swe_bench_lite", "test", "demo__demo-1")
        assert inst["FAIL_TO_PASS"] == ["tests/test_foo.py::test_bug"]


# ---------------------------------------------------------------------------
# Precheck
# ---------------------------------------------------------------------------

class TestPrecheck:
    def test_docker_cli_missing(self, monkeypatch):
        monkeypatch.setattr(precheck_mod.shutil, "which", lambda *_: None)
        c = precheck_mod.check_docker_cli()
        assert not c.ok and c.level == "error"

    def test_docker_daemon_down(self, monkeypatch):
        monkeypatch.setattr(precheck_mod.shutil, "which", lambda *_: "/usr/bin/docker")
        monkeypatch.setattr(precheck_mod, "_run",
                            lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="down"))
        c = precheck_mod.check_docker_daemon()
        assert not c.ok and c.level == "error"

    def test_harness_missing(self, monkeypatch):
        monkeypatch.setattr(precheck_mod, "_run",
                            lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="no module"))
        c = precheck_mod.check_harness_available()
        assert not c.ok and c.level == "error"

    def test_workdir_writable(self, swe_env):
        c = precheck_mod.check_workdir_writable()
        assert c.ok

    def test_concurrency_limit(self, monkeypatch):
        monkeypatch.setattr(swe_config, "MAX_CONCURRENCY", 1, raising=False)
        assert precheck_mod.check_concurrency(0).ok
        assert not precheck_mod.check_concurrency(1).ok

    def test_disabled_blocks_aggregate(self, monkeypatch):
        monkeypatch.setattr(swe_config, "ENABLED", False, raising=False)
        result = precheck_mod.run_prechecks()
        assert result["ok"] is False
        assert any(c["name"] == "feature_enabled" and not c["ok"] for c in result["checks"])


# ---------------------------------------------------------------------------
# Harness wrapper + parser
# ---------------------------------------------------------------------------

class TestHarness:
    def test_build_command_flags(self, swe_env):
        argv = harness_mod.build_command(
            dataset_name="/d.json", split="test", instance_id="i",
            predictions_path="/p.jsonl", run_id="rid", timeout=600,
        )
        assert "--predictions_path" in argv and "/p.jsonl" in argv
        assert "--instance_ids" in argv and "i" in argv
        assert "--run_id" in argv and "rid" in argv
        assert "--max_workers" in argv and argv[argv.index("--max_workers") + 1] == "1"
        assert "--namespace" in argv

    def test_run_resolved(self, swe_env, tmp_path, monkeypatch):
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        run_dir = str(tmp_path / "run")
        result = harness_mod.run_harness(
            run_dir=run_dir, dataset_name="/x.json", split="test",
            instance_id="demo__demo-1", model_patch="diff", run_id="rid",
        )
        assert result.exit_code == 0
        verdict = harness_mod.parse_verdict(result, "demo__demo-1")
        assert verdict.outcome == "resolved" and verdict.resolved is True

    def test_run_docker_unavailable(self, swe_env, tmp_path, monkeypatch):
        monkeypatch.setenv("FAKE_SCENARIO", "docker_unavailable")
        result = harness_mod.run_harness(
            run_dir=str(tmp_path / "run"), dataset_name="/x.json", split="test",
            instance_id="demo__demo-1", model_patch="diff", run_id="rid",
        )
        verdict = harness_mod.parse_verdict(result, "demo__demo-1")
        assert verdict.outcome == "error"
        assert verdict.error_category == harness_mod.CAT_DOCKER_UNAVAILABLE

    def test_run_timeout_kills(self, swe_env, tmp_path, monkeypatch):
        monkeypatch.setenv("FAKE_SCENARIO", "timeout")
        result = harness_mod.run_harness(
            run_dir=str(tmp_path / "run"), dataset_name="/x.json", split="test",
            instance_id="demo__demo-1", model_patch="diff", run_id="rid",
            wall_timeout=1, poll_interval=0.1,
        )
        assert result.timed_out
        verdict = harness_mod.parse_verdict(result, "demo__demo-1")
        assert verdict.outcome == "timeout"

    def test_cleanup_containers_no_docker(self, monkeypatch):
        monkeypatch.setattr(swe_config, "DOCKER_BIN", "definitely-not-docker", raising=False)
        assert harness_mod.cleanup_containers("rid") == 0


# ---------------------------------------------------------------------------
# Full closed-loop run_job
# ---------------------------------------------------------------------------

class TestRunJob:
    def test_resolved(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "completed"
        assert job.resolved is True and job.outcome == "resolved"
        assert job.patch_file_id and job.log_file_id

    def test_unresolved(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "unresolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "completed" and job.resolved is False
        assert job.outcome == "unresolved"

    def test_no_patch(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(action=None))  # writes nothing
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "failed" and job.outcome == "no_patch"
        assert job.error_category == "no_patch"

    def test_patch_apply_failed(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "patch_apply_failed")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "failed" and job.error_category == "patch_invalid"

    def test_harness_error(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "error")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "error"

    def test_strict_rejects_test_edits(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir, mode="strict")
        run_one(job_id, TestingSessionLocal, FakeAgent(edit_tests))
        job = _get_job(TestingSessionLocal, job_id)
        # Strict mode rejects — never resolved/failed, and never reaches harness.
        assert job.status == "integrity_rejected" and job.outcome == "integrity_rejected"
        assert job.resolved is None
        assert job.log_file_id is None          # harness was not run
        assert job.patch_file_id                 # the offending patch is still saved
        integ = (job.docker_info or {}).get("integrity", {})
        assert integ.get("protected_files")

    def test_debug_flags_risk_but_runs(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir, mode="debug")
        run_one(job_id, TestingSessionLocal, FakeAgent(edit_tests))
        job = _get_job(TestingSessionLocal, job_id)
        # Debug mode runs the harness but flags the integrity risk.
        assert job.status == "completed"
        assert job.integrity_risk is True
        assert job.log_file_id  # harness ran

    def test_env_recorded(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        job = _get_job(TestingSessionLocal, job_id)
        assert job.environment and "os" in job.environment and "arch" in job.environment
        assert "harness_command" in job.environment

    def test_cancel_during_agent(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        agent = FakeAgent(action=None, cancel_db=(TestingSessionLocal, job_id))
        run_one(job_id, TestingSessionLocal, agent)
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "cancelled" and job.outcome == "cancelled"

    def test_cleanup_removes_workdir(self, seed_dataset, workspace, monkeypatch, tmp_path):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        job_id = _make_job(TestingSessionLocal, workspace["id"], working_dir=agent_dir)
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo))
        # The per-job working tree is gone after the run.
        assert not os.path.exists(workdir_mod.instance_root(agent_dir, job_id))

    def test_missing_agent_workdir_errors(self, seed_dataset, workspace, monkeypatch):
        from tests.conftest import TestingSessionLocal
        monkeypatch.setenv("FAKE_SCENARIO", "resolved")
        # Agent member exists but has NO working_dir.
        from app.models import EvaluationJob, WorkspaceMember
        db = TestingSessionLocal()
        agent = "nodir"
        db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name=agent,
                               working_dir=None, status="online"))
        job_id = str(uuid.uuid4())
        db.add(EvaluationJob(id=job_id, workspace_id=workspace["id"],
                             channel_name=f"swebench:{job_id[:8]}", created_by="human:user",
                             dataset="swe_bench_lite", split="test",
                             instance_id="demo__demo-1", selected_agent=agent, status="queued"))
        db.commit()
        db.close()
        run_one(job_id, TestingSessionLocal, FakeAgent(fix_foo), workdir=workdir_mod)
        job = _get_job(TestingSessionLocal, job_id)
        assert job.status == "error" and job.error_category == "integrity_error"


# ---------------------------------------------------------------------------
# Service: cancel semantics / concurrency
# ---------------------------------------------------------------------------

class TestService:
    def test_cancel_queued_immediately(self, workspace):
        from tests.conftest import TestingSessionLocal
        from app.models import EvaluationJob
        db = TestingSessionLocal()
        job = EvaluationJob(id=str(uuid.uuid4()), workspace_id=workspace["id"],
                            channel_name="c", created_by="human:user",
                            dataset="swe_bench_lite", split="test",
                            instance_id="i", selected_agent="a", status="queued")
        db.add(job)
        db.commit()
        result = eval_service.request_cancel(db, job)
        assert result["changed"] and job.status == "cancelled"
        db.close()

    def test_cancel_terminal_noop(self, workspace):
        from tests.conftest import TestingSessionLocal
        from app.models import EvaluationJob
        db = TestingSessionLocal()
        job = EvaluationJob(id=str(uuid.uuid4()), workspace_id=workspace["id"],
                            channel_name="c", created_by="human:user",
                            dataset="swe_bench_lite", split="test",
                            instance_id="i", selected_agent="a", status="completed")
        db.add(job)
        db.commit()
        result = eval_service.request_cancel(db, job)
        assert not result["changed"]
        db.close()


# ---------------------------------------------------------------------------
# Router (HTTP)
# ---------------------------------------------------------------------------

class TestRouter:
    def _add_member(self, workspace_id, working_dir, agent="coder"):
        from tests.conftest import TestingSessionLocal
        from app.models import WorkspaceMember
        db = TestingSessionLocal()
        db.add(WorkspaceMember(workspace_id=workspace_id, agent_name=agent,
                               working_dir=working_dir, status="online"))
        db.commit()
        db.close()

    def test_datasets_endpoint(self, client):
        resp = client.get("/v1/evaluations/datasets")
        assert resp.status_code == 200
        data = resp.json()["data"]
        keys = {d["key"] for d in data["datasets"]}
        assert "swe_bench_lite" in keys and "swe_bench_verified" in keys

    def test_create_disabled_403(self, client, workspace, monkeypatch):
        monkeypatch.setattr(swe_config, "ENABLED", False, raising=False)
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.json()["code"] == 403

    def test_create_requires_working_dir(self, client, workspace, swe_env):
        self._add_member(workspace["id"], working_dir=None)
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.json()["code"] == 400

    def test_create_and_list_and_get(self, client, workspace, swe_env, tmp_path):
        self._add_member(workspace["id"], working_dir=str(tmp_path / "agent"))
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite", "split": "test",
            "instance_id": "demo__demo-1", "agent": "coder", "source": "human:user",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        job = resp.json()["data"]
        assert job["status"] == "queued" and job["agent"] == "coder"
        job_id = job["id"]

        lst = client.get(f"/v1/evaluations?network={workspace['id']}",
                         headers={"X-Workspace-Token": workspace["token"]})
        assert any(j["id"] == job_id for j in lst.json()["data"]["jobs"])

        got = client.get(f"/v1/evaluations/{job_id}",
                         headers={"X-Workspace-Token": workspace["token"]})
        assert got.json()["data"]["id"] == job_id

    def test_cancel_and_retry(self, client, workspace, swe_env, tmp_path):
        self._add_member(workspace["id"], working_dir=str(tmp_path / "agent"))
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder",
        }, headers={"X-Workspace-Token": workspace["token"]})
        job_id = resp.json()["data"]["id"]

        cancel = client.delete(f"/v1/evaluations/{job_id}",
                               headers={"X-Workspace-Token": workspace["token"]})
        assert cancel.json()["data"]["status"] == "cancelled"

        retry = client.post(f"/v1/evaluations/{job_id}/retry",
                            headers={"X-Workspace-Token": workspace["token"]})
        assert retry.status_code == 200
        assert retry.json()["data"]["status"] == "queued"
        assert retry.json()["data"]["id"] != job_id

    def test_instances_endpoint_no_leak(self, client, workspace, seed_dataset):
        resp = client.get(
            f"/v1/evaluations/instances?network={workspace['id']}&dataset=swe_bench_lite&split=test",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        items = resp.json()["data"]["items"]
        assert items and "patch" not in items[0] and "test_patch" not in items[0]

    def test_patch_404_when_absent(self, client, workspace, swe_env, tmp_path):
        self._add_member(workspace["id"], working_dir=str(tmp_path / "agent"))
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder",
        }, headers={"X-Workspace-Token": workspace["token"]})
        job_id = resp.json()["data"]["id"]
        patch = client.get(f"/v1/evaluations/{job_id}/patch",
                           headers={"X-Workspace-Token": workspace["token"]})
        assert patch.json()["code"] == 404

    def test_unauthorized(self, client, workspace, swe_env):
        resp = client.get(f"/v1/evaluations?network={workspace['id']}",
                          headers={"X-Workspace-Token": "wrong"})
        assert resp.json()["code"] == 401


# ---------------------------------------------------------------------------
# Git history isolation (real git, local bare origin — no network)
# ---------------------------------------------------------------------------

def _build_origin(tmp_path, repo="demo/demo"):
    """Create a local bare origin with: base commit, a FUTURE fix commit, a
    branch, and a tag. Returns (base_sha, future_sha)."""
    origins = tmp_path / "origins"
    bare = origins / f"{repo}.git"
    bare.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "--bare", "-q", str(bare)], check=True)

    seed = tmp_path / "seed"
    (seed / "src").mkdir(parents=True)

    def g(*a):
        subprocess.run(["git", *a], cwd=str(seed), check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    g("init", "-q")
    g("config", "user.email", "s@s.local")
    g("config", "user.name", "seed")
    (seed / "src" / "foo.py").write_text("def foo(x):\n    return x[0]\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(seed),
                          stdout=subprocess.PIPE, text=True, check=True).stdout.strip()
    (seed / "SECRET_FUTURE_FIX.py").write_text("the future fix the agent must not see\n")
    g("add", "-A")
    g("commit", "-q", "-m", "future fix")
    future = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(seed),
                            stdout=subprocess.PIPE, text=True, check=True).stdout.strip()
    g("branch", "feature")
    g("tag", "v1.0")
    g("remote", "add", "origin", str(bare))
    g("push", "-q", "origin", "HEAD:refs/heads/main")
    g("push", "-q", "origin", "feature")
    g("push", "-q", "origin", "--tags")
    return base, future


def _capture(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True).stdout


class TestGitIsolation:
    def test_prepare_isolates_history(self, swe_env, tmp_path, monkeypatch):
        base, future = _build_origin(tmp_path)
        monkeypatch.setattr(swe_config, "GIT_BASE_URL", str(tmp_path / "origins") + "/", raising=False)
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)

        prepared = workdir_mod.prepare_instance_workdir(
            agent_working_dir=agent_dir, job_id="job1234",
            instance_id="demo__demo-1", repo="demo/demo", base_commit=base,
        )
        d = prepared.path

        # Only the base commit is checked out.
        assert _capture(["git", "rev-parse", "HEAD"], d).strip() == base
        # No remotes, and no real branch/tag refs (detached HEAD shows as
        # "* (no branch)" in `git branch -a`, which is not a branch).
        assert _capture(["git", "remote", "-v"], d).strip() == ""
        assert _capture(["git", "for-each-ref", "refs/heads"], d).strip() == ""
        assert _capture(["git", "for-each-ref", "refs/tags"], d).strip() == ""
        assert _capture(["git", "for-each-ref", "refs/remotes"], d).strip() == ""
        branches = _capture(["git", "branch", "-a"], d)
        assert "feature" not in branches and "main" not in branches
        assert _capture(["git", "tag"], d).strip() == ""
        # The future fix commit is NOT discoverable.
        all_log = _capture(["git", "log", "--all", "--format=%H"], d)
        assert future not in all_log
        assert base in all_log
        # And the future file is not in the tree.
        assert not os.path.exists(os.path.join(d, "SECRET_FUTURE_FIX.py"))
        # verify_isolation agrees.
        assert workdir_mod.verify_isolation(d, base) == []

    def test_verify_detects_head_mismatch(self, swe_env, tmp_path, monkeypatch):
        base, _ = _build_origin(tmp_path)
        monkeypatch.setattr(swe_config, "GIT_BASE_URL", str(tmp_path / "origins") + "/", raising=False)
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        prepared = workdir_mod.prepare_instance_workdir(
            agent_working_dir=agent_dir, job_id="job5678",
            instance_id="demo__demo-1", repo="demo/demo", base_commit=base,
        )
        problems = workdir_mod.verify_isolation(prepared.path, "0" * 40)
        assert any("HEAD" in p for p in problems)

    def test_unfetchable_commit_raises(self, swe_env, tmp_path, monkeypatch):
        _build_origin(tmp_path)
        monkeypatch.setattr(swe_config, "GIT_BASE_URL", str(tmp_path / "origins") + "/", raising=False)
        agent_dir = str(tmp_path / "agent")
        os.makedirs(agent_dir, exist_ok=True)
        with pytest.raises(workdir_mod.WorkdirError):
            workdir_mod.prepare_instance_workdir(
                agent_working_dir=agent_dir, job_id="jobnope",
                instance_id="demo__demo-1", repo="demo/demo", base_commit="deadbeef" * 5,
            )


# ---------------------------------------------------------------------------
# Experimental positioning + version locking
# ---------------------------------------------------------------------------

class TestExperimentalAndVersions:
    def test_datasets_endpoint_experimental(self, client):
        data = client.get("/v1/evaluations/datasets").json()["data"]
        assert data["experimental"] is True
        assert data["leaderboard_comparable"] is False
        assert "not leaderboard-comparable" in data["notice"].lower()
        assert data["default_integrity_mode"] in ("strict", "debug")

    def test_job_serializer_experimental(self, client, workspace, swe_env, tmp_path):
        from tests.conftest import TestingSessionLocal
        from app.models import WorkspaceMember
        db = TestingSessionLocal()
        db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name="coder",
                               working_dir=str(tmp_path / "agent"), status="online"))
        db.commit()
        db.close()
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder", "mode": "debug",
        }, headers={"X-Workspace-Token": workspace["token"]})
        job = resp.json()["data"]
        assert job["experimental"] is True and job["leaderboard_comparable"] is False
        assert job["integrity_mode"] == "debug"

    def test_version_status_match(self, monkeypatch):
        monkeypatch.setattr(env_mod, "swebench_version", lambda: swe_config.EXPECTED_SWEBENCH_VERSION)
        st = env_mod.version_status()
        assert st["ok"] and st["level"] == "ok"

    def test_version_status_mismatch_warns(self, monkeypatch):
        monkeypatch.setattr(env_mod, "swebench_version", lambda: "9.9.9")
        monkeypatch.setattr(swe_config, "REQUIRE_EXACT_VERSION", False, raising=False)
        st = env_mod.version_status()
        assert not st["ok"] and st["level"] == "warn"

    def test_version_status_mismatch_can_error(self, monkeypatch):
        monkeypatch.setattr(env_mod, "swebench_version", lambda: "9.9.9")
        monkeypatch.setattr(swe_config, "REQUIRE_EXACT_VERSION", True, raising=False)
        st = env_mod.version_status()
        assert st["level"] == "error"
        check = precheck_mod.check_dependency_versions()
        assert check.level == "error"

    def test_precheck_includes_notices(self, swe_env):
        result = precheck_mod.run_prechecks(dataset_key="swe_bench_lite", split="test")
        names = {c["name"] for c in result["checks"]}
        assert {"experimental", "isolation", "resources", "dependency_versions"} <= names


# ---------------------------------------------------------------------------
# Default-off behaviour
# ---------------------------------------------------------------------------

class TestDisabled:
    def test_worker_not_started_when_disabled(self, monkeypatch):
        monkeypatch.setattr(swe_config, "ENABLED", False, raising=False)
        from tests.conftest import TestingSessionLocal
        assert eval_service.start_worker(TestingSessionLocal) is None

    def test_create_rejected_when_disabled(self, client, workspace, monkeypatch):
        monkeypatch.setattr(swe_config, "ENABLED", False, raising=False)
        resp = client.post("/v1/evaluations", json={
            "network": workspace["id"], "dataset": "swe_bench_lite",
            "instance_id": "demo__demo-1", "agent": "coder",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.json()["code"] == 403
