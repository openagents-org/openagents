"""CLI network commands — network start/init/list/interact/publish."""

import asyncio
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import typer
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console, OPENAGENTS_API_BASE
from openagents.client.cli_helpers import (
    connect_to_relay,
    initialize_workspace,
    is_localhost_or_private,
    parse_publish_to,
    publish_network_to_openagents,
    validate_api_key,
)
from openagents.launchers.network_launcher import launch_network
from openagents.launchers.terminal_console import launch_console

network_app = typer.Typer(
    name="network",
    help="\U0001f310 Network management commands",
    rich_markup_mode="rich",
)
app.add_typer(network_app, name="network")

@network_app.command("start")
def network_start(
    path: Optional[str] = typer.Argument(None, help="Path to network configuration file (.yaml) or workspace directory (default: ~/.openagents/network)"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory (deprecated: use positional argument)"),
    port: Optional[int] = typer.Option(None, "--port", "-p", help="Network port (overrides config)"),
    detach: bool = typer.Option(False, "--detach", "-d", help="Run in background"),
    runtime: Optional[int] = typer.Option(None, "--runtime", "-t", help="Runtime in seconds"),
    publish_to: Optional[str] = typer.Option(None, "--publish-to", help="Publish network to OpenAgents (e.g., 'my-network' or 'openagents://my-network'). Requires OPENAGENTS_API_KEY env var."),
    network_host: Optional[str] = typer.Option(None, "--network-host", help="External host for network discovery (default: auto-detect or use relay)"),
    network_port: Optional[int] = typer.Option(None, "--network-port", help="External port for network discovery (default: same as --port or config)"),
    description: Optional[str] = typer.Option(None, "--description", help="Network description for discovery listing"),
):
    """🚀 Start a network"""

    # Handle --publish-to option: validate API key first
    publish_config = None
    if publish_to:
        # Parse the network ID from the publish_to argument
        target_network_id = parse_publish_to(publish_to)

        # Check for API key
        api_key = os.environ.get("OPENAGENTS_API_KEY")
        if not api_key:
            console.print(Panel(
                "[red]❌ OPENAGENTS_API_KEY environment variable is required for publishing[/red]\n\n"
                "[bold cyan]💡 How to get an API key:[/bold cyan]\n"
                "1️⃣  Go to [link=https://openagents.org]openagents.org[/link]\n"
                "2️⃣  Sign in to your account\n"
                "3️⃣  Navigate to your organization settings\n"
                "4️⃣  Generate an API key\n"
                "5️⃣  Set it: [code]export OPENAGENTS_API_KEY=oa-your-key[/code]",
                title="[red]⚠️  Missing API Key[/red]",
                border_style="red"
            ))
            raise typer.Exit(1)

        # Validate the API key
        console.print("[blue]🔑 Validating API key...[/blue]")
        validation = validate_api_key(api_key)
        if not validation.get("valid"):
            console.print(Panel(
                f"[red]❌ Invalid API key: {validation.get('error', 'Unknown error')}[/red]\n\n"
                "[bold cyan]💡 Troubleshooting:[/bold cyan]\n"
                "1️⃣  Check that your API key is correct\n"
                "2️⃣  Ensure your API key has not expired\n"
                "3️⃣  Try generating a new key at [link=https://openagents.org]openagents.org[/link]",
                title="[red]⚠️  API Key Validation Failed[/red]",
                border_style="red"
            ))
            raise typer.Exit(1)

        org_name = validation.get("org_name", "Unknown")
        console.print(f"[green]✓ API key validated (Organization: {org_name})[/green]")

        # Store publish configuration for later use
        publish_config = {
            "network_id": target_network_id,
            "api_key": api_key,
            "network_host": network_host,
            "network_port": network_port,
            "org_name": org_name,
            "description": description,
        }

    # Use default workspace if no path provided
    if not path and not workspace:
        default_workspace = Path.home() / ".openagents" / "network"
        console.print(f"[blue]📁 Using default workspace: {default_workspace}[/blue]")

        # Initialize the workspace (creates it if needed, reuses if exists)
        try:
            initialize_workspace(default_workspace)
            path = str(default_workspace)
        except Exception as e:
            console.print(f"[red]❌ Failed to initialize default workspace: {e}[/red]")
            raise typer.Exit(1)

    # Show a simple startup message
    console.print(f"[blue]🚀 Starting OpenAgents network...[/blue]")
    if path:
        console.print(f"[dim]📁 Path: {path}[/dim]")
    if workspace:
        console.print(f"[dim]📂 Workspace: {workspace}[/dim]")
    console.print("[dim]Press Ctrl+C to stop[/dim]")
    console.print()  # Add blank line before network logs
    
    # Create error detection system with network status tracking
    class NetworkStatusHandler(logging.Handler):
        def __init__(self, console, publish_config=None):
            super().__init__()
            self.has_error = False
            self.error_messages = []
            self.error_displayed = False
            self.network_started = False
            self.network_host = None
            self.network_ports = []
            self.status_displayed = False
            self.console = console
            self.studio_enabled = False
            self.http_port = None
            self.publish_config = publish_config
            self.publish_completed = False
            
        def emit(self, record):
            message = record.getMessage()
            
            # Filter out noisy poll messages that appear every 2 seconds
            if any(pattern in message for pattern in [
                "🔧 POLL_MESSAGES:",
                "🔧 HTTP: Processing 0 polled messages",
                "🔧 HTTP: Successfully converted 0 messages",
                "/api/poll?agent_id=",
                "POLL_MESSAGES: Handler called for event: system.poll_messages",
                "POLL_MESSAGES: Requesting agent:",
                "POLL_MESSAGES: Serialized 0 messages",
                "POLL_MESSAGES: Sending response with 0 messages",
                "No secret found for agent",
                "Authentication failed for event from",
                "Poll messages request failed: Authentication failed",
                "GET /api/poll?agent_id=",
                "KeenHelper",  # Filter any messages related to KeenHelper agent
                "studio.openagents.org"  # Filter studio polling requests
            ]):
                return  # Don't process or display these messages
            
            if record.levelno >= logging.ERROR:
                self.has_error = True
                self.error_messages.append(message)
            elif "started successfully" in message:
                self.network_started = True
            elif "Studio frontend enabled" in message:
                self.studio_enabled = True
            elif "HTTP transport listening on" in message:
                # Extract HTTP port from message like "HTTP transport listening on 0.0.0.0:8700"
                import re
                match = re.search(r':(\d+)', message)
                if match:
                    self.http_port = match.group(1)
            elif "Starting heartbeat monitor" in message:
                # Show banner and status after network is fully started
                if not self.status_displayed and not self.has_error:
                    self.status_displayed = True
                    self.console.print()  # Add blank line
                    # Show banner
                    show_banner()
                    self.console.print()  # Add blank line

                    # Build status message
                    status_lines = [
                        "[bold green]✅ OpenAgents network is online[/bold green]"
                    ]
                    if self.studio_enabled and self.http_port:
                        studio_url = f"http://localhost:{self.http_port}/studio/"
                        status_lines.append(f"🎨 Studio: [link={studio_url}]{studio_url}[/link]")
                    status_lines.append("🔌 Check the logs above for host and port details")

                    self.console.print(Panel.fit(
                        "\n".join(status_lines),
                        border_style="green"
                    ))
                    self.console.print("[dim]Network is running... Press Ctrl+C to stop[/dim]")

                    # Handle publishing if configured
                    # Run in a separate thread to avoid blocking the asyncio event loop
                    # (requests.post is synchronous and would block the event loop if called directly)
                    if self.publish_config and not self.publish_completed and self.http_port:
                        threading.Thread(target=self._handle_publishing, daemon=True).start()

                    # Open browser if Studio is enabled
                    if self.studio_enabled and self.http_port:
                        studio_url = f"http://localhost:{self.http_port}/studio/"
                        self.console.print(f"\n[cyan]🌐 Opening Studio in browser...[/cyan]")
                        webbrowser.open(studio_url)
            elif "Transport" in record.getMessage() and ":" in record.getMessage():
                # Extract host:port from transport messages like "Transport TransportType.HTTP: 0.0.0.0:8702"
                message = record.getMessage()
                if ":" in message:
                    # Look for pattern like "0.0.0.0:8702" in the message
                    import re
                    match = re.search(r'(\d+\.\d+\.\d+\.\d+):(\d+)', message)
                    if match:
                        self.network_host = match.group(1)
                        port = match.group(2)
                        if port not in self.network_ports:
                            self.network_ports.append(port)
                        self._check_and_display_status()
                            
        def _check_and_display_status(self):
            # No longer used - status is displayed after heartbeat monitor starts
            pass

        def _handle_publishing(self):
            """Handle network publishing to OpenAgents after network starts."""
            if self.publish_completed or not self.publish_config:
                return

            self.publish_completed = True
            local_port = int(self.http_port)

            self.console.print()
            self.console.print("[blue]📡 Publishing network to OpenAgents...[/blue]")

            # Determine the host/port to publish
            publish_host = self.publish_config.get("network_host")
            publish_port = self.publish_config.get("network_port") or local_port
            relay_url = None
            use_relay = False

            # Check if we have a public host specified
            if publish_host and not is_localhost_or_private(publish_host):
                # User provided a public host
                self.console.print(f"[dim]Using specified host: {publish_host}:{publish_port}[/dim]")
            else:
                # Need to use relay - check if network host is localhost/private or not specified
                detected_host = self.network_host or "localhost"
                if is_localhost_or_private(detected_host) or not publish_host:
                    use_relay = True
                    self.console.print("[yellow]🔗 Network host is local, connecting to relay...[/yellow]")

                    # Connect to relay
                    relay_result = connect_to_relay(local_port, timeout=30)

                    if relay_result.get("success"):
                        relay_url = relay_result.get("relay_url")
                        self.console.print(f"[green]✓ Connected to relay: {relay_url}[/green]")

                        # Parse the relay URL to get host:port for publishing
                        try:
                            from urllib.parse import urlparse
                            parsed = urlparse(relay_url)
                            publish_host = parsed.hostname
                            publish_port = parsed.port or (443 if parsed.scheme == "https" else 80)
                        except Exception as e:
                            self.console.print(f"[red]❌ Failed to parse relay URL: {e}[/red]")
                            return
                    else:
                        self.console.print(Panel(
                            f"[red]❌ Failed to connect to relay: {relay_result.get('error')}[/red]\n\n"
                            "[bold cyan]💡 Options:[/bold cyan]\n"
                            "1️⃣  Ensure your network is publicly accessible\n"
                            "2️⃣  Use [code]--network-host[/code] to specify a public hostname\n"
                            "3️⃣  Try again later if relay is temporarily unavailable",
                            title="[red]⚠️  Relay Connection Failed[/red]",
                            border_style="red"
                        ))
                        return
                else:
                    publish_host = detected_host
                    self.console.print(f"[dim]Using detected host: {publish_host}:{publish_port}[/dim]")

            # Now publish to OpenAgents
            network_id = self.publish_config.get("network_id")
            api_key = self.publish_config.get("api_key")

            self.console.print(f"[dim]Publishing as: {network_id}[/dim]")

            # Try to fetch network profile from local health endpoint
            network_profile = None
            try:
                health_url = f"http://localhost:{local_port}/api/health"
                health_response = requests.get(health_url, timeout=5)
                if health_response.status_code == 200:
                    health_data = health_response.json()
                    if health_data.get("success") and health_data.get("data", {}).get("network_profile"):
                        network_profile = health_data["data"]["network_profile"]
                        self.console.print(f"[dim]Using network profile: {network_profile.get('name', network_id)}[/dim]")
            except Exception as e:
                self.console.print(f"[dim]Could not fetch network profile: {e}[/dim]")

            # Allow CLI --description to override network profile description
            cli_description = self.publish_config.get("description")
            if cli_description:
                if network_profile is None:
                    network_profile = {}
                network_profile["description"] = cli_description

            publish_result = publish_network_to_openagents(
                network_id=network_id,
                api_key=api_key,
                host=publish_host,
                port=publish_port,
                network_name=network_id,  # Fallback name
                relay_url=relay_url,
                network_profile=network_profile,
            )

            if publish_result.get("success"):
                # Build the discovery URL
                discovery_url = f"openagents://{network_id}"

                self.console.print()
                self.console.print(Panel.fit(
                    f"[bold green]✅ Network published successfully![/bold green]\n\n"
                    f"📡 Network ID: [code]{network_id}[/code]\n"
                    f"🔗 Discovery URL: [code]{discovery_url}[/code]\n"
                    f"🌐 Public endpoint: [code]{publish_host}:{publish_port}[/code]" +
                    (f"\n📶 Via relay: [code]{relay_url}[/code]" if relay_url else ""),
                    title="[green]🎉 Published to OpenAgents[/green]",
                    border_style="green"
                ))
            else:
                self.console.print(Panel(
                    f"[red]❌ Failed to publish: {publish_result.get('error')}[/red]\n\n"
                    "[bold cyan]💡 Troubleshooting:[/bold cyan]\n"
                    "1️⃣  Check that your API key is valid\n"
                    "2️⃣  Ensure the network ID is not already taken\n"
                    "3️⃣  Verify your network is accessible",
                    title="[red]⚠️  Publishing Failed[/red]",
                    border_style="red"
                ))

    # Create a filter to suppress noisy poll messages
    class PollMessageFilter(logging.Filter):
        def filter(self, record):
            message = record.getMessage()
            # Block noisy poll messages and repetitive event logs
            if any(pattern in message for pattern in [
                "🔧 POLL_MESSAGES:",
                "🔧 HTTP: Processing 0 polled messages", 
                "🔧 HTTP: Successfully converted 0 messages",
                "/api/poll?agent_id=",
                "POLL_MESSAGES: Handler called for event: system.poll_messages",
                "POLL_MESSAGES: Requesting agent:",
                "POLL_MESSAGES: Serialized 0 messages",
                "POLL_MESSAGES: Sending response with 0 messages",
                "No secret found for agent",
                "Authentication failed for event from",
                "Poll messages request failed: Authentication failed",
                "GET /api/poll?agent_id=",
                "KeenHelper",  # Filter any messages related to KeenHelper agent
                "studio.openagents.org",  # Filter studio polling requests
                "🔧 NETWORK: Processing regular event:",  # Filter repetitive network event processing logs
                "Agents to notify: set()",  # Filter empty agent notification logs
                "system.notification.register_agent"  # Filter agent registration notifications
            ]):
                return False  # Block these messages from being logged
            return True  # Allow other messages
    
    network_status = NetworkStatusHandler(console, publish_config=publish_config)
    root_logger = logging.getLogger()
    openagents_logger = logging.getLogger('openagents')
    
    # Add poll message filter to reduce noise
    poll_filter = PollMessageFilter()
    
    # Apply filter to all existing handlers on root logger
    root_logger.addFilter(poll_filter)
    for handler in root_logger.handlers:
        handler.addFilter(poll_filter)
    
    # Apply filter to openagents logger and its handlers
    openagents_logger.addFilter(poll_filter) 
    for handler in openagents_logger.handlers:
        handler.addFilter(poll_filter)
        
    # Also apply to any child loggers of openagents
    for name, logger in logging.Logger.manager.loggerDict.items():
        if isinstance(logger, logging.Logger) and name.startswith('openagents'):
            logger.addFilter(poll_filter)
            for handler in logger.handlers:
                handler.addFilter(poll_filter)
    
    # Add network status handler
    root_logger.addHandler(network_status)
    openagents_logger.addHandler(network_status)
    
    try:
        # Auto-detect whether path argument is a file or directory
        actual_config = None
        actual_workspace = workspace  # Keep existing --workspace flag for backward compatibility

        if path:
            path_obj = Path(path)
            if path_obj.is_file() and path_obj.suffix.lower() in ['.yaml', '.yml']:
                # It's a config file
                actual_config = path
            elif path_obj.is_dir():
                # It's a workspace directory
                actual_workspace = path
                actual_config = None
            else:
                # Handle error case
                console.print(f"[red]❌ Invalid path: {path} is neither a .yaml file nor a directory[/red]")
                raise typer.Exit(1)

        # Validate that workspace and path directory aren't both specified
        if workspace and actual_workspace and workspace != actual_workspace:
            console.print("[red]❌ Cannot specify both --workspace flag and workspace directory as positional argument[/red]")
            raise typer.Exit(1)

        # Launch the network directly (this handles its own logging and output)
        if actual_workspace or actual_config is None:
            launch_network(actual_config, runtime, actual_workspace)
        else:
            launch_network(actual_config, runtime)
            
        # Check for errors that were logged during startup (if network launcher returned)
        if network_status.has_error and not network_status.error_displayed:
            error_text = " ".join(network_status.error_messages).lower()
            network_status.error_displayed = True
            
            if "address already in use" in error_text or "errno 98" in error_text:
                # Extract port number from error message
                import re
                # Look for pattern like "('0.0.0.0', 8702)" or similar
                port_match = re.search(r"'[^']*',\s*(\d+)", error_text)
                if not port_match:
                    # Try alternative patterns
                    port_match = re.search(r"port['\s:]+(\d+)", error_text)
                
                port = port_match.group(1) if port_match else "8700"
                
                console.print(Panel(
                    "[red]❌ Network port is already occupied[/red]\n\n"
                    "The network could not start because another process is using the port.\n\n"
                    "[bold cyan]💡 Solutions:[/bold cyan]\n"
                    f"1️⃣  [bold]Stop conflicting process:[/bold] [code]sudo lsof -ti:{port} | xargs kill[/code]\n"
                    f"2️⃣  [bold]Check port usage:[/bold] [code]lsof -i:{port}[/code]\n"
                    "3️⃣  [bold]Edit config:[/bold] Change the port in your network configuration file\n"
                    f"4️⃣  [bold]Use different port:[/bold] Try a different port number (e.g., {int(port)+1}, {int(port)+2})",
                    title="[red]⚠️  Port Conflict Detected[/red]",
                    border_style="red"
                ))
            else:
                console.print(Panel(
                    "[red]❌ Network failed to start[/red]\n\n"
                    "The network encountered an error during startup.\n\n"
                    "[bold cyan]💡 Common issues & solutions:[/bold cyan]\n"
                    "1️⃣  [bold]Config error:[/bold] Verify your configuration file exists and is valid\n"
                    "2️⃣  [bold]Permission issue:[/bold] Check if you have permission to bind to the port\n"
                    "3️⃣  [bold]More details:[/bold] Run with [code]--verbose[/code] flag\n"
                    f"4️⃣  [bold]Error details:[/bold] {network_status.error_messages[0] if network_status.error_messages else 'Unknown error'}",
                    title="[red]⚠️  Network Startup Error[/red]",
                    border_style="red"
                ))
            raise typer.Exit(1)
            
    except KeyboardInterrupt:
        console.print("\n[yellow]⚠️  Network shutdown requested[/yellow]")
        raise typer.Exit(1)
    except Exception as e:
        error_msg = str(e)
        
        # Check if it's a port conflict error (only if not already displayed)
        if not network_status.error_displayed and ("address already in use" in error_msg.lower() or "errno 98" in error_msg.lower() or network_status.has_error):
            # Check for specific error patterns in logged messages
            error_text = " ".join(network_status.error_messages).lower()
            network_status.error_displayed = True
            
            if "address already in use" in error_text or "errno 98" in error_text:
                # Extract port number from error message
                import re
                # Look for pattern like "('0.0.0.0', 8702)" or similar
                port_match = re.search(r"'[^']*',\s*(\d+)", error_text)
                if not port_match:
                    # Try alternative patterns
                    port_match = re.search(r"port['\s:]+(\d+)", error_text)
                
                port = port_match.group(1) if port_match else "8700"
                
                console.print(Panel(
                    "[red]❌ Network port is already occupied[/red]\n\n"
                    "The network could not start because another process is using the port.\n\n"
                    "[bold cyan]💡 Solutions:[/bold cyan]\n"
                    f"1️⃣  [bold]Stop conflicting process:[/bold] [code]sudo lsof -ti:{port} | xargs kill[/code]\n"
                    f"2️⃣  [bold]Check port usage:[/bold] [code]lsof -i:{port}[/code]\n"
                    "3️⃣  [bold]Edit config:[/bold] Change the port in your network configuration file\n"
                    f"4️⃣  [bold]Use different port:[/bold] Try a different port number (e.g., {int(port)+1}, {int(port)+2})",
                    title="[red]⚠️  Port Conflict Detected[/red]",
                    border_style="red"
                ))
            else:
                console.print(Panel(
                    "[red]❌ Network failed to start[/red]\n\n"
                    "The network encountered an error during startup.\n\n"
                    "[bold cyan]💡 Common issues & solutions:[/bold cyan]\n"
                    "1️⃣  [bold]Config error:[/bold] Verify your configuration file exists and is valid\n"
                    "2️⃣  [bold]Permission issue:[/bold] Check if you have permission to bind to the port\n"
                    "3️⃣  [bold]More details:[/bold] Run with [code]--verbose[/code] flag\n"
                    f"4️⃣  [bold]Error details:[/bold] {network_status.error_messages[0] if network_status.error_messages else error_msg}",
                    title="[red]⚠️  Network Startup Error[/red]",
                    border_style="red"
                ))
        elif not network_status.error_displayed:
            console.print(f"[red]❌ Error starting network: {e}[/red]")
        
        raise typer.Exit(1)
        
    finally:
        # Clean up network status handler and filters
        root_logger.removeHandler(network_status)
        openagents_logger.removeHandler(network_status)
        
        # Remove filters from all loggers and handlers
        root_logger.removeFilter(poll_filter)
        for handler in root_logger.handlers:
            handler.removeFilter(poll_filter)
            
        openagents_logger.removeFilter(poll_filter)
        for handler in openagents_logger.handlers:
            handler.removeFilter(poll_filter)
            
        # Clean up child loggers 
        for name, logger in logging.Logger.manager.loggerDict.items():
            if isinstance(logger, logging.Logger) and name.startswith('openagents'):
                logger.removeFilter(poll_filter)
                for handler in logger.handlers:
                    handler.removeFilter(poll_filter)


@network_app.command("init")
def network_init(
    workspace_dir: str = typer.Argument(..., help="Directory name for the new workspace"),
    force: bool = typer.Option(False, "--force", "-f", help="Overwrite existing workspace"),
):
    """🛠️ Initialize a new workspace directory with default network.yaml"""
    
    workspace_path = Path(workspace_dir)
    
    # Check if directory already exists
    if workspace_path.exists() and not force:
        if workspace_path.is_dir() and any(workspace_path.iterdir()):
            console.print(f"[red]❌ Directory '{workspace_dir}' already exists and is not empty[/red]")
            console.print("[dim]Use --force to overwrite existing workspace[/dim]")
            raise typer.Exit(1)
        elif workspace_path.is_file():
            console.print(f"[red]❌ A file named '{workspace_dir}' already exists[/red]")
            raise typer.Exit(1)
    
    try:
        # Show initialization message
        console.print(f"[blue]🛠️ Initializing workspace in '{workspace_dir}'...[/blue]")
        
        # Use the existing initialize_workspace function
        config_path = initialize_workspace(workspace_path)
        
        # Success message
        console.print()
        console.print(Panel.fit(
            f"[bold green]✅ Workspace initialized successfully![/bold green]\n\n"
            f"📁 Location: [code]{workspace_path.absolute()}[/code]\n"
            f"📝 Config: [code]{config_path.name}[/code]\n\n"
            f"[bold cyan]Next steps:[/bold cyan]\n"
            f"1️⃣ Start the network: [code]openagents network start {workspace_dir}/[/code]\n"
            f"2️⃣ Edit the config: [code]{config_path}[/code]",
            border_style="green"
        ))
        
    except FileNotFoundError as e:
        console.print(f"[red]❌ Template not found: {e}[/red]")
        raise typer.Exit(1)
    except RuntimeError as e:
        console.print(f"[red]❌ Failed to initialize workspace: {e}[/red]")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]❌ Unexpected error: {e}[/red]")
        raise typer.Exit(1)


