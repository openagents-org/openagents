"""Regression tests for the ``agentid`` CLI commands in cli_identity.py.

The ``agentid`` subcommands (verify / info / resolve / verify-token /
challenge / token / auth / claim) use ``Progress``, ``SpinnerColumn`` and
``TextColumn`` from ``rich.progress`` inside a ``with Progress(...)`` block.
Those names were never imported in ``cli_identity.py``, so every one of those
commands crashed with ``NameError: name 'Progress' is not defined`` the moment
it reached the progress block — before any network call.

These tests stub out the network layer so no real request is made and assert
that the command does not raise a ``NameError``.
"""

import openagents.agentid as agentid
import openagents.client.cli_identity  # noqa: F401  -- registers agentid_app onto app
from openagents.agentid.exceptions import AgentIDConnectionError
from openagents.client.cli_shared import app
from typer.testing import CliRunner

runner = CliRunner()


def test_agentid_verify_does_not_raise_nameerror(monkeypatch):
    """``agentid verify`` must reach the network layer without a NameError.

    The verifier is stubbed to raise a connection error, so the command takes
    its handled error path (exit code 1) instead of crashing with
    ``NameError: name 'Progress' is not defined``.
    """

    class _OfflineVerifier:
        def __init__(self, *args, **kwargs):
            pass

        def validate(self, agent_id):
            raise AgentIDConnectionError("offline (test stub)")

    monkeypatch.setattr(agentid, "AgentIDVerifier", _OfflineVerifier)

    result = runner.invoke(app, ["agentid", "verify", "openagents:test-agent"])

    assert not isinstance(result.exception, NameError), (
        f"agentid verify raised NameError: {result.exception}"
    )
    assert "NameError" not in result.output
    # Handled connection error -> typer.Exit(1)
    assert result.exit_code == 1
