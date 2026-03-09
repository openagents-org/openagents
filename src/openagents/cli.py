# Backward-compat shim — moved to openagents.client.cli
from openagents.client.cli import *  # noqa: F401,F403
from openagents.client.cli import cli_main, app  # noqa: F401

# Explicit re-exports used by external consumers
from openagents.client.cli import (  # noqa: F401
    configure_workspace_logging,
    VERBOSE_MODE,
    setup_logging,
)

# Re-export from split modules (was in monolithic cli.py before the split)
from openagents.client.cli_network import discover_running_networks  # noqa: F401
