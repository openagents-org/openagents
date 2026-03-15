#!/usr/bin/env python3
"""
OpenAgents CLI — orchestrator module.

This is the main CLI entry point. Commands are organized into domain modules:
- cli_helpers.py  — shared utility functions (logging, workspace, studio, ports)
- cli_network.py  — network start/init/list/interact/publish
- cli_agent.py    — agent start/list, agents start/list (bulk)
- cli_identity.py — certs generate/verify, agentid commands
- cli_daemon.py   — daemon lifecycle (up/down/status/start/stop/connect) + workspace
- cli_packages.py — install/search/update/runtimes/autostart/remove
- cli_legacy.py   — connect-legacy adapters + account commands
- cli_shared.py   — shared state (app, console, constants)
"""

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import typer
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich import box

# -- Shared state (re-export for backward compatibility) ----------------------
from openagents.client.cli_shared import app, console

VERBOSE_MODE = False  # mutable global, updated by verbose_callback

# -- Helpers (re-export the two names that other modules import) --------------
from openagents.client.cli_helpers import (  # noqa: F401
    configure_workspace_logging,
    get_default_workspace_path,
    initialize_workspace,
    setup_logging,
    studio_command,
)

# -- Import command modules (registration happens at import time) -------------
import openagents.client.cli_network   # noqa: F401  — network_app
import openagents.client.cli_agent     # noqa: F401  — agent_app, agents_app
import openagents.client.cli_identity  # noqa: F401  — certs_app, agentid_app
import openagents.client.cli_daemon    # noqa: F401  — workspace_app + daemon commands
import openagents.client.cli_packages  # noqa: F401  — install/search/update/runtimes/autostart
import openagents.client.cli_legacy    # noqa: F401  — connect-legacy + account commands


# =============================================================================
# Root-level commands (studio, version, examples, init)
# =============================================================================

