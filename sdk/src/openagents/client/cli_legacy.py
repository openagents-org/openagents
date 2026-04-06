"""CLI legacy adapter commands — connect-legacy claude/openclaw/codex + account commands."""

import asyncio
import json
import logging
import os
import socket
import sys
import webbrowser
from pathlib import Path
from typing import List, Optional

import requests
import typer
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console

connect_legacy_app = typer.Typer(
    name="connect-legacy",
    help="[deprecated] Use 'create' + 'connect' instead. One-shot agent connection.",
    rich_markup_mode="rich",
    hidden=True,
)
app.add_typer(connect_legacy_app, name="connect-legacy")


@connect_legacy_app.command("claude")
def connect_claude(
    api_key: str = typer.Option(
        None, "--api-key", envvar="OA_API_KEY",
        help="OpenAgents API key (oa-xxxxx)",
    ),
    name: Optional[str] = typer.Option(
        None, "--name",
        help="Custom agent name (default: auto-generated)",
    ),
    workspace_name: Optional[str] = typer.Option(
        None, "--workspace-name",
        help="Custom workspace name",
    ),
    join: Optional[str] = typer.Option(
        None, "--join",
        help="Join existing workspace (ID or slug)",
    ),
    token: Optional[str] = typer.Option(
        None, "--token",
        help="Workspace token (required with --join)",
    ),
    channel: Optional[str] = typer.Option(
        None, "--channel",
        help="Channel name to listen on (default: first channel)",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
    disable_files: bool = typer.Option(
        False, "--disable-files", help="Disable shared file tools for this agent",
    ),
    disable_browser: bool = typer.Option(
        False, "--disable-browser", help="Disable shared browser tools for this agent",
    ),
    save: bool = typer.Option(
        False, "--save", help="Save this connection to daemon config (~/.openagents/daemon.yaml)",
    ),
):
    """Connect Claude Code to an OpenAgents workspace."""
    import asyncio
    from openagents.client.workspace_client import (
        WorkspaceClient, get_identity, save_identity,
        generate_agent_name, LocalAgentIdentity, _load_identities,
    )

    # Resolve API key: flag > env > stored (optional for workspace)
    if not api_key:
        data = _load_identities()
        api_key = data.get("api_key")

    # Get or create agent identity
    identity = get_identity("claude")
    if identity and not name:
        agent_name = identity.agent_name
        console.print(f"Using saved identity: [cyan]{agent_name}[/cyan]")
    else:
        agent_name = name or generate_agent_name("claude")
        console.print(f"Creating agent: [cyan]{agent_name}[/cyan]")

    async def _run():
        client = WorkspaceClient(endpoint=endpoint)

        # Step 1: Register agent (anonymous if no API key)
        with console.status("Registering agent..."):
            try:
                result = await client.register_agent(
                    agent_name, api_key,
                    origin="cli",
                )
                if result.get("already_exists"):
                    console.print(
                        f"Agent [cyan]{agent_name}[/cyan] already registered"
                    )
                else:
                    console.print(
                        f"[green]Agent registered:[/green] {agent_name}"
                    )
                # Save identity — use api_key from registration or keep existing
                new_api_key = (
                    result.get("api_key")
                    or (result.get("data") or {}).get("api_key")
                    or (identity.api_key if identity else None)
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="claude",
                    api_key=new_api_key,
                ))
            except Exception as e:
                # Registration is optional — workspace backend may not have
                # the /v1/agentid/register endpoint (self-hosted mode).
                logging.debug(f"Registration skipped: {e}")
                console.print(
                    f"[dim]Registration skipped (not required for workspace)[/dim]"
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="claude",
                    api_key=identity.api_key if identity else None,
                ))

        # Step 2: Create or join workspace
        if join:
            # Join an existing workspace
            ws_token = token
            if not ws_token:
                console.print("[red]--token is required when using --join[/red]")
                raise typer.Exit(1)

            with console.status("Joining workspace..."):
                try:
                    join_result = await client.join_network(
                        agent_name=agent_name,
                        network=join,
                        token=ws_token,
                        agent_type="claude",
                        server_host=socket.gethostname(),
                        working_dir=os.getcwd(),
                    )
                    ws_id = join_result.get("network_id", join)
                    console.print(
                        f"[green]Joined workspace:[/green] {ws_id}"
                    )
                except Exception as e:
                    console.print(f"[red]Failed to join workspace: {e}[/red]")
                    raise typer.Exit(1)

            # Discover channels — only rejoin channels where this agent is already a participant
            channel_name = channel
            my_channels: list[str] = []
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{endpoint}/v1/discover",
                        params={"network": ws_id},
                        headers={"X-Workspace-Token": ws_token},
                    ) as resp:
                        disc = await resp.json()
                        channels_data = (disc.get("data") or disc).get("channels", [])
                        for ch in channels_data:
                            ch_name = ch["address"].replace("channel/", "")
                            participants = ch.get("participants") or []
                            if agent_name in participants:
                                my_channels.append(ch_name)
                        if not channel_name:
                            channel_name = my_channels[0] if my_channels else (
                                channels_data[0]["address"].replace("channel/", "") if channels_data else "general"
                            )
            except Exception:
                if not channel_name:
                    channel_name = "general"

            console.print(f"Listening on [cyan]{len(my_channels) or 1}[/cyan] channel(s)")

            # Rejoin channels where this agent is a participant
            try:
                import aiohttp
                channels_to_join = my_channels if my_channels else [channel_name]
                async with aiohttp.ClientSession() as session:
                    for ch in channels_to_join:
                        try:
                            async with session.post(
                                f"{endpoint}/v1/events",
                                json={
                                    "type": "network.channel.join",
                                    "source": f"openagents:{agent_name}",
                                    "target": "core",
                                    "payload": {
                                        "channel": ch,
                                        "agent_name": agent_name,
                                    },
                                    "network": ws_id,
                                },
                                headers={
                                    "X-Workspace-Token": ws_token,
                                    "Content-Type": "application/json",
                                },
                            ) as resp:
                                pass
                        except Exception:
                            pass
            except Exception:
                pass

            ws_workspace_id = ws_id
            ws_channel = channel_name
            ws_tok = ws_token
        else:
            # Create a new workspace
            with console.status("Creating workspace..."):
                try:
                    ws = await client.create_workspace(agent_name, workspace_name, agent_type="claude")
                    console.print(f"[green]Workspace created:[/green] {ws.name}")
                    console.print(
                        f"[bold]URL:[/bold] [link={ws.url}]{ws.url}[/link]"
                    )
                except Exception as e:
                    console.print(f"[red]Workspace creation failed: {e}[/red]")
                    raise typer.Exit(1)

            ws_workspace_id = ws.workspace_id
            ws_channel = ws.channel_name
            ws_tok = ws.token

        # Save to daemon config if requested
        if save:
            from openagents.client.daemon_config import (
                NetworkEntry, AgentEntry,
                add_network_to_config, add_agent_to_config,
            )
            net_entry = NetworkEntry(
                id=ws_workspace_id,
                slug=join or ws_workspace_id,
                name=workspace_name or ws_workspace_id,
                token=ws_tok,
                endpoint=endpoint,
            )
            add_network_to_config(net_entry)
            net_ref = net_entry.slug or net_entry.id
            add_agent_to_config(AgentEntry(
                name=agent_name, type="claude", role="master",
                network=net_ref,
                options={
                    k: v for k, v in {
                        "disable_files": disable_files or None,
                        "disable_browser": disable_browser or None,
                    }.items() if v
                },
            ))
            console.print(
                "[green]Saved to daemon config.[/green] "
                "Next time: [bold]openagents up[/bold]"
            )

        # Step 3: Start adapter
        console.print(
            f"\n[bold green]Agent is online![/bold green] "
            f"Waiting for messages..."
        )
        console.print("[dim]Press Ctrl+C to disconnect[/dim]\n")

        from openagents.adapters.claude import ClaudeAdapter
        disabled_modules: set = set()
        if disable_files:
            disabled_modules.add("files")
        if disable_browser:
            disabled_modules.add("browser")
        adapter = ClaudeAdapter(
            workspace_id=ws_workspace_id,
            channel_name=ws_channel,
            token=ws_tok,
            agent_name=agent_name,
            endpoint=endpoint,
            disabled_modules=disabled_modules or None,
        )
        await adapter.run()

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Disconnected.[/yellow]")


