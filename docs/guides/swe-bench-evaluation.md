# SWE-bench Evaluation (Workspace)

> **Experimental local evaluation.** Results are intended for local regression
> testing and are **not leaderboard-comparable by default**. This is a
> default-off, local / self-hosted capability — not an official SWE-bench score
> and not an official "Verified" result.

SWE-bench is a **benchmark / evaluation** capability built into the OpenAgents
Workspace. It is **not an agent** — it does not appear in the agent catalog or
any agent install list. Instead it *reuses* a connected coding agent to solve a
benchmark instance, then grades the result with the **official SWE-bench Docker
harness**. The Workspace never re-implements test judgement.

Whether a run is *comparable* depends on how isolated the agent's environment
is: the official harness decides the test result, but the agent's working
environment (network access, history isolation) decides benchmark validity. Use
these results for local Agent regression and capability comparison, not as a
published score.

> One job = one instance: prepare an isolated checkout at the instance's base
> commit → hand the issue to a connected coding agent → collect the agent's
> `git diff` → run the official harness → record the verdict.

---

## What it does

1. Pick a dataset — **SWE-bench Lite**, **SWE-bench Verified**, or (optionally)
   the **full** set.
2. Pick one instance.
3. Pick an already-connected coding agent.
4. The server creates an isolated working directory at the instance's base
   commit, inside the agent's own working directory.
5. The agent receives only the **issue text** (problem statement) and the repo
   — never the gold patch, the test patch, or the measured tests.
6. The agent's changes are collected with `git diff`.
7. The official harness (`python -m swebench.harness.run_evaluation`) evaluates
   the patch in Docker.
8. The Workspace shows the status, patch, harness logs, duration, and result.

Open it from the **Benchmarks** entry in the left navigation (a flask icon),
separate from the agent list.

---

## Requirements

SWE-bench is heavy and **disabled by default**. To enable it you need a host
that runs the Workspace backend, Docker, **and** the coding agent on the **same
machine** (see *Topology* below).

| Resource | Recommendation |
| --- | --- |
| OS | Linux x86_64 (recommended). macOS works. Windows needs Docker Desktop + WSL2. |
| Docker | Docker Engine running and reachable (`docker info`). |
| Disk | **≥ 120 GiB free** on the work dir (instance images are large). |
| RAM / CPU | ≥ 16 GiB RAM, ≥ 8 CPU recommended. |
| Python | Pinned harness deps — `pip install -r workspace/backend/requirements-swebench.txt` (`swebench==4.1.0`, `datasets==3.6.0`, `docker==7.1.0`; Python 3.10/3.11). |
| Network | Required to pull prebuilt images from Docker Hub and to download datasets the first time. |

The harness deps are **pinned and lazy-imported** — they do not affect the
default install, and the workspace boots without them. Every job records the
actual `swebench` / Python / Docker / OS / arch it ran against; preflight warns
(or, with `SWEBENCH_REQUIRE_EXACT_VERSION=true`, errors) when the installed
`swebench` version differs from the tested one (`4.1.0`).

ARM (Apple silicon) is **experimental**: the prebuilt images are `linux/amd64`,
so set `SWEBENCH_NAMESPACE=none` to build instance images locally (slower).

### Enabling

```bash
export SWEBENCH_ENABLED=true
# optional
export SWEBENCH_WORK_DIR=/var/lib/openagents/swebench
export SWEBENCH_MAX_CONCURRENCY=1          # default 1
export SWEBENCH_NAMESPACE=swebench         # "none" to build locally (ARM)
export SWEBENCH_ENABLE_FULL=false          # set true to offer the 2,294-instance full set
export SWEBENCH_EVAL_TIMEOUT=1800          # per-instance test timeout (s)
export SWEBENCH_PYTHON=/path/to/python     # python that has `swebench` installed
export SWEBENCH_INTEGRITY_MODE=strict      # strict (default) | debug
export SWEBENCH_REQUIRE_EXACT_VERSION=false  # hard-fail on a swebench version mismatch
```

When `SWEBENCH_ENABLED` is unset, the background worker never starts and the
create endpoint returns `403` — the feature is completely inert.

---

## Topology (important)

The connected coding agent runs **locally** (via the agent-connector daemon) and
edits files in its own working directory. The Docker harness must run where that
working directory and Docker live. **V1 supports the co-located self-hosted
topology**: the Workspace backend, the agent-connector, and Docker all on one
host. The server creates each instance checkout under the selected agent's
`working_dir` so the agent can read/write it.

If the selected agent has no `working_dir` on the host, the job is refused with
an actionable error. The hosted, multi-tenant Workspace does not run SWE-bench
(it has no co-located Docker) — keep `SWEBENCH_ENABLED` off there.

---

## Using it

1. Open **Benchmarks** → **+**.
2. Choose an **online** agent that has a working directory.
3. Choose a **dataset** and **split**.
4. **Browse** instances and pick one (search by repo or instance id).
5. Optionally **Run environment precheck** to verify Docker/disk/harness.
6. **Run evaluation**.

The job moves through:

