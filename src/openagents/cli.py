#!/usr/bin/env python3
"""
OpenAgents CLI

Main entry point for the OpenAgents command-line interface.
"""

import argparse
import sys
import logging
import yaml
import os
import subprocess
import threading
import time
import webbrowser
import tempfile
import shutil
import socket
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

from openagents.launchers.network_launcher import async_launch_network, launch_network
from openagents.launchers.terminal_console import launch_console

# Global verbose flag that can be imported by other modules
VERBOSE_MODE = False


def setup_logging(level: str = "INFO", verbose: bool = False) -> None:
    """Set up logging configuration.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        verbose: Whether to enable verbose mode
    """
    global VERBOSE_MODE
    VERBOSE_MODE = verbose
    
    numeric_level = getattr(logging, level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError(f"Invalid log level: {level}")
    
    logging.basicConfig(
        level=numeric_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("openagents.log")
        ]
    )
    
    # Suppress noisy websockets connection logs in studio mode
    logging.getLogger('websockets.server').setLevel(logging.WARNING)
    logging.getLogger('websockets.protocol').setLevel(logging.WARNING)


def launch_network_command(args: argparse.Namespace) -> None:
    """Handle launch-network command.
    
    Args:
        args: Command-line arguments
    """
    # Use enhanced network launcher for all network launches
    launch_network(args.config, args.runtime)


def connect_command(args: argparse.Namespace) -> None:
    """Handle connect command.
    
    Args:
        args: Command-line arguments
    """
    # Validate that either host or network-id is provided
    if not args.host and not args.network_id:
        logging.error("Either --host or --network-id must be provided")
        return
        
    # If network-id is provided but host is not, use a default host
    if args.network_id and not args.host:
        args.host = "localhost"  # Default to localhost when only network-id is provided
        
    launch_console(args.host, args.port, args.id, args.network_id)


def get_default_workspace_path() -> Path:
    """Get the path for the default workspace directory.
    
    Returns:
        Path: Path to the default workspace directory
    """
    return Path.cwd() / "openagents_workspace"


def initialize_workspace(workspace_path: Path) -> Path:
    """Initialize a workspace directory with default configuration.
    
    Args:
        workspace_path: Path to the workspace directory
        
    Returns:
        Path: Path to the config.yaml file in the workspace
    """
    # Create workspace directory if it doesn't exist
    workspace_path.mkdir(parents=True, exist_ok=True)
    
    config_path = workspace_path / "config.yaml"
    
    # Check if config.yaml already exists
    if config_path.exists():
        logging.info(f"Using existing workspace configuration: {config_path}")
        return config_path
    
    # Find the default workspace template
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    default_workspace_path = project_root / "examples" / "default_workspace"
    
    if not default_workspace_path.exists():
        logging.error(f"Default workspace template not found: {default_workspace_path}")
        raise FileNotFoundError(f"Default workspace template not found: {default_workspace_path}")
    
    # Copy all files from default workspace to the new workspace
    try:
        for item in default_workspace_path.iterdir():
            if item.is_file():
                dest_path = workspace_path / item.name
                shutil.copy2(item, dest_path)
                logging.info(f"Copied {item.name} to workspace")
            elif item.is_dir():
                dest_dir = workspace_path / item.name
                shutil.copytree(item, dest_dir, dirs_exist_ok=True)
                logging.info(f"Copied directory {item.name} to workspace")
        
        logging.info(f"Initialized new workspace at: {workspace_path}")
        
    except Exception as e:
        logging.error(f"Failed to initialize workspace: {e}")
        raise RuntimeError(f"Failed to initialize workspace: {e}")
    
    return config_path


def load_workspace_config(workspace_path: Path) -> Dict[str, Any]:
    """Load configuration from a workspace directory.
    
    Args:
        workspace_path: Path to the workspace directory
        
    Returns:
        Dict: Configuration dictionary
    """
    config_path = initialize_workspace(workspace_path)
    
    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        if not config:
            raise ValueError("Configuration file is empty")
        
        logging.info(f"Loaded workspace configuration from: {config_path}")
        return config
        
    except Exception as e:
        logging.error(f"Failed to load workspace configuration: {e}")
        raise ValueError(f"Failed to load workspace configuration: {e}")