def discover_running_networks(
    ports: Optional[List[int]] = None,
    hosts: Optional[List[str]] = None,
    timeout: float = 1.0
) -> List[Dict[str, Any]]:
    """Discover running OpenAgents networks by scanning known ports.
    
    Args:
        ports: List of ports to scan. Defaults to common OpenAgents ports.
        hosts: List of hosts to scan. Defaults to localhost.
        timeout: Connection timeout in seconds.
        
    Returns:
        List of dictionaries containing network information for each discovered network.
    """
    import requests
    import re
    
    if ports is None:
        # Common OpenAgents network ports
        ports = [8700, 8570, 8050, 8600, 8701, 8702, 8703]
    
    if hosts is None:
        hosts = ["localhost", "127.0.0.1"]
    
    discovered_networks = []
    seen_networks = set()  # Track network_id to avoid duplicates
    
    for host in hosts:
        for port in ports:
            try:
                # Try to reach the health endpoint
                url = f"http://{host}:{port}/api/health"
                response = requests.get(url, timeout=timeout)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Check if this is a valid OpenAgents network response
                    if data.get("success") and "data" in data:
                        network_data = data["data"]
                        network_id = network_data.get("network_id", "unknown")
                        
                        # Skip if we've already found this network
                        if network_id in seen_networks:
                            continue
                        seen_networks.add(network_id)
                        
                        # Get process info for PID
                        pid = None
                        try:
                            if sys.platform.startswith("linux"):
                                # Use ss without filter and search for the port in output
                                result = subprocess.run(
                                    ["ss", "-tlpn"],
                                    capture_output=True,
                                    text=True,
                                    timeout=2,
                                )
                                if result.returncode == 0 and result.stdout:
                                    # Find lines containing the port and extract PID
                                    for line in result.stdout.split("\n"):
                                        if f":{port}" in line:
                                            # Use regex for more robust PID extraction
                                            # Match patterns like "pid=12345," or "pid=12345)"
                                            pid_match = re.search(r'pid=(\d+)', line)
                                            if pid_match:
                                                pid = pid_match.group(1)
                                                break
                            elif sys.platform == "darwin":
                                result = subprocess.run(
                                    ["lsof", "-i", f":{port}", "-t"],
                                    capture_output=True,
                                    text=True,
                                    timeout=2,
                                )
                                if result.returncode == 0 and result.stdout:
                                    pid = result.stdout.strip().split("\n")[0]
                        except (subprocess.TimeoutExpired, subprocess.SubprocessError, OSError):
                            # PID detection is optional, continue without it
                            pass
                        
                        network_info = {
                            "network_id": network_id,
                            "network_name": network_data.get("network_name", "Unknown"),
                            "host": host,
                            "port": port,
                            "is_running": network_data.get("is_running", False),
                            "uptime_seconds": network_data.get("uptime_seconds", 0),
                            "agent_count": network_data.get("agent_count", 0),
                            "pid": pid,
                            "network_profile": network_data.get("network_profile", {}),
                        }
                        discovered_networks.append(network_info)
                        
            except (requests.RequestException, requests.exceptions.JSONDecodeError, ValueError):
                # Port is not reachable or not an OpenAgents network
                continue
    
    return discovered_networks


