# -*- coding: utf-8 -*-
"""
End-to-end backend tests for the Skill Hub install flow.

Covers the Workspace → Launcher contract:
  - POST /skills/install marks the skill `installing` (NOT installed) and emits
    a `workspace.agent.control` event with `action=skill.install` + catalog
    metadata that the launcher polls for.
  - POST /skills/status (launcher callback) flips state to installed/failed and
    keeps the legacy `installed` list in sync.
  - POST /skills/uninstall emits a `skill.uninstall` control event and clears
    state.
"""

import io
import zipfile

from sqlalchemy import select


def _make_zip(files: dict) -> bytes:
    """Build a .zip from ``{name: text_content}`` for tests."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def _make_workspace(client, name="WS2", agent="beta"):
    resp = client.post("/v1/workspaces", json={
        "name": name, "agent_name": agent, "creator_email": "other@example.com",
    })
    assert resp.status_code == 200, resp.text
    d = resp.json()["data"]
    return {"id": d["workspaceId"], "token": d["token"]}


def _upload_file(client, workspace, filename, data, content_type="application/octet-stream"):
    if isinstance(data, str):
        data = data.encode("utf-8")
    resp = client.post(
        "/v1/files",
        files={"file": (filename, data, content_type)},
        data={"network": workspace["id"]},
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


def _register_custom(client, workspace, file_id, token=None, **fields):
    return client.post(
        f"/v1/workspaces/{workspace['id']}/skills/custom",
        json={"file_id": file_id, **fields},
        headers={"X-Workspace-Token": token or workspace["token"]},
    )


def _join_agent(client, workspace, name, agent_type="claude"):
    resp = client.post("/v1/join", json={
        "agent_name": name,
        "token": workspace["token"],
        "network": workspace["id"],
        "agent_type": agent_type,
    })
    assert resp.status_code == 200, resp.text


def _control_events(client, workspace, agent_name):
    """Fetch workspace.agent.control events targeted at an agent (what the
    launcher's control poller queries)."""
    resp = client.get("/v1/events", params={
        "network": workspace["id"],
        "type": "workspace.agent.control",
        "target": f"openagents:{agent_name}",
    }, headers={"X-Workspace-Token": workspace["token"]})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["events"]


def _member_skills(db, workspace, agent_name):
    from app.models import WorkspaceMember
    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace["id"],
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one()
    return dict(member.enabled_skills or {})


class TestSkillInstallRequest:
    def test_install_marks_installing_not_installed(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "installing"
        # Not yet in the installed list — only the launcher's success callback
        # may add it.
        assert "claude-api" not in data["installedSkills"]
        assert data["skillStatus"]["claude-api"]["state"] == "installing"

    def test_install_emits_control_event_with_metadata(self, client, workspace):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        events = _control_events(client, workspace, "claude")
        skill_events = [e for e in events if e["payload"].get("action") == "skill.install"]
        assert len(skill_events) == 1
        payload = skill_events[0]["payload"]
        assert payload["skill"]["id"] == "claude-api"
        assert payload["skill"]["source_repo"] == "anthropics/skills"
        assert payload["skill"]["source_path"] == "skills/claude-api"
        assert skill_events[0]["target"] == "openagents:claude"

    def test_install_unknown_skill_returns_404(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "does-not-exist"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404

    def test_install_unknown_member_returns_404(self, client, workspace):
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/ghost/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404

    def test_install_bad_token_returns_401(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": "wrong-token"},
        )
        assert resp.status_code == 401


class TestSkillStatusCallback:
    def test_status_installed_adds_to_installed_list(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed",
                  "path": "/work/.claude/skills/claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "installed"
        assert "claude-api" in data["installedSkills"]
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["state"] == "installed"
        assert skills["skill_status"]["claude-api"]["path"].endswith("claude-api")

    def test_status_failed_records_error_and_not_installed(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "failed",
                  "error": "could not fetch skill from anthropics/skills"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "failed"
        assert "claude-api" not in data["installedSkills"]
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["state"] == "failed"
        assert "could not fetch" in skills["skill_status"]["claude-api"]["error"]

    def test_status_invalid_state_returns_400(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "bogus"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 400

    def test_codex_agent_install_and_status_roundtrip(self, client, workspace, db):
        """Codex must work end-to-end exactly like Claude."""
        _join_agent(client, workspace, "codex", agent_type="codex")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/codex/skills/install",
            json={"skill_id": "mcp-builder"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        events = _control_events(client, workspace, "codex")
        assert any(e["payload"].get("action") == "skill.install" for e in events)

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/codex/skills/status",
            json={"skill_id": "mcp-builder", "state": "installed",
                  "path": "/work/.codex/skills/mcp-builder"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        assert "mcp-builder" in resp.json()["data"]["installedSkills"]


class TestPerAgentIsolation:
    def test_install_is_scoped_per_agent(self, client, workspace, db):
        """Installing on Claude must NOT mark the skill installed on Codex."""
        _join_agent(client, workspace, "claude", agent_type="claude")
        _join_agent(client, workspace, "codex", agent_type="codex")

        # Install + confirm on claude only.
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )

        claude_skills = _member_skills(db, workspace, "claude")
        codex_skills = _member_skills(db, workspace, "codex")
        assert "claude-api" in claude_skills["installed"]
        # Codex must be completely untouched — no installed entry, no status.
        assert "claude-api" not in codex_skills.get("installed", [])
        assert "claude-api" not in codex_skills.get("skill_status", {})

        # And the control event only targeted claude.
        codex_events = _control_events(client, workspace, "codex")
        assert not any(e["payload"].get("action") == "skill.install" for e in codex_events)

    def test_discover_reports_distinct_status_per_agent(self, client, workspace, db):
        _join_agent(client, workspace, "claude", agent_type="claude")
        _join_agent(client, workspace, "codex", agent_type="codex")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = {a["address"]: a for a in disc.json()["data"]["agents"]}
        claude_status = (agents["openagents:claude"]["enabled_skills"] or {}).get("skill_status", {})
        codex_skills = agents["openagents:codex"]["enabled_skills"] or {}
        assert claude_status.get("claude-api", {}).get("state") == "installing"
        # Codex shows nothing for this skill.
        assert "claude-api" not in codex_skills.get("skill_status", {})


class TestPartialInstall:
    def test_partial_flag_is_persisted(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed", "partial": True},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        skills = _member_skills(db, workspace, "claude")
        assert skills["skill_status"]["claude-api"]["partial"] is True
        assert "claude-api" in skills["installed"]


class TestStatusAuth:
    def test_status_requires_workspace_token(self, client, workspace):
        _join_agent(client, workspace, "claude")
        # No token at all → 401, cannot forge an "installed" state.
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
        )
        assert resp.status_code == 401

    def test_status_wrong_token_rejected(self, client, workspace):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": "forged-token"},
        )
        assert resp.status_code == 401

    def test_status_for_unknown_member_404(self, client, workspace):
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/ghost/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404


class TestSkillUninstall:
    def test_uninstall_clears_state_and_emits_control_event(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        # Install + confirm
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "claude-api", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        # Uninstall
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/uninstall",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        assert "claude-api" not in resp.json()["data"]["installedSkills"]

        skills = _member_skills(db, workspace, "claude")
        assert "claude-api" not in skills.get("skill_status", {})

        events = _control_events(client, workspace, "claude")
        assert any(e["payload"].get("action") == "skill.uninstall" for e in events)

    def test_install_appears_in_discover_enabled_skills(self, client, workspace, db):
        """The skill_status the UI reads must round-trip through /v1/discover."""
        _join_agent(client, workspace, "claude")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "claude-api"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = disc.json()["data"]["agents"]
        claude = next(a for a in agents if a["address"] == "openagents:claude")
        assert claude["enabled_skills"]["skill_status"]["claude-api"]["state"] == "installing"


VALID_SKILL_MD = "---\nname: My Skill\ndescription: a test\n---\n# My Skill\n"


class TestCustomSkillRegister:
    def test_register_md_success(self, client, workspace, db):
        fid = _upload_file(client, workspace, "my-md.md", VALID_SKILL_MD, "text/markdown")
        resp = _register_custom(client, workspace, fid, id="my-md", name="My MD",
                                description="hello", filename="my-md.md")
        assert resp.status_code == 200, resp.text
        entry = resp.json()["data"]
        assert entry["id"] == "my-md"
        assert entry["name"] == "My MD"
        assert entry["source_type"] == "workspace_file"
        assert entry["package_type"] == "md"
        assert entry["file_id"] == fid
        assert entry["category"] == "custom"

    def test_register_zip_success(self, client, workspace, db):
        data = _make_zip({"SKILL.md": VALID_SKILL_MD, "helper.py": "print('hi')\n"})
        fid = _upload_file(client, workspace, "pkg.zip", data, "application/zip")
        resp = _register_custom(client, workspace, fid, id="my-zip", filename="pkg.zip")
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["package_type"] == "zip"

    def test_register_persists_to_settings_and_lists(self, client, workspace, db):
        from app.models import Workspace
        fid = _upload_file(client, workspace, "s.md", VALID_SKILL_MD, "text/markdown")
        _register_custom(client, workspace, fid, id="persisted", filename="s.md")

        # Re-read the row to prove the JSONB write actually persisted (guards
        # against SQLAlchemy not detecting an in-place settings mutation).
        ws = db.execute(select(Workspace).where(Workspace.id == workspace["id"])).scalar_one()
        assert "persisted" in (ws.settings or {}).get("custom_skills", {})

        listed = client.get(f"/v1/workspaces/{workspace['id']}/skills/custom",
                            headers={"X-Workspace-Token": workspace["token"]})
        assert listed.status_code == 200
        ids = [s["id"] for s in listed.json()["data"]["skills"]]
        assert "persisted" in ids

    def test_register_second_skill_keeps_first(self, client, workspace, db):
        f1 = _upload_file(client, workspace, "a.md", VALID_SKILL_MD, "text/markdown")
        f2 = _upload_file(client, workspace, "b.md", VALID_SKILL_MD, "text/markdown")
        _register_custom(client, workspace, f1, id="skill-a", filename="a.md")
        _register_custom(client, workspace, f2, id="skill-b", filename="b.md")
        listed = client.get(f"/v1/workspaces/{workspace['id']}/skills/custom",
                            headers={"X-Workspace-Token": workspace["token"]})
        ids = {s["id"] for s in listed.json()["data"]["skills"]}
        assert {"skill-a", "skill-b"} <= ids

    def test_conflict_with_catalog_returns_409(self, client, workspace, db):
        fid = _upload_file(client, workspace, "c.md", VALID_SKILL_MD, "text/markdown")
        resp = _register_custom(client, workspace, fid, id="claude-api", filename="c.md")
        assert resp.status_code == 409

    def test_conflict_with_existing_custom_returns_409(self, client, workspace, db):
        f1 = _upload_file(client, workspace, "d.md", VALID_SKILL_MD, "text/markdown")
        f2 = _upload_file(client, workspace, "d2.md", VALID_SKILL_MD, "text/markdown")
        assert _register_custom(client, workspace, f1, id="dup", filename="d.md").status_code == 200
        assert _register_custom(client, workspace, f2, id="dup", filename="d2.md").status_code == 409

    def test_invalid_id_returns_400(self, client, workspace, db):
        fid = _upload_file(client, workspace, "e.md", VALID_SKILL_MD, "text/markdown")
        resp = _register_custom(client, workspace, fid, id="-bad-id", filename="e.md")
        assert resp.status_code == 400

    def test_bad_token_returns_401(self, client, workspace, db):
        fid = _upload_file(client, workspace, "f.md", VALID_SKILL_MD, "text/markdown")
        resp = _register_custom(client, workspace, fid, token="wrong-token", id="ok", filename="f.md")
        assert resp.status_code == 401

    def test_file_from_other_workspace_rejected(self, client, workspace, db):
        other = _make_workspace(client)
        foreign_fid = _upload_file(client, other, "x.md", VALID_SKILL_MD, "text/markdown")
        # Register the foreign file id into *this* workspace → not found.
        resp = _register_custom(client, workspace, foreign_fid, id="foreign", filename="x.md")
        assert resp.status_code == 404

    def test_zip_without_skill_md_rejected(self, client, workspace, db):
        data = _make_zip({"README.md": "# nope\n", "helper.py": "x=1\n"})
        fid = _upload_file(client, workspace, "bad.zip", data, "application/zip")
        resp = _register_custom(client, workspace, fid, id="noskill", filename="bad.zip")
        assert resp.status_code == 400

    def test_zip_with_path_traversal_rejected(self, client, workspace, db):
        data = _make_zip({"SKILL.md": VALID_SKILL_MD, "../escape.txt": "pwned"})
        fid = _upload_file(client, workspace, "eviltrav.zip", data, "application/zip")
        resp = _register_custom(client, workspace, fid, id="trav", filename="eviltrav.zip")
        assert resp.status_code == 400

    def test_binary_masquerading_as_md_rejected(self, client, workspace, db):
        # A .zip renamed to .md must fail the UTF-8 text check.
        data = _make_zip({"SKILL.md": VALID_SKILL_MD})
        fid = _upload_file(client, workspace, "fake.md", data, "text/markdown")
        resp = _register_custom(client, workspace, fid, id="fake", filename="fake.md")
        assert resp.status_code == 400


class TestCustomSkillInstall:
    def _register(self, client, workspace, skill_id="my-custom", zip_pkg=False):
        if zip_pkg:
            data = _make_zip({"SKILL.md": VALID_SKILL_MD})
            fid = _upload_file(client, workspace, f"{skill_id}.zip", data, "application/zip")
            return _register_custom(client, workspace, fid, id=skill_id, filename=f"{skill_id}.zip")
        fid = _upload_file(client, workspace, f"{skill_id}.md", VALID_SKILL_MD, "text/markdown")
        return _register_custom(client, workspace, fid, id=skill_id, filename=f"{skill_id}.md")

    def test_install_custom_marks_installing(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        self._register(client, workspace, "my-custom")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["state"] == "installing"
        assert data["skillStatus"]["my-custom"]["state"] == "installing"

    def test_install_custom_emits_workspace_file_control_event(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        reg = self._register(client, workspace, "my-custom", zip_pkg=True)
        file_id = reg.json()["data"]["file_id"]
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        events = _control_events(client, workspace, "claude")
        skill_events = [e for e in events if e["payload"].get("action") == "skill.install"]
        assert len(skill_events) == 1
        skill = skill_events[0]["payload"]["skill"]
        assert skill["source_type"] == "workspace_file"
        assert skill["file_id"] == file_id
        assert skill["package_type"] == "zip"
        # Never leak file contents into the control event payload.
        blob = str(skill_events[0]["payload"])
        assert "base64" not in blob
        assert "content" not in skill  # no raw content key
        assert "PK" not in blob        # no zip bytes

    def test_install_unknown_skill_still_404(self, client, workspace, db):
        _join_agent(client, workspace, "claude")
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "nope-not-real"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 404

    def test_custom_install_is_per_agent(self, client, workspace, db):
        _join_agent(client, workspace, "claude", agent_type="claude")
        _join_agent(client, workspace, "codex", agent_type="codex")
        self._register(client, workspace, "my-custom")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        claude_skills = _member_skills(db, workspace, "claude")
        codex_skills = _member_skills(db, workspace, "codex")
        assert "my-custom" in claude_skills.get("skill_status", {})
        assert "my-custom" not in codex_skills.get("skill_status", {})

    def test_install_after_file_deleted_returns_409_and_no_event(self, client, workspace, db):
        """If the backing upload was deleted from Workspace Files, install must
        fail fast (before emitting a control event) with a clear message."""
        _join_agent(client, workspace, "claude")
        reg = self._register(client, workspace, "my-custom")
        file_id = reg.json()["data"]["file_id"]

        # Delete the underlying file (as the Files UI would).
        delr = client.delete(f"/v1/files/{file_id}",
                             headers={"X-Workspace-Token": workspace["token"]})
        assert delr.status_code == 200, delr.text

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 409, resp.text
        assert "re-upload" in resp.json()["message"].lower()

        # Member must NOT be left dangling in "installing", and no control event.
        skills = _member_skills(db, workspace, "claude")
        assert "my-custom" not in skills.get("skill_status", {})
        events = _control_events(client, workspace, "claude")
        assert not any(e["payload"].get("action") == "skill.install" for e in events)

    def test_custom_uninstall_does_not_need_catalog(self, client, workspace, db):
        """Uninstalling a custom skill must not fail just because it isn't in the
        built-in catalog (find_skill would return None)."""
        _join_agent(client, workspace, "claude")
        self._register(client, workspace, "my-custom")
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/install",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/status",
            json={"skill_id": "my-custom", "state": "installed"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/members/claude/skills/uninstall",
            json={"skill_id": "my-custom"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200, resp.text
        events = _control_events(client, workspace, "claude")
        assert any(e["payload"].get("action") == "skill.uninstall" for e in events)
        # The custom skill metadata itself survives an agent-level uninstall.
        listed = client.get(f"/v1/workspaces/{workspace['id']}/skills/custom",
                            headers={"X-Workspace-Token": workspace["token"]})
        assert "my-custom" in [s["id"] for s in listed.json()["data"]["skills"]]
