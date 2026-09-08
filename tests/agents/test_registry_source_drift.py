"""One agent catalog, three checked-in copies — they must agree.

The same agent is described in three places, each read by a different runtime:

===========================================  ====================================
``registry/*.json``                          canonical catalog; the workspace
                                             backend serves a synced copy
``packages/agent-connector/registry.json``   the JS runtime (Launcher, connector)
``sdk/src/openagents/registry/*.yaml``       the Python SDK / ``openagents`` CLI
===========================================  ====================================

Nothing kept them in step. ``registry/*.json`` and the backend copy have had a
byte-for-byte guard since the sync script landed (see
``workspace/backend/tests/test_agent_registry.py``), but the other two edges had
none, so they drifted silently and in ways users felt:

- Claude's ``check_ready.creds_file`` said ``~/.claude/.credentials.json`` in the
  YAML and ``~/.claude/sessions`` in both JSON copies (issue #631). The latter is
  a registry of RUNNING claude processes, so the Launcher told signed-in users
  with no session open to "Run: claude login".
- Commit 74903b47 rewrote Gemini's ``not_ready_message`` for the June 2026 end of
  individual sign-in, in the YAML and the connector copy — and missed
  ``registry/gemini.json``, which the backend serves.

The rules below are deliberately asymmetric. The two JSON catalogs describe the
same runtime contract and must match exactly on ``check_ready``. The YAML is
allowed to stay a SUBSET — many entries are catalog-only and legitimately omit
fields the JS runtime needs — but where it does declare a key, it may not
contradict the others.

Run:
    pytest tests/agents/test_registry_source_drift.py -v
"""

import json
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

REPO = Path(__file__).resolve().parents[2]
ROOT_REGISTRY = REPO / "registry"
CONNECTOR_REGISTRY = REPO / "packages" / "agent-connector" / "registry.json"
YAML_REGISTRY = REPO / "sdk" / "src" / "openagents" / "registry"

# Not an agent entry — the catalog's ordering/index sidecar.
_NOT_AN_AGENT = {"index.json"}

FIX_HINT = (
    "registry drift — the three catalogs describe one contract. Edit all of "
    "registry/<agent>.json, packages/agent-connector/registry.json and "
    "sdk/src/openagents/registry/<agent>.yaml, then run "
    "workspace/backend/scripts/sync_registry.py. The connector copy is "
    "hand-maintained: `npm run build:registry` would drop the fields only it "
    "carries."
)


def _load_root() -> dict:
    out = {}
    for f in sorted(ROOT_REGISTRY.glob("*.json")):
        if f.name in _NOT_AN_AGENT:
            continue
        entry = json.loads(f.read_text(encoding="utf-8"))
        out[entry["name"]] = entry
    return out


def _load_connector() -> dict:
    entries = json.loads(CONNECTOR_REGISTRY.read_text(encoding="utf-8"))
    return {e["name"]: e for e in entries}


def _load_yaml() -> dict:
    out = {}
    for f in sorted(YAML_REGISTRY.glob("*.yaml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        out[data.get("name") or f.stem] = data
    return out


@pytest.fixture(scope="module")
def catalogs():
    if not ROOT_REGISTRY.is_dir() or not CONNECTOR_REGISTRY.is_file():
        pytest.skip("catalogs not present in this checkout (slim deploy)")
    return _load_root(), _load_connector(), _load_yaml()


def test_every_yaml_agent_exists_in_both_json_catalogs(catalogs):
    """A YAML-only agent is invisible to the Launcher and the backend."""
    root, connector, yamls = catalogs
    missing = {
        name: [
            label
            for label, cat in (("root", root), ("connector", connector))
            if name not in cat
        ]
        for name in yamls
    }
    missing = {k: v for k, v in missing.items() if v}
    assert not missing, f"agents missing from a catalog: {missing}\n{FIX_HINT}"


def test_root_and_connector_check_ready_are_identical(catalogs):
    """Both feed a readiness implementation, so both must read the same rules.

    Full equality, not a subset: these two are the runtime contract. Key ORDER
    is not compared — dict equality is order-insensitive by design.
    """
    root, connector, _ = catalogs
    mismatched = {}
    for name in sorted(set(root) & set(connector)):
        a = root[name].get("check_ready")
        b = connector[name].get("check_ready")
        if a != b:
            keys = set(a or {}) | set(b or {})
            mismatched[name] = {
                k: {"root": (a or {}).get(k), "connector": (b or {}).get(k)}
                for k in sorted(keys)
                if (a or {}).get(k) != (b or {}).get(k)
            }
    assert not mismatched, (
        f"check_ready differs between registry/*.json and the connector copy: "
        f"{json.dumps(mismatched, indent=2, ensure_ascii=False)}\n{FIX_HINT}"
    )


def test_yaml_check_ready_never_contradicts_the_json_catalogs(catalogs):
    """The YAML may omit keys; it may not disagree about one it declares.

    Omission is fine — a catalog-only entry has no Python adapter to be ready
    for. A DIFFERENT value for the same key is the bug this whole module exists
    to catch: it means two runtimes check two different things and one of them
    is wrong.
    """
    root, connector, yamls = catalogs
    conflicts = []
    for name in sorted(set(yamls) & set(root) & set(connector)):
        declared = yamls[name].get("check_ready") or {}
        for label, other in (
            ("root", root[name].get("check_ready") or {}),
            ("connector", connector[name].get("check_ready") or {}),
        ):
            for key, value in declared.items():
                if key not in other:
                    conflicts.append(
                        f"{name}.check_ready.{key}: declared in YAML "
                        f"({value!r}) but absent from {label}"
                    )
                elif other[key] != value:
                    conflicts.append(
                        f"{name}.check_ready.{key}: YAML {value!r} != "
                        f"{label} {other[key]!r}"
                    )
    assert not conflicts, "\n".join(["YAML contradicts a JSON catalog:", *conflicts, FIX_HINT])


def test_claude_readiness_evidence_is_the_credential_store(catalogs):
    """Issue #631, pinned so the sessions directory cannot come back.

    ``~/.claude/sessions`` holds one ``<pid>.json`` per RUNNING claude process,
    written at session start and deleted at exit — empty for a signed-in user
    with nothing open. The credential store is ``.credentials.json`` (keyed
    ``claudeAiOauth``) on Linux/Windows and the ``Claude Code-credentials``
    Keychain item on macOS, and ``claude auth status`` is the authoritative
    check that survives a relocated CLAUDE_CONFIG_DIR.
    """
    root, connector, yamls = catalogs
    for label, cat in (("root", root), ("connector", connector), ("yaml", yamls)):
        cr = cat["claude"].get("check_ready") or {}
        assert cr.get("creds_file") == "~/.claude/.credentials.json", label
        assert cr.get("creds_key") == "claudeAiOauth", label
        assert cr.get("status_command") == "claude auth status", label
        # `claude login` is not a subcommand — it starts an interactive session
        # with "login" as the prompt. Authentication lives under `claude auth`.
        assert cr.get("login_command") == "claude auth login", label
        assert "claude login" not in (cr.get("not_ready_message") or ""), label
