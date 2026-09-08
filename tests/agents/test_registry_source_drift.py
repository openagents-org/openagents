"""One agent catalog, four checked-in copies — they must agree.

The same agent is described in four places, each read by a different runtime:

===========================================  ====================================
``registry/*.json``                          canonical catalog
``workspace/backend/registry/*.json``        what the workspace backend serves
``packages/agent-connector/registry.json``   the JS runtime (Launcher, connector)
``sdk/src/openagents/registry/*.yaml``       the Python SDK / ``openagents`` CLI
===========================================  ====================================

Nothing gated them against each other on a pull request. The root and its
backend copy have had a byte-for-byte guard since the sync script landed (see
``workspace/backend/tests/test_agent_registry.py``), but it only runs in the
workflow_dispatch-only Python Tests workflow — and the other two edges had no
guard at all, so they drifted silently and in ways users felt:

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
BACKEND_REGISTRY = REPO / "workspace" / "backend" / "registry"

# Not an agent entry — the catalog's ordering/index sidecar.
_NOT_AN_AGENT = {"index.json"}

FIX_HINT = (
    "registry drift — the catalogs describe one contract. Edit registry/"
    "<agent>.json, packages/agent-connector/registry.json and "
    "sdk/src/openagents/registry/<agent>.yaml, then copy the entry into "
    "workspace/backend/registry/<agent>.json.\n"
    "Two things that will bite if you reach for the obvious tool instead:\n"
    "  • `npm run build:registry` regenerates the connector copy from the YAML "
    "and would DROP the fields only that copy carries — it is hand-maintained.\n"
    "  • `workspace/backend/scripts/sync_registry.py` is the normal way to "
    "refresh the backend copy, but on develop today it also reverts unrelated "
    "backend-only drift (kimi's resolve_env, added to the generated copy alone "
    "by 6c6f3643, and the provider catalog's Yumi model id). Until that is "
    "repaired, hand-copy the agent you are editing rather than running it "
    "blind."
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


def _load_backend() -> dict:
    """The copy the workspace backend actually serves, generated from the root."""
    out = {}
    for f in sorted(BACKEND_REGISTRY.glob("*.json")):
        if f.name in _NOT_AN_AGENT:
            continue
        entry = json.loads(f.read_text(encoding="utf-8"))
        out[entry["name"]] = entry
    return out


def _load_yaml() -> dict:
    out = {}
    for f in sorted(YAML_REGISTRY.glob("*.yaml")):
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        out[data.get("name") or f.stem] = data
    return out


@pytest.fixture(scope="module")
def catalogs():
    """The four checked-in copies, keyed by the name used in failure messages."""
    if not ROOT_REGISTRY.is_dir() or not CONNECTOR_REGISTRY.is_file():
        pytest.skip("catalogs not present in this checkout (slim deploy)")
    cats = {
        "root": _load_root(),
        "connector": _load_connector(),
        "yaml": _load_yaml(),
    }
    # A slim deploy can ship without the backend; a full checkout must not.
    if BACKEND_REGISTRY.is_dir():
        cats["backend"] = _load_backend()
    return cats


def test_every_yaml_agent_exists_in_both_json_catalogs(catalogs):
    """A YAML-only agent is invisible to the Launcher and the backend."""
    root, connector, yamls = catalogs["root"], catalogs["connector"], catalogs["yaml"]
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


def test_json_catalogs_list_the_same_agents(catalogs):
    """Compare the agent SETS before comparing any field.

    Every per-agent check below iterates an intersection, which silently skips
    an agent that exists on only one side — so dropping ``codebuddy`` from the
    connector, or adding an agent to the root alone, would pass every one of
    them. The YAML membership test does not cover this either: codebuddy,
    commandcode and openworker have no YAML file at all.
    """
    names = {label: set(cat) for label, cat in catalogs.items() if label != "yaml"}
    reference = names["root"]
    differing = {
        label: {"missing": sorted(reference - got), "extra": sorted(got - reference)}
        for label, got in names.items()
        if got != reference
    }
    assert not differing, (
        f"the JSON catalogs list different agents than registry/*.json: "
        f"{json.dumps(differing, indent=2)}\n{FIX_HINT}"
    )


def test_root_and_connector_check_ready_are_identical(catalogs):
    """Both feed a readiness implementation, so both must read the same rules.

    Full equality, not a subset: these two are the runtime contract. Key ORDER
    is not compared — dict equality is order-insensitive by design.
    """
    root, connector = catalogs["root"], catalogs["connector"]
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


def test_root_and_backend_check_ready_are_identical(catalogs):
    """The fourth copy — the one the workspace backend serves.

    ``workspace/backend/registry`` is generated from the root by
    ``sync_registry.py``, and a byte-for-byte guard for it already exists in
    ``workspace/backend/tests/test_agent_registry.py``. That guard only runs in
    the workflow_dispatch-only Python Tests workflow, though, so nothing checked
    it on a pull request — and this module's workflow triggers on
    ``workspace/backend/registry/**`` while testing nothing there.

    Scoped to ``check_ready`` rather than the whole entry on purpose: the full
    comparison is currently red on develop for reasons that have nothing to do
    with readiness (kimi's backend-only ``resolve_env``, the provider catalog's
    Yumi model id), and a gate that is red for an unrelated reason teaches
    people to ignore it. The byte-for-byte guard still owns the general case.
    """
    if "backend" not in catalogs:
        pytest.skip("backend catalog copy not present in this checkout")
    root, backend = catalogs["root"], catalogs["backend"]
    mismatched = {
        name: {"root": root[name].get("check_ready"), "backend": backend[name].get("check_ready")}
        for name in sorted(set(root) & set(backend))
        if root[name].get("check_ready") != backend[name].get("check_ready")
    }
    assert not mismatched, (
        f"check_ready differs between registry/*.json and the backend copy: "
        f"{json.dumps(mismatched, indent=2, ensure_ascii=False)}\n{FIX_HINT}"
    )


def test_yaml_check_ready_never_contradicts_the_json_catalogs(catalogs):
    """The YAML may omit keys; it may not disagree about one it declares.

    Omission is fine — a catalog-only entry has no Python adapter to be ready
    for. A DIFFERENT value for the same key is the bug this whole module exists
    to catch: it means two runtimes check two different things and one of them
    is wrong.
    """
    root, connector, yamls = catalogs["root"], catalogs["connector"], catalogs["yaml"]
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
    for label, cat in catalogs.items():
        cr = cat["claude"].get("check_ready") or {}
        assert cr.get("creds_file") == "~/.claude/.credentials.json", label
        assert cr.get("creds_key") == "claudeAiOauth", label
        assert cr.get("status_command") == "claude auth status", label
        # `claude login` is not a subcommand — it starts an interactive session
        # with "login" as the prompt. Authentication lives under `claude auth`.
        assert cr.get("login_command") == "claude auth login", label
        assert "claude login" not in (cr.get("not_ready_message") or ""), label
