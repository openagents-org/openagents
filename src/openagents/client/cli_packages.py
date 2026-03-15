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

logger = logging.getLogger(__name__)

# Node.js LTS version for auto-install
_NODE_VERSION = "22.16.0"


def _refresh_path_windows():
    """Merge registry PATH entries into the current process PATH."""
    try:
        import winreg
        current = os.environ.get("PATH", "")
        current_dirs = set(d.lower().rstrip("\\") for d in current.split(";") if d)

        new_dirs = []
        for hive, subkey in [
            (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
            (winreg.HKEY_CURRENT_USER, r"Environment"),
        ]:
            try:
                val = winreg.QueryValueEx(winreg.OpenKey(hive, subkey), "Path")[0]
                for d in val.split(";"):
                    d = d.strip()
                    if d and d.lower().rstrip("\\") not in current_dirs:
                        new_dirs.append(d)
                        current_dirs.add(d.lower().rstrip("\\"))
            except OSError:
                pass

        if new_dirs:
            os.environ["PATH"] = current + ";" + ";".join(new_dirs)
    except Exception as e:
        logger.debug(f"Failed to refresh PATH: {e}")


def _install_nodejs(is_windows: bool, os_name: str) -> bool:
    """Auto-install Node.js. Returns True on success."""
    import shutil

    if is_windows:
        # Download and run the MSI installer silently
        msi_url = f"https://nodejs.org/dist/v{_NODE_VERSION}/node-v{_NODE_VERSION}-x64.msi"
        msi_path = os.path.join(os.environ.get("TEMP", "."), "node-installer.msi")
        console.print(f"  Downloading Node.js v{_NODE_VERSION}...")
        try:
            # Use PowerShell to download ($ProgressPreference speeds up download)
            ps_download = (
                f"$ProgressPreference='SilentlyContinue'; "
                f"Invoke-WebRequest -Uri '{msi_url}' -OutFile '{msi_path}' -UseBasicParsing"
            )
            subprocess.run(
                ["powershell", "-Command", ps_download],
                check=True, timeout=300,
            )
            console.print(f"  Installing Node.js (this may take a moment)...")
            subprocess.run(
                ["msiexec", "/i", msi_path, "/quiet", "/norestart"],
                check=True, timeout=300,
            )
            # Clean up
            try:
                os.remove(msi_path)
            except OSError:
                pass
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug(f"Windows Node.js install failed: {e}")
            return False

    elif os_name == "Darwin":
        # macOS — try brew first, then official installer
        if shutil.which("brew"):
            console.print(f"  Installing Node.js v{_NODE_VERSION.split('.')[0]} via Homebrew...")
            try:
                # Use node@22 formula for specific major version
                major = _NODE_VERSION.split(".")[0]
                subprocess.run(["brew", "install", f"node@{major}"], check=True, timeout=300)
                # Link it so `node` and `npm` are on PATH
                subprocess.run(
                    ["brew", "link", "--overwrite", f"node@{major}"],
                    check=False, timeout=30,
                )
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        # Fallback: official pkg installer
        console.print(f"  Downloading Node.js v{_NODE_VERSION}...")
        pkg_url = f"https://nodejs.org/dist/v{_NODE_VERSION}/node-v{_NODE_VERSION}.pkg"
        pkg_path = "/tmp/node-installer.pkg"
        try:
            subprocess.run(["curl", "-fsSL", "-o", pkg_path, pkg_url], check=True, timeout=120)
            console.print("  Installing Node.js (may require sudo)...")
            subprocess.run(["sudo", "installer", "-pkg", pkg_path, "-target", "/"], check=True, timeout=60)
            os.remove(pkg_path)
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug(f"macOS Node.js install failed: {e}")
            return False

    else:
        # Linux — try package managers
        if shutil.which("apt-get"):
            console.print("  Installing Node.js via apt...")
            try:
                subprocess.run(["sudo", "apt-get", "update", "-qq"], check=True, timeout=60)
                subprocess.run(
                    ["sudo", "apt-get", "install", "-y", "-qq", "nodejs", "npm"],
                    check=True, timeout=120,
                )
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        if shutil.which("dnf"):
            console.print("  Installing Node.js via dnf...")
            try:
                subprocess.run(["sudo", "dnf", "install", "-y", "nodejs", "npm"], check=True, timeout=120)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        if shutil.which("pacman"):
            console.print("  Installing Node.js via pacman...")
            try:
                subprocess.run(["sudo", "pacman", "-Sy", "--noconfirm", "nodejs", "npm"], check=True, timeout=120)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        # Fallback: NodeSource binary
        console.print(f"  Downloading Node.js v{_NODE_VERSION}...")
        try:
            subprocess.run(
                ["bash", "-c", "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"],
                check=True, timeout=180,
            )
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug(f"Linux Node.js install failed: {e}")
            return False


def _parse_dep(dep: str) -> tuple[str, int | None]:
    """Parse 'nodejs>=22' into ('nodejs', 22). Returns (dep, None) if no version."""
    import re
    m = re.match(r'^([a-zA-Z0-9_]+)>=(\d+)$', dep)
    if m:
        return m.group(1), int(m.group(2))
    return dep, None


def _get_node_major_version() -> int | None:
    """Get the installed Node.js major version, or None if not installed."""
    import shutil
    node = shutil.which("node")
    if not node:
        return None
    try:
        result = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            # Output is like "v20.19.3"
            import re
            m = re.match(r'v(\d+)', result.stdout.strip())
            if m:
                return int(m.group(1))
    except Exception:
        pass
    return None


def _ensure_dependency(dep: str, is_windows: bool, os_name: str, agent_type: str) -> bool:
    """Check if a dependency is available, auto-install if missing. Returns True on success."""
    import shutil

    dep_name, min_version = _parse_dep(dep)

    dep_checks = {
        "nodejs": ("npm", "Node.js", _install_nodejs),
        "git": ("git", "Git", _install_git),
    }

    check_binary, label, installer = dep_checks.get(dep_name, (dep_name, dep_name, None))

    if shutil.which(check_binary) is not None:
        # Check version constraint for nodejs
        if dep_name == "nodejs" and min_version is not None:
            current = _get_node_major_version()
            if current is not None and current < min_version:
                console.print(
                    f"  [yellow]{label} v{current} found but v{min_version}+ is required — upgrading...[/yellow]"
                )
                if not _install_nodejs(is_windows, os_name):
                    console.print(f"\n  [red]Could not upgrade {label} automatically.[/red]")
                    console.print(f"  Please upgrade to Node.js v{min_version}+, then retry:")
                    console.print(f"  [bold]openagents install {agent_type}[/bold]")
                    return False
                # Re-check version after upgrade
                new_version = _get_node_major_version()
                if new_version is not None and new_version < min_version:
                    console.print(
                        f"\n  [yellow]{label} upgraded to v{new_version} but v{min_version}+ is required.[/yellow]"
                    )
                    console.print(f"  Please upgrade manually (e.g. nvm install {min_version}), then retry:")
                    console.print(f"  [bold]openagents install {agent_type}[/bold]")
                    return False
                console.print(f"  [green]✓[/green] {label} upgraded to v{new_version}\n")
                return True
        return True  # already installed (and version OK)

    console.print(f"  [yellow]{label} not found — installing...[/yellow]")

    if installer is None:
        console.print(f"  [red]No auto-installer for '{dep_name}'.[/red]")
        console.print(f"  Please install {label} manually, then retry:")
        console.print(f"  [bold]openagents install {agent_type}[/bold]")
        return False

    if not installer(is_windows, os_name):
        console.print(f"\n  [red]Could not install {label} automatically.[/red]")
        console.print(f"  Please install manually, then retry:")
        console.print(f"  [bold]openagents install {agent_type}[/bold]")
        return False

    # Refresh PATH on Windows after install
    if is_windows:
        _refresh_path_windows()

    if shutil.which(check_binary) is None:
        console.print(f"\n  [yellow]{label} installed but not yet on PATH.[/yellow]")
        console.print(f"  Please restart your terminal, then retry:")
        console.print(f"  [bold]openagents install {agent_type}[/bold]")
        return False

    console.print(f"  [green]✓[/green] {label} installed\n")
    return True


def _install_git(is_windows: bool, os_name: str) -> bool:
    """Auto-install Git. Returns True on success."""
    import shutil

    if is_windows:
        # Download and run Git for Windows installer silently
        git_url = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
        console.print(f"  Downloading Git for Windows...")
        try:
            # Use $env:TEMP for reliable path handling; $ProgressPreference speeds up download
            ps_download = (
                f"$ProgressPreference='SilentlyContinue'; "
                f"Invoke-WebRequest -Uri '{git_url}' -OutFile $env:TEMP\\git-installer.exe -UseBasicParsing"
            )
            subprocess.run(
                ["powershell", "-Command", ps_download],
                check=True, timeout=300,
            )
            installer_path = os.path.join(os.environ.get("TEMP", "."), "git-installer.exe")
            console.print(f"  Installing Git (this may take a moment)...")
            subprocess.run(
                [installer_path, "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-"],
                check=True, timeout=300,
            )
            try:
                os.remove(installer_path)
            except OSError:
                pass
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            logger.debug(f"Windows Git install failed: {e}")
            return False

    elif os_name == "Darwin":
        # macOS — xcode-select or brew
        if shutil.which("brew"):
            console.print("  Installing Git via Homebrew...")
            try:
                subprocess.run(["brew", "install", "git"], check=True, timeout=300)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        # xcode-select triggers Git install on macOS
        console.print("  Installing Git via Xcode Command Line Tools...")
        try:
            subprocess.run(["xcode-select", "--install"], check=True, timeout=300)
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
            return False

    else:
        # Linux
        if shutil.which("apt-get"):
            console.print("  Installing Git via apt...")
            try:
                subprocess.run(["sudo", "apt-get", "update", "-qq"], check=True, timeout=60)
                subprocess.run(["sudo", "apt-get", "install", "-y", "-qq", "git"], check=True, timeout=120)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        if shutil.which("dnf"):
            console.print("  Installing Git via dnf...")
            try:
                subprocess.run(["sudo", "dnf", "install", "-y", "git"], check=True, timeout=120)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        if shutil.which("pacman"):
            console.print("  Installing Git via pacman...")
            try:
                subprocess.run(["sudo", "pacman", "-Sy", "--noconfirm", "git"], check=True, timeout=120)
                return True
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
        return False


@app.command("remove", rich_help_panel="Client")
def daemon_remove(
    agent_name: str = typer.Argument(..., help="Name of the agent to remove"),
):
    """🗑 Remove an agent from the daemon config."""
    from openagents.client.daemon_config import remove_agent_from_config, find_agent_in_config

    agent = find_agent_in_config(agent_name)
    if agent is None:
        console.print(f"  [red]Agent '{agent_name}' not found in config.[/red]")
        raise typer.Exit(1)

    net_info = f" → {agent.network}" if agent.network else " (local)"
    if not Confirm.ask(
        f"  Remove [cyan]{agent_name}[/cyan] ({agent.type}{net_info})?"
    ):
        raise typer.Exit(0)

    remove_agent_from_config(agent_name)

    # Stop just this agent in the daemon
    from openagents.client.daemon import read_daemon_pid
    from openagents.client.daemon_config import CMD_PATH
    pid = read_daemon_pid()
    if pid:
        CMD_PATH.parent.mkdir(parents=True, exist_ok=True)
        CMD_PATH.write_text(f"stop:{agent_name}\n")

    console.print(f"  [green]✓ Removed[/green] {agent_name}")


@app.command("runtimes", rich_help_panel="Client")
def list_runtimes():
    """🔧 List installed and available agent runtimes."""
    from openagents.client.agent_setup import detect_runtimes

    runtimes = detect_runtimes()

    table = Table(
        title="Agent Runtimes",
        box=box.ROUNDED,
        title_style="bold",
        show_header=True,
        header_style="bold",
    )
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
                "[green]● installed[/green]",
                info["path"] or "",
                "",
            )
        else:
            table.add_row(
                name,
                info["label"],
                "[dim]○ not installed[/dim]",
                "",
                info["install"],
            )

    console.print()
    console.print(table)

    # Also show configured agents
    from openagents.client.daemon_config import load_config
    cfg = load_config()
    if cfg.agents:
        console.print(f"\n  [dim]{len(cfg.agents)} agent(s) configured in daemon.yaml[/dim]")
        for a in cfg.agents:
            net_label = a.network or "[dim](local)[/dim]"
            console.print(f"    [cyan]{a.name}[/cyan] ({a.type}, {a.role}) → {net_label}")