@app.command("studio", rich_help_panel="SDK")
def studio(
    host: str = typer.Option("localhost", "--host", "-h", help="Network host address"),
    port: int = typer.Option(8700, "--port", "-p", help="Network port"),
    studio_port: int = typer.Option(8050, "--studio-port", help="Studio frontend port"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't automatically open browser"),
    standalone: bool = typer.Option(True, "--standalone", "-s", help="Launch studio frontend only (kept for backward compatibility)"),
):
    """Launch OpenAgents Studio - A beautiful web interface

    By default, launches only the Studio frontend on port 8050.
    Connect it to a running network (e.g., at localhost:8700).
    """
    console.print(Panel.fit(
        "[bold blue]OpenAgents Studio[/bold blue]\n"
        "A beautiful web interface for AI agent collaboration",
        border_style="blue"
    ))

    args = SimpleNamespace(
        host=host,
        port=port,
        studio_port=studio_port,
        workspace=workspace,
        no_browser=no_browser,
        standalone=standalone,
    )
    studio_command(args)


@app.command("version", rich_help_panel="Client")
def version():
    """Show version information"""
    try:
        from openagents import __version__
        console.print(Panel.fit(
            f"[bold blue]OpenAgents[/bold blue] [green]v{__version__}[/green]\n"
            "AI Agent Networks for Open Collaboration",
            border_style="blue"
        ))
    except ImportError:
        console.print("[yellow]Version information not available[/yellow]")


@app.command("examples", rich_help_panel="SDK")
def show_examples():
    """Show usage examples"""
    examples_text = """
[bold blue]Common Usage Examples:[/bold blue]

[bold green]1. Quick Start - Start a Network:[/bold green]
   [code]openagents network start[/code]
   Opens http://localhost:8700/studio/

[bold green]2. Start Studio Frontend Only:[/bold green]
   [code]openagents studio[/code]
   Connect to an existing network

[bold green]3. Start a Network from Config:[/bold green]
   [code]openagents network start path/to/network.yaml[/code]

[bold green]4. Start an Agent:[/bold green]
   [code]openagents agent start path/to/agent.yaml[/code]

[bold green]5. Initialize a New Workspace:[/bold green]
   [code]openagents init my_workspace[/code]

[bold cyan]For more information, visit:[/bold cyan]
   [link]https://github.com/openagents-org/openagents[/link]
"""
    console.print(Panel(
        examples_text,
        title="[bold blue]OpenAgents Examples[/bold blue]",
        border_style="blue",
        expand=False
    ))


@app.command("init", rich_help_panel="SDK")
def init_workspace_cmd(
    path: Optional[str] = typer.Argument(None, help="Workspace directory path"),
    force: bool = typer.Option(False, "--force", "-f", help="Overwrite existing workspace"),
):
    """Initialize a new OpenAgents workspace"""
    workspace_path = Path(path) if path else get_default_workspace_path()

    if workspace_path.exists() and not force:
        if workspace_path.is_dir() and any(workspace_path.iterdir()):
            console.print(f"[red]Directory already exists and is not empty: {workspace_path}[/red]")
            console.print("[yellow]Use --force to overwrite existing content[/yellow]")
            raise typer.Exit(1)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Creating workspace...", total=None)
        try:
            config_path = initialize_workspace(workspace_path)
            progress.update(task, description="[green]Workspace created successfully!")
            console.print(Panel.fit(
                f"[bold green]Workspace initialized![/bold green]\n\n"
                f"Location: [code]{workspace_path}[/code]\n"
                f"Config: [code]{config_path}[/code]\n\n"
                f"[bold cyan]Next steps:[/bold cyan]\n"
                f"1. [code]cd {workspace_path}[/code]\n"
                f"2. [code]openagents studio[/code]",
                border_style="green"
            ))
        except Exception as e:
            progress.update(task, description=f"[red]Failed to create workspace: {e}[/red]")
            console.print(f"[red]Error: {e}[/red]")
            raise typer.Exit(1)


@app.command("list", rich_help_panel="Client")
def list_agents_cmd():
    """List locally installed agents and their setup status"""
    _show_agent_scan()


@app.command("setup", rich_help_panel="Client")
def setup_cmd():
    """🖥  Interactive setup dashboard — manage agents, workspaces, and connections"""
    from openagents.client.cli_tui import launch_tui
    launch_tui()


# =============================================================================
# Callbacks
# =============================================================================

def version_callback(value: bool):
    if value:
        version()
        raise typer.Exit()


def verbose_callback(value: bool):
    global VERBOSE_MODE
    VERBOSE_MODE = value
    return value


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


@app.callback()
def main(
    ctx: typer.Context,
    version_flag: Optional[bool] = typer.Option(
        None, "--version", callback=version_callback, is_eager=True,
        help="Show version and exit"
    ),
    verbose: bool = typer.Option(
        False, "--verbose", "-v", callback=verbose_callback,
        help="Enable verbose output"
    ),
    log_level: str = typer.Option(
        "INFO", "--log-level",
        help="Set the logging level"
    ),
    no_banner: bool = typer.Option(
        False, "--no-banner",
        help="Don't show the startup banner"
    ),
):
    """
    [bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration

    Create and manage distributed AI agent networks with ease.
    """
    setup_logging(log_level, verbose)

    # If no subcommand was provided, launch interactive TUI
    if ctx.invoked_subcommand is None:
        from openagents.client.cli_tui import launch_tui
        launch_tui()
        raise typer.Exit(0)

    # Show banner for studio command
    if not no_banner and len(sys.argv) > 1 and sys.argv[1] == 'studio':
        show_banner()


def _show_agent_scan():
    """Scan machine for agents and show readiness status."""
    from openagents.client.plugin_registry import registry
    from openagents.client.daemon import read_daemon_pid
    from openagents.client.daemon_config import load_config, read_status

    console.print("\n[bold blue]OpenAgents[/bold blue] — scanning for agents...\n")

    scan = registry.scan_agents()

    table = Table(box=box.SIMPLE)
    table.add_column("Agent", style="cyan")
    table.add_column("Status")
    table.add_column("Notes", style="dim")

    installed_count = 0
    ready_count = 0
    for agent in scan:
        if agent["installed"]:
            installed_count += 1
            if agent["ready"]:
                ready_count += 1
                status = "[green]ready[/green]"
            else:
                status = "[yellow]needs setup[/yellow]"
            notes = agent["message"]
            if agent["path"] and agent["ready"]:
                notes = agent["path"]
        else:
            status = "[dim]not installed[/dim]"
            notes = agent["install_command"]
        table.add_row(agent["label"], status, notes)

    console.print(table)

    cfg = load_config()
    if cfg.agents:
        console.print(f"[dim]{len(cfg.agents)} agent(s) configured[/dim]")
        for a in cfg.agents:
            net_label = f"-> {a.network}" if a.network else "(local)"
            path_label = f" [dim]{a.path}[/dim]" if a.path else ""
            console.print(f"  [cyan]{a.name}[/cyan] ({a.type}) {net_label}{path_label}")
        console.print()

    pid = read_daemon_pid()
    if pid:
        console.print(f"[green]Daemon running[/green] (PID {pid})")
        status_data = read_status()
        if status_data and "agents" in status_data:
            for name, info in status_data["agents"].items():
                state = info.get("state", "unknown")
                net = info.get("network", info.get("workspace", ""))
                console.print(f"  [cyan]{name}[/cyan] — {state} {net}")
        console.print()

    if installed_count == 0:
        console.print("Install an agent: [bold]openagents install claude[/bold]")
    elif ready_count > 0 and not cfg.agents:
        ready_names = [a["name"] for a in scan if a["ready"]]
        console.print(f"Create an agent:  [bold]openagents create {ready_names[0]}[/bold]")
    elif cfg.agents and not pid:
        console.print("Start agents:     [bold]openagents up[/bold]")
    elif not pid:
        not_ready = [a for a in scan if a["installed"] and not a["ready"]]
        if not_ready:
            console.print(f"Setup needed:     {not_ready[0]['message']}")
    console.print()


def cli_main():
    """Entry point for the CLI"""
    try:
        app()
    except KeyboardInterrupt:
        console.print("\n[yellow]Goodbye![/yellow]")
        sys.exit(0)
    except Exception as e:
        console.print(f"[red]Unexpected error: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli_main()
