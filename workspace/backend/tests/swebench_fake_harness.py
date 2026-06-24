#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mock SWE-bench harness for tests — NEVER touches Docker.

It accepts the same CLI flags as ``python -m swebench.harness.run_evaluation``
and writes exactly the files the real harness writes (the summary report in cwd
and the per-instance ``report.json`` under ``logs/run_evaluation/...``), driven
by the ``FAKE_SCENARIO`` env var so a single fixture covers every outcome:

    resolved | unresolved | error | patch_apply_failed | docker_unavailable
    | timeout (sleeps; the wrapper's wall-timeout kills it)

The model name is fixed to ``openagents`` to match harness.MODEL_NAME.
"""

import json
import os
import sys
import time


def _arg(name, default=None):
    argv = sys.argv
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


def main():
    scenario = os.environ.get("FAKE_SCENARIO", "resolved")
    run_id = _arg("--run_id", "run")
    instance_id = _arg("--instance_ids", "inst")
    model = "openagents"

    if scenario == "timeout":
        time.sleep(30)  # the wrapper kills us before this returns
        return 0

    if scenario == "docker_unavailable":
        sys.stderr.write(
            "docker.errors.DockerException: Error while fetching server API version: "
            "Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n"
        )
        return 1

    # Per-instance report dir (mirrors the real layout).
    inst_dir = os.path.join("logs", "run_evaluation", run_id, model, instance_id)
    os.makedirs(inst_dir, exist_ok=True)

    summary = {
        "total_instances": 1,
        "submitted_instances": 1,
        "completed_instances": 1,
        "resolved_instances": 0,
        "unresolved_instances": 0,
        "empty_patch_instances": 0,
        "error_instances": 0,
        "completed_ids": [instance_id],
        "incomplete_ids": [],
        "empty_patch_ids": [],
        "submitted_ids": [instance_id],
        "resolved_ids": [],
        "unresolved_ids": [],
        "error_ids": [],
        "schema_version": 2,
    }

    if scenario == "resolved":
        summary["resolved_instances"] = 1
        summary["resolved_ids"] = [instance_id]
        report = {instance_id: {
            "patch_is_None": False, "patch_exists": True,
            "patch_successfully_applied": True, "resolved": True,
            "tests_status": {
                "FAIL_TO_PASS": {"success": ["test_fix"], "failure": []},
                "PASS_TO_PASS": {"success": ["test_a"], "failure": []},
                "FAIL_TO_FAIL": {"success": [], "failure": []},
                "PASS_TO_FAIL": {"success": [], "failure": []},
            },
        }}
        _write_instance_report(inst_dir, report)

    elif scenario == "unresolved":
        summary["unresolved_instances"] = 1
        summary["unresolved_ids"] = [instance_id]
        report = {instance_id: {
            "patch_is_None": False, "patch_exists": True,
            "patch_successfully_applied": True, "resolved": False,
            "tests_status": {
                "FAIL_TO_PASS": {"success": [], "failure": ["test_fix"]},
                "PASS_TO_PASS": {"success": ["test_a"], "failure": []},
                "FAIL_TO_FAIL": {"success": [], "failure": []},
                "PASS_TO_FAIL": {"success": [], "failure": []},
            },
        }}
        _write_instance_report(inst_dir, report)

    elif scenario == "patch_apply_failed":
        # The harness logs the marker and records the instance as an error.
        summary["error_instances"] = 1
        summary["error_ids"] = [instance_id]
        sys.stdout.write(">>>>> Patch Apply Failed\n")

    elif scenario == "error":
        summary["error_instances"] = 1
        summary["error_ids"] = [instance_id]
        sys.stdout.write("BuildImageError: error building image\n")

    else:
        sys.stderr.write(f"unknown FAKE_SCENARIO={scenario}\n")
        return 2

    with open(f"{model}.{run_id}.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh)
    return 0


def _write_instance_report(inst_dir, report):
    with open(os.path.join(inst_dir, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh)
    with open(os.path.join(inst_dir, "run_instance.log"), "w", encoding="utf-8") as fh:
        fh.write(">>>>> Start Test Output\nok\n>>>>> End Test Output\n")
    with open(os.path.join(inst_dir, "test_output.txt"), "w", encoding="utf-8") as fh:
        fh.write("test output\n")


if __name__ == "__main__":
    sys.exit(main())