@connect_legacy_app.command("openclaw")
def connect_openclaw(
    api_key: str = typer.Option(
        None, "--api-key", envvar="OA_API_KEY",
        help="OpenAgents API key (oa-xxxxx)",
    ),
    name: Optional[str] = typer.Option(
        None, "--name",
        help="Custom agent name (default: auto-generated)",
    ),
    workspace_name: Optional[str] = typer.Option(
        None, "--workspace-name",
        help="Custom workspace name",
    ),
    join: Optional[str] = typer.Option(
        None, "--join",
        help="Join existing workspace (ID or slug)",
    ),
    token: Optional[str] = typer.Option(
        None, "--token",
        help="Workspace token (required with --join)",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
    openclaw_host: str = typer.Option(
        "127.0.0.1", "--openclaw-host",
        help="OpenClaw Gateway host",
    ),
    openclaw_port: int = typer.Option(
        18789, "--openclaw-port",
        help="OpenClaw Gateway port",
    ),
    openclaw_token: Optional[str] = typer.Option(
        None, "--openclaw-token", envvar="OPENCLAW_TOKEN",
        help="OpenClaw Gateway auth token",
    ),
    openclaw_agent_id: str = typer.Option(
        "main", "--openclaw-agent-id",
        help="OpenClaw agent ID to use",
    ),
    disable_files: bool = typer.Option(
        False, "--disable-files", help="Disable shared file tools for this agent",
    ),
    disable_browser: bool = typer.Option(
        False, "--disable-browser", help="Disable shared browser tools for this agent",
    ),
    save: bool = typer.Option(
        False, "--save", help="Save this connection to daemon config (~/.openagents/daemon.yaml)",
    ),
):
    """Connect OpenClaw to an OpenAgents workspace."""
    import asyncio
    from openagents.client.workspace_client import (
        WorkspaceClient, get_identity, save_identity,
        generate_agent_name, LocalAgentIdentity, _load_identities,
    )

    # Resolve API key: flag > env > stored (optional for workspace)
    if not api_key:
        data = _load_identities()
        api_key = data.get("api_key")

    # Get or create agent identity
    identity = get_identity("openclaw")
    if identity and not name:
        agent_name = identity.agent_name
        console.print(f"Using saved identity: [cyan]{agent_name}[/cyan]")
    else:
        agent_name = name or generate_agent_name("openclaw")
        console.print(f"Creating agent: [cyan]{agent_name}[/cyan]")

    async def _run():
        client = WorkspaceClient(endpoint=endpoint)

        # Step 0: Check OpenClaw Gateway is reachable
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                url = f"http://{openclaw_host}:{openclaw_port}"
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    console.print(
                        f"[green]OpenClaw Gateway reachable[/green] "
                        f"at {openclaw_host}:{openclaw_port}"
                    )
        except Exception:
            console.print(
                f"[red]Cannot reach OpenClaw Gateway at "
                f"{openclaw_host}:{openclaw_port}[/red]"
            )
            console.print(
                "Make sure OpenClaw is running: "
                "[bold]openclaw gateway start[/bold]"
            )
            raise typer.Exit(1)

        # Step 1: Register agent
        with console.status("Registering agent..."):
            try:
                result = await client.register_agent(
                    agent_name, api_key,
                    origin="cli",
                )
                if result.get("already_exists"):
                    console.print(
                        f"Agent [cyan]{agent_name}[/cyan] already registered"
                    )
                else:
                    console.print(
                        f"[green]Agent registered:[/green] {agent_name}"
                    )
                new_api_key = (
                    result.get("api_key")
                    or (result.get("data") or {}).get("api_key")
                    or (identity.api_key if identity else None)
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="openclaw",
                    api_key=new_api_key,
                ))
            except Exception as e:
                logging.debug(f"Registration skipped: {e}")
                console.print(
                    f"[dim]Registration skipped (not required for workspace)[/dim]"
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="openclaw",
                    api_key=identity.api_key if identity else None,
                ))

        # Step 2: Create or join workspace
        if join:
            if not token:
                console.print("[red]--token is required when using --join[/red]")
                raise typer.Exit(1)

            with console.status("Joining workspace..."):
                try:
                    join_result = await client.join_network(
                        agent_name=agent_name,
                        network=join,
                        token=token,
                        agent_type="openclaw",
                        server_host=socket.gethostname(),
                        working_dir=os.getcwd(),
                    )
                    ws_id = join_result.get("network_id", join)
                    console.print(f"[green]Joined workspace:[/green] {ws_id}")
                except Exception as e:
                    console.print(f"[red]Join failed: {e}[/red]")
                    raise typer.Exit(1)

            # Discover channels
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{endpoint}/v1/discover",
                        params={"network": ws_id},
                        headers={"X-Workspace-Token": token},
                    ) as resp:
                        disc = await resp.json()
                        channels = (disc.get("data") or disc).get("channels", [])
                        if channels:
                            ws_channel = channels[0]["address"].replace("channel/", "")
                        else:
                            ws_channel = "general"
            except Exception:
                ws_channel = "general"

            # Join the channel
            try:
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        f"{endpoint}/v1/events",
                        json={
                            "type": "network.channel.join",
                            "source": f"openagents:{agent_name}",
                            "target": "core",
                            "payload": {"channel": ws_channel, "agent_name": agent_name},
                            "network": ws_id,
                        },
                        headers={"X-Workspace-Token": token, "Content-Type": "application/json"},
                    ) as resp:
                        pass
            except Exception:
                pass

            ws_workspace_id = ws_id
            ws_tok = token
        else:
            with console.status("Creating workspace..."):
                try:
                    ws = await client.create_workspace(agent_name, workspace_name, agent_type="openclaw")
                    console.print(f"[green]Workspace created:[/green] {ws.name}")
                    console.print(
                        f"[bold]URL:[/bold] [link={ws.url}]{ws.url}[/link]"
                    )
                except Exception as e:
                    console.print(f"[red]Workspace creation failed: {e}[/red]")
                    raise typer.Exit(1)

            ws_workspace_id = ws.workspace_id
            ws_channel = ws.channel_name
            ws_tok = ws.token

        # Save to daemon config if requested
        if save:
            from openagents.client.daemon_config import (
                NetworkEntry, AgentEntry,
                add_network_to_config, add_agent_to_config,
            )
            net_entry = NetworkEntry(
                id=ws_workspace_id,
                slug=join or ws_workspace_id,
                name=workspace_name or ws_workspace_id,
                token=ws_tok,
                endpoint=endpoint,
            )
            add_network_to_config(net_entry)
            net_ref = net_entry.slug or net_entry.id
            add_agent_to_config(AgentEntry(
                name=agent_name, type="openclaw", role="worker",
                network=net_ref,
                options={
                    k: v for k, v in {
                        "openclaw_host": openclaw_host if openclaw_host != "127.0.0.1" else None,
                        "openclaw_port": openclaw_port if openclaw_port != 18789 else None,
                        "openclaw_token": openclaw_token,
                        "openclaw_agent_id": openclaw_agent_id if openclaw_agent_id != "main" else None,
                    }.items() if v
                },
            ))
            console.print(
                "[green]Saved to daemon config.[/green] "
                "Next time: [bold]openagents up[/bold]"
            )

        # Step 3: Start adapter
        console.print(
            f"\n[bold green]Agent is online![/bold green] "
            f"Waiting for messages..."
        )
        console.print("[dim]Press Ctrl+C to disconnect[/dim]\n")

        from openagents.adapters.openclaw import OpenClawAdapter
        disabled_modules = set()
        if disable_files:
            disabled_modules.add("files")
        if disable_browser:
            disabled_modules.add("browser")
        adapter = OpenClawAdapter(
            workspace_id=ws_workspace_id,
            channel_name=ws_channel,
            token=ws_tok,
            agent_name=agent_name,
            endpoint=endpoint,
            openclaw_host=openclaw_host,
            openclaw_port=openclaw_port,
            openclaw_token=openclaw_token,
            openclaw_agent_id=openclaw_agent_id,
            disabled_modules=disabled_modules,
        )
        await adapter.run()

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Disconnected.[/yellow]")


