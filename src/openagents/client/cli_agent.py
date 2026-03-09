"""CLI agent commands — agent start/list, agents start/list (bulk)."""

import logging
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.panel import Panel
from rich.table import Table
from rich import box

from openagents.client.cli_shared import app, console

agent_app = typer.Typer(
    name="agent",
    help="\U0001f916 Agent management commands",
    rich_markup_mode="rich",
)
agents_app = typer.Typer(
    name="agents",
    help="\U0001f916\U0001f916 Bulk agent management commands",
    rich_markup_mode="rich",
)
app.add_typer(agent_app, name="agent")
app.add_typer(agents_app, name="agents")

@agent_app.command("start")
def agent_start(
    config: str = typer.Argument(..., help="Path to agent configuration file"),
    agent_id: Optional[str] = typer.Option(None, "--agent-id", "-i", help="Override agent ID"),
    network_id: Optional[str] = typer.Option(None, "--network-id", "-n", help="Network ID to connect to"),
    host: Optional[str] = typer.Option(None, "--network-host", "-h", help="Network host address"),
    port: Optional[int] = typer.Option(None, "--network-port", "-p", help="Network port"),
    detach: bool = typer.Option(False, "--detach", "-d", help="Run in background"),
):
    """🚀 Start an agent"""
    from openagents.agents.runner import AgentRunner
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Loading agent configuration...", total=None)
        
        try:
            if detach:
                console.print("[yellow]⚠️  Detached mode not yet implemented, running in foreground[/yellow]")

            # Prepare connection override from command line arguments
            connection_override = {}
            if host is not None:
                connection_override["host"] = host
            if port is not None:
                connection_override["port"] = port
            if network_id is not None:
                connection_override["network_id"] = network_id

            # Configure file logging to the agent config directory
            config_dir = Path(config).parent.resolve()
            configure_workspace_logging(config_dir)

            # Load .env file from workspace root (parent of config directory)
            workspace_root = config_dir.parent
            env_file = workspace_root / ".env"
            if env_file.exists():
                try:
                    from dotenv import load_dotenv
                    load_dotenv(env_file)
                    progress.update(task, description=f"[green]✅ Loaded environment from {env_file}")
                except ImportError:
                    console.print("[yellow]⚠️  python-dotenv not installed, skipping .env file loading[/yellow]")
                except Exception as e:
                    console.print(f"[yellow]⚠️  Could not load .env file: {e}[/yellow]")

            # Load agent using AgentRunner.from_yaml with overrides
            agent = AgentRunner.from_yaml(config, agent_id_override=agent_id, connection_override=connection_override if connection_override else None)
            progress.update(task, description=f"[green]✅ Loaded agent '{agent.agent_id}'")

            # Prepare connection settings (combine config file + CLI overrides)
            connection_settings = {}
            config_path = Path(config)
            if config_path.exists():
                try:
                    with open(config_path, "r") as file:
                        yaml_config = yaml.safe_load(file)
                    if "connection" in yaml_config:
                        connection_settings.update(yaml_config["connection"])
                except Exception as e:
                    console.print(f"[yellow]⚠️  Could not read connection settings: {e}[/yellow]")

            # Apply CLI overrides to connection settings
            if host is not None:
                connection_settings["host"] = host
            if port is not None:
                connection_settings["port"] = port
            if network_id is not None:
                connection_settings["network_id"] = network_id

            # Apply defaults only when no network_id is provided
            final_network_id = connection_settings.get("network_id")
            if final_network_id:
                # When network_id is provided, let the client handle network discovery
                final_host = connection_settings.get("host")  # None if not specified
                final_port = connection_settings.get("port")  # None if not specified
            else:
                # When no network_id, use defaults for direct connection
                final_host = connection_settings.get("host", "localhost")
                final_port = connection_settings.get("port", 8570)

            # Get password_hash for group authentication
            final_password_hash = connection_settings.get("password_hash")

            # Update progress message appropriately
            if final_network_id:
                progress.update(task, description=f"[blue]🔗 Connecting to network '{final_network_id}'")
            else:
                progress.update(task, description=f"[blue]🔗 Connecting to {final_host}:{final_port}")

            # Start the agent
            agent.start(
                network_host=final_host,
                network_port=final_port,
                network_id=final_network_id,
                metadata={"agent_type": type(agent).__name__, "config_file": config},
                password_hash=final_password_hash,
            )

            progress.update(task, description="[green]✅ Agent started successfully!")
            console.print(f"[green]🤖 Agent '{agent.agent_id}' is running![/green]")

            # Wait for the agent to stop
            agent.wait_for_stop()

        except KeyboardInterrupt:
            progress.update(task, description="[yellow]🛑 Agent stopped by user")
            if 'agent' in locals():
                agent.stop()
        except Exception as e:
            progress.update(task, description=f"[red]❌ Failed to start agent: {e}")
            console.print(f"[red]Error: {e}[/red]")
            if 'agent' in locals():
                agent.stop()
            raise typer.Exit(1)