def create_default_studio_config(host: str = "localhost", port: int = 8570) -> str:
    """Create a default network configuration for studio mode.
    
    Args:
        host: Host to bind the network to
        port: Port to bind the network to
        
    Returns:
        str: Path to the created configuration file
    """
    config = {
        "network": {
            "name": "OpenAgentsStudio",
            "mode": "centralized",
            "node_id": "studio-coordinator",
            "host": host,
            "port": port,
            "server_mode": True,
            "transport": "websocket",
            "transport_config": {
                "buffer_size": 8192,
                "compression": True,
                "ping_interval": 30,
                "ping_timeout": 10,
                "max_message_size": 104857600
            },
            "encryption_enabled": False,  # Simplified for studio mode
            "discovery_interval": 5,
            "discovery_enabled": True,
            "max_connections": 100,
            "connection_timeout": 30.0,
            "retry_attempts": 3,
            "heartbeat_interval": 30,
            "message_queue_size": 1000,
            "message_timeout": 30.0,
            "message_routing_enabled": True,
            "mods": [
                {
                    "name": "openagents.mods.communication.simple_messaging",
                    "enabled": True,
                    "config": {
                        "max_message_size": 104857600,
                        "message_retention_time": 300,
                        "enable_message_history": True
                    }
                },
                {
                    "name": "openagents.mods.discovery.agent_discovery",
                    "enabled": True,
                    "config": {
                        "announce_interval": 30,
                        "cleanup_interval": 60,
                        "agent_timeout": 120
                    }
                }
            ]
        },
        "network_profile": {
            "discoverable": True,
            "name": "OpenAgents Studio Network",
            "description": "A local OpenAgents network for studio development",
            "host": host,
            "port": port,
            "required_openagents_version": "0.5.1"
        },
        "log_level": "INFO"
    }
    
    # Create temporary config file
    temp_dir = tempfile.gettempdir()
    config_path = os.path.join(temp_dir, "openagents_studio_config.yaml")
    
    with open(config_path, 'w') as f:
        yaml.dump(config, f, default_flow_style=False)
    
    return config_path


async def studio_network_launcher(workspace_path: Path, host: str, port: int) -> None:
    """Launch the network for studio mode using workspace configuration.
    
    Args:
        workspace_path: Path to the workspace directory
        host: Host to bind the network to
        port: Port to bind the network to
    """
    try:
        # Load workspace configuration
        config = load_workspace_config(workspace_path)
        
        # Override network host and port with command line arguments
        if 'network' not in config:
            config['network'] = {}
        
        config['network']['host'] = host
        config['network']['port'] = port
        
        # Add workspace metadata to the configuration
        if 'metadata' not in config:
            config['metadata'] = {}
        config['metadata']['workspace_path'] = str(workspace_path.resolve())
        
        # Create temporary config file with updated settings
        temp_dir = tempfile.gettempdir()
        temp_config_path = os.path.join(temp_dir, "openagents_studio_workspace_config.yaml")
        
        with open(temp_config_path, 'w') as f:
            yaml.dump(config, f, default_flow_style=False)
        
        logging.info(f"Using workspace configuration from: {workspace_path}")
        await async_launch_network(temp_config_path, runtime=None)
        
    except Exception as e:
        logging.error(f"Failed to launch studio network: {e}")
        raise