@connect_legacy_app.command("codex")
def connect_codex(
    api_key: str = typer.Option(
        None, "--api-key", envvar="OA_API_KEY",
        help="OpenAgents API key (oa-xxxxx)",
    ),
    name: Optional[str] = typer.Option(
        None, "--name",
        help="Custom agent name (default: auto-generated)",
    ),
    workspace_name: Optional[str] = typer.Option(
        None, "--workspace-name",
        help="Custom workspace name",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
    disable_files: bool = typer.Option(
        False, "--disable-files", help="Disable shared file tools for this agent",
    ),
    disable_browser: bool = typer.Option(
        False, "--disable-browser", help="Disable shared browser tools for this agent",
    ),
    save: bool = typer.Option(
        False, "--save", help="Save this connection to daemon config (~/.openagents/daemon.yaml)",
    ),
):
    """Connect OpenAI Codex CLI to an OpenAgents workspace."""
    import asyncio
    from openagents.client.workspace_client import (
        WorkspaceClient, get_identity, save_identity,
        generate_agent_name, LocalAgentIdentity, _load_identities,
    )

    # Resolve API key: flag > env > stored (optional for workspace)
    if not api_key:
        data = _load_identities()
        api_key = data.get("api_key")

    # Check codex CLI is installed
    if not shutil.which("codex"):
        console.print(
            "[red]Error: codex CLI not found.[/red]"
        )
        console.print(
            "Install with: [bold]npm install -g @openai/codex[/bold]"
        )
        raise typer.Exit(1)

    # Check Codex auth (CODEX_API_KEY or OPENAI_API_KEY)
    if not (os.environ.get("CODEX_API_KEY")
            or os.environ.get("OPENAI_API_KEY")):
        console.print(
            "[yellow]Warning: No CODEX_API_KEY or OPENAI_API_KEY "
            "env var found.[/yellow]"
        )
        console.print(
            "Codex needs one of these for API access, or use "
            "'codex login' for ChatGPT auth."
        )

    # Get or create agent identity
    identity = get_identity("codex")
    if identity and not name:
        agent_name = identity.agent_name
        console.print(f"Using saved identity: [cyan]{agent_name}[/cyan]")
    else:
        agent_name = name or generate_agent_name("codex")
        console.print(f"Creating agent: [cyan]{agent_name}[/cyan]")

    async def _run():
        client = WorkspaceClient(endpoint=endpoint)

        # Step 1: Register agent
        with console.status("Registering agent..."):
            try:
                result = await client.register_agent(
                    agent_name, api_key,
                    origin="cli",
                )
                if result.get("already_exists"):
                    console.print(
                        f"Agent [cyan]{agent_name}[/cyan] already registered"
                    )
                else:
                    console.print(
                        f"[green]Agent registered:[/green] {agent_name}"
                    )
                new_api_key = (
                    result.get("api_key")
                    or (result.get("data") or {}).get("api_key")
                    or (identity.api_key if identity else None)
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="codex",
                    api_key=new_api_key,
                ))
            except Exception as e:
                logging.debug(f"Registration skipped: {e}")
                console.print(
                    f"[dim]Registration skipped (not required for workspace)[/dim]"
                )
                save_identity(LocalAgentIdentity(
                    agent_name=agent_name,
                    agent_type="codex",
                    api_key=identity.api_key if identity else None,
                ))

        # Step 2: Create workspace
        with console.status("Creating workspace..."):
            try:
                ws = await client.create_workspace(agent_name, workspace_name, agent_type="codex")
                console.print(f"[green]Workspace created:[/green] {ws.name}")
                console.print(
                    f"[bold]URL:[/bold] [link={ws.url}]{ws.url}[/link]"
                )
            except Exception as e:
                console.print(f"[red]Workspace creation failed: {e}[/red]")
                raise typer.Exit(1)

        # Save to daemon config if requested
        if save:
            from openagents.client.daemon_config import (
                NetworkEntry, AgentEntry,
                add_network_to_config, add_agent_to_config,
            )
            net_entry = NetworkEntry(
                id=ws.workspace_id,
                slug=ws.workspace_id,
                name=workspace_name or ws.name,
                token=ws.token,
                endpoint=endpoint,
            )
            add_network_to_config(net_entry)
            net_ref = net_entry.slug or net_entry.id
            add_agent_to_config(AgentEntry(
                name=agent_name, type="codex", role="worker",
                network=net_ref,
            ))
            console.print(
                "[green]Saved to daemon config.[/green] "
                "Next time: [bold]openagents up[/bold]"
            )

        # Step 3: Start adapter
        console.print(
            f"\n[bold green]Agent is online![/bold green] "
            f"Waiting for messages..."
        )
        console.print("[dim]Press Ctrl+C to disconnect[/dim]\n")

        from openagents.adapters.codex import CodexAdapter
        disabled_modules = set()
        if disable_files:
            disabled_modules.add("files")
        if disable_browser:
            disabled_modules.add("browser")
        adapter = CodexAdapter(
            workspace_id=ws.workspace_id,
            channel_name=ws.channel_name,
            token=ws.token,
            agent_name=agent_name,
            endpoint=endpoint,
            disabled_modules=disabled_modules,
        )
        await adapter.run()

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Disconnected.[/yellow]")


