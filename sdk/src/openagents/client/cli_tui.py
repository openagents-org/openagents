"""Interactive TUI dashboard for OpenAgents — `openagents` or `openagents setup`."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    Label,
    LoadingIndicator,
    OptionList,
    Static,
)
from textual.widgets.option_list import Option
from rich.text import Text


# ── Data helpers ────────────────────────────────────────────────────────────


def _load_agent_rows() -> list[dict]:
    """Build unified agent table: one row per configured agent, merged with
    runtime scan and daemon status."""
    from openagents.client.daemon import read_daemon_pid
    from openagents.client.daemon_config import (
        DEFAULT_ENDPOINT,
        get_agent_network,
        load_config,
        read_status,
    )
    from openagents.client.plugin_registry import registry

    cfg = load_config()
    status = read_status() or {}
    agent_statuses = status.get("agents", {})
    pid = read_daemon_pid()

    scan = {a["name"]: a for a in registry.scan_agents()}

    rows: list[dict] = []

    # Configured agents first
    seen_types: set[str] = set()
    for agent in cfg.agents:
        seen_types.add(agent.type)
        info = agent_statuses.get(agent.name, {})
        state = info.get("state", "stopped") if pid else "stopped"
        # Build a friendly workspace display
        workspace_display = ""
        net = get_agent_network(agent, cfg)
        if net:
            slug = net.slug or net.id
            is_local = "localhost" in net.endpoint or "127.0.0.1" in net.endpoint
            if is_local:
                workspace_display = f"{net.endpoint}/{slug}"
            elif net.endpoint == DEFAULT_ENDPOINT or not net.endpoint:
                workspace_display = f"workspace.openagents.org/{slug}"
            else:
                workspace_display = f"{net.endpoint}/{slug}"
        elif agent.network:
            workspace_display = agent.network
        rows.append({
            "name": agent.name,
            "type": agent.type,
            "state": state,
            "workspace": workspace_display,
            "path": agent.path or "",
            "last_error": info.get("last_error", ""),
            "configured": True,
        })

    # Installed but not-configured runtimes
    for s in scan.values():
        if s["name"] not in seen_types and s["installed"]:
            hint = s.get("message", "")
            if s.get("ready"):
                state_label = "not configured"
            else:
                state_label = "not configured"
                hint = hint or "Not ready"
            rows.append({
                "name": f"({s['name']})",
                "type": s["name"],
                "state": state_label,
                "workspace": hint,
                "path": "",
                "configured": False,
            })

    return rows


def _load_catalog() -> list[dict]:
    """Return all catalog entries with installed flag and version."""
    from openagents.client.plugin_registry import registry

    scan = {a["name"]: a for a in registry.scan_agents()}
    catalog = registry.get_catalog()
    plugins = registry._plugins

    results = []
    for name, info in catalog.items():
        already = scan.get(name, {})
        installed = already.get("installed", False)
        version = ""
        if installed and name in plugins:
            version = plugins[name].get_version() or ""
        results.append({
            "name": info.name,
            "label": info.label,
            "description": info.description,
            "install_command": info.install_command,
            "installed": installed,
            "version": version,
        })
    return results


# ── State formatting ────────────────────────────────────────────────────────


_STATE_DISPLAY = {
    "online": ("●", "green"),
    "running": ("●", "green"),
    "starting": ("◐", "yellow"),
    "reconnecting": ("◐", "yellow"),
    "stopped": ("○", "dim"),
    "not configured": ("○", "dim"),
    "error": ("✗", "red"),
}


def _state_text(state: str) -> str:
    symbol, color = _STATE_DISPLAY.get(state, ("?", "white"))
    return f"[{color}]{symbol} {state}[/{color}]"


# ── Modal Screens ───────────────────────────────────────────────────────────


class InstallAgentScreen(Screen[dict | None]):
    """Full-screen table to pick an agent runtime to install or update."""

    BINDINGS = [
        Binding("escape", "cancel", "Back"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._items = _load_catalog()
        self._installing = False

    def compose(self) -> ComposeResult:
        yield Header(icon="🌀")
        with Vertical():
            yield Label(" [bold]Install Agent Runtime[/bold]  —  Enter to install, or update an installed runtime\n")
            yield Static("", id="install-status")
            yield Static("", id="install-log")
            yield LoadingIndicator(id="install-spinner")
            table = DataTable(id="install-table", cursor_type="row")
            table.add_columns("Name", "Label", "Version", "Status", "Description")
            for item in self._items:
                if item["installed"]:
                    table.add_row(
                        f"[dim]{item['name']}[/dim]",
                        f"[dim]{item['label']}[/dim]",
                        f"[dim]{item['version']}[/dim]",
                        "[green]installed[/green]",
                        f"[dim]{item['description'] or ''}[/dim]",
                    )
                else:
                    table.add_row(
                        item["name"],
                        item["label"],
                        "",
                        "[yellow]not installed[/yellow]",
                        item["description"] or "",
                    )
            yield table
        yield Footer()

    def on_mount(self) -> None:
        self.query_one("#install-spinner", LoadingIndicator).display = False

    def _show_progress(self, msg: str) -> None:
        self.query_one("#install-status", Static).update(f" {msg}")
        self.query_one("#install-spinner", LoadingIndicator).display = True

    def _update_progress(self, msg: str) -> None:
        self.query_one("#install-status", Static).update(f" {msg}")

    def _update_log(self, msg: str) -> None:
        self.query_one("#install-log", Static).update(f" [dim]{msg}[/dim]")

    def _hide_progress(self, msg: str = "") -> None:
        self.query_one("#install-status", Static).update(f" {msg}" if msg else "")
        self.query_one("#install-spinner", LoadingIndicator).display = False
        self.query_one("#install-log", Static).update("")

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        if not self._items or self._installing:
            return
        row_idx = event.cursor_row
        item = self._items[row_idx]
        self._installing = True
        verb = "Updating" if item["installed"] else "Installing"
        self._show_progress(f"{verb} [cyan]{item['name']}[/cyan]…")
        self._do_install_inline(item)

    @work(thread=True)
    def _do_install_inline(self, item: dict) -> None:
        import platform as _platform
        from openagents.client.plugin_registry import registry

        catalog = registry.get_catalog()
        info = catalog.get(item["name"])
        if not info:
            self.app.call_from_thread(self._hide_progress, f"[red]✗ Unknown agent: {item['name']}[/red]")
            self._installing = False
            return

        is_windows = _platform.system() == "Windows"
        os_name = _platform.system()

        # Auto-install dependencies (nodejs, git, etc.)
        for dep in info.requires:
            if not self._ensure_dep(dep, is_windows, os_name, item["name"]):
                self._installing = False
                return

        cmd = info.install_command

        # Refresh PATH one more time before running (deps may have added new paths)
        if is_windows:
            from openagents.client.cli_packages import _refresh_path_windows
            _refresh_path_windows()

        self.app.call_from_thread(self._update_progress, f"Running: {cmd}")

        # Use npm.cmd on Windows for npm commands
        if is_windows and cmd.startswith("npm "):
            cmd = "npm.cmd " + cmd[4:]

        # Force npm to produce streaming output (it suppresses progress when
        # stdout is not a TTY, so without this we get zero lines until exit).
        if "npm " in cmd or "npm.cmd " in cmd:
            cmd += " --foreground-scripts --loglevel=verbose"

        # Build env: suppress interactive prompts from npm/pip/etc.
        env = os.environ.copy()
        env["npm_config_yes"] = "true"
        env["CI"] = "1"  # many tools skip prompts when CI is set
        env["PYTHONUNBUFFERED"] = "1"  # force unbuffered output for pip

        try:
            proc = subprocess.Popen(
                cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, stdin=subprocess.DEVNULL, env=env,
                bufsize=1, encoding="utf-8", errors="replace",
            )
            last_err = ""
            while True:
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                line = line.rstrip()
                if line:
                    # Show the latest output line so user sees progress
                    display = line[:120]
                    self.app.call_from_thread(self._update_log, display)
                    # Track last meaningful line for error reporting
                    if "err" in line.lower() or "warn" in line.lower():
                        last_err = line.strip()[:200]

            returncode = proc.wait(timeout=600)
            if returncode == 0:
                # Write install marker immediately (before UI callbacks) so it
                # persists even if the user dismisses the screen before
                # _finish_install runs on the main thread.
                from openagents.registry.loader import mark_installed
                mark_installed(item["name"])

                self.app.call_from_thread(
                    self._hide_progress,
                    f"[green]✓ Installed {item['name']}[/green]  —  Press [bold]n[/bold] on the main screen to create an agent",
                )
                self.app.call_from_thread(self._finish_install, item)
            else:
                err = last_err or f"exit code {returncode}"
                self.app.call_from_thread(self._hide_progress, f"[red]✗ Install failed:[/red] {err}")
                self._installing = False
        except Exception as e:
            self.app.call_from_thread(self._hide_progress, f"[red]✗ Install error:[/red] {e}")
            self._installing = False

    def _ensure_dep(self, dep: str, is_windows: bool, os_name: str, agent_name: str) -> bool:
        """Check and auto-install a dependency. Returns True on success."""
        import shutil
        from openagents.client.cli_packages import (
            _install_nodejs, _install_git, _refresh_path_windows,
            _parse_dep, _get_node_major_version,
        )

        dep_name, min_version = _parse_dep(dep)

        dep_map = {
            "nodejs": ("npm", "Node.js", _install_nodejs),
            "git": ("git", "Git", _install_git),
        }
        check_bin, label, installer = dep_map.get(dep_name, (dep_name, dep_name, None))

        if shutil.which(check_bin):
            # Check version constraint for nodejs
            if dep_name == "nodejs" and min_version is not None:
                current = _get_node_major_version()
                if current is not None and current < min_version:
                    self.app.call_from_thread(
                        self._update_progress,
                        f"Upgrading {label} (v{current} → v{min_version}+)...",
                    )
                    if not installer(is_windows, os_name):
                        self.app.call_from_thread(
                            self._hide_progress,
                            f"[red]✗ Could not upgrade {label} to v{min_version}+[/red]",
                        )
                        return False
                    new_ver = _get_node_major_version()
                    if new_ver is not None and new_ver < min_version:
                        self.app.call_from_thread(
                            self._hide_progress,
                            f"[yellow]{label} v{new_ver} still below v{min_version}+. Upgrade manually.[/yellow]",
                        )
                        return False
            return True

        self.app.call_from_thread(self._update_progress, f"Installing {label}...")

        if installer is None:
            self.app.call_from_thread(self._hide_progress, f"[red]✗ Missing dependency: {dep_name}[/red]")
            return False

        if not installer(is_windows, os_name):
            self.app.call_from_thread(self._hide_progress, f"[red]✗ Could not install {label}[/red]")
            return False

        if is_windows:
            _refresh_path_windows()

        if not shutil.which(check_bin):
            self.app.call_from_thread(
                self._hide_progress,
                f"[yellow]{label} installed but not on PATH. Restart terminal and retry.[/yellow]",
            )
            return False

        self.app.call_from_thread(self._update_progress, f"{label} installed")
        return True

    def _finish_install(self, item: dict) -> None:
        self._installing = False
        # Refresh PATH on Windows so newly installed binaries are found
        import platform as _platform
        if _platform.system() == "Windows":
            from openagents.client.cli_packages import _refresh_path_windows
            _refresh_path_windows()
        # Persist install marker so API-only agents stay "installed" across restarts
        from openagents.registry.loader import mark_installed
        mark_installed(item["name"])
        # Refresh table to show updated status
        self._items = _load_catalog()
        # Force-mark the just-installed item as installed (in case PATH
        # refresh didn't catch the new binary yet — the install succeeded)
        for it in self._items:
            if it["name"] == item["name"]:
                it["installed"] = True
                break
        table = self.query_one("#install-table", DataTable)
        table.clear()
        for it in self._items:
            if it["installed"]:
                table.add_row(
                    f"[dim]{it['name']}[/dim]",
                    f"[dim]{it['label']}[/dim]",
                    f"[dim]{it['version']}[/dim]",
                    "[green]installed[/green]",
                    f"[dim]{it['description'] or ''}[/dim]",
                )
            else:
                table.add_row(
                    it["name"],
                    it["label"],
                    "",
                    "[yellow]not installed[/yellow]",
                    it["description"] or "",
                )

    def action_cancel(self) -> None:
        if self._installing:
            return  # Don't dismiss while installing
        self.dismiss(None)


class StartAgentScreen(ModalScreen[dict | None]):
    """Prompt for agent name and working directory."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, agent_type: str) -> None:
        super().__init__()
        self.agent_type = agent_type

    def compose(self) -> ComposeResult:
        from openagents.client.workspace_client import generate_agent_name

        default_name = generate_agent_name(self.agent_type)
        default_path = str(Path.cwd())

        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]Start {self.agent_type} Agent[/bold]", id="modal-title")
            yield Label("Agent name:")
            yield Input(value=default_name, id="agent-name-input")
            yield Label("Working directory:")
            yield Input(value=default_path, id="agent-path-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        name_input = self.query_one("#agent-name-input", Input)
        path_input = self.query_one("#agent-path-input", Input)
        self.dismiss({
            "name": name_input.value.strip(),
            "type": self.agent_type,
            "path": path_input.value.strip(),
        })

    def action_cancel(self) -> None:
        self.dismiss(None)


class SelectAgentTypeScreen(ModalScreen[str | None]):
    """Pick an installed agent type for starting."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def compose(self) -> ComposeResult:
        from openagents.client.plugin_registry import registry

        scan = registry.scan_agents()
        installed = [a for a in scan if a["installed"]]

        with Vertical(id="modal-dialog"):
            yield Label("[bold]Select Agent Type[/bold]", id="modal-title")
            if not installed:
                yield Label("[dim]No agent runtimes installed. Install one first.[/dim]")
            else:
                ol = OptionList(id="type-list")
                for a in installed:
                    ready_mark = "[green]✓[/green]" if a["ready"] else "[yellow]![/yellow]"
                    ol.add_option(Option(f"{ready_mark} {a['label']}", id=a["name"]))
                yield ol

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self.dismiss(str(event.option.id))

    def action_cancel(self) -> None:
        self.dismiss(None)


class ConnectWorkspaceScreen(Screen[dict | None]):
    """Full-screen table to pick a workspace to connect an agent to."""

    BINDINGS = [
        Binding("escape", "cancel", "Back"),
    ]

    # Special row IDs for create / join actions
    _ACTION_CREATE = "__create__"
    _ACTION_TOKEN = "__token__"

    def __init__(self, agent_name: str) -> None:
        super().__init__()
        self.agent_name = agent_name
        self._row_actions: list[str] = []  # parallel to table rows

    def compose(self) -> ComposeResult:
        from openagents.client.daemon_config import load_config

        cfg = load_config()

        yield Header(icon="🌀")
        with Vertical():
            yield Label(
                f" [bold]Connect '{self.agent_name}' to Workspace[/bold]"
                f"  —  Select a workspace and press Enter\n"
            )
            table = DataTable(id="connect-table", cursor_type="row")
            table.add_columns("Workspace", "URL")

            for net in cfg.networks:
                name_part = net.name or net.slug or net.id
                is_local = "localhost" in net.endpoint or "127.0.0.1" in net.endpoint
                slug = net.slug or net.id
                if is_local:
                    url = f"{net.endpoint}/{slug}"
                else:
                    url = f"https://workspace.openagents.org/{slug}"
                table.add_row(name_part, url)
                self._row_actions.append(f"existing:{slug}")

            # Action rows
            table.add_row("[bold]✚ Create new workspace[/bold]", "")
            self._row_actions.append(self._ACTION_CREATE)
            table.add_row("[bold]🔑 Join with token[/bold]", "")
            self._row_actions.append(self._ACTION_TOKEN)

            yield table
        yield Footer()

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        row_idx = event.cursor_row
        action = self._row_actions[row_idx]
        self.dismiss({"action": action, "agent": self.agent_name})

    def action_cancel(self) -> None:
        self.dismiss(None)


class TokenInputScreen(ModalScreen[str | None]):
    """Simple modal to paste a workspace token."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, title: str = "Enter workspace token") -> None:
        super().__init__()
        self._title = title

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]{self._title}[/bold]", id="modal-title")
            yield Input(placeholder="Paste token here…", id="token-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip() or None)

    def action_cancel(self) -> None:
        self.dismiss(None)


class WorkspaceUrlScreen(ModalScreen[None]):
    """Modal showing the workspace URL for the user to copy."""

    CSS = """
    #modal-dialog {
        width: 95%;
        height: auto;
        max-height: 10;
    }
    """

    BINDINGS = [Binding("escape", "close", "Close"), Binding("enter", "close", "Close")]

    def __init__(self, url: str, opened: bool = False) -> None:
        super().__init__()
        self._url = url
        self._opened = opened

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label("[bold]Workspace URL[/bold]", id="modal-title")
            yield Static(self._url)
            if self._opened:
                yield Label("[dim]Opened in browser. Press Escape to close.[/dim]")
            else:
                yield Label("[dim]Select and copy the URL. Press Escape to close.[/dim]")

    def action_close(self) -> None:
        self.dismiss(None)


class AgentActionScreen(ModalScreen[str | None]):
    """Context menu of available actions for the selected agent."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, actions: list[tuple[str, str]]) -> None:
        """actions: list of (action_id, label) pairs."""
        super().__init__()
        self._actions = actions

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label("[bold]Actions[/bold]", id="modal-title")
            ol = OptionList(
                *[Option(label, id=action_id) for action_id, label in self._actions],
                id="action-list",
            )
            yield ol

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self.dismiss(event.option.id)

    def action_cancel(self) -> None:
        self.dismiss(None)


class TextInputScreen(ModalScreen[str | None]):
    """Generic single-line input modal."""

    BINDINGS = [Binding("escape", "cancel", "Cancel")]

    def __init__(self, title: str, default: str = "") -> None:
        super().__init__()
        self._title = title
        self._default = default

    def compose(self) -> ComposeResult:
        with Vertical(id="modal-dialog"):
            yield Label(f"[bold]{self._title}[/bold]", id="modal-title")
            yield Input(value=self._default, id="text-input")
            yield Label("[dim]Press Enter to confirm, Escape to cancel[/dim]")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value.strip() or None)

    def action_cancel(self) -> None:
        self.dismiss(None)


class ConfigureAgentScreen(Screen[bool]):
    """Full-screen page to configure LLM provider settings for an agent type."""

    BINDINGS = [
        Binding("escape", "cancel", "Back"),
        Binding("ctrl+s", "save", "Save"),
        Binding("ctrl+t", "test_config", "Test"),
    ]

    def __init__(self, agent_type: str) -> None:
        super().__init__()
        self._agent_type = agent_type
        self._fields: list[dict] = []

    def compose(self) -> ComposeResult:
        from openagents.client.daemon_config import load_agent_env
        from openagents.client.plugin_registry import registry

        plugin = registry.get(self._agent_type)
        self._fields = plugin.required_env_vars() if plugin else []
        saved = load_agent_env(self._agent_type)
        label = plugin.label if plugin else self._agent_type

        yield Header(icon="🌀")
        with VerticalScroll(id="configure-page"):
            yield Label(f"[bold]Configure {label}[/bold]")
            yield Label("[dim]Saved to ~/.openagents/env/[/dim]")
            yield Label("")
            if not self._fields:
                yield Label("[dim]No configuration required for this agent type.[/dim]")
            else:
                for field in self._fields:
                    current = saved.get(field["name"], "") or field.get("default", "")
                    req = " [red]*[/red]" if field.get("required") else ""
                    is_password = field.get("password", False)
                    placeholder = field.get("placeholder", f"Enter {field['name']}…")

                    yield Label(f"{field['description']}{req}")
                    yield Input(
                        value=current,
                        placeholder=placeholder,
                        password=is_password,
                        id=f"cfg-{field['name']}",
                    )
                    yield Label("")
                with Horizontal(id="configure-buttons"):
                    yield Button("Save", variant="primary", id="btn-save")
                    yield Button("Test", variant="default", id="btn-test")
                yield Label("", id="test-result")
        yield Footer()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-save":
            self._save()
        elif event.button.id == "btn-test":
            self._run_test()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self._save()

    def _gather_env(self) -> dict:
        """Collect current field values."""
        env = {}
        for field in self._fields:
            try:
                inp = self.query_one(f"#cfg-{field['name']}", Input)
                val = inp.value.strip()
                if val:
                    env[field["name"]] = val
            except Exception:
                pass
        return env

    def _save(self) -> None:
        from openagents.client.daemon_config import save_agent_env

        save_agent_env(self._agent_type, self._gather_env())
        self.dismiss(True)

    def action_save(self) -> None:
        self._save()

    def action_cancel(self) -> None:
        self.dismiss(False)

    def action_test_config(self) -> None:
        self._run_test()

    def _run_test(self) -> None:
        """Kick off async LLM test."""
        env = self._gather_env()
        api_key = env.get("LLM_API_KEY") or env.get("OPENAI_API_KEY") or env.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            try:
                self.query_one("#test-result", Label).update("[red]No API key entered[/red]")
            except Exception:
                pass
            return
        try:
            self.query_one("#test-result", Label).update("[dim]Testing...[/dim]")
            self.query_one("#btn-test", Button).disabled = True
        except Exception:
            pass
        self._do_test(env)

    @work(thread=True)
    def _do_test(self, env: dict) -> None:
        """Test LLM inference in a background thread."""
        import json as _json
        from urllib.request import Request, urlopen
        from urllib.error import URLError, HTTPError

        from openagents.client.plugin_registry import registry

        plugin = registry.get(self._agent_type)
        resolved = plugin.resolve_env(env) if plugin else env

        api_key = resolved.get("OPENAI_API_KEY") or resolved.get("ANTHROPIC_API_KEY", "")
        base_url = resolved.get("OPENAI_BASE_URL", "").rstrip("/")
        model = resolved.get("OPENCLAW_MODEL") or resolved.get("LLM_MODEL", "")

        is_anthropic = "ANTHROPIC_API_KEY" in resolved and "OPENAI_API_KEY" not in resolved

        try:
            if is_anthropic:
                url = "https://api.anthropic.com/v1/messages"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                }
                body = _json.dumps({
                    "model": model or "claude-sonnet-4-20250514",
                    "max_tokens": 32,
                    "messages": [{"role": "user", "content": "Say hi in 5 words."}],
                }).encode()
            else:
                url = (base_url or "https://api.openai.com/v1") + "/chat/completions"
                headers = {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                }
                body = _json.dumps({
                    "model": model or "gpt-4o-mini",
                    "max_tokens": 32,
                    "messages": [{"role": "user", "content": "Say hi in 5 words."}],
                }).encode()

            req = Request(url, data=body, headers=headers, method="POST")
            with urlopen(req, timeout=15) as resp:
                data = _json.loads(resp.read())

            # Extract response text
            if is_anthropic:
                text = data.get("content", [{}])[0].get("text", "")
                used_model = data.get("model", model or "?")
            else:
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                used_model = data.get("model", model or "?")

            result = f"[green]OK[/green] — model: {used_model}, response: {text[:60]}"
        except HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode()[:200]
            except Exception:
                pass
            result = f"[red]HTTP {e.code}[/red]: {err_body}"
        except URLError as e:
            result = f"[red]Connection error[/red]: {e.reason}"
        except Exception as e:
            result = f"[red]Error[/red]: {e}"

        self.app.call_from_thread(self._show_test_result, result)

    def _show_test_result(self, result: str) -> None:
        try:
            self.query_one("#test-result", Label).update(result)
            self.query_one("#btn-test", Button).disabled = False
        except Exception:
            pass


# ── Main TUI App ────────────────────────────────────────────────────────────


class OpenAgentsTUI(App):
    """Interactive OpenAgents dashboard."""

    TITLE = "OpenAgents"
    SUB_TITLE = "Interactive Setup"

    CSS = """
    Screen {
        background: $surface;
    }
    #main-layout {
        height: 1fr;
    }
    #agent-panel {
        height: 1fr;
        border: round $primary;
        padding: 0 1;
    }
    #agent-panel > Label {
        margin-bottom: 1;
    }
    #log-panel {
        height: auto;
        max-height: 10;
        border: round $accent;
        padding: 0 1;
    }
    #log-content {
        height: auto;
        max-height: 8;
    }
    #modal-dialog {
        background: $surface;
        border: thick $primary;
        padding: 1 2;
        width: 70;
        max-height: 24;
        margin: 4 0;
    }
    #modal-dialog > Label {
        margin-bottom: 1;
    }
    #modal-title {
        text-style: bold;
        margin-bottom: 1;
    }
    ModalScreen {
        align: center middle;
    }
    #install-spinner {
        height: 1;
        margin: 0 1;
        color: $accent;
    }
    #install-status {
        height: auto;
        margin: 0 0;
    }
    #configure-page {
        padding: 1 2;
    }
    #configure-page > Label {
        margin-bottom: 1;
    }
    #configure-buttons {
        height: auto;
        margin-top: 1;
    }
    #configure-buttons > Button {
        margin-right: 2;
    }
    #test-result {
        margin-top: 1;
        height: auto;
    }
    """

    BINDINGS = [
        Binding("i", "install", "Install"),
        Binding("e", "configure_agent", "Configure"),
        Binding("l", "login_agent", "Login"),
        Binding("n", "new_agent", "New Agent"),
        Binding("s", "start_agent", "Start"),
        Binding("x", "stop_agent", "Stop"),
        Binding("c", "connect_agent", "Connect"),
        Binding("d", "disconnect_agent", "Disconnect"),
        Binding("delete", "remove_agent", "Remove"),
        Binding("w", "open_workspace", "Open Workspace"),
        Binding("u", "daemon_toggle", "Daemon"),
        Binding("r", "refresh", "Refresh"),
        Binding("q", "quit", "Quit"),
    ]

    def _agent_has_env_vars(self, agent_type: str) -> bool:
        """Check if an agent type has configurable env vars."""
        from openagents.client.plugin_registry import registry
        plugin = registry.get(agent_type)
        return bool(plugin and plugin.required_env_vars())

    def _agent_needs_login(self, agent_type: str) -> bool:
        """Check if an agent type has a login command and is not yet ready."""
        from openagents.client.plugin_registry import registry
        plugin = registry.get(agent_type)
        if not plugin or not plugin.login_command():
            return False
        ready, _ = plugin.check_ready()
        return not ready

    def check_action(self, action: str, parameters: tuple) -> bool | None:
        """Dynamically show/hide per-agent actions based on the highlighted row."""
        contextual = {
            "new_agent", "configure_agent", "login_agent", "start_agent",
            "stop_agent", "connect_agent", "disconnect_agent", "remove_agent",
            "open_workspace",
        }
        if action not in contextual:
            return True

        agent = self._selected_agent(allow_unconfigured=True)
        if not agent:
            return action == "new_agent"

        configured = agent.get("configured", True)
        state = agent.get("state", "")
        is_running = any(s in state for s in ("online", "running", "starting", "reconnecting"))
        is_stopped = "stopped" in state or "error" in state
        has_workspace = bool(agent.get("workspace"))

        if action == "configure_agent":
            return self._agent_has_env_vars(agent["type"])
        if action == "login_agent":
            return self._agent_needs_login(agent["type"])

        if not configured:
            return action in ("new_agent", "configure_agent", "login_agent")

        if action == "new_agent":
            return True
        if action == "start_agent":
            return is_stopped
        if action == "stop_agent":
            return is_running
        if action == "connect_agent":
            return not has_workspace
        if action == "disconnect_agent":
            return has_workspace
        if action == "open_workspace":
            return has_workspace
        if action == "remove_agent":
            return True

        return True

    def compose(self) -> ComposeResult:
        yield Header(icon="🌀")
        with Vertical(id="main-layout"):
            with Vertical(id="agent-panel"):
                yield Label("[bold]Agents[/bold]")
                yield DataTable(id="agent-table")
            with Vertical(id="log-panel"):
                yield Label("[bold]Activity Log[/bold]")
                yield VerticalScroll(
                    Static("Ready.", id="log-text"),
                    id="log-content",
                )
        yield Footer()

    def on_mount(self) -> None:
        from openagents import __version__
        self.title = f"OpenAgents v{__version__}"
        table = self.query_one("#agent-table", DataTable)
        table.cursor_type = "row"
        table.add_columns("Name", "Type", "Status", "Workspace")
        self._refresh_table()
        self.set_interval(5, self._refresh_table)

    def _refresh_table(self) -> None:
        table = self.query_one("#agent-table", DataTable)
        # Preserve cursor position across refresh
        saved_row = table.cursor_row if table.row_count > 0 else 0
        table.clear()
        try:
            rows = _load_agent_rows()
        except Exception:
            rows = []
        self._agent_rows = rows
        if not rows:
            table.add_row("No agents yet — press [bold]i[/bold] to install one", "", "", "")
        else:
            for r in rows:
                name_cell = Text(r["name"])
                if r.get("path"):
                    name_cell.append(f"\n{r['path']}", style="dim")
                table.add_row(
                    name_cell,
                    r["type"],
                    _state_text(r["state"]),
                    r["workspace"],
                    height=None,
                )
        # Restore cursor position (clamped to valid range)
        if table.row_count > 0:
            table.move_cursor(row=min(saved_row, table.row_count - 1))

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        """Refresh footer bindings when the cursor moves to a different row."""
        if event.data_table.id == "agent-table":
            self.refresh_bindings()
            # Show error details in log for agents in error state
            rows = getattr(self, "_agent_rows", [])
            idx = event.cursor_row
            if 0 <= idx < len(rows):
                r = rows[idx]
                if r.get("last_error") and "error" in r.get("state", ""):
                    self._log(f"[red]Error:[/red] {r['last_error']}")

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        """Show context menu when Enter is pressed on an agent row."""
        if event.data_table.id != "agent-table":
            return
        # Build list of available actions for the selected agent
        all_actions = [
            ("login_agent", "Login"),
            ("configure_agent", "Configure"),
            ("start_agent", "Start"),
            ("stop_agent", "Stop"),
            ("open_workspace", "Open Workspace"),
            ("connect_agent", "Connect to Workspace"),
            ("disconnect_agent", "Disconnect from Workspace"),
            ("remove_agent", "Remove"),
        ]
        available = [
            (action_id, label)
            for action_id, label in all_actions
            if self.check_action(action_id, ())
        ]
        if not available:
            return
        self.push_screen(AgentActionScreen(available), callback=self._on_action_picked)

    def _on_action_picked(self, action_id: str | None) -> None:
        if action_id:
            self.run_action(action_id)

    def __init__(self) -> None:
        super().__init__()
        self._log_lines: list[str] = ["Ready."]
        self._agent_rows: list[dict] = []

    def _log(self, msg: str) -> None:
        self._log_lines.append(msg)
        # Keep last 50 lines
        if len(self._log_lines) > 50:
            self._log_lines = self._log_lines[-50:]
        try:
            log_widget = self.query_one("#log-text", Static)
            log_widget.update("\n".join(self._log_lines))
        except Exception:
            pass  # widget not ready or markup error

    @staticmethod
    def _workspace_url(net) -> str:
        """Build the full workspace URL with token for display."""
        slug = net.slug or net.id
        is_local = "localhost" in net.endpoint or "127.0.0.1" in net.endpoint
        if is_local:
            base = f"{net.endpoint}/{slug}"
        else:
            base = f"https://workspace.openagents.org/{slug}"
        if net.token:
            return f"{base}?token={net.token}"
        return base

    @staticmethod
    def _signal_daemon_reload():
        """Signal the running daemon to reload config."""
        from openagents.client.daemon import read_daemon_pid
        pid = read_daemon_pid()
        if not pid:
            return
        if sys.platform == "win32":
            from openagents.client.daemon_config import CMD_PATH
            try:
                CMD_PATH.write_text("reload\n")
            except OSError:
                pass
        else:
            try:
                import signal
                os.kill(pid, signal.SIGHUP)
            except (ProcessLookupError, PermissionError):
                pass

    def _selected_agent(self, allow_unconfigured: bool = False) -> dict | None:
        table = self.query_one("#agent-table", DataTable)
        if table.row_count == 0:
            return None
        try:
            row_idx = table.cursor_row
            row = table.get_row_at(row_idx)
        except Exception:
            return None
        # Name cell may contain path on second line (Rich Text)
        name_raw = row[0]
        if hasattr(name_raw, "plain"):
            name_lines = name_raw.plain.split("\n")
        else:
            name_lines = str(name_raw).split("\n")
        name = name_lines[0]
        path = name_lines[1] if len(name_lines) > 1 else ""
        if name.startswith("("):
            if not allow_unconfigured:
                return None
            return {
                "name": name,
                "type": str(row[1]),
                "state": "not configured",
                "workspace": "",
                "path": "",
                "configured": False,
            }
        return {
            "name": name,
            "type": str(row[1]),
            "state": str(row[2]),
            "workspace": str(row[3]),
            "path": path,
            "configured": True,
        }

    # ── Actions ─────────────────────────────────────────────────────────

    def action_refresh(self) -> None:
        self._refresh_table()
        self._log("[green]✓[/green] Refreshed")

    # -- Open Workspace --

    def action_open_workspace(self) -> None:
        agent = self._selected_agent()
        if not agent or not agent.get("workspace"):
            self._log("[yellow]No workspace to open[/yellow]")
            return
        from openagents.client.daemon_config import load_config, get_agent_network
        cfg = load_config()
        agent_entry = None
        for a in cfg.agents:
            if a.name == agent["name"]:
                agent_entry = a
                break
        if not agent_entry:
            self._log("[yellow]Agent not found in config[/yellow]")
            return
        net = get_agent_network(agent_entry, cfg)
        if not net:
            self._log("[yellow]No network config found[/yellow]")
            return
        url = self._workspace_url(net)
        # Try opening in browser; show URL in a copyable modal either way
        opened = False
        try:
            import webbrowser
            opened = webbrowser.open(url)
        except Exception:
            pass
        if opened:
            self._log(f"[green]✓[/green] Opened workspace in browser")
        self.push_screen(WorkspaceUrlScreen(url, opened=opened))

    # -- Install --

    def action_install(self) -> None:
        self.push_screen(InstallAgentScreen(), callback=self._on_install_picked)

    def _on_install_picked(self, result: dict | None) -> None:
        # Install now happens inside InstallAgentScreen; just refresh on return
        self._refresh_table()

    # -- Configure --

    def action_configure_agent(self) -> None:
        agent = self._selected_agent(allow_unconfigured=True)
        if not agent:
            self._log("[yellow]Select an agent to configure[/yellow]")
            return
        self.push_screen(
            ConfigureAgentScreen(agent["type"]),
            callback=self._on_configure_done,
        )

    def _on_configure_done(self, saved: bool) -> None:
        if saved:
            self._log("[green]✓[/green] Configuration saved")
        self._refresh_table()

    # -- Login --

    def action_login_agent(self) -> None:
        agent = self._selected_agent(allow_unconfigured=True)
        if not agent:
            self._log("[yellow]Select an agent first[/yellow]")
            return
        from openagents.client.plugin_registry import registry
        plugin = registry.get(agent["type"])
        if not plugin or not plugin.login_command():
            self._log("[yellow]No login command for this agent type[/yellow]")
            return
        cmd = plugin.login_command()
        self._log(f"Running [bold]{cmd}[/bold]…")
        self._run_login(cmd)

    @work(thread=True)
    def _run_login(self, cmd: str) -> None:
        with self.app.suspend():
            result = subprocess.run(cmd, shell=True)
        if result.returncode == 0:
            self.app.call_from_thread(self._log, "[green]✓[/green] Login completed")
        else:
            self.app.call_from_thread(self._log, f"[yellow]Login exited with code {result.returncode}[/yellow]")
        self.app.call_from_thread(self._refresh_table)

    # -- Start --

    def action_new_agent(self) -> None:
        """Create a new agent. If an unconfigured agent type is selected, skip type picker."""
        agent = self._selected_agent(allow_unconfigured=True)
        if agent and not agent.get("configured", True):
            # Skip type selection — go straight to name/path dialog
            self._on_type_picked(agent["type"])
            return
        self.push_screen(SelectAgentTypeScreen(), callback=self._on_type_picked)

    def action_start_agent(self) -> None:
        """Restart the selected stopped/error agent."""
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to start[/yellow]")
            return
        if "stopped" not in agent["state"] and "error" not in agent["state"]:
            self._log(f"[yellow]{agent['name']} is already running[/yellow]")
            return
        self._log(f"Starting [cyan]{agent['name']}[/cyan]…")
        self._do_restart(agent["name"])

    def _on_type_picked(self, agent_type: str | None) -> None:
        if not agent_type:
            return
        self.push_screen(StartAgentScreen(agent_type), callback=self._on_start_confirmed)

    def _on_start_confirmed(self, result: dict | None) -> None:
        if not result:
            return
        name = result["name"]
        agent_type = result["type"]
        path = result["path"]

        self._log(f"Starting [cyan]{name}[/cyan] ({agent_type}) in {path}…")
        self._do_start(name, agent_type, path)

    @work(thread=True)
    def _do_start(self, name: str, agent_type: str, path: str) -> None:
        from openagents.client.daemon_config import (
            AgentEntry,
            add_agent_to_config,
        )

        agent_entry = AgentEntry(
            name=name,
            type=agent_type,
            role="worker",
            path=path,
        )
        add_agent_to_config(agent_entry)

        # Start daemon via subprocess (avoids fork issues inside TUI)
        try:
            subprocess.Popen(
                [sys.executable, "-m", "openagents.client.cli", "up"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.app.call_from_thread(
                self._log,
                f"[green]✓[/green] Added [cyan]{name}[/cyan] and started daemon",
            )
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Failed to start daemon:[/red] {e}")
            return
        import time
        time.sleep(5)
        self.app.call_from_thread(self._refresh_table)
        # Check if agent actually started — show daemon log errors if not
        self._check_agent_started(name)

    @work(thread=True)
    def _do_restart(self, name: str) -> None:
        """Restart a stopped agent by sending a restart command to the daemon."""
        from openagents.client.daemon import read_daemon_pid
        from openagents.client.daemon_config import CMD_PATH

        pid = read_daemon_pid()
        if pid is None:
            # Daemon not running — start it (will launch all agents)
            try:
                subprocess.Popen(
                    [sys.executable, "-m", "openagents.client.cli", "up"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                self.app.call_from_thread(
                    self._log,
                    f"[green]✓[/green] Starting daemon (will launch [cyan]{name}[/cyan])",
                )
            except Exception as e:
                self.app.call_from_thread(self._log, f"[red]✗ Failed to start daemon:[/red] {e}")
                return
        else:
            # Daemon running — send restart command via command file
            try:
                CMD_PATH.parent.mkdir(parents=True, exist_ok=True)
                CMD_PATH.write_text(f"restart:{name}\n")
                self.app.call_from_thread(
                    self._log,
                    f"[green]✓[/green] Restarting [cyan]{name}[/cyan] via daemon",
                )
            except Exception as e:
                self.app.call_from_thread(self._log, f"[red]✗ Failed to restart:[/red] {e}")
                return
        import time
        time.sleep(5)
        self.app.call_from_thread(self._refresh_table)
        # Check if agent actually started — show daemon log errors if not
        self._check_agent_started(name)

    def _check_agent_started(self, name: str) -> None:
        """Check if agent came online; if not, surface daemon log errors."""
        from openagents.client.daemon_config import read_status, LOG_PATH

        status = read_status() or {}
        agent_info = status.get("agents", {}).get(name, {})
        state = agent_info.get("state", "stopped")

        if state in ("online", "starting", "reconnecting"):
            return  # Agent is fine

        # Agent didn't start — check for last_error in status
        last_err = agent_info.get("last_error", "")
        if last_err:
            self.app.call_from_thread(
                self._log,
                f"[red]✗ {name} failed:[/red] {last_err}",
            )
            return

        # No error in status — tail the daemon log for clues
        try:
            if LOG_PATH.exists():
                text = LOG_PATH.read_text(encoding="utf-8", errors="replace")
                # Find last error/warning lines mentioning this agent or general errors
                lines = text.splitlines()
                error_lines = []
                for line in reversed(lines):
                    if len(error_lines) >= 3:
                        break
                    stripped = line.strip()
                    if not stripped:
                        continue
                    low = stripped.lower()
                    if "error" in low or "failed" in low or "crash" in low:
                        error_lines.append(stripped)
                if error_lines:
                    error_lines.reverse()
                    for line in error_lines:
                        self.app.call_from_thread(
                            self._log,
                            f"[red]daemon:[/red] {line[:200]}",
                        )
                else:
                    self.app.call_from_thread(
                        self._log,
                        f"[yellow]{name} not started yet — check daemon log for details[/yellow]",
                    )
        except Exception:
            self.app.call_from_thread(
                self._log,
                f"[yellow]{name} not started yet — check daemon log for details[/yellow]",
            )

    # -- Stop --

    def action_stop_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to stop[/yellow]")
            return
        name = agent["name"]
        self._log(f"Stopping [cyan]{name}[/cyan]…")
        self._do_stop(name)

    @work(thread=True)
    def _do_stop(self, name: str) -> None:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "openagents.client.cli", "stop", name],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                self.app.call_from_thread(self._log, f"[green]✓[/green] Stopped [cyan]{name}[/cyan]")
            else:
                err = result.stderr.strip()[:200] if result.stderr else result.stdout.strip()[:200]
                self.app.call_from_thread(self._log, f"[red]✗ Stop failed:[/red] {err}")
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Stop error:[/red] {e}")
        import time
        time.sleep(1)
        self.app.call_from_thread(self._refresh_table)

    # -- Remove --

    def action_remove_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to remove[/yellow]")
            return
        name = agent["name"]
        self._log(f"Removing [cyan]{name}[/cyan]…")
        self._do_remove(name)

    @work(thread=True)
    def _do_remove(self, name: str) -> None:
        import time
        from openagents.client.daemon_config import (
            disconnect_agent_from_network,
            load_config,
            remove_agent_from_config,
        )

        # Check if agent is connected to a workspace — disconnect first
        cfg = load_config()
        agent_cfg = next((a for a in cfg.agents if a.name == name), None)
        if agent_cfg and agent_cfg.network:
            self.app.call_from_thread(
                self._log, f"Disconnecting [cyan]{name}[/cyan] from workspace…"
            )
            disconnect_agent_from_network(name)
            self._signal_daemon_reload()

        # Stop the agent if daemon is running
        from openagents.client.daemon import read_daemon_pid

        pid = read_daemon_pid()
        if pid:
            self.app.call_from_thread(self._log, f"Stopping [cyan]{name}[/cyan]…")
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "openagents.client.cli", "stop", name],
                    capture_output=True, text=True, timeout=30,
                )
                if result.returncode == 0:
                    self.app.call_from_thread(
                        self._log, f"[green]✓[/green] Stopped [cyan]{name}[/cyan]"
                    )
                    time.sleep(1)
            except Exception:
                pass

        # Remove from config
        if remove_agent_from_config(name):
            self.app.call_from_thread(
                self._log, f"[green]✓[/green] Removed [cyan]{name}[/cyan] from config"
            )
        else:
            self.app.call_from_thread(
                self._log, f"[red]✗ Agent '{name}' not found in config[/red]"
            )
        self.app.call_from_thread(self._refresh_table)

    # -- Connect --

    def action_connect_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to connect[/yellow]")
            return
        self.push_screen(
            ConnectWorkspaceScreen(agent["name"]),
            callback=self._on_connect_picked,
        )

    def _on_connect_picked(self, result: dict | None) -> None:
        if not result:
            return
        action = result["action"]
        agent_name = result["agent"]

        if action.startswith("existing:"):
            slug = action.split(":", 1)[1]
            from openagents.client.daemon_config import connect_agent_to_network, load_config

            connect_agent_to_network(agent_name, slug)
            self._signal_daemon_reload()
            cfg = load_config()
            net = next((n for n in cfg.networks if (n.slug or n.id) == slug), None)
            url = self._workspace_url(net) if net else slug
            self._log(f"[green]✓[/green] Connected [cyan]{agent_name}[/cyan] → {url}")
            self._refresh_table()

        elif action == ConnectWorkspaceScreen._ACTION_CREATE:
            self.push_screen(
                TextInputScreen("Workspace name", default=f"{agent_name}'s workspace"),
                callback=lambda name: self._on_create_workspace(agent_name, name),
            )

        elif action == ConnectWorkspaceScreen._ACTION_TOKEN:
            self.push_screen(
                TokenInputScreen(),
                callback=lambda token: self._on_join_token(agent_name, token),
            )

    def _on_create_workspace(self, agent_name: str, ws_name: str | None) -> None:
        if not ws_name:
            return
        self._log(f"Creating workspace [bold]{ws_name}[/bold]…")
        self._do_create_workspace(agent_name, ws_name)

    @work(thread=True)
    def _do_create_workspace(self, agent_name: str, ws_name: str) -> None:
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "openagents.client.cli",
                    "workspace", "create", "--name", ws_name,
                ],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                # Re-load config to find the newly created network
                from openagents.client.daemon_config import (
                    connect_agent_to_network,
                    load_config,
                )

                cfg = load_config()
                if cfg.networks:
                    last_net = cfg.networks[-1]
                    connect_agent_to_network(agent_name, last_net.slug or last_net.id)
                    self._signal_daemon_reload()
                    url = self._workspace_url(last_net)
                    self.app.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Created & connected → {url}",
                    )
                else:
                    self.app.call_from_thread(
                        self._log, "[green]✓[/green] Workspace created"
                    )
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.app.call_from_thread(self._log, f"[red]✗ Create failed:[/red] {err}")
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        self.app.call_from_thread(self._refresh_table)

    def _on_join_token(self, agent_name: str, token: str | None) -> None:
        if not token:
            return
        self._log(f"Joining workspace with token…")
        self._do_join_token(agent_name, token)

    @work(thread=True)
    def _do_join_token(self, agent_name: str, token: str) -> None:
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "openagents.client.cli",
                    "workspace", "join", token,
                ],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                from openagents.client.daemon_config import (
                    connect_agent_to_network,
                    load_config,
                )

                cfg = load_config()
                if cfg.networks:
                    last_net = cfg.networks[-1]
                    connect_agent_to_network(agent_name, last_net.slug or last_net.id)
                    self._signal_daemon_reload()
                    url = self._workspace_url(last_net)
                    self.app.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Joined & connected [cyan]{agent_name}[/cyan] → {url}",
                    )
                else:
                    self.app.call_from_thread(
                        self._log,
                        f"[green]✓[/green] Joined & connected [cyan]{agent_name}[/cyan]",
                    )
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.app.call_from_thread(self._log, f"[red]✗ Join failed:[/red] {err}")
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        self.app.call_from_thread(self._refresh_table)

    # -- Disconnect --

    def action_disconnect_agent(self) -> None:
        agent = self._selected_agent()
        if not agent:
            self._log("[yellow]Select an agent to disconnect[/yellow]")
            return
        name = agent["name"]
        from openagents.client.daemon_config import disconnect_agent_from_network

        if disconnect_agent_from_network(name):
            self._signal_daemon_reload()
            self._log(f"[green]✓[/green] Disconnected [cyan]{name}[/cyan]")
        else:
            self._log(f"[red]✗ Agent '{name}' not found[/red]")
        self._refresh_table()

    # -- Daemon up/down --

    def action_daemon_toggle(self) -> None:
        """Start daemon if not running, stop it (with confirmation) if running."""
        from openagents.client.daemon import read_daemon_pid
        pid = read_daemon_pid()
        if pid:
            self._confirm_daemon_down()
        else:
            self.action_daemon_up()

    def _confirm_daemon_down(self) -> None:
        """Ask for confirmation before stopping the daemon."""
        self.push_screen(
            TextInputScreen(
                "Stop daemon? This will disconnect ALL agents.\n"
                "Type 'yes' to confirm:",
                "Confirm Daemon Stop",
            ),
            callback=self._on_daemon_down_confirmed,
        )

    def _on_daemon_down_confirmed(self, result: str | None) -> None:
        if result and result.strip().lower() == "yes":
            self.action_daemon_down()
        else:
            self._log("[dim]Daemon stop cancelled[/dim]")

    def action_daemon_up(self) -> None:
        self._log("Starting daemon…")
        self._do_daemon_up()

    @work(thread=True)
    def _do_daemon_up(self) -> None:
        try:
            if sys.platform == "win32":
                # On Windows+SSH, DETACHED_PROCESS and CREATE_NEW_PROCESS_GROUP
                # cause children to die immediately.  Start the daemon as a
                # plain child process with no special flags — it stays alive as
                # long as the TUI (its parent) is alive, which is exactly what
                # we want for the interactive TUI session.
                from openagents.client.daemon import LOG_PATH, PID_PATH
                LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
                log_file = open(LOG_PATH, "a")
                self._daemon_proc = subprocess.Popen(
                    [sys.executable, "-m", "openagents", "up", "--foreground"],
                    stdout=log_file,
                    stderr=log_file,
                    stdin=subprocess.DEVNULL,
                )
                PID_PATH.write_text(str(self._daemon_proc.pid))
            else:
                subprocess.Popen(
                    [sys.executable, "-m", "openagents.client.cli", "up"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            self.app.call_from_thread(self._log, "[green]✓[/green] Daemon starting…")
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Failed:[/red] {e}")
            return
        import time
        time.sleep(5)
        self.app.call_from_thread(self._refresh_table)
        # Check if any configured agents failed to start
        from openagents.client.daemon_config import load_config
        cfg = load_config()
        for agent in cfg.agents:
            if agent.network:  # only check network agents
                self._check_agent_started(agent.name)

    def action_daemon_down(self) -> None:
        self._log("Stopping daemon…")
        self._do_daemon_down()

    @work(thread=True)
    def _do_daemon_down(self) -> None:
        try:
            result = subprocess.run(
                [sys.executable, "-m", "openagents.client.cli", "down"],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0:
                self.app.call_from_thread(self._log, "[green]✓[/green] Daemon stopped")
            else:
                err = (result.stderr or result.stdout).strip()[:200]
                self.app.call_from_thread(self._log, f"[yellow]⚠ {err}[/yellow]")
        except Exception as e:
            self.app.call_from_thread(self._log, f"[red]✗ Error:[/red] {e}")
        import time
        time.sleep(1)
        self.app.call_from_thread(self._refresh_table)


# ── Entry point ─────────────────────────────────────────────────────────────


def launch_tui() -> None:
    """Launch the interactive TUI dashboard."""
    app = OpenAgentsTUI()
    app.run()