@agent_app.command("list")  
def agent_list(
    network: Optional[str] = typer.Option(None, "--network", "-n", help="Filter by network")
):
    """📋 List agents"""
    table = Table(title="🤖 Available Agents", box=box.ROUNDED)
    table.add_column("Name", style="cyan")
    table.add_column("Type", style="green")
    table.add_column("Status", style="yellow")
    table.add_column("Network", style="magenta")
    
    if network:
        table.title = f"🤖 Agents in Network '{network}'"
    
    table.add_row("No agents found", "—", "—", "—")
    console.print(table)


@agents_app.command("start")
def agents_start(
    folder: str = typer.Argument(..., help="Path to directory containing agent YAML configuration files"),
    host: Optional[str] = typer.Option(None, "--host", "-h", help="Override network host for all agents"),
    port: Optional[int] = typer.Option(None, "--port", "-p", help="Override network port for all agents"), 
    network_id: Optional[str] = typer.Option(None, "--network-id", "-n", help="Override network ID for all agents"),
    max_concurrent: int = typer.Option(1, "--max-concurrent", "-c", help="Maximum number of agents to start concurrently"),
    no_ui: bool = typer.Option(False, "--no-ui", help="Start agents without the tabbed log interface"),
    detach: bool = typer.Option(False, "--detach", "-d", help="Run in background (implies --no-ui)"),
):
    """🚀🚀 Start multiple agents from a directory of YAML configs"""
    import asyncio
    from pathlib import Path
    from openagents.utils.bulk_agent_manager import BulkAgentManager
    
    folder_path = Path(folder)
    
    # Validate folder exists
    if not folder_path.exists():
        console.print(f"[red]❌ Directory not found: {folder}[/red]")
        raise typer.Exit(1)
    
    if not folder_path.is_dir():
        console.print(f"[red]❌ Path is not a directory: {folder}[/red]")
        raise typer.Exit(1)

    # Configure file logging to the agents folder
    configure_workspace_logging(folder_path.resolve())

    console.print(Panel.fit(
        f"[bold blue]🚀🚀 Starting Multiple Agents[/bold blue]\n"
        f"📁 Directory: [code]{folder_path.resolve()}[/code]\n"
        f"🔧 Max Concurrent: [code]{max_concurrent}[/code]",
        border_style="blue"
    ))
    
    # Handle detached mode
    if detach:
        no_ui = True
        console.print("[yellow]⚠️  Detached mode not yet fully implemented, running in foreground without UI[/yellow]")
    
    async def start_agents_async():
        """Async function to start agents."""
        bulk_manager = BulkAgentManager()
        
        try:
            # Discovery phase
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                discovery_task = progress.add_task("🔍 Discovering agent configurations...", total=None)
                
                # Discover agents in the directory
                agent_infos = bulk_manager.discover_agents(folder_path)
                
                if not agent_infos:
                    progress.update(discovery_task, description="[red]❌ No agent configurations found")
                    console.print(f"[red]❌ No YAML agent configurations found in {folder_path}[/red]")
                    console.print("[yellow]💡 Make sure the directory contains *.yaml or *.yml files with agent configurations[/yellow]")
                    return
                
                valid_agents = [info for info in agent_infos if info.is_valid]
                invalid_agents = [info for info in agent_infos if not info.is_valid]
                
                progress.update(discovery_task, 
                    description=f"[green]✅ Found {len(valid_agents)} valid agents, {len(invalid_agents)} invalid")
                
                # Show discovery results
                if valid_agents:
                    console.print("\n[bold green]📋 Valid Agent Configurations:[/bold green]")
                    table = Table(box=box.ROUNDED)
                    table.add_column("Agent ID", style="cyan")
                    table.add_column("Type", style="green")
                    table.add_column("Config File", style="yellow")
                    
                    for info in valid_agents:
                        table.add_row(info.agent_id, info.agent_type, info.config_path.name)
                    
                    console.print(table)
                
                if invalid_agents:
                    console.print(f"\n[bold red]❌ Invalid Configurations ({len(invalid_agents)}):[/bold red]")
                    for info in invalid_agents:
                        console.print(f"  • [red]{info.config_path.name}[/red]: {info.error_message}")
                
                if not valid_agents:
                    console.print("[red]❌ No valid agent configurations found[/red]")
                    return
                
                # Add agents to manager
                bulk_manager.add_agents(agent_infos)
            
            # Connection override settings
            connection_override = {}
            if host is not None:
                connection_override["host"] = host
            if port is not None:
                connection_override["port"] = port
            if network_id is not None:
                connection_override["network_id"] = network_id
            
            # Starting phase
            console.print(f"\n[blue]🚀 Starting {len(valid_agents)} agents...[/blue]")
            
            if connection_override:
                override_info = []
                if host:
                    override_info.append(f"Host: {host}")
                if port:
                    override_info.append(f"Port: {port}")
                if network_id:
                    override_info.append(f"Network ID: {network_id}")
                console.print(f"[dim]🔧 Connection overrides: {', '.join(override_info)}[/dim]")
            
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                TimeElapsedColumn(),
                console=console,
            ) as progress:
                startup_task = progress.add_task("🚀 Starting agents...", total=len(valid_agents))
                
                # Start all agents concurrently
                success_map = await bulk_manager.start_all_agents(
                    connection_override=connection_override if connection_override else None,
                    max_concurrent=max_concurrent
                )
                
                progress.update(startup_task, completed=len(valid_agents))
            
            # Show startup results
            successful_agents = [agent_id for agent_id, success in success_map.items() if success]
            failed_agents = [agent_id for agent_id, success in success_map.items() if not success]
            
            console.print(f"\n[bold green]✅ Successfully started {len(successful_agents)} agents[/bold green]")
            if failed_agents:
                console.print(f"[bold red]❌ Failed to start {len(failed_agents)} agents[/bold red]")
                for agent_id in failed_agents:
                    status = bulk_manager.get_agent_status(agent_id)
                    error_msg = status.get('error_message', 'Unknown error') if status else 'Unknown error'
                    console.print(f"  • [red]{agent_id}[/red]: {error_msg}")
            
            if not successful_agents:
                console.print("[red]❌ No agents started successfully[/red]")
                return
            
            # Launch UI or run in background
            if no_ui:
                console.print("\n[blue]🤖 Agents are running in background...[/blue]")
                console.print("[dim]Press Ctrl+C to stop all agents[/dim]")
                
                try:
                    # Simple monitoring loop
                    while bulk_manager.running:
                        await asyncio.sleep(5)
                        
                        # Check agent status
                        running_agents = bulk_manager.get_running_agents()
                        if not running_agents:
                            console.print("[yellow]⚠️  All agents have stopped[/yellow]")
                            break
                        
                except KeyboardInterrupt:
                    console.print("\n[yellow]🛑 Shutdown requested...[/yellow]")
                finally:
                    # Stop all agents
                    console.print("[blue]🔄 Stopping all agents...[/blue]")
                    stop_results = bulk_manager.stop_all_agents()
                    
                    stopped_count = sum(1 for success in stop_results.values() if success)
                    console.print(f"[green]✅ Stopped {stopped_count} agents[/green]")
                    
                    bulk_manager.shutdown()
                    console.print("[green]✅ Shutdown complete[/green]")
            else:
                # Launch the awesome tabbed UI
                console.print(f"\n[bold blue]🎨 Launching Agent Monitor UI...[/bold blue]")
                console.print("[dim]Use Tab/Shift+Tab to navigate, 'q' to quit, 'r' to refresh[/dim]")
                
                try:
                    # Import and run the monitor UI
                    from openagents.ui.agent_monitor import run_agent_monitor
                    
                    # Run the monitor (this blocks until user quits)
                    run_agent_monitor(bulk_manager)
                    
                except ImportError as e:
                    console.print(f"[red]❌ UI not available: {e}[/red]")
                    console.print("[yellow]💡 Install textual: pip install textual[/yellow]")
                    console.print("[yellow]🔄 Falling back to no-UI mode...[/yellow]")
                    
                    # Fall back to no-UI mode
                    try:
                        while bulk_manager.running:
                            await asyncio.sleep(5)
                            running_agents = bulk_manager.get_running_agents()
                            if not running_agents:
                                break
                    except KeyboardInterrupt:
                        pass
                
                except KeyboardInterrupt:
                    console.print("\n[yellow]🛑 Monitor shutdown requested...[/yellow]")
                
                finally:
                    # Clean shutdown
                    console.print("[blue]🔄 Stopping all agents...[/blue]")
                    stop_results = bulk_manager.stop_all_agents()
                    
                    stopped_count = sum(1 for success in stop_results.values() if success)
                    console.print(f"[green]✅ Stopped {stopped_count} agents[/green]")
                    
                    bulk_manager.shutdown()
                    console.print("[green]✅ Shutdown complete[/green]")
        
        except Exception as e:
            console.print(f"[red]❌ Error starting agents: {e}[/red]")
            if 'bulk_manager' in locals():
                bulk_manager.shutdown()
            raise typer.Exit(1)
    
    # Run the async function
    try:
        asyncio.run(start_agents_async())
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Goodbye![/yellow]")
    except Exception as e:
        console.print(f"[red]❌ Unexpected error: {e}[/red]")
        raise typer.Exit(1)