@network_app.command("list")
def network_list(
    status: bool = typer.Option(False, "--status", "-s", help="Show status information")
):
    """📋 List available networks"""
    table = Table(title="🌐 Available Networks", box=box.ROUNDED)
    
    if status:
        table.add_column("Name", style="cyan")
        table.add_column("Status", style="green")
        table.add_column("Port", style="yellow") 
        table.add_column("PID", style="magenta")
        
        # Discover running networks
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
            transient=True,
        ) as progress:
            progress.add_task("🔍 Scanning for running networks...", total=None)
            networks = discover_running_networks()
        
        if networks:
            for network in networks:
                status_text = "[green]Running[/green]" if network.get("is_running") else "[red]Stopped[/red]"
                pid_text = str(network.get("pid")) if network.get("pid") else "—"
                table.add_row(
                    network.get("network_name", "Unknown"),
                    status_text,
                    str(network.get("port", "—")),
                    pid_text
                )
        else:
            table.add_row("No networks found", "—", "—", "—")
    else:
        table.add_column("Name", style="cyan")
        table.add_column("Description", style="green")
        table.add_row("No networks found", "—")
    
    console.print(table)


@network_app.command("interact")
def network_interact(
    network: Optional[str] = typer.Option(None, "--network", "-n", help="Network ID to connect to"),
    host: str = typer.Option("localhost", "--host", "-h", help="Server host address"),
    port: int = typer.Option(8570, "--port", "-p", help="Server port"),
    agent_id: Optional[str] = typer.Option(None, "--id", help="Agent ID"),
):
    """💬 Connect to a network interactively"""
    console.print(f"[bold blue]🔗 Connecting to network at {host}:{port}[/bold blue]")
    
    # Validate that either host or network-id is provided
    if not host and not network:
        console.print("[red]❌ Either --host or --network must be provided[/red]")
        raise typer.Exit(1)

    # If network-id is provided but host is not, use a default host
    if network and not host:
        host = "localhost"

    launch_console(host, port, agent_id, network)


