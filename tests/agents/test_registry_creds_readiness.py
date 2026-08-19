"""Readiness from a registry entry's ``check_ready.creds_file``.

Three shapes exist in the catalog and every one of them used to fall through
this check silently, so the whole ``creds_file`` declaration was dead code:

- a **directory** of session files (Claude's ``~/.claude/sessions``) —
  ``read_text()`` raises on a directory;
- a file that is **not JSON** (Hermes' ``config.yaml``) — ``json.loads`` raises;
- a JSON file with **no** ``creds_key`` — the only ``return True`` was guarded
  on ``creds_key``, so it was unreachable.

The behaviour now matches the JS core's ``installer.js``, so both
implementations read one registry the same way. Nothing here reads a credential
out: a value is only ever tested for emptiness.

Run:
    pytest tests/agents/test_registry_creds_readiness.py -v
"""

import json

import pytest

import openagents.registry.loader as loader


def _plugin(check_ready):
    """A minimal installed plugin whose readiness rests on ``check_ready``."""
    plugin = loader._make_plugin_from_yaml(
        {
            "name": "creds-probe",
            # Only builtin entries become full plugins; catalog-only ones
            # return None.
            "builtin": True,
            "install": {"binary": "creds-probe"},
            "adapter": {
                "module": "openagents.adapters.gemini",
                "class": "GeminiAdapter",
            },
            "check_ready": check_ready,
        }
    )
    assert plugin is not None
    # Installation is not what these cases are about, and resolving a real
    # binary would drag PATH into it.
    plugin.is_installed = lambda: True
    return plugin


@pytest.fixture(autouse=True)
def _no_ambient_keys(monkeypatch):
    """An API key in the ambient env would satisfy readiness before the file."""
    for var in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)


class TestCredsDirectory:
    def test_non_empty_directory_is_signed_in(self, tmp_path):
        sessions = tmp_path / "sessions"
        sessions.mkdir()
        (sessions / "a.json").write_text("{}")
        ready, _ = _plugin({"creds_file": str(sessions)}).check_ready()
        assert ready is True

    def test_empty_directory_is_not(self, tmp_path):
        sessions = tmp_path / "sessions"
        sessions.mkdir()
        ready, msg = _plugin(
            {"creds_file": str(sessions), "not_ready_message": "Sign in"}
        ).check_ready()
        assert ready is False
        assert msg == "Sign in"


class TestCredsKey:
    def _accounts(self, tmp_path, body):
        path = tmp_path / "google_accounts.json"
        path.write_text(json.dumps(body))
        return {"creds_file": str(path), "creds_key": "active"}

    def test_named_field_with_a_value_is_signed_in(self, tmp_path):
        cfg = self._accounts(tmp_path, {"active": "ada@example.com", "old": []})
        assert _plugin(cfg).check_ready()[0] is True

    def test_null_field_is_signed_out(self, tmp_path):
        # How the CLI records a sign-out — and how the file sits from install
        # onward for someone who never signed in at all.
        cfg = self._accounts(tmp_path, {"active": None, "old": ["ada@example.com"]})
        assert _plugin(cfg).check_ready()[0] is False

    def test_blank_field_is_signed_out(self, tmp_path):
        cfg = self._accounts(tmp_path, {"active": "   "})
        assert _plugin(cfg).check_ready()[0] is False

    def test_unparseable_file_is_not_signed_in(self, tmp_path):
        path = tmp_path / "google_accounts.json"
        path.write_text("{ half a file")
        cfg = {"creds_file": str(path), "creds_key": "active"}
        assert _plugin(cfg).check_ready()[0] is False


class TestExistenceOnly:
    def test_non_json_config_counts_on_existence(self, tmp_path):
        # Hermes' config.yaml: json.loads could only ever raise here, so the
        # file being there is the whole of the evidence.
        path = tmp_path / "config.yaml"
        path.write_text("provider: openai\n")
        assert _plugin({"creds_file": str(path)}).check_ready()[0] is True

    def test_empty_file_does_not_count(self, tmp_path):
        path = tmp_path / "config.yaml"
        path.write_text("")
        assert _plugin({"creds_file": str(path)}).check_ready()[0] is False

    def test_missing_file_does_not_count(self, tmp_path):
        cfg = {"creds_file": str(tmp_path / "nope.yaml")}
        assert _plugin(cfg).check_ready()[0] is False

    def test_json_without_a_creds_key_counts_on_existence(self, tmp_path):
        # Unchanged for entries that never named a field.
        path = tmp_path / "creds.json"
        path.write_text('{"anything": 1}')
        assert _plugin({"creds_file": str(path)}).check_ready()[0] is True


class TestRegistryDeclarations:
    def test_gemini_names_the_account_field(self):
        data = next(
            d for d in loader.load_registry_yamls() if d.get("name") == "gemini"
        )
        check = data["check_ready"]
        # Not oauth_creds.json: current CLI builds move the token into the OS
        # keychain and delete that file, so watching for it reported "signed
        # out" however many times the user signed in.
        assert check["creds_file"] == "~/.gemini/google_accounts.json"
        assert check["creds_key"] == "active"