@app.command(name="invitations", rich_help_panel="Workspace")
def invitations_cmd(
    agent_type: str = typer.Argument(
        ..., help="Agent type to check invitations for (claude, codex, openclaw)",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
):
    """List pending workspace invitations for an agent."""
    import asyncio
    from openagents.client.workspace_client import WorkspaceClient, get_identity

    identity = get_identity(agent_type)
    if not identity:
        console.print(f"[yellow]No saved identity for '{agent_type}'.[/yellow]")
        console.print(f"Run 'openagents connect {agent_type}' first to create one.")
        raise typer.Exit(1)

    async def _run():
        client = WorkspaceClient(endpoint=endpoint)
        invitations = await client.check_invitations(identity.agent_name)
        if not invitations:
            console.print(f"No pending invitations for [cyan]{identity.agent_name}[/cyan]")
            return
        console.print(f"\nPending invitations for [cyan]{identity.agent_name}[/cyan]:\n")
        for inv in invitations:
            console.print(
                f"  Workspace: [bold]{inv.get('workspaceName', 'Unknown')}[/bold]"
            )
            console.print(f"  Token:     {inv['inviteToken']}")
            console.print(f"  Expires:   {inv.get('expiresAt', '?')}")
            console.print(
                f"  Accept:    [green]openagents join {inv['inviteToken']}[/green]\n"
            )

    asyncio.run(_run())


@app.command(name="join", rich_help_panel="Workspace")
def join_cmd(
    invite_token: str = typer.Argument(
        ..., help="Invitation token (inv_xxxxx)",
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
):
    """Accept a workspace invitation and print connection details."""
    import asyncio
    from openagents.client.workspace_client import WorkspaceClient

    async def _run():
        client = WorkspaceClient(endpoint=endpoint)
        try:
            result = await client.accept_invitation(invite_token)
        except ConnectionError as e:
            console.print(f"[red]{e}[/red]")
            raise typer.Exit(1)

        ws_slug = result.get("slug", result["workspaceId"])
        ws_name = result["workspaceName"]
        ws_token = result["workspaceToken"]
        agent = result["agent"]

        console.print(f"\n[green]Invitation accepted![/green]")
        console.print(f"  Workspace: [bold]{ws_name}[/bold]")
        console.print(f"  Agent:     {agent['agentName']} ({agent['role']})")
        console.print(
            f"  URL:       [link=https://workspace.openagents.org/{ws_slug}?token={ws_token}]"
            f"https://workspace.openagents.org/{ws_slug}?token={ws_token}[/link]"
        )

    asyncio.run(_run())


@app.command(name="login", rich_help_panel="Workspace")
def login_cmd(
    api_key: str = typer.Option(
        ..., "--api-key", prompt="Enter your OpenAgents API key",
        help="Your OpenAgents API key (oa-xxxxx)",
    ),
):
    """Store your OpenAgents API key for CLI use."""
    from openagents.client.workspace_client import _load_identities, _save_identities

    if not api_key.startswith("oa"):
        console.print(
            "[yellow]Warning: API key usually starts with 'oa-'[/yellow]"
        )

    data = _load_identities()
    data["api_key"] = api_key
    _save_identities(data)
    console.print("[green]API key saved.[/green]")
    console.print("[dim]Stored in ~/.openagents/identity.json[/dim]")


@app.command(name="rename", rich_help_panel="Identity")
def rename_cmd(
    new_name: str = typer.Argument(help="New agent name"),
    agent_type: str = typer.Option(
        "claude", "--type", help="Agent type to rename"
    ),
):
    """Rename your local agent identity."""
    from openagents.client.workspace_client import get_identity, save_identity

    identity = get_identity(agent_type)
    if not identity:
        console.print(
            f"[red]No identity found for agent type '{agent_type}'.[/red]"
        )
        console.print("Run 'openagents connect claude' first.")
        raise typer.Exit(1)

    old_name = identity.agent_name
    identity.agent_name = new_name
    save_identity(identity)
    console.print(f"[green]Renamed:[/green] {old_name} -> {new_name}")
    console.print(
        "[dim]Note: Server-side rename requires re-registration "
        "with 'openagents connect'.[/dim]"
    )


@app.command(name="mcp-server", rich_help_panel="SDK")
def mcp_server_cmd(
    workspace_id: str = typer.Option(
        ..., "--workspace-id", help="Workspace ID"
    ),
    channel_name: str = typer.Option(
        ..., "--channel-name", help="Channel name"
    ),
    agent_name: str = typer.Option(
        ..., "--agent-name", help="Agent name"
    ),
    endpoint: str = typer.Option(
        "https://workspace-endpoint.openagents.org", "--endpoint", envvar="OA_ENDPOINT",
        help="API endpoint URL",
    ),
    disable_files: bool = typer.Option(
        False, "--disable-files", help="Disable shared file tools",
    ),
    disable_browser: bool = typer.Option(
        False, "--disable-browser", help="Disable shared browser tools",
    ),
):
    """Run the OpenAgents workspace MCP server (stdio transport)."""
    import asyncio
    import os
    from openagents.mcp_server import run_mcp_server

    token = os.environ.get("OA_WORKSPACE_TOKEN", "")
    if not token:
        console.print(
            "[red]Error: OA_WORKSPACE_TOKEN environment variable required[/red]",
            file=sys.stderr,
        )
        raise typer.Exit(1)

    disabled_modules: set = set()
    if disable_files:
        disabled_modules.add("files")
    if disable_browser:
        disabled_modules.add("browser")

    asyncio.run(run_mcp_server(
        workspace_id=workspace_id,
        channel_name=channel_name,
        token=token,
        agent_name=agent_name,
        endpoint=endpoint,
        disabled_modules=disabled_modules or None,
    ))


# ============================================================================
# BANNER AND MAIN
# ============================================================================