@network_app.command("publish")
def network_publish(
    config: Optional[str] = typer.Argument(None, help="Path to network configuration file"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory"),
):
    """🌍 Publish your network to the OpenAgents dashboard"""
    
    console.print(Panel.fit(
        "[bold cyan]🌍 Publish Your Network[/bold cyan]\n\n"
        "Share your OpenAgents network with the community!\n\n"
        "[bold yellow]🚀 Ready to publish?[/bold yellow]\n"
        "Visit the OpenAgents dashboard to get started:",
        border_style="blue"
    ))
    
    console.print()
    console.print("[bold green]🔗 https://openagents.org/login[/bold green]")
    console.print()
    
    # Show network info if config is provided
    if config:
        try:
            import yaml
            with open(config, 'r') as f:
                config_data = yaml.safe_load(f)
            
            network_name = config_data.get('network', {}).get('name', 'Unknown')
            network_profile = config_data.get('network_profile', {})
            
            if network_profile:
                console.print(Panel(
                    f"[bold]Network to Publish:[/bold]\n"
                    f"📝 Name: [code]{network_name}[/code]\n"
                    f"📋 Description: {network_profile.get('description', 'No description')}\n"
                    f"🏷️  Tags: {', '.join(network_profile.get('tags', []))}\n"
                    f"🌐 Discoverable: {network_profile.get('discoverable', False)}",
                    title="[green]📋 Network Details[/green]",
                    border_style="green"
                ))
        except Exception as e:
            console.print(f"[yellow]⚠️  Could not read network config: {e}[/yellow]")
    
    console.print("[dim]💡 Tip: Make sure your network is running and accessible before publishing![/dim]")


