"""Readiness from a registry entry's ``check_ready.creds_file``.

Three shapes exist in the catalog and every one of them used to fall through
this check silently, so the whole ``creds_file`` declaration was dead code:

- a **directory**, for a CLI that writes one file per stored account —
  ``read_text()`` raises on a directory. (This used to cite Claude's
  ``~/.claude/sessions``; that directory tracks RUNNING claude processes, not
  logins, so Claude now declares ``.credentials.json`` instead.);
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


class TestStatusCommand:
    """``check_ready.status_command`` — asking the CLI instead of guessing.

    This is the only evidence that survives a CLI relocating its credential
    store. Claude Code's ``claude auth status`` still answers correctly under a
    custom ``CLAUDE_CONFIG_DIR`` (which also changes the Keychain service name)
    and under the Windows Credential Manager path, where ``creds_file`` and a
    fixed ``keychain_service`` both see nothing. The JS core has run it since it
    was introduced; this side only counted it toward ``has_checks``.

    Exit code is the whole protocol — nothing the command prints is read.
    """

    @pytest.fixture(autouse=True)
    def _no_status_cache(self):
        """The 10s memo is shared module state; a stale hit would cross cases."""
        loader._status_cache.clear()
        yield
        loader._status_cache.clear()

    def test_exit_zero_is_signed_in(self):
        ready, msg = _plugin({"status_command": "exit 0"}).check_ready()
        assert (ready, msg) == (True, "Ready (logged in)")

    def test_non_zero_exit_is_not(self):
        ready, msg = _plugin(
            {"status_command": "exit 1", "not_ready_message": "Sign in"}
        ).check_ready()
        assert (ready, msg) == (False, "Sign in")

    def test_a_command_that_cannot_run_is_not_ready(self):
        cfg = {
            "status_command": "openagents-no-such-binary status",
            "not_ready_message": "Sign in",
        }
        assert _plugin(cfg).check_ready()[0] is False

    def test_declaring_only_a_status_command_is_still_a_check(self):
        """The trap this closes.

        ``has_checks`` decides whether an installed agent is Ready by default.
        With ``status_command`` left out of it, an entry declaring nothing else
        fell straight through to an unconditional Ready — a signed-out agent
        reported as usable.
        """
        cfg = {"status_command": "exit 1", "not_ready_message": "Sign in"}
        assert _plugin(cfg).check_ready() == (False, "Sign in")

    def test_cheaper_evidence_wins_and_never_spawns(self, tmp_path):
        """Ordering, not just correctness — this is the polled path.

        Every other check is a file read or an env lookup; this one spawns a
        process (~1s for Claude Code). A creds_file hit must settle it first, or
        a readiness poll pays for a subprocess it did not need.
        """
        creds = tmp_path / "creds.json"
        creds.write_text('{"token": "x"}')
        cfg = {"creds_file": str(creds), "status_command": "exit 1"}
        assert _plugin(cfg).check_ready()[0] is True
        assert loader._status_cache == {}, "cheap evidence still spawned the CLI"

    def test_the_verdict_is_memoized(self, monkeypatch):
        calls = []

        def _fake_run(command, **kwargs):
            calls.append(command)

            class R:
                returncode = 0

            return R()

        monkeypatch.setattr(loader.subprocess, "run", _fake_run)
        plugin = _plugin({"status_command": "some status"})
        assert plugin.check_ready()[0] is True
        assert plugin.check_ready()[0] is True
        assert calls == ["some status"], "the 10s memo did not hold"
