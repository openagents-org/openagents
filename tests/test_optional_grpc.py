"""Verify non-gRPC transports work without the SDK's grpcio dependency."""

import os
import subprocess
import sys
import textwrap
from pathlib import Path


def test_http_transport_import_does_not_require_grpcio():
    """A base install can import HTTP transport without grpcio installed."""
    sdk_src = Path(__file__).parents[1] / "sdk" / "src"
    script = textwrap.dedent(
        """
        import importlib.abc
        import sys

        class BlockGrpc(importlib.abc.MetaPathFinder):
            def find_spec(self, fullname, path=None, target=None):
                if fullname == "grpc" or fullname.startswith("grpc."):
                    raise ModuleNotFoundError("grpc blocked for optional dependency test")
                return None

        sys.meta_path.insert(0, BlockGrpc())
        from openagents.sdk.transports import HttpTransport
        assert HttpTransport.__name__ == "HttpTransport"
        assert "grpc" not in sys.modules

        try:
            from openagents.sdk.transports import GRPCTransport
        except ImportError as exc:
            assert "pip install openagents[sdk]" in str(exc)
        else:
            raise AssertionError(f"unexpected gRPC transport: {GRPCTransport}")
        """
    )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(sdk_src)
    result = subprocess.run(
        [sys.executable, "-c", script],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
