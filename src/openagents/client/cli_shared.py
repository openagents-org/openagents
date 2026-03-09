"""
Shared CLI state — Typer app, Rich console, and constants.

All CLI submodules import from here to avoid circular dependencies.
"""

import typer
from rich.console import Console

# Shared Rich console
console = Console()

# Main Typer app
app = typer.Typer(
    name="openagents",
    help="\U0001f916 [bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration",
    add_completion=False,
    rich_markup_mode="rich",
    invoke_without_command=True,
)

# Global verbose flag
VERBOSE_MODE = False

# OpenAgents API constants
OPENAGENTS_API_BASE = "https://endpoint.openagents.org/v1"
OPENAGENTS_RELAY_URL = "wss://relay.openagents.org"
LOCALHOST_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "local"]