@agents_app.command("list")
def agents_list(
    folder: str = typer.Argument(..., help="Path to directory containing agent configurations"),
    show_invalid: bool = typer.Option(False, "--show-invalid", help="Show invalid configurations"),
):
    """📋 List agent configurations in a directory"""
    from pathlib import Path
    from openagents.utils.bulk_agent_manager import BulkAgentManager
    
    folder_path = Path(folder)
    
    if not folder_path.exists():
        console.print(f"[red]❌ Directory not found: {folder}[/red]")
        raise typer.Exit(1)
    
    bulk_manager = BulkAgentManager()
    agent_infos = bulk_manager.discover_agents(folder_path)
    
    if not agent_infos:
        console.print(f"[yellow]⚠️  No YAML files found in {folder_path}[/yellow]")
        return
    
    valid_agents = [info for info in agent_infos if info.is_valid]
    invalid_agents = [info for info in agent_infos if not info.is_valid]
    
    if valid_agents:
        table = Table(title=f"🤖 Agent Configurations in {folder_path}", box=box.ROUNDED)
        table.add_column("Agent ID", style="cyan")
        table.add_column("Type", style="green") 
        table.add_column("Config File", style="yellow")
        table.add_column("Host", style="blue")
        table.add_column("Port", style="magenta")
        
        for info in valid_agents:
            connection = info.connection_settings
            host = connection.get("host", "—")
            port = str(connection.get("port", "—"))
            
            table.add_row(
                info.agent_id,
                info.agent_type,
                info.config_path.name,
                host,
                port
            )
        
        console.print(table)
        console.print(f"\n[green]✅ Found {len(valid_agents)} valid agent configurations[/green]")
    
    if invalid_agents and show_invalid:
        console.print(f"\n[red]❌ Invalid configurations ({len(invalid_agents)}):[/red]")
        for info in invalid_agents:
            console.print(f"  • [red]{info.config_path.name}[/red]: {info.error_message}")
    elif invalid_agents:
        console.print(f"\n[yellow]⚠️  {len(invalid_agents)} invalid configurations (use --show-invalid to see details)[/yellow]")