```
queued → preparing → agent_running → patch_collected → evaluating
       → completed | failed | timeout | cancelled | error
```

No fake progress percentage is shown — only the current stage.

### Results

* **completed / resolved** — the patch made all `FAIL_TO_PASS` tests pass and
  kept all `PASS_TO_PASS` tests passing (the harness `resolved` verdict).
* **completed / unresolved** — ran to completion but tests did not all pass.
* **failed / no_patch** — the agent produced no applicable source change.
* **failed / patch_invalid** — the patch failed to apply.
* **integrity_rejected** — (strict mode) the patch touched tests or evaluation
  infrastructure; rejected before the harness ran. Not a test result.
* **timeout** — the agent or the harness exceeded its time budget.
* **cancelled** — you cancelled the job.
* **error** — environment/harness problem (Docker unavailable, image
  pull/build failure, harness error, or `integrity_error` when the isolated
  checkout could not be built). The `error_category` and `error_reason` fields
  explain which.

Each job exposes the collected **patch** and the raw **harness logs** for
download.

---

## Cancel & cleanup

* **Cancel** stops a queued job immediately, or flags a running one for
  cooperative cancellation.
* On finish, failure, timeout, or cancel the runner always reclaims resources:
  it removes only the containers named with the job's unique `run_id`, deletes
  the per-job working tree, and removes the harness run directory. It **never
  touches your other Docker containers, images, or volumes**.
* Image caching follows `SWEBENCH_CACHE_LEVEL` (default `env`). Pre-existing
  user images are never removed unless you set `SWEBENCH_CLEAN=true`.

---

## Benchmark integrity

The Workspace actively protects benchmark validity, but is honest about what it
can and cannot guarantee.

**Task isolation.** The agent only ever receives the **public** view of an
instance (`problem_statement`, `repo`, `base_commit`, …). The gold `patch`,
`test_patch`, `FAIL_TO_PASS`, `PASS_TO_PASS`, and `hints_text` are stripped in
one place and asserted absent. The dataset cache, harness, and evaluation
containers are stored outside any agent-accessible directory.

**Git history isolation.** The agent's working directory is **not** a normal
clone. The server:

1. `git init`s an empty repo and adds `origin`;
2. fetches **only** the instance `base_commit` (shallow, no tags);
3. checks it out as a **detached HEAD**;
4. removes `origin` and every other remote;
5. deletes all branch / tag / remote-tracking refs and the reflog, then prunes;
6. **verifies** the result (HEAD == base_commit, no remotes, no branch/tag refs).

So `git log --all`, `git branch -a`, `git tag`, and `git remote -v` reveal
nothing beyond the base commit's own ancestry — the future fix commit, branches,
and tags are not present. If the directory cannot be built to that spec, the job
fails as **`integrity_error`** and the agent is never started.

**Integrity modes.**

* **`strict`** (default for evaluation): if the collected patch modifies any
  test file, `test`/`tests` directory, fixture, mock, CI config, test-runner /
  coverage config (pytest/tox/nox/coverage/conftest), dependency / install
  script, or benchmark/harness file, the job is **`integrity_rejected`** — it
  never reaches the harness and is never reported as `resolved` or `failed`. The
  offending patch and the exact matched paths are saved, and the UI shows
  *"Patch changed test or evaluation infrastructure."*
* **`debug`** (local debugging only): the full patch still runs, but the job is
  flagged `integrity_risk` and is **not** a valid formal result.

We do **not** silently strip the offending hunks and then claim a `resolved` —
a stripped patch is not provably equivalent to what the agent produced.

**What is NOT guaranteed.** This is application-layer isolation of the
*checkout*. It does **not** stop a networked agent from fetching future repo
state from GitHub or elsewhere — when network isolation is not enabled, there is
still no strict benchmark-isolation guarantee. The agent also runs as the **same
OS user** as the backend, so "the dataset/harness directory is not handed to the
agent" is an application-layer convenience, **not** OS-level sandboxing. For
strict isolation, run the agent without network access (and ideally as a
separate, confined user).

Test judgement is performed **only** by the official harness.

---

## Known limitations (V1)

* **Experimental, default-off, not leaderboard-comparable.** Use for local
  regression / capability comparison only.
* **Co-located self-hosted only** — requires backend + agent + Docker on one
  host. No remote/distributed execution.
* **One instance per job**, concurrency defaults to 1.
* The agent is considered finished when it emits the completion sentinel or
  goes idle after working; there is no deeper agent-internal progress signal.
* **Network isolation is NOT enforced.** Git *history* in the checkout is
  stripped, but a networked agent could still reach GitHub. Application-layer
  "the harness/dataset dir isn't handed to the agent" is not OS-level
  sandboxing (same OS user). For strict isolation, run the agent offline. This
  is documented rather than guaranteed.
* The full dataset is gated behind `SWEBENCH_ENABLE_FULL` due to its size.
* ARM is experimental (local image builds only).
* **Real Docker harness end-to-end has not been verified in this repo's CI**
  (no Docker on the build box). The closed loop is covered by offline tests with
  a mock harness; verify on a Docker host before relying on results.