@app.command("install", rich_help_panel="Client")
def install_agent(
    agent_type: str = typer.Argument(..., help="Agent type to install (e.g. claude, aider, codex)"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
):
    """📦 Install an agent runtime on this machine."""
    import shutil
    import subprocess
    import sys as _sys
    from openagents.client.plugin_registry import registry

    catalog = registry.get_catalog()
    info = catalog.get(agent_type)
    if info is None:
        console.print(Panel(
            f"[red]Unknown agent type:[/red] [bold]{agent_type}[/bold]\n\n"
            f"Run [bold]openagents search[/bold] to see available agents.",
            title="[red]Not Found[/red]",
            border_style="red",
        ))
        raise typer.Exit(1)

    # Check if the binary is already installed (don't skip install
    # just because an adapter module exists for direct API mode)
    plugin = registry.get(agent_type)
    if plugin and plugin.which():
        path = plugin.which()
        console.print(f"  [green]✓[/green] {info.label} is already installed.\n  Location: [dim]{path}[/dim]")
        raise typer.Exit(0)

    cmd = info.install_command
    console.print(f"\n  Installing [cyan]{info.label}[/cyan]")
    console.print(f"  Command: [dim]{cmd}[/dim]\n")

    import platform as _platform
    is_windows = _platform.system() == "Windows"
    os_name = _platform.system()

    # --- Auto-install dependencies declared in YAML `requires:` ---
    for dep in info.requires:
        if not _ensure_dependency(dep, is_windows, os_name, agent_type):
            raise typer.Exit(1)

    # Determine how to run the install command
    use_shell = False
    if cmd.startswith("powershell ") or cmd.startswith("powershell.exe "):
        # PowerShell installer (Windows)
        run_args = ["powershell", "-ExecutionPolicy", "Bypass", "-Command", cmd.split(None, 2)[-1]]
    elif "| bash" in cmd or "| sh" in cmd:
        # Curl-pipe-bash style installer (e.g. Claude Code native installer)
        run_args = ["bash", "-c", cmd]
    elif cmd.startswith("pip install "):
        package = cmd.replace("pip install ", "")
        run_args = [_sys.executable, "-m", "pip", "install", package]
    elif cmd.startswith("npm install "):
        npm_cmd = "npm.cmd" if is_windows else "npm"
        parts = cmd.split()
        parts[0] = npm_cmd
        run_args = parts
    elif cmd.startswith("See "):
        console.print(f"[yellow]Manual installation required:[/yellow]")
        console.print(f"  {cmd}")
        raise typer.Exit(0)
    else:
        # Generic command — use shell on Windows for path resolution
        if is_windows:
            run_args = cmd
            use_shell = True
        else:
            run_args = cmd.split()

    display_cmd = run_args if isinstance(run_args, str) else ' '.join(run_args)
    if not yes and not Confirm.ask(f"Run `{display_cmd}`?"):
        raise typer.Exit(0)

    try:
        result = subprocess.run(run_args, check=False, shell=use_shell)
        if result.returncode == 0:
            # Verify installation
            plugin = registry.get(agent_type)
            if plugin and plugin.is_installed():
                path = plugin.which()
                loc = f"\n  Location: [dim]{path}[/dim]" if path else ""
                console.print(Panel(
                    f"[green]Successfully installed {info.label}[/green]{loc}\n\n"
                    f"Next: [bold]openagents create {agent_type}[/bold]",
                    title="[green]✓ Installed[/green]",
                    border_style="green",
                ))
            else:
                console.print(Panel(
                    f"[yellow]Installed but not detected in PATH.[/yellow]\n\n"
                    "You may need to restart your terminal.",
                    title="[yellow]Warning[/yellow]",
                    border_style="yellow",
                ))
        else:
            console.print(f"\n  [red]✗ Installation failed (exit code {result.returncode})[/red]")
            raise typer.Exit(1)
    except FileNotFoundError:
        console.print(Panel(
            f"[red]Command not found:[/red] {run_args[0]}\n\n"
            f"Install manually: {cmd}",
            title="[red]Error[/red]",
            border_style="red",
        ))
        raise typer.Exit(1)


@app.command("search", rich_help_panel="Client")
def search_agents(
    query: str = typer.Argument("", help="Search query (empty = list all)"),
):
    """🔍 Search available agent types."""
    from openagents.client.plugin_registry import registry

    if query:
        results = registry.search_catalog(query)
    else:
        results = list(registry.get_catalog().values())

    if not results:
        console.print(f"  [yellow]No agents found matching '{query}'[/yellow]")
        raise typer.Exit(0)

    table = Table(
        title="Available Agents" if not query else f"Results for '{query}'",
        box=box.ROUNDED,
        title_style="bold",
        show_header=True,
        header_style="bold",
    )
    table.add_column("Name", style="cyan")
    table.add_column("Label")
    table.add_column("Status")
    table.add_column("Install Command", style="dim")
    table.add_column("Description", style="dim")

    for info in results:
        plugin = registry.get(info.name)
        if plugin and plugin.is_installed():
            status = "[green]● installed[/green]"
        elif info.builtin:
            status = "[yellow]○ not installed[/yellow]"
        else:
            status = "[dim]○ available[/dim]"

        table.add_row(
            info.name,
            info.label,
            status,
            info.install_command,
            info.description or "",
        )

    console.print()
    console.print(table)
    console.print(f"\n  [dim]Install with:[/dim] [bold]openagents install <name>[/bold]")


@app.command("update", rich_help_panel="Client")
def self_update(
    check_only: bool = typer.Option(
        False, "--check", help="Only check for updates, don't install",
    ),
):
    """🔄 Update openagents and check agent runtime versions."""
    import subprocess as _sp
    from rich.progress import Progress, SpinnerColumn, TextColumn

    from openagents.client.plugin_registry import registry

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Checking for updates...", total=None)

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
                for line in result.stdout.splitlines():
                    if "LATEST:" in line.upper() or "openagents" in line.lower():
                        import re as _re
                        m = _re.search(r'\(([0-9][0-9.]*)\)', line)
                        if m:
                            latest = m.group(1)
                            break
        except Exception:
            pass

        progress.update(task, description="[green]✓ Check complete[/green]")

    # Build version table
    table = Table(
        title="Version Status",
        box=box.ROUNDED,
        title_style="bold",
        show_header=True,
        header_style="bold",
    )
    table.add_column("Component", style="cyan")
    table.add_column("Version")
    table.add_column("Status")
    table.add_column("Location", style="dim")

    if latest and latest != current:
        table.add_row("openagents", current, f"[yellow]→ {latest} available[/yellow]", "")
    else:
        table.add_row("openagents", current, "[green]● up to date[/green]", "")

    for plugin in registry.list_plugins():
        if not plugin.is_installed():
            continue
        path = plugin.which() or ""
        table.add_row(plugin.name, "", "[green]● installed[/green]", path)

    console.print()
    console.print(table)

    if check_only:
        return

    # Upgrade openagents
    if latest and latest != current:
        console.print(f"\n  Upgrading openagents {current} → {latest}...")
        result = _sp.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "openagents"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode == 0:
            console.print("  [green]✓ openagents updated successfully.[/green]")
        else:
            console.print(f"  [red]✗ Update failed:[/red] {result.stderr[:200]}")
            raise typer.Exit(1)

        # Restart daemon if running
        from openagents.client.daemon import read_daemon_pid, stop_daemon
        pid = read_daemon_pid()
        if pid:
            console.print("  Restarting daemon...")
            stop_daemon()
            _start_daemon()
    else:
        console.print("\n  [dim]Already up to date.[/dim]")


@app.command("autostart", rich_help_panel="Client")
def init_autostart(
    remove: bool = typer.Option(False, "--remove", help="Remove auto-start configuration"),
):
    """⚙️ Set up OpenAgents daemon to auto-start on login."""
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
    console.print(Panel(
        "[green]Installed and started systemd user service.[/green]\n\n"
        "  Status  [dim]systemctl --user status openagents[/dim]\n"
        "  Logs    [dim]journalctl --user -u openagents -f[/dim]\n"
        "  Stop    [dim]systemctl --user stop openagents[/dim]\n"
        "  Remove  [dim]openagents autostart --remove[/dim]",
        title="[green]✓ Auto-Start Enabled[/green]",
        border_style="green",
    ))


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
    console.print(Panel(
        "[green]Installed and loaded launchd agent.[/green]\n\n"
        f"  Logs    [dim]tail -f {log_path}[/dim]\n"
        "  Stop    [dim]launchctl unload ~/Library/LaunchAgents/org.openagents.daemon.plist[/dim]\n"
        "  Remove  [dim]openagents autostart --remove[/dim]",
        title="[green]✓ Auto-Start Enabled[/green]",
        border_style="green",
    ))


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
        console.print(Panel(
            "[green]Created scheduled task for auto-start on login.[/green]\n\n"
            f"  Check   [dim]schtasks /Query /TN \"{task_name}\"[/dim]\n"
            "  Remove  [dim]openagents autostart --remove[/dim]",
            title="[green]✓ Auto-Start Enabled[/green]",
            border_style="green",
        ))
    else:
        console.print(Panel(
            "[red]Failed to create scheduled task.[/red]\n\n"
            "Try running as Administrator.",
            title="[red]Error[/red]",
            border_style="red",
        ))
        raise typer.Exit(1)


# ============================================================================
# WORKSPACE CONNECT COMMANDS
# ============================================================================
