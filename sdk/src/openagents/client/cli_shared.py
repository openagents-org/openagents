"""
Shared CLI state — Typer app, Rich console, and constants.

All CLI submodules import from here to avoid circular dependencies.
"""

import os
import sys

import typer
from rich.console import Console
from rich.panel import Panel

# Ensure UTF-8 output on Windows (avoids charmap codec errors with emoji)
if sys.platform == "win32" and not os.environ.get("PYTHONIOENCODING"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Shared Rich console
console = Console()

# Main Typer app
app = typer.Typer(
    name="openagents",
    help="[bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration",
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


def show_banner():
    """Show a beautiful startup banner"""
    banner_text = """
[bold blue]   ___                              ___                          _       [/bold blue]
[bold blue]  / _ \\ _ __    ___  _ __           /   \\  __ _   ___  _ __   | |_  ___ [/bold blue]
[bold blue] | | | | '_ \\  / _ \\| '_ \\         / /\\ / / _` | / _ \\| '_ \\  | __|/ __[/bold blue]
[bold blue] | |_| | |_) ||  __/| | | |       / /_// | (_| ||  __/| | | | | |_\\__ \\ [/bold blue]
[bold blue]  \\___/| .__/  \\___||_| |_|      /___,'   \\__, | \\___||_| |_|  \\__|___/[/bold blue]
[bold blue]       |_|                              |___/                        [/bold blue]

[bold cyan]AI Agent Networks for Open Collaboration[/bold cyan]
[dim]   Create and manage distributed AI agent networks with ease[/dim]
"""
    console.print(Panel(
        banner_text.strip(),
        border_style="blue",
        expand=False
    ))
