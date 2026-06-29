# -*- coding: utf-8 -*-
"""
Benchmark-integrity guard for the collected model patch.

A genuine fix touches *source* code. Touching tests or evaluation
infrastructure is the cheat vector, so we classify every changed file and, in
``strict`` mode, REJECT the whole patch (it never reaches the harness) if it
modifies any of:

  * the instance's own measured test files
  * any test file / ``test`` / ``tests`` / ``testing`` directory
  * fixtures or mocks
  * CI config (GitHub Actions, GitLab CI, CircleCI, Travis, Jenkins, …)
  * test-runner / coverage config (pytest/tox/nox/coverage/conftest)
  * dependency / install scripts (requirements, setup.py, pyproject, …)
  * benchmark / harness files

We do NOT silently strip these hunks and then claim a "resolved" — a stripped
patch is not provably semantically equivalent to what the agent produced. In
``debug`` mode the full patch still runs, but the job is flagged as an
integrity risk and is never a valid formal result.
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Set

# `diff --git a/<path> b/<path>` — capture the b/ (post-image) path.
_DIFF_GIT_RE = re.compile(r"^diff --git a/(?P<a>.+?) b/(?P<b>.+)$")
# `+++ b/<path>` fallback when there's no `diff --git` header.
_PLUSPLUS_RE = re.compile(r"^\+\+\+ b/(?P<path>.+)$")

_TEST_BASENAME_RE = re.compile(r"(^test_.*\.py$|.*_test\.py$|^tests?\.py$|.*\.test\.[jt]sx?$|.*\.spec\.[jt]sx?$)")

# Integrity categories (also surfaced in the UI / job report).
CAT_INSTANCE_TEST = "instance_test"
CAT_TEST_FILE = "test_file"
CAT_TEST_DIR = "test_dir"
CAT_FIXTURE = "fixture"
CAT_MOCK = "mock"
CAT_CI_CONFIG = "ci_config"
CAT_TEST_RUNNER_CONFIG = "test_runner_config"
CAT_DEPENDENCY_SCRIPT = "dependency_script"
CAT_BENCHMARK_INFRA = "benchmark_infra"

_CI_CONFIG_PREFIXES = (".github/workflows/", ".circleci/", ".gitlab/")
_CI_CONFIG_FILES = {
    ".gitlab-ci.yml", ".travis.yml", "azure-pipelines.yml", "appveyor.yml",
    "appveyor.yaml", "jenkinsfile",
}
_TEST_RUNNER_FILES = {
    "pytest.ini", "tox.ini", "noxfile.py", ".coveragerc", "conftest.py",
    "setup.cfg", "pytest.cfg", ".flake8",
}
_DEPENDENCY_FILES = {
    "setup.py", "pyproject.toml", "pipfile", "pipfile.lock", "poetry.lock",
    "manifest.in", "environment.yml", "environment.yaml", "constraints.txt",
}
_DEPENDENCY_BASENAME_RE = re.compile(r"^(requirements.*\.txt|.*\.cfg)$")
_BENCHMARK_TOKENS = ("swebench", "run_evaluation", "/harness/")


def is_test_file(path: str) -> bool:
    """Heuristic: does this path look like a test file?"""
    p = (path or "").strip()
    if not p:
        return False
    parts = p.split("/")
    if any(seg in ("tests", "test", "testing") for seg in parts[:-1]):
        return True
    return bool(_TEST_BASENAME_RE.match(parts[-1]))


def classify_protected(path: str, instance_test_files: Optional[Set[str]] = None) -> Optional[str]:
    """Return the integrity category a path violates, or None if it's plain
    source. The most specific / severe category wins."""
    p = (path or "").strip()
    if not p:
        return None
    low = p.lower()
    base = low.split("/")[-1]
    parts = low.split("/")

    if instance_test_files and p in instance_test_files:
        return CAT_INSTANCE_TEST
    if any(tok in low for tok in _BENCHMARK_TOKENS):
        return CAT_BENCHMARK_INFRA
    if low.startswith(_CI_CONFIG_PREFIXES) or base in _CI_CONFIG_FILES:
        return CAT_CI_CONFIG
    if any(seg in ("tests", "test", "testing") for seg in parts[:-1]):
        return CAT_TEST_DIR
    if _TEST_BASENAME_RE.match(base):
        return CAT_TEST_FILE
    if "fixture" in low:
        return CAT_FIXTURE
    if "mock" in low:
        return CAT_MOCK
    if base in _TEST_RUNNER_FILES:
        return CAT_TEST_RUNNER_CONFIG
    if base in _DEPENDENCY_FILES or _DEPENDENCY_BASENAME_RE.match(base):
        # `.cfg` already handled above for known runners; treat other dep files.
        if base == "setup.cfg":
            return CAT_TEST_RUNNER_CONFIG
        return CAT_DEPENDENCY_SCRIPT
    return None


def _strip_ab_prefix(path: str) -> str:
    for pre in ("a/", "b/"):
        if path.startswith(pre):
            return path[len(pre):]
    return path


def changed_files_from_patch(patch_text: str) -> List[str]:
    """Return the list of (post-image) file paths a unified diff modifies."""
    files: List[str] = []
    for line in (patch_text or "").splitlines():
        m = _DIFF_GIT_RE.match(line)
        if m:
            files.append(m.group("b"))
            continue
        m = _PLUSPLUS_RE.match(line)
        if m and m.group("path") != "/dev/null":
            p = m.group("path")
            if p not in files:
                files.append(p)
    return files


def test_files_from_patch(patch_text: str) -> Set[str]:
    """File paths touched by a (test) patch — the instance's measured tests."""
    return {_strip_ab_prefix(p) for p in changed_files_from_patch(patch_text)}


@dataclass
class PatchAnalysis:
    changed_files: List[str] = field(default_factory=list)
    hits: List[dict] = field(default_factory=list)   # [{"file":..., "category":...}]

    @property
    def has_violation(self) -> bool:
        return bool(self.hits)

    @property
    def protected_files(self) -> List[str]:
        return [h["file"] for h in self.hits]

    @property
    def categories(self) -> List[str]:
        seen, out = set(), []
        for h in self.hits:
            if h["category"] not in seen:
                seen.add(h["category"])
                out.append(h["category"])
        return out

    def to_dict(self) -> dict:
        return {
            "changed_files": self.changed_files,
            "protected_hits": self.hits,
            "protected_files": self.protected_files,
            "categories": self.categories,
            "has_violation": self.has_violation,
        }


def analyze_patch(patch_text: str, instance_test_files: Optional[Set[str]] = None) -> PatchAnalysis:
    """Classify every changed file in the patch."""
    changed = changed_files_from_patch(patch_text or "")
    analysis = PatchAnalysis(changed_files=changed)
    for f in changed:
        cat = classify_protected(_strip_ab_prefix(f), instance_test_files)
        if cat:
            analysis.hits.append({"file": _strip_ab_prefix(f), "category": cat})
    return analysis