def check_port_availability(host: str, port: int) -> Tuple[bool, str]:
    """Check if a port is available for binding.
    
    Args:
        host: Host address to check
        port: Port number to check
        
    Returns:
        tuple: (is_available, process_info)
    """
    try:
        # Try to bind to the port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((host, port))
            return True, ""
    except OSError as e:
        if e.errno == 48:  # Address already in use
            # Try to get process information
            try:
                import subprocess
                if sys.platform == "darwin":  # macOS
                    result = subprocess.run(
                        ["lsof", "-i", f":{port}"],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0 and result.stdout:
                        lines = result.stdout.strip().split('\n')
                        if len(lines) > 1:  # Skip header
                            process_line = lines[1]
                            parts = process_line.split()
                            if len(parts) >= 2:
                                command = parts[0]
                                pid = parts[1]
                                return False, f"{command} (PID: {pid})"
                elif sys.platform.startswith("linux"):
                    result = subprocess.run(
                        ["ss", "-tlpn", f"sport = :{port}"],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0 and result.stdout:
                        lines = result.stdout.strip().split('\n')
                        for line in lines[1:]:  # Skip header
                            if f":{port}" in line:
                                # Extract process info from ss output
                                if "users:" in line:
                                    users_part = line.split("users:")[1]
                                    if "pid=" in users_part:
                                        pid_part = users_part.split("pid=")[1].split(",")[0].split(")")[0]
                                        return False, f"Process (PID: {pid_part})"
                return False, "unknown process"
            except Exception:
                return False, "unknown process"
        else:
            return False, f"bind error: {e}"


def check_studio_ports(network_host: str, network_port: int, studio_port: int) -> Tuple[bool, List[str]]:
    """Check if both network and studio ports are available.
    
    Args:
        network_host: Network host address
        network_port: Network port
        studio_port: Studio frontend port
        
    Returns:
        tuple: (all_available, list_of_conflicts)
    """
    conflicts = []
    
    # Check network port
    network_available, network_process = check_port_availability(network_host, network_port)
    if not network_available:
        conflicts.append(f"🌐 Network port {network_port}: occupied by {network_process}")
    
    # Check studio port  
    studio_available, studio_process = check_port_availability("0.0.0.0", studio_port)
    if not studio_available:
        conflicts.append(f"🎨 Studio port {studio_port}: occupied by {studio_process}")
    
    return len(conflicts) == 0, conflicts


def suggest_alternative_ports(network_port: int, studio_port: int) -> Tuple[int, int]:
    """Suggest alternative available ports.
    
    Args:
        network_port: Original network port
        studio_port: Original studio port
        
    Returns:
        tuple: (alternative_network_port, alternative_studio_port)
    """
    # Find available network port
    alt_network_port = network_port
    for offset in range(1, 20):  # Try next 20 ports
        test_port = network_port + offset
        if test_port > 65535:
            break
        available, _ = check_port_availability("localhost", test_port)
        if available:
            alt_network_port = test_port
            break
    
    # Find available studio port
    alt_studio_port = studio_port
    for offset in range(1, 20):  # Try next 20 ports
        test_port = studio_port + offset
        if test_port > 65535:
            break
        available, _ = check_port_availability("0.0.0.0", test_port)
        if available:
            alt_studio_port = test_port
            break
    
    return alt_network_port, alt_studio_port


def check_nodejs_availability() -> Tuple[bool, str]:
    """Check if Node.js and npm are available on the system.
    
    Returns:
        tuple: (is_available, error_message)
    """
    missing_tools = []
    
    # Check for Node.js
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("Node.js")
    
    # Check for npm
    try:
        subprocess.run(["npm", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("npm")
    
    # Check for npx
    try:
        subprocess.run(["npx", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("npx")
    
    if missing_tools:
        error_msg = f"""
❌ Missing required dependencies: {', '.join(missing_tools)}

OpenAgents Studio requires Node.js and npm to run the web interface.

📋 Installation instructions:

🍎 macOS:
   brew install node
   # or download from: https://nodejs.org/

🐧 Ubuntu/Debian:
   sudo apt update && sudo apt install nodejs npm
   # or: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs

🎩 CentOS/RHEL/Fedora:
   sudo dnf install nodejs npm
   # or: curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo dnf install nodejs

🪟 Windows:
   Download from: https://nodejs.org/
   # or: winget install OpenJS.NodeJS

🔧 Alternative - Use nvm (Node Version Manager):
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install --lts
   nvm use --lts

After installation, verify with:
   node --version && npm --version

Then run 'openagents studio' again.
"""
        return False, error_msg
    
    return True, ""


def launch_studio_frontend(studio_port: int = 8055) -> subprocess.Popen:
    """Launch the studio frontend development server.
    
    Args:
        studio_port: Port for the studio frontend
        
    Returns:
        subprocess.Popen: The frontend process
        
    Raises:
        RuntimeError: If Node.js/npm are not available or if setup fails
        FileNotFoundError: If studio directory is not found
    """
    # Check for Node.js and npm availability first
    is_available, error_msg = check_nodejs_availability()
    if not is_available:
        raise RuntimeError(error_msg)
    
    # Find the studio directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(script_dir))
    studio_dir = os.path.join(project_root, "studio")
    
    if not os.path.exists(studio_dir):
        raise FileNotFoundError(f"Studio directory not found: {studio_dir}")
    
    # Check if node_modules exists, if not run npm install
    node_modules_path = os.path.join(studio_dir, "node_modules")
    if not os.path.exists(node_modules_path):
        logging.info("Installing studio dependencies...")
        try:
            install_process = subprocess.run(
                ["npm", "install"],
                cwd=studio_dir,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout for npm install
            )
            if install_process.returncode != 0:
                raise RuntimeError(f"Failed to install studio dependencies:\n{install_process.stderr}")
            logging.info("Studio dependencies installed successfully")
        except subprocess.TimeoutExpired:
            raise RuntimeError("npm install timed out after 5 minutes. Please check your internet connection and try again.")
        except FileNotFoundError:
            # This shouldn't happen since we checked above, but just in case
            raise RuntimeError("npm command not found. Please install Node.js and npm.")
    
    # Start the development server
    env = os.environ.copy()
    env["PORT"] = str(studio_port)
    env["HOST"] = "0.0.0.0"
    env["DANGEROUSLY_DISABLE_HOST_CHECK"] = "true"
    
    logging.info(f"Starting studio frontend on port {studio_port}...")
    
    try:
        # Use npx to run react-scripts directly with our PORT environment variable
        # This ensures our PORT value takes precedence over the package.json
        process = subprocess.Popen(
            ["npx", "react-scripts", "start"],
            cwd=studio_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        return process
    except FileNotFoundError:
        # This shouldn't happen since we checked above, but just in case
        raise RuntimeError("npx command not found. Please install Node.js and npm.")


def studio_command(args: argparse.Namespace) -> None:
    """Handle studio command.
    
    Args:
        args: Command-line arguments
    """
    import asyncio
    
    logging.info("🚀 Starting OpenAgents Studio...")
    
    # Extract arguments
    network_host = args.host
    network_port = args.port
    studio_port = args.studio_port
    workspace_path = getattr(args, 'workspace', None)
    no_browser = args.no_browser
    
    # Determine workspace path
    if workspace_path:
        workspace_path = Path(workspace_path).resolve()
    else:
        workspace_path = get_default_workspace_path()
    
    logging.info(f"📁 Using workspace: {workspace_path}")
    
    # Check for port conflicts early
    logging.info("🔍 Checking port availability...")
    ports_available, conflicts = check_studio_ports(network_host, network_port, studio_port)
    
    if not ports_available:
        alt_network_port, alt_studio_port = suggest_alternative_ports(network_port, studio_port)
        
        error_msg = f"""
❌ Port conflicts detected:

{chr(10).join(conflicts)}

💡 Solutions:

1️⃣  Use alternative ports (recommended):
   openagents studio --port {alt_network_port} --studio-port {alt_studio_port}

2️⃣  Stop the conflicting processes:
   # Find and stop processes using these ports
   # On macOS/Linux: sudo lsof -ti:{network_port},{studio_port} | xargs kill
   # Or restart the conflicting applications

3️⃣  Choose custom ports:
   openagents studio --port <network-port> --studio-port <frontend-port>

💭 Common port conflicts:
   • Port {studio_port}: Often used by other development servers (React, Vue, etc.)
   • Port {network_port}: May be used by other OpenAgents instances or services
   
🔧 Quick command to find available ports:
   python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print('Available port:', s.getsockname()[1]); s.close()"
"""
        
        logging.error(error_msg)
        raise RuntimeError("Port conflicts detected. See above for solutions.")
    
    logging.info("✅ All ports are available")
    
    def frontend_monitor(process):
        """Monitor frontend process output and detect when it's ready."""
        ready_detected = False
        for line in iter(process.stdout.readline, ''):
            if line:
                # Print frontend output with prefix
                print(f"[Studio] {line.rstrip()}")
                
                # Detect when the development server is ready
                if not ready_detected and ("webpack compiled" in line.lower() or 
                                         "compiled successfully" in line.lower() or
                                         "local:" in line.lower()):
                    ready_detected = True
                    studio_url = f"http://localhost:{studio_port}"
                    
                    if not no_browser:
                        # Wait a moment then open browser
                        time.sleep(2)
                        logging.info(f"🌐 Opening studio in browser: {studio_url}")
                        webbrowser.open(studio_url)
                    else:
                        logging.info(f"🌐 Studio is ready at: {studio_url}")
    
    async def run_studio():
        """Run the complete studio setup."""
        frontend_process = None
        
        try:
            # Start frontend in a separate thread
            frontend_process = launch_studio_frontend(studio_port)
            
            # Start monitoring frontend output in background thread
            frontend_thread = threading.Thread(
                target=frontend_monitor, 
                args=(frontend_process,),
                daemon=True
            )
            frontend_thread.start()
            
            # Small delay to let frontend start
            await asyncio.sleep(2)
            
            # Launch network (this will run indefinitely)
            logging.info(f"🌐 Starting network on {network_host}:{network_port}...")
            await studio_network_launcher(workspace_path, network_host, network_port)
            
        except KeyboardInterrupt:
            logging.info("📱 Studio shutdown requested...")
        except Exception as e:
            logging.error(f"❌ Studio error: {e}")
        finally:
            # Clean up frontend process
            if frontend_process:
                logging.info("🔄 Shutting down studio frontend...")
                frontend_process.terminate()
                try:
                    frontend_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    frontend_process.kill()
                    frontend_process.wait()
                logging.info("✅ Studio frontend shutdown complete")
    
    try:
        asyncio.run(run_studio())
    except KeyboardInterrupt:
        logging.info("✅ OpenAgents Studio stopped")
    except Exception as e:
        logging.error(f"❌ Failed to start OpenAgents Studio: {e}")
        sys.exit(1)


# Network command handlers
def handle_network_command(args: argparse.Namespace) -> None:
    """Route network subcommands to appropriate handlers.
    
    Args:
        args: Parsed command line arguments
    """
    if args.network_action == "start":
        network_start_command(args)
    elif args.network_action == "stop":
        network_stop_command(args)
    elif args.network_action == "list":
        network_list_command(args)
    elif args.network_action == "info":
        network_info_command(args)
    elif args.network_action == "logs":
        network_logs_command(args)
    elif args.network_action == "interact":
        network_interact_command(args)
    elif args.network_action == "create":
        network_create_command(args)
    else:
        logging.error(f"Unknown network action: {args.network_action}")


def network_start_command(args: argparse.Namespace) -> None:
    """Handle 'network start' command.
    
    Args:
        args: Command arguments
    """
    if args.detach:
        config_str = args.config or "auto-discovered config"
        logging.info(f"Starting network in background: {config_str}")
        # TODO: Implement detached mode with process management
        logging.warning("Detached mode not yet implemented, running in foreground")
    
    # Handle workspace-based launch
    if args.workspace or args.config is None:
        workspace_path = args.workspace
        config_path = args.config
        
        # Validate that we have either config or workspace
        if not config_path and not workspace_path:
            logging.error("Either config file or workspace directory must be provided")
            return
        
        # Use workspace-aware launch_network functionality
        launch_network(config_path, args.runtime, workspace_path)
    else:
        # Use existing launch_network functionality for backward compatibility
        launch_network(args.config, args.runtime)


def network_stop_command(args: argparse.Namespace) -> None:
    """Handle 'network stop' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"Stopping network: {args.name if args.name else 'all networks'}")
    logging.warning("Network stop not yet implemented")


def network_list_command(args: argparse.Namespace) -> None:
    """Handle 'network list' command.
    
    Args:
        args: Command arguments
    """
    if args.status:
        print("Networks with status:")
        print("NAME              STATUS    PORT    PID")
        print("================  ========  ======  =====")
        print("No networks found")
    else:
        print("Available networks:")
        print("No networks found")


def network_info_command(args: argparse.Namespace) -> None:
    """Handle 'network info' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"Getting info for network: {args.name}")
    logging.warning("Network info not yet implemented")


def network_logs_command(args: argparse.Namespace) -> None:
    """Handle 'network logs' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"{'Following' if args.follow else 'Showing'} logs for network: {args.name}")
    logging.warning("Network logs not yet implemented")


def network_interact_command(args: argparse.Namespace) -> None:
    """Handle 'network interact' command.
    
    Args:
        args: Command arguments
    """
    # Use existing connect functionality
    launch_console(args.host, args.port, args.id, args.network)


def network_create_command(args: argparse.Namespace) -> None:
    """Handle 'network create' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"Creating network from template: {args.template}")
    logging.warning("Network creation not yet implemented")


# Agent command handlers
def handle_agent_command(args: argparse.Namespace) -> None:
    """Route agent subcommands to appropriate handlers.
    
    Args:
        args: Parsed command line arguments
    """
    if args.agent_action == "start":
        agent_start_command(args)
    elif args.agent_action == "stop":
        agent_stop_command(args)
    elif args.agent_action == "list":
        agent_list_command(args)
    elif args.agent_action == "logs":
        agent_logs_command(args)
    elif args.agent_action == "create":
        agent_create_command(args)
    else:
        logging.error(f"Unknown agent action: {args.agent_action}")


def agent_start_command(args: argparse.Namespace) -> None:
    """Handle 'agent start' command.
    
    Args:
        args: Command arguments
    """
    from openagents.agents.runner import AgentRunner
    import yaml
    
    if args.detach:
        logging.info(f"Starting agent in background: {args.config}")
        logging.warning("Detached mode not yet implemented, running in foreground")
    
    try:
        # Load agent using AgentRunner.from_yaml (reuse existing logic)
        logging.info(f"Loading agent from configuration: {args.config}")
        agent = AgentRunner.from_yaml(args.config)
        
        # Get agent information
        agent_id = agent.agent_id
        agent_type = type(agent).__name__
        
        logging.info(f"Loaded agent '{agent_id}' of type '{agent_type}'")
        
        # Prepare connection settings - prioritize command line arguments over config file
        connection_settings = {}
        
        # Load config file to get connection settings if needed
        config_path = Path(args.config)
        if config_path.exists():
            try:
                with open(config_path, 'r') as file:
                    config = yaml.safe_load(file)
                
                # Get connection settings from config file
                if 'connection' in config:
                    conn_config = config['connection']
                    connection_settings.update(conn_config)
            except Exception as e:
                logging.warning(f"Could not read connection settings from config file: {e}")
        
        # Override with command line arguments (if provided)
        if args.host is not None:
            connection_settings['host'] = args.host
        if args.port is not None:
            connection_settings['port'] = args.port
        if args.network is not None:
            connection_settings['network_id'] = args.network
        
        # Apply defaults for any missing settings
        host = connection_settings.get('host', 'localhost')
        port = connection_settings.get('port', 8570)
        network_id = connection_settings.get('network_id')
        
        # Start the agent and wait for it to stop
        try:
            logging.info(f"Starting agent '{agent_id}' - connecting to {host}:{port}")
            if network_id:
                logging.info(f"Target network ID: {network_id}")
            
            # Start the agent
            agent.start(
                host=host,
                port=port,
                network_id=network_id,
                metadata={"agent_type": agent_type, "config_file": args.config}
            )
            
            # Wait for the agent to stop
            agent.wait_for_stop()
            
        except KeyboardInterrupt:
            logging.info("Agent stopped by user")
            agent.stop()
        except Exception as e:
            logging.error(f"Error running agent: {e}")
            agent.stop()
            
    except FileNotFoundError as e:
        logging.error(f"Configuration file not found: {e}")
        return
    except ValueError as e:
        logging.error(f"Invalid configuration: {e}")
        return
    except ImportError as e:
        logging.error(f"Failed to import agent class: {e}")
        return
    except Exception as e:
        logging.error(f"Failed to load agent: {e}")
        return


def agent_stop_command(args: argparse.Namespace) -> None:
    """Handle 'agent stop' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"Stopping agent: {args.name}")
    logging.warning("Agent stop not yet implemented")


def agent_list_command(args: argparse.Namespace) -> None:
    """Handle 'agent list' command.
    
    Args:
        args: Command arguments
    """
    if args.network:
        print(f"Agents in network '{args.network}':")
    else:
        print("All agents:")
    
    print("NAME              TYPE           STATUS    NETWORK")
    print("================  =============  ========  ================")
    print("No agents found")


def agent_logs_command(args: argparse.Namespace) -> None:
    """Handle 'agent logs' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"{'Following' if args.follow else 'Showing'} logs for agent: {args.name}")
    logging.warning("Agent logs not yet implemented")


def agent_create_command(args: argparse.Namespace) -> None:
    """Handle 'agent create' command.
    
    Args:
        args: Command arguments
    """
    logging.info(f"Creating agent from template: {args.template}")
    logging.warning("Agent creation not yet implemented")


def launch_agent_command(args: argparse.Namespace) -> None:
    """Handle launch-agent command.
    
    Args:
        args: Command-line arguments
    """
    from openagents.agents.runner import AgentRunner
    
    try:
        # Load agent using AgentRunner.from_yaml
        logging.info(f"Loading agent from configuration: {args.config}")
        agent = AgentRunner.from_yaml(args.config)
        
        # Get agent information
        agent_id = agent.agent_id
        agent_type = type(agent).__name__
        
        logging.info(f"Loaded agent '{agent_id}' of type '{agent_type}'")
        
        # Prepare connection settings - prioritize command line arguments over config file
        connection_settings = {}
        
        # Load config file to get connection settings if needed
        config_path = Path(args.config)
        if config_path.exists():
            try:
                with open(config_path, 'r') as file:
                    config = yaml.safe_load(file)
                
                # Get connection settings from config file
                if 'connection' in config:
                    conn_config = config['connection']
                    connection_settings.update(conn_config)
            except Exception as e:
                logging.warning(f"Could not read connection settings from config file: {e}")
        
        # Override with command line arguments (if provided)
        if args.host is not None:
            connection_settings['host'] = args.host
        if args.port is not None:
            connection_settings['port'] = args.port
        if args.network_id is not None:
            connection_settings['network_id'] = args.network_id
        
        # Apply defaults for any missing settings
        host = connection_settings.get('host', 'localhost')
        port = connection_settings.get('port', 8570)
        network_id = connection_settings.get('network_id')
        
        # Start the agent and wait for it to stop
        try:
            logging.info(f"Starting agent '{agent_id}' - connecting to {host}:{port}")
            if network_id:
                logging.info(f"Target network ID: {network_id}")
            
            # Start the agent
            agent.start(
                host=host,
                port=port,
                network_id=network_id,
                metadata={"agent_type": agent_type, "config_file": args.config}
            )
            
            # Wait for the agent to stop
            agent.wait_for_stop()
            
        except KeyboardInterrupt:
            logging.info("Agent stopped by user")
            agent.stop()
        except Exception as e:
            logging.error(f"Error running agent: {e}")
            agent.stop()
            
    except FileNotFoundError as e:
        logging.error(f"Configuration file not found: {e}")
        return
    except ValueError as e:
        logging.error(f"Invalid configuration: {e}")
        return
    except ImportError as e:
        logging.error(f"Failed to import agent class: {e}")
        return
    except Exception as e:
        logging.error(f"Failed to load agent: {e}")
        return


def main(argv: Optional[List[str]] = None) -> int:
    """Main entry point for the CLI.
    
    Args:
        argv: Command-line arguments (defaults to sys.argv[1:])
        
    Returns:
        int: Exit code
    """
    parser = argparse.ArgumentParser(
        description="OpenAgents - A flexible framework for building multi-agent systems"
    )
    parser.add_argument("--log-level", default="INFO", 
                        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
                        help="Logging level")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose debugging output")
    
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Network command group
    network_parser = subparsers.add_parser("network", help="Network management commands")
    network_subparsers = network_parser.add_subparsers(dest="network_action", help="Network actions")
    
    # network create
    network_create_parser = network_subparsers.add_parser("create", help="Create a new network from template")
    network_create_parser.add_argument("template", nargs="?", help="Network template name")
    network_create_parser.add_argument("--name", help="Network name")
    network_create_parser.add_argument("--port", type=int, help="Network port")
    
    # network start
    network_start_parser = network_subparsers.add_parser("start", help="Start a network")
    network_start_parser.add_argument("config", nargs="?", help="Path to network configuration file or network name (optional if workspace has network.yaml)")
    network_start_parser.add_argument("--workspace", help="Path to workspace directory for persistent storage")
    network_start_parser.add_argument("--detach", action="store_true", help="Run in background")
    network_start_parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    
    # network stop
    network_stop_parser = network_subparsers.add_parser("stop", help="Stop a running network")
    network_stop_parser.add_argument("name", nargs="?", help="Network name to stop")
    
    # network list
    network_list_parser = network_subparsers.add_parser("list", help="List networks")
    network_list_parser.add_argument("--status", action="store_true", help="Show status information")
    
    # network info
    network_info_parser = network_subparsers.add_parser("info", help="Show network information")
    network_info_parser.add_argument("name", help="Network name")
    
    # network logs
    network_logs_parser = network_subparsers.add_parser("logs", help="Show network logs")
    network_logs_parser.add_argument("name", help="Network name")
    network_logs_parser.add_argument("--follow", action="store_true", help="Follow log output")
    
    # network interact
    network_interact_parser = network_subparsers.add_parser("interact", help="Connect to a network interactively")
    network_interact_parser.add_argument("--network", help="Network ID to connect to")
    network_interact_parser.add_argument("--host", default="localhost", help="Server host address (default: localhost)")
    network_interact_parser.add_argument("--port", type=int, default=8570, help="Server port (default: 8570)")
    network_interact_parser.add_argument("--id", help="Agent ID (default: auto-generated)")
    
    # Agent command group
    agent_parser = subparsers.add_parser("agent", help="Agent management commands")
    agent_subparsers = agent_parser.add_subparsers(dest="agent_action", help="Agent actions")
    
    # agent create
    agent_create_parser = agent_subparsers.add_parser("create", help="Create a new agent from template")
    agent_create_parser.add_argument("template", help="Agent template name")
    agent_create_parser.add_argument("--name", help="Agent name")
    agent_create_parser.add_argument("--network", help="Network to connect to")
    
    # agent start
    agent_start_parser = agent_subparsers.add_parser("start", help="Start an agent")
    agent_start_parser.add_argument("config", help="Path to agent configuration file or agent name")
    agent_start_parser.add_argument("--network", help="Network ID to connect to (overrides config)")
    agent_start_parser.add_argument("--host", help="Server host address (overrides config)")
    agent_start_parser.add_argument("--port", type=int, help="Server port (overrides config)")
    agent_start_parser.add_argument("--detach", action="store_true", help="Run in background")
    
    # agent stop
    agent_stop_parser = agent_subparsers.add_parser("stop", help="Stop a running agent")
    agent_stop_parser.add_argument("name", help="Agent name to stop")
    
    # agent list
    agent_list_parser = agent_subparsers.add_parser("list", help="List agents")
    agent_list_parser.add_argument("--network", help="Filter by network")
    
    # agent logs
    agent_logs_parser = agent_subparsers.add_parser("logs", help="Show agent logs")
    agent_logs_parser.add_argument("name", help="Agent name")
    agent_logs_parser.add_argument("--follow", action="store_true", help="Follow log output")
    
    # Studio command (unchanged)
    studio_parser = subparsers.add_parser("studio", help="Launch OpenAgents Studio - a Jupyter-like web interface")
    studio_parser.add_argument("--host", default="localhost", help="Network host address (default: localhost)")
    studio_parser.add_argument("--port", type=int, default=8570, help="Network port (default: 8570)")
    studio_parser.add_argument("--studio-port", type=int, default=8055, help="Studio frontend port (default: 8055)")
    studio_parser.add_argument("--workspace", "-w", help="Path to workspace directory (default: ./openagents_workspace)")
    studio_parser.add_argument("--no-browser", action="store_true", help="Don't automatically open browser")
    
    # Legacy commands for backward compatibility
    legacy_launch_network_parser = subparsers.add_parser("launch-network", help="[DEPRECATED] Use 'network start' instead")
    legacy_launch_network_parser.add_argument("config", help="Path to network configuration file")
    legacy_launch_network_parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    
    legacy_connect_parser = subparsers.add_parser("connect", help="[DEPRECATED] Use 'network interact' instead")
    legacy_connect_parser.add_argument("--host", default="localhost", help="Server host address")
    legacy_connect_parser.add_argument("--port", type=int, default=8570, help="Server port (default: 8570)")
    legacy_connect_parser.add_argument("--id", help="Agent ID (default: auto-generated)")
    legacy_connect_parser.add_argument("--network-id", help="Network ID to connect to")
    
    legacy_launch_agent_parser = subparsers.add_parser("launch-agent", help="[DEPRECATED] Use 'agent start' instead")
    legacy_launch_agent_parser.add_argument("config", help="Path to agent YAML configuration file")
    legacy_launch_agent_parser.add_argument("--network-id", help="Network ID to connect to (overrides config file)")
    legacy_launch_agent_parser.add_argument("--host", help="Server host address (overrides config file)")
    legacy_launch_agent_parser.add_argument("--port", type=int, help="Server port (overrides config file)")
    
    # Parse arguments
    args = parser.parse_args(argv)
    
    # Set up logging
    setup_logging(args.log_level, args.verbose)
    
    try:
        if args.command == "network":
            handle_network_command(args)
        elif args.command == "agent":
            handle_agent_command(args)
        elif args.command == "studio":
            studio_command(args)
        # Legacy commands with deprecation warnings
        elif args.command == "launch-network":
            logging.warning("⚠️  'launch-network' is deprecated. Use 'openagents network start' instead.")
            launch_network_command(args)
        elif args.command == "connect":
            logging.warning("⚠️  'connect' is deprecated. Use 'openagents network interact' instead.")
            # Convert connect args to network interact format
            args.network = getattr(args, 'network_id', None)
            connect_command(args)
        elif args.command == "launch-agent":
            logging.warning("⚠️  'launch-agent' is deprecated. Use 'openagents agent start' instead.")
            # Convert legacy args to new format
            if hasattr(args, 'network_id'):
                args.network = args.network_id
            launch_agent_command(args)
        else:
            parser.print_help()
            return 1
        
        return 0
    except Exception as e:
        logging.error(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main()) 