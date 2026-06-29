# -*- coding: utf-8 -*-
"""
SWE-bench dataset loading and benchmark-integrity isolation.

Two responsibilities:

1. Load instances from a SWE-bench HuggingFace dataset (lazily — the
   ``datasets`` lib is optional) and cache the FULL instances to a JSON file
   under the (agent-inaccessible) work dir so the harness can re-read them
   offline and so the UI can list instances.

2. Enforce the benchmark-integrity boundary: an agent under evaluation must
   only ever see ``public_view(instance)`` — never the gold ``patch``, the
   ``test_patch``, the ``FAIL_TO_PASS`` / ``PASS_TO_PASS`` targets, or
   ``hints_text``. Those fields are stripped here in one place.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

from .config import DATASETS, config

logger = logging.getLogger(__name__)

# Fields the agent must NEVER see. Anything that reveals the solution, the
# tests being measured, or future repo state lives here.
SENSITIVE_FIELDS = frozenset({
    "patch",            # gold solution
    "test_patch",       # the tests the harness will apply/measure
    "FAIL_TO_PASS",     # which tests must flip
    "PASS_TO_PASS",     # which tests must keep passing
    "hints_text",       # maintainer hints / spoilers
})

# Fields that are safe to hand to the agent.
PUBLIC_FIELDS = (
    "instance_id",
    "repo",
    "base_commit",
    "problem_statement",
    "version",
    "environment_setup_commit",
    "created_at",
)


class DatasetError(Exception):
    """Raised when a dataset / instance cannot be loaded."""


def _cache_dir() -> str:
    path = os.path.join(config.WORK_DIR, "datasets")
    os.makedirs(path, exist_ok=True)
    try:
        os.chmod(path, 0o700)  # not world-readable; this holds gold/test data
    except OSError:
        pass
    return path


def cache_path(dataset_key: str, split: str) -> str:
    return os.path.join(_cache_dir(), f"{dataset_key}__{split}.json")


def _hf_id(dataset_key: str) -> str:
    meta = DATASETS.get(dataset_key)
    if not meta:
        raise DatasetError(f"Unknown dataset '{dataset_key}'")
    if not config.dataset_enabled(dataset_key):
        raise DatasetError(f"Dataset '{dataset_key}' is not enabled on this server")
    return meta["id"]


def _normalise_instance(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Decode the JSON-encoded FAIL_TO_PASS / PASS_TO_PASS string fields."""
    inst = dict(raw)
    for key in ("FAIL_TO_PASS", "PASS_TO_PASS"):
        val = inst.get(key)
        if isinstance(val, str):
            try:
                inst[key] = json.loads(val)
            except (ValueError, TypeError):
                inst[key] = []
    return inst


def load_instances(dataset_key: str, split: str, *, refresh: bool = False) -> List[Dict[str, Any]]:
    """Load (and cache) the FULL instances for a dataset split.

    Reads the on-disk cache if present unless ``refresh``. Otherwise pulls via
    the ``datasets`` library (optional dependency). Raises ``DatasetError`` if
    neither is available.
    """
    path = cache_path(dataset_key, split)
    if not refresh and os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, list) and data:
                return [_normalise_instance(x) for x in data]
        except (ValueError, OSError) as exc:
            logger.warning("swebench dataset cache unreadable (%s); reloading", exc)

    hf_id = _hf_id(dataset_key)
    try:
        from datasets import load_dataset  # type: ignore
    except ImportError as exc:
        raise DatasetError(
            "The 'datasets' package is required to download SWE-bench datasets. "
            "Install it (pip install datasets) or pre-populate the dataset cache."
        ) from exc

    try:
        ds = load_dataset(hf_id, split=split)
    except Exception as exc:  # network / auth / unknown split
        raise DatasetError(f"Failed to load dataset {hf_id}:{split} — {exc}") from exc

    instances = [dict(row) for row in ds]
    # Persist the full instances (gold + tests) to the agent-inaccessible cache.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(instances, fh)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return [_normalise_instance(x) for x in instances]


def get_instance(dataset_key: str, split: str, instance_id: str) -> Dict[str, Any]:
    """Return the FULL instance dict (internal use only — contains gold/tests)."""
    for inst in load_instances(dataset_key, split):
        if inst.get("instance_id") == instance_id:
            return inst
    raise DatasetError(f"Instance '{instance_id}' not found in {dataset_key}:{split}")


def public_view(instance: Dict[str, Any]) -> Dict[str, Any]:
    """Strip an instance down to the fields an agent is allowed to see.

    This is the ONLY function that should be used to build agent-facing
    context. It is deny-by-default: only PUBLIC_FIELDS pass through, and a
    belt-and-suspenders assertion guarantees no sensitive field leaks.
    """
    view = {k: instance.get(k) for k in PUBLIC_FIELDS if k in instance}
    leaked = SENSITIVE_FIELDS & set(view.keys())
    assert not leaked, f"benchmark integrity violation: leaked {leaked}"
    return view


def list_instances(
    dataset_key: str,
    split: str,
    *,
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Public, paginated instance listing for the instance picker.

    Returns only safe summary fields (never gold/test data).
    """
    instances = load_instances(dataset_key, split)
    if search:
        needle = search.lower()
        instances = [
            i for i in instances
            if needle in (i.get("instance_id", "").lower())
            or needle in (i.get("repo", "").lower())
        ]
    total = len(instances)
    page = instances[offset:offset + limit]
    items = []
    for i in page:
        ps = i.get("problem_statement") or ""
        items.append({
            "instance_id": i.get("instance_id"),
            "repo": i.get("repo"),
            "base_commit": i.get("base_commit"),
            "version": i.get("version"),
            "problem_summary": ps[:280],
        })
    return {"total": total, "items": items, "limit": limit, "offset": offset}
