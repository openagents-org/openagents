"""CLI package commands — remove/runtimes/install/search/update/autostart."""

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.panel import Panel
from rich.prompt import Confirm
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console

@app.command("remove")
def daemon_remove(
    agent_name: str = typer.Argument(..., help="Name of the agent to remove"),
):
    """Remove an agent from the daemon config."""
    from openagents.client.daemon_config import remove_agent_from_config, find_agent_in_config

    agent = find_agent_in_config(agent_name)
    if agent is None:
        console.print(f"[red]Agent '{agent_name}' not found in config.[/red]")
        raise typer.Exit(1)

    net_info = f" → {agent.network}" if agent.network else " (local)"
    if not Confirm.ask(
        f"Remove [cyan]{agent_name}[/cyan] ({agent.type}{net_info})?"
    ):
        raise typer.Exit(0)

    remove_agent_from_config(agent_name)
    console.print(f"[green]Removed[/green] {agent_name}")


@app.command("runtimes")
def list_runtimes():
    """List installed and available agent runtimes."""
    from openagents.client.agent_setup import detect_runtimes

    runtimes = detect_runtimes()

    table = Table(title="Agent Runtimes", box=box.SIMPLE)
    table.add_column("Type", style="cyan")
    table.add_column("Name")
    table.add_column("Status")
    table.add_column("Location", style="dim")
    table.add_column("Install", style="dim")

    for name, info in runtimes.items():
        if info["installed"]:
            table.add_row(
                name,
                info["label"],
                "[green]installed[/green]",
                info["path"] or "",
                "",
            )
        else:
            table.add_row(
                name,
                info["label"],
                "[dim]not installed[/dim]",
                "",
                info["install"],
            )

    console.print(table)

    # Also show configured agents
    from openagents.client.daemon_config import load_config
    cfg = load_config()
    if cfg.agents:
        console.print(f"\n[dim]{len(cfg.agents)} agent(s) configured in daemon.yaml[/dim]")
        for a in cfg.agents:
            net_label = a.network or "(local)"
            console.print(f"  [cyan]{a.name}[/cyan] ({a.type}, {a.role}) → {net_label}")


@app.command("install")
def install_agent(
    agent_type: str = typer.Argument(..., help="Agent type to install (e.g. claude, aider, codex)"),
):
    """Install an agent runtime on this machine."""
    import subprocess
    import sys as _sys
    from openagents.client.plugin_registry import registry

    catalog = registry.get_catalog()
    info = catalog.get(agent_type)
    if info is None:
        console.print(f"[red]Unknown agent type: {agent_type}[/red]")
        console.print(f"Run [cyan]openagents search[/cyan] to see available agents.")
        raise typer.Exit(1)

    # Check if already installed
    plugin = registry.get(agent_type)
    if plugin and plugin.is_installed():
        console.print(f"[green]{info.label}[/green] is already installed.")
        path = plugin.which()
        if path:
            console.print(f"  Location: {path}")
        raise typer.Exit(0)

    cmd = info.install_command
    console.print(f"Installing [cyan]{info.label}[/cyan]...")
    console.print(f"  Command: [dim]{cmd}[/dim]\n")

    # Determine how to run the install command
    if cmd.startswith("pip install "):
        package = cmd.replace("pip install ", "")
        run_args = [_sys.executable, "-m", "pip", "install", package]
    elif cmd.startswith("npm install "):
        # Check if npm is available
        if shutil.which("npm") is None:
            console.print("[yellow]npm is not installed.[/yellow]")
            console.print(
                "Install Node.js first: [bold]https://nodejs.org[/bold]\n"
                "Or use your package manager:"
            )
            import platform
            if platform.system() == "Darwin":
                console.print("  [dim]brew install node[/dim]")
            elif platform.system() == "Linux":
                console.print("  [dim]sudo apt install nodejs npm[/dim]  (Debian/Ubuntu)")
                console.print("  [dim]sudo dnf install nodejs npm[/dim]  (Fedora)")
            console.print(f"\nThen retry: [bold]openagents install {agent_type}[/bold]")
            raise typer.Exit(1)
        run_args = cmd.split()
    elif cmd.startswith("See "):
        console.print(f"[yellow]Manual installation required:[/yellow]")
        console.print(f"  {cmd}")
        raise typer.Exit(0)
    else:
        run_args = cmd.split()

    if not Confirm.ask(f"Run `{' '.join(run_args)}`?"):
        raise typer.Exit(0)

    try:
        result = subprocess.run(run_args, check=False)
        if result.returncode == 0:
            console.print(f"\n[green]Successfully installed {info.label}[/green]")
            # Verify installation
            plugin = registry.get(agent_type)
            if plugin and plugin.is_installed():
                path = plugin.which()
                if path:
                    console.print(f"  Location: {path}")
                console.print(f"\nNext: [bold]openagents start {agent_type}[/bold]")
            else:
                console.print(
                    "[yellow]Installed but not detected in PATH.[/yellow]\n"
                    "You may need to restart your terminal."
                )
        else:
            console.print(f"\n[red]Installation failed (exit code {result.returncode})[/red]")
            raise typer.Exit(1)
    except FileNotFoundError:
        console.print(f"[red]Command not found: {run_args[0]}[/red]")
        console.print(f"Install manually: {cmd}")
        raise typer.Exit(1)


@app.command("search")
def search_agents(
    query: str = typer.Argument("", help="Search query (empty = list all)"),
):
    """Search available agent types."""
    from openagents.client.plugin_registry import registry

    if query:
        results = registry.search_catalog(query)
    else:
        results = list(registry.get_catalog().values())

    if not results:
        console.print(f"[yellow]No agents found matching '{query}'[/yellow]")
        raise typer.Exit(0)

    table = Table(title="Available Agents", box=box.SIMPLE)
    table.add_column("Name", style="cyan")
    table.add_column("Label")
    table.add_column("Status")
    table.add_column("Install Command", style="dim")
    table.add_column("Description", style="dim")

    for info in results:
        plugin = registry.get(info.name)
        if plugin and plugin.is_installed():
            status = "[green]installed[/green]"
        elif info.builtin:
            status = "[yellow]not installed[/yellow]"
        else:
            status = "[dim]available[/dim]"

        table.add_row(
            info.name,
            info.label,
            status,
            info.install_command,
            info.description or "",
        )

    console.print(table)
    console.print(f"\n[dim]Install with: openagents install <name>[/dim]")


@app.command("update")
def self_update(
    check_only: bool = typer.Option(
        False, "--check", help="Only check for updates, don't install",
    ),
):
    """Update openagents and check agent runtime versions."""
    import subprocess as _sp

    from openagents.client.plugin_registry import registry

    console.print("[bold]Checking for updates...[/bold]\n")

    # Check current openagents version
    try:
        from importlib.metadata import version as get_version
        current = get_version("openagents")
    except Exception:
        current = "unknown"

    # Check PyPI for latest version
    latest = None
    try:
        import json as _json
        result = _sp.run(
            [sys.executable, "-m", "pip", "index", "versions", "openagents"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0 and "versions:" in result.stdout.lower():
            # Parse "openagents (X.Y.Z)" from output
            for line in result.stdout.splitlines():
                if "LATEST:" in line.upper() or "openagents" in line.lower():
                    import re as _re
                    m = _re.search(r'\(([0-9][0-9.]*)\)', line)
                    if m:
                        latest = m.group(1)
                        break
    except Exception:
        pass

    console.print(f"  openagents: [cyan]{current}[/cyan]", end="")
    if latest and latest != current:
        console.print(f" → [green]{latest}[/green] available")
    else:
        console.print(" [dim](up to date)[/dim]")

    # Check agent runtimes
    console.print()
    for plugin in registry.list_plugins():
        if not plugin.is_installed():
            continue
        path = plugin.which() or ""
        console.print(f"  {plugin.name}: [green]installed[/green] [dim]{path}[/dim]")

    if check_only:
        return

    # Upgrade openagents
    if latest and latest != current:
        console.print(f"\n[bold]Upgrading openagents {current} → {latest}...[/bold]")
        result = _sp.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "openagents"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            console.print("[green]openagents updated successfully.[/green]")
        else:
            console.print(f"[red]Update failed:[/red] {result.stderr[:200]}")
            raise typer.Exit(1)

        # Restart daemon if running
        from openagents.client.daemon import read_daemon_pid, stop_daemon
        pid = read_daemon_pid()
        if pid:
            console.print("Restarting daemon...")
            stop_daemon()
            _start_daemon()
    else:
        console.print("\n[dim]Already up to date.[/dim]")


@app.command("autostart")
def init_autostart(
    remove: bool = typer.Option(False, "--remove", help="Remove auto-start configuration"),
):
    """Set up OpenAgents daemon to auto-start on login."""
    import sys as _sys

    IS_WINDOWS = _sys.platform == "win32"
    IS_MACOS = _sys.platform == "darwin"

    if IS_WINDOWS:
        _init_windows(remove)
    elif IS_MACOS:
        _init_launchd(remove)
    else:
        _init_systemd(remove)


def _init_systemd(remove: bool):
    """Set up systemd user service for auto-start."""
    import shutil
    service_dir = Path.home() / ".config" / "systemd" / "user"
    service_file = service_dir / "openagents.service"

    if remove:
        if service_file.exists():
            service_file.unlink()
            os.system("systemctl --user daemon-reload")
            console.print("[green]Removed systemd service.[/green]")
        else:
            console.print("[yellow]No systemd service found.[/yellow]")
        return

    openagents_bin = shutil.which("openagents")
    if not openagents_bin:
        console.print("[red]Cannot find 'openagents' in PATH.[/red]")
        raise typer.Exit(1)

    service_dir.mkdir(parents=True, exist_ok=True)
    service_content = f"""[Unit]
Description=OpenAgents Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={openagents_bin} up --foreground
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
"""
    service_file.write_text(service_content)
    os.system("systemctl --user daemon-reload")
    os.system("systemctl --user enable openagents.service")
    os.system("systemctl --user start openagents.service")
    console.print("[green]Installed and started systemd user service.[/green]")
    console.print("[dim]  Status: systemctl --user status openagents[/dim]")
    console.print("[dim]  Logs:   journalctl --user -u openagents -f[/dim]")
    console.print("[dim]  Stop:   systemctl --user stop openagents[/dim]")
    console.print("[dim]  Remove: openagents init --remove[/dim]")


def _init_launchd(remove: bool):
    """Set up launchd plist for auto-start on macOS."""
    import shutil
    plist_dir = Path.home() / "Library" / "LaunchAgents"
    plist_file = plist_dir / "org.openagents.daemon.plist"

    if remove:
        if plist_file.exists():
            os.system(f"launchctl unload {plist_file}")
            plist_file.unlink()
            console.print("[green]Removed launchd agent.[/green]")
        else:
            console.print("[yellow]No launchd agent found.[/yellow]")
        return

    openagents_bin = shutil.which("openagents")
    if not openagents_bin:
        console.print("[red]Cannot find 'openagents' in PATH.[/red]")
        raise typer.Exit(1)

    plist_dir.mkdir(parents=True, exist_ok=True)
    log_path = Path.home() / ".openagents" / "daemon.log"
    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.openagents.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>{openagents_bin}</string>
        <string>up</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log_path}</string>
    <key>StandardErrorPath</key>
    <string>{log_path}</string>
</dict>
</plist>
"""
    plist_file.write_text(plist_content)
    os.system(f"launchctl load {plist_file}")
    console.print("[green]Installed and loaded launchd agent.[/green]")
    console.print(f"[dim]  Logs:   tail -f {log_path}[/dim]")
    console.print("[dim]  Stop:   launchctl unload ~/Library/LaunchAgents/org.openagents.daemon.plist[/dim]")
    console.print("[dim]  Remove: openagents init --remove[/dim]")


def _init_windows(remove: bool):
    """Set up Windows Task Scheduler for auto-start."""
    import shutil
    task_name = "OpenAgentsDaemon"

    if remove:
        ret = os.system(f'schtasks /Delete /TN "{task_name}" /F >nul 2>&1')
        if ret == 0:
            console.print("[green]Removed scheduled task.[/green]")
        else:
            console.print("[yellow]No scheduled task found.[/yellow]")
        return

    openagents_bin = shutil.which("openagents")
    if not openagents_bin:
        console.print("[red]Cannot find 'openagents' in PATH.[/red]")
        raise typer.Exit(1)

    cmd = f'schtasks /Create /TN "{task_name}" /TR "\"{openagents_bin}\" up --foreground" /SC ONLOGON /RL HIGHEST /F'
    ret = os.system(cmd)
    if ret == 0:
        console.print("[green]Created scheduled task for auto-start on login.[/green]")
        console.print(f"[dim]  Check:  schtasks /Query /TN \"{task_name}\"[/dim]")
        console.print(f"[dim]  Remove: openagents init --remove[/dim]")
    else:
        console.print("[red]Failed to create scheduled task. Try running as Administrator.[/red]")
        raise typer.Exit(1)


# ============================================================================
# WORKSPACE CONNECT COMMANDS
# ============================================================================
