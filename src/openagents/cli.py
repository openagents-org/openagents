#!/usr/bin/env python3
"""
OpenAgents CLI

A beautiful command-line interface for OpenAgents multi-agent framework.
"""

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
import argparse
from pathlib import Path
try:
    from importlib.resources import files
except ImportError:
    # Python < 3.9 fallback
    from importlib_resources import files
from typing import List, Optional, Dict, Any, Tuple
import http.server
import socketserver
from urllib.parse import urlparse

import typer
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn, TimeElapsedColumn
from rich.text import Text
from rich.prompt import Confirm
from rich.live import Live
from rich.layout import Layout
from rich.columns import Columns
from rich import box

from openagents.launchers.network_launcher import async_launch_network, launch_network
from openagents.launchers.terminal_console import launch_console

# Initialize rich console
console = Console()

# Create main app with Rich help
app = typer.Typer(
    name="openagents",
    help="🤖 [bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration",
    add_completion=False,
    rich_markup_mode="rich"
)

# Global verbose flag that can be imported by other modules
VERBOSE_MODE = False


def setup_logging(level: str = "INFO", verbose: bool = False) -> None:
    """Set up logging configuration with Rich formatting.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        verbose: Whether to enable verbose mode
    """
    global VERBOSE_MODE
    VERBOSE_MODE = verbose

    from rich.logging import RichHandler

    numeric_level = getattr(logging, level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError(f"Invalid log level: {level}")

    # Configure logging with Rich handler
    logging.basicConfig(
        level=numeric_level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[
            RichHandler(console=console, rich_tracebacks=True, show_path=verbose),
            logging.FileHandler("openagents.log")
        ]
    )

    # Suppress noisy websockets connection logs in studio mode
    logging.getLogger("websockets.server").setLevel(logging.WARNING)
    logging.getLogger("websockets.protocol").setLevel(logging.WARNING)




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
        Path: Path to the network.yaml file in the workspace
    """
    # Create workspace directory if it doesn't exist
    workspace_path.mkdir(parents=True, exist_ok=True)

    config_path = workspace_path / "network.yaml"

    # Check if network.yaml already exists
    if config_path.exists():
        logging.info(f"Using existing workspace configuration: {config_path}")
        return config_path

    # Get the default network template from package resources
    try:
        # First, try to get the network.yaml template from package resources
        template_files = files("openagents.templates.default_network")

        # Copy the main network.yaml template
        network_yaml_content = (template_files / "network.yaml").read_text()
        with open(config_path, 'w') as f:
            f.write(network_yaml_content)
        logging.info(f"Created network.yaml in workspace")

        # Copy README.md if it exists
        try:
            readme_content = (template_files / "README.md").read_text()
            with open(workspace_path / "README.md", 'w') as f:
                f.write(readme_content)
            logging.info(f"Created README.md in workspace")
        except (FileNotFoundError, TypeError):
            logging.debug("No README.md template found, skipping")

        # Copy the agents directory if it exists
        try:
            agents_template = files("openagents.templates.default_network.agents")
            agents_dir = workspace_path / "agents"
            agents_dir.mkdir(parents=True, exist_ok=True)

            # Copy agent YAML and Python files
            for item in agents_template.iterdir():
                if item.name.endswith('.yaml') or item.name.endswith('.py'):
                    if item.name == '__init__.py':
                        continue
                    agent_content = item.read_text()
                    with open(agents_dir / item.name, 'w') as f:
                        f.write(agent_content)
                    logging.info(f"Created agents/{item.name} in workspace")
        except (FileNotFoundError, ModuleNotFoundError):
            logging.debug("No agents template found, skipping")

        # Create events, tools, mods directories with .keep files
        for folder_name, description in [
            ("events", "Place AsyncAPI event definition files here"),
            ("tools", "Place custom tool Python files here"),
            ("mods", "Place custom mod files here"),
        ]:
            folder_path = workspace_path / folder_name
            folder_path.mkdir(parents=True, exist_ok=True)
            keep_file = folder_path / ".keep"
            if not keep_file.exists():
                with open(keep_file, 'w') as f:
                    f.write(f"# {description}\n")
            logging.info(f"Created {folder_name}/ directory in workspace")

    except (FileNotFoundError, ModuleNotFoundError):
        # Fallback to development mode path resolution
        script_dir = Path(__file__).parent

        # Try templates directory first (package mode)
        template_path = script_dir / "templates" / "default_network" / "network.yaml"
        if template_path.exists():
            shutil.copy2(template_path, config_path)
            logging.info(f"Copied network.yaml from templates to workspace")

            # Copy README.md if it exists
            readme_path = script_dir / "templates" / "default_network" / "README.md"
            if readme_path.exists():
                shutil.copy2(readme_path, workspace_path / "README.md")
                logging.info(f"Copied README.md to workspace")

            # Also copy agents directory if it exists
            agents_template_path = script_dir / "templates" / "default_network" / "agents"
            if agents_template_path.exists():
                agents_dir = workspace_path / "agents"
                shutil.copytree(agents_template_path, agents_dir, dirs_exist_ok=True)
                # Remove __init__.py and __pycache__ from copied agents
                init_file = agents_dir / "__init__.py"
                if init_file.exists():
                    init_file.unlink()
                pycache_dir = agents_dir / "__pycache__"
                if pycache_dir.exists():
                    shutil.rmtree(pycache_dir)
                logging.info(f"Copied agents directory to workspace")

            # Create events, tools, mods directories with .keep files
            for folder_name, description in [
                ("events", "Place AsyncAPI event definition files here"),
                ("tools", "Place custom tool Python files here"),
                ("mods", "Place custom mod files here"),
            ]:
                folder_path = workspace_path / folder_name
                folder_path.mkdir(parents=True, exist_ok=True)
                keep_file = folder_path / ".keep"
                if not keep_file.exists():
                    with open(keep_file, 'w') as f:
                        f.write(f"# {description}\n")
                logging.info(f"Created {folder_name}/ directory in workspace")
        else:
            # Fallback to examples directory (development mode)
            project_root = script_dir.parent.parent
            default_network_path = project_root / "examples" / "default_network"

            if not default_network_path.exists():
                logging.error(f"Default network template not found: {default_network_path}")
                raise FileNotFoundError(
                    f"Default network template not found: {default_network_path}"
                )

            # Copy all files from default network to the new workspace
            for item in default_network_path.iterdir():
                if item.is_file():
                    dest_path = workspace_path / item.name
                    shutil.copy2(item, dest_path)
                    logging.info(f"Copied {item.name} to workspace")
                elif item.is_dir():
                    dest_dir = workspace_path / item.name
                    shutil.copytree(item, dest_dir, dirs_exist_ok=True)
                    logging.info(f"Copied directory {item.name} to workspace")

            # Create events, tools, mods directories with .keep files
            for folder_name, description in [
                ("events", "Place AsyncAPI event definition files here"),
                ("tools", "Place custom tool Python files here"),
                ("mods", "Place custom mod files here"),
            ]:
                folder_path = workspace_path / folder_name
                folder_path.mkdir(parents=True, exist_ok=True)
                keep_file = folder_path / ".keep"
                if not keep_file.exists():
                    with open(keep_file, 'w') as f:
                        f.write(f"# {description}\n")
                logging.info(f"Created {folder_name}/ directory in workspace")

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
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)

        if not config:
            raise ValueError("Configuration file is empty")

        logging.info(f"Loaded workspace configuration from: {config_path}")
        return config

    except Exception as e:
        logging.error(f"Failed to load workspace configuration: {e}")
        raise ValueError(f"Failed to load workspace configuration: {e}")


def create_default_network_config(host: str = "localhost", port: int = 8700) -> str:
    """Create a default network configuration by copying from template.

    Args:
        host: Host to bind the network to
        port: Port to bind the network to

    Returns:
        str: Path to the created configuration file
    """
    # Create .openagents/my-network directory
    openagents_dir = Path.home() / ".openagents" / "my-network"
    openagents_dir.mkdir(parents=True, exist_ok=True)
    
    config_path = openagents_dir / "network.yaml"
    
    # Find the default network template in the package templates directory
    script_dir = Path(__file__).parent
    template_path = script_dir / "templates" / "default_network.yaml"

    if not template_path.exists():
        raise FileNotFoundError(f"Default network template not found: {template_path}")
    
    # Copy template and update host/port
    try:
        with open(template_path, "r") as f:
            config = yaml.safe_load(f)
        
        # Update network host and port
        if "network" in config:
            config["network"]["host"] = host
            config["network"]["port"] = port
        
        # Update network profile host and port
        if "network_profile" in config:
            config["network_profile"]["host"] = host
            config["network_profile"]["port"] = port
        
        with open(config_path, "w") as f:
            yaml.dump(config, f, default_flow_style=False)
        
        return str(config_path)
        
    except Exception as e:
        raise RuntimeError(f"Failed to create default network config: {e}")


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
                "max_message_size": 104857600,
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
                        "enable_message_history": True,
                    },
                },
                {
                    "name": "openagents.mods.discovery.agent_discovery",
                    "enabled": True,
                    "config": {
                        "announce_interval": 30,
                        "cleanup_interval": 60,
                        "agent_timeout": 120,
                    },
                },
            ],
        },
        "network_profile": {
            "discoverable": True,
            "name": "OpenAgents Studio Network",
            "description": "A local OpenAgents network for studio development",
            "host": host,
            "port": port,
            "required_openagents_version": "0.5.1",
        },
        "log_level": "INFO",
    }

    # Create temporary config file
    temp_dir = tempfile.gettempdir()
    config_path = os.path.join(temp_dir, "openagents_studio_network.yaml")

    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False)

    return config_path


async def studio_network_launcher(workspace_path: Optional[Path], host: str, port: int) -> None:
    """Launch the network for studio mode using workspace configuration or default config.

    Args:
        workspace_path: Path to the workspace directory (optional)
        host: Host to bind the network to
        port: Port to bind the network to
    """
    try:
        if workspace_path:
            # Load workspace configuration
            config = load_workspace_config(workspace_path)

            # Override network host and port with command line arguments
            if "network" not in config:
                config["network"] = {}

            config["network"]["host"] = host
            config["network"]["port"] = port

            # Add workspace metadata to the configuration
            if "metadata" not in config:
                config["metadata"] = {}
            config["metadata"]["workspace_path"] = str(workspace_path.resolve())

            # Create temporary config file with updated settings
            temp_dir = tempfile.gettempdir()
            temp_config_path = os.path.join(
                temp_dir, "openagents_studio_workspace_network.yaml"
            )

            with open(temp_config_path, "w") as f:
                yaml.dump(config, f, default_flow_style=False)

            logging.info(f"Using workspace configuration from: {workspace_path}")
        else:
            # Use default network configuration
            temp_config_path = create_default_network_config(host, port)
            logging.info(f"Created default network configuration at: {temp_config_path}")

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
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    if result.returncode == 0 and result.stdout:
                        lines = result.stdout.strip().split("\n")
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
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    if result.returncode == 0 and result.stdout:
                        lines = result.stdout.strip().split("\n")
                        for line in lines[1:]:  # Skip header
                            if f":{port}" in line:
                                # Extract process info from ss output
                                if "users:" in line:
                                    users_part = line.split("users:")[1]
                                    if "pid=" in users_part:
                                        pid_part = (
                                            users_part.split("pid=")[1]
                                            .split(",")[0]
                                            .split(")")[0]
                                        )
                                        return False, f"Process (PID: {pid_part})"
                return False, "unknown process"
            except Exception:
                return False, "unknown process"
        else:
            return False, f"bind error: {e}"


def check_studio_ports(
    network_host: str, network_port: int, studio_port: int
) -> Tuple[bool, List[str]]:
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
    network_available, network_process = check_port_availability(
        network_host, network_port
    )
    if not network_available:
        conflicts.append(
            f"🌐 Network port {network_port}: occupied by {network_process}"
        )

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
    """Check if Node.js and npm are available on the system, and verify Node.js version >= v20.

    Returns:
        tuple: (is_available, error_message)
    """
    missing_tools = []
    version_issues = []

    # On Windows, we need shell=True to find executables in PATH
    is_windows = sys.platform.startswith('win')

    # Check for Node.js and its version
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            check=True,
            text=True,
            shell=is_windows
        )
        node_version = result.stdout.strip()
        # Parse version string (e.g., "v20.1.0" -> 20)
        if node_version.startswith('v'):
            major_version = int(node_version[1:].split('.')[0])
            if major_version < 20:
                version_issues.append(f"Node.js version {node_version} (requires >= v20)")
        else:
            version_issues.append(f"Node.js version {node_version} (cannot parse version)")
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("Node.js")

    # Check for npm
    try:
        subprocess.run(
            ["npm", "--version"],
            capture_output=True,
            check=True,
            shell=is_windows
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("npm")

    # Check for npx
    try:
        subprocess.run(
            ["npx", "--version"],
            capture_output=True,
            check=True,
            shell=is_windows
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        missing_tools.append("npx")

    if missing_tools or version_issues:
        problems = []
        if missing_tools:
            problems.append(f"Missing: {', '.join(missing_tools)}")
        if version_issues:
            problems.append(f"Version issues: {', '.join(version_issues)}")
        
        error_msg = f"""[red]❌ Node.js/npm compatibility issues:[/red] {'; '.join(problems)}

OpenAgents Studio requires [bold]Node.js >= v20[/bold] and [bold]npm[/bold] to run the web interface.

[bold blue]📋 Installation instructions:[/bold blue]

🍎 [bold]macOS:[/bold]
   [code]brew install node[/code]
   # or download from: https://nodejs.org/

🐧 [bold]Ubuntu/Debian:[/bold]
   [code]sudo apt update && sudo apt install nodejs npm[/code]
   # or: [code]curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs[/code]

🎩 [bold]CentOS/RHEL/Fedora:[/bold]
   [code]sudo dnf install nodejs npm[/code]
   # or: [code]curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo dnf install nodejs[/code]

🪟 [bold]Windows:[/bold]
   Download from: https://nodejs.org/
   # or: [code]winget install OpenJS.NodeJS[/code]

🔧 [bold]Alternative - Use nvm (Node Version Manager):[/bold]
   [code]curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash[/code]
   [code]nvm install --lts[/code]
   [code]nvm use --lts[/code]

[bold green]After installation, verify with:[/bold green]
   [code]node --version && npm --version[/code]

Then run [code]openagents studio[/code] again.
"""
        return False, error_msg

    return True, ""


def check_openagents_studio_package() -> Tuple[bool, bool, str]:
    """Check if openagents-studio package is installed and up-to-date.

    Returns:
        tuple: (is_installed, is_latest, installed_version)
    """
    openagents_prefix = os.path.expanduser("~/.openagents")
    is_windows = sys.platform.startswith('win')

    # Check if package is installed
    try:
        result = subprocess.run(
            ["npm", "list", "-g", "openagents-studio", "--prefix", openagents_prefix],
            capture_output=True,
            text=True,
            shell=is_windows
        )
        
        if result.returncode != 0:
            return False, False, ""
            
        # Extract version from npm list output
        lines = result.stdout.strip().split('\n')
        for line in lines:
            if 'openagents-studio@' in line:
                installed_version = line.split('@')[-1].strip()
                break
        else:
            return False, False, ""
            
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False, False, ""
    
    # Check latest version on npm
    try:
        result = subprocess.run(
            ["npm", "view", "openagents-studio", "version"],
            capture_output=True,
            text=True,
            shell=is_windows
        )
        
        if result.returncode != 0:
            # If we can't check latest version, assume installed version is OK
            return True, True, installed_version
            
        latest_version = result.stdout.strip()
        is_latest = installed_version == latest_version
        
        return True, is_latest, installed_version
        
    except (FileNotFoundError, subprocess.CalledProcessError):
        # If we can't check latest version, assume installed version is OK
        return True, True, installed_version


def install_openagents_studio_package(progress=None, task_id=None) -> None:
    """Install openagents-studio package and dependencies to ~/.openagents prefix.

    Args:
        progress: Optional Rich Progress instance to use for progress updates
        task_id: Optional task ID for progress updates
    """
    import threading
    import time

    openagents_prefix = os.path.expanduser("~/.openagents")
    is_windows = sys.platform.startswith('win')

    # Ensure the prefix directory exists
    os.makedirs(openagents_prefix, exist_ok=True)

    logging.info("Installing openagents-studio package and dependencies...")
    
    # Progress tracking variables
    progress_stages = [
        "📦 Resolving dependencies...",
        "⬇️  Downloading packages...",
        "🔧 Installing packages...",
        "🎯 Finalizing installation..."
    ]
    current_stage = 0
    process_complete = False
    
    def update_progress():
        nonlocal current_stage, process_complete
        start_time = time.time()
        
        while not process_complete:
            elapsed = time.time() - start_time
            
            # Update stage based on elapsed time (rough estimates)
            if elapsed > 5 and current_stage < 1:
                current_stage = 1
                if progress and task_id:
                    progress.update(task_id, description=progress_stages[1], completed=25)
            elif elapsed > 15 and current_stage < 2:
                current_stage = 2
                if progress and task_id:
                    progress.update(task_id, description=progress_stages[2], completed=60)
            elif elapsed > 30 and current_stage < 3:
                current_stage = 3
                if progress and task_id:
                    progress.update(task_id, description=progress_stages[3], completed=90)
            else:
                # Increment progress slowly for the current stage
                if progress and task_id:
                    current_progress = min(progress.tasks[task_id].completed + 1, 95)
                    progress.update(task_id, completed=current_progress)
            
            time.sleep(1)
    
    # Start progress update thread if we have progress context
    if progress and task_id:
        progress.update(task_id, description=progress_stages[0], completed=5)
        progress_thread = threading.Thread(target=update_progress, daemon=True)
        progress_thread.start()
    
    try:
        # On Windows, npm with --prefix can have issues, so we use a different approach
        if is_windows:
            # Install globally without --prefix, but set npm config to use custom location
            install_cmd = [
                "npm", "install", "-g",
                "openagents-studio",
                f"--prefix={openagents_prefix}",
            ]
        else:
            install_cmd = [
                "npm", "install", "-g",
                "openagents-studio",
                "--prefix", openagents_prefix,
                "--silent"  # Reduce npm output noise
            ]

        install_process = subprocess.run(
            install_cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout for npm install
            shell=is_windows
        )
        
        process_complete = True
        if progress and task_id:
            progress.update(task_id, description="✅ Installation complete!", completed=100)
        
        if install_process.returncode != 0:
            raise RuntimeError(
                f"Failed to install openagents-studio package:\n{install_process.stderr}"
            )
            
        logging.info("openagents-studio package installed successfully")
        
    except subprocess.TimeoutExpired:
        process_complete = True
        raise RuntimeError(
            "npm install timed out after 10 minutes. Please check your internet connection and try again."
        )
    except FileNotFoundError:
        process_complete = True
        raise RuntimeError("npm command not found. Please install Node.js and npm.")


def _find_studio_build_dir() -> Optional[str]:
    """Find the studio build directory from the installed package.
    
    Returns:
        Optional[str]: Path to the studio build directory, or None if not found
    """
    # Try importlib.resources first (for installed packages)
    try:
        studio_resources = files("openagents").joinpath("studio", "build")
        if studio_resources.is_dir():
            # Check if index.html exists
            try:
                index_file = studio_resources.joinpath("index.html")
                if index_file.is_file():
                    return str(studio_resources)
            except (AttributeError, TypeError):
                pass
    except (ModuleNotFoundError, AttributeError, TypeError):
        pass
    
    # Try to find build directory in multiple locations
    script_dir = os.path.dirname(os.path.abspath(__file__))
    package_dir = os.path.dirname(script_dir)  # src/openagents
    project_root = os.path.dirname(os.path.dirname(script_dir))  # project root
    
    possible_paths = [
        # In installed package (src/openagents/studio/build)
        os.path.join(package_dir, "studio", "build"),
        # In current project root (development: studio/build)
        os.path.join(project_root, "studio", "build"),
        # Alternative: relative to package
        os.path.join(os.path.dirname(package_dir), "studio", "build"),
    ]
    
    # Check other possible paths
    for path in possible_paths:
        if path and os.path.exists(path) and os.path.isdir(path):
            index_html = os.path.join(path, "index.html")
            if os.path.exists(index_html):
                return path
    
    return None


def _create_studio_handler(build_dir):
    """Create a custom HTTP request handler for serving Studio static files.
    
    Args:
        build_dir: Directory containing the built static files
        
    Returns:
        A handler class configured for the build directory
    """
    class StudioHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
        """Custom HTTP request handler for serving Studio static files with SPA routing support."""
        
        def __init__(self, *args, **kwargs):
            # Change to build directory before initializing
            original_cwd = os.getcwd()
            try:
                os.chdir(build_dir)
                super().__init__(*args, **kwargs)
            finally:
                os.chdir(original_cwd)
        
        def translate_path(self, path):
            """Translate URL path to file system path."""
            # Parse the path
            path = urlparse(path).path
            # Remove leading slash
            path = path.lstrip('/')
            
            # If path is empty or just '/', serve index.html
            if not path or path == '/':
                return os.path.join(build_dir, 'index.html')
            
            # Check if file exists
            full_path = os.path.join(build_dir, path)
            if os.path.exists(full_path) and os.path.isfile(full_path):
                return full_path
            
            # For SPA routing, if the path doesn't exist as a file, serve index.html
            # This allows React Router to handle client-side routing
            return os.path.join(build_dir, 'index.html')
        
        def end_headers(self):
            """Add CORS headers and custom headers."""
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()
        
        def log_message(self, format, *args):
            """Suppress default logging, we'll handle it ourselves."""
            pass
    
    return StudioHTTPRequestHandler


def launch_studio_static(studio_port: int = 8050) -> subprocess.Popen:
    """Launch studio using Python's built-in HTTP server to serve static files.
    
    This function does not require Node.js and serves pre-built static files.
    
    Args:
        studio_port: Port for the studio frontend
        
    Returns:
        subprocess.Popen: The HTTP server process
        
    Raises:
        RuntimeError: If studio build directory is not found
    """
    build_dir = _find_studio_build_dir()
    
    if not build_dir:
        raise RuntimeError(
            "Studio build directory not found. "
            "Please ensure the package was installed with the built frontend files. "
            "If you're a developer, run 'npm run build' in the studio directory first."
        )
    
    logging.info(f"Serving studio static files from {build_dir} on port {studio_port}")
    
    # Create a custom handler class for the build directory
    HandlerClass = _create_studio_handler(build_dir)
    
    # Create and start the server in a separate thread
    httpd = socketserver.TCPServer(("", studio_port), HandlerClass)
    httpd.allow_reuse_address = True
    
    def run_server():
        try:
            httpd.serve_forever()
        except Exception as e:
            logging.error(f"HTTP server error: {e}")
    
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    
    # Wait a moment to ensure server started
    time.sleep(0.5)
    
    # Create a mock process object that behaves like subprocess.Popen
    class MockProcess:
        def __init__(self, httpd, thread):
            self.httpd = httpd
            self.thread = thread
            self.returncode = None
            self.stdout = None
            self.stderr = None
        
        def wait(self):
            """Wait for the server thread to finish."""
            self.thread.join()
        
        def terminate(self):
            """Shutdown the HTTP server."""
            if self.httpd:
                self.httpd.shutdown()
                self.httpd.server_close()
        
        def kill(self):
            """Kill the HTTP server."""
            self.terminate()
        
        def poll(self):
            """Check if server is still running."""
            return None if self.thread.is_alive() else 0
    
    return MockProcess(httpd, server_thread)


def launch_studio_with_package(studio_port: int = 8050) -> subprocess.Popen:
    """Launch studio using the installed openagents-studio package.
    
    Falls back to static file server if npm package is not available.

    Args:
        studio_port: Port for the studio frontend

    Returns:
        subprocess.Popen: The studio process
    """
    openagents_prefix = os.path.expanduser("~/.openagents")
    is_windows = sys.platform.startswith('win')

    # Set up environment
    env = os.environ.copy()
    env["PORT"] = str(studio_port)
    env["HOST"] = "0.0.0.0"
    env["DANGEROUSLY_DISABLE_HOST_CHECK"] = "true"

    # On Windows, increase Node.js memory limit to avoid buffer allocation errors
    # Also disable source maps which can cause memory issues
    if is_windows:
        env["NODE_OPTIONS"] = "--max-old-space-size=4096"
        env["GENERATE_SOURCEMAP"] = "false"
        # Use polling for file watching to reduce memory usage on Windows
        env["CHOKIDAR_USEPOLLING"] = "true"
        env["WATCHPACK_POLLING"] = "true"

    # On Windows, npm global installs with --prefix don't reliably create wrapper scripts,
    # so we use npx directly which is more reliable
    if is_windows:
        logging.info(f"Starting openagents-studio on port {studio_port} using npx...")

        # Try to find the openagents-studio directory
        possible_studio_dirs = [
            os.path.join(openagents_prefix, "node_modules", "openagents-studio"),
            os.path.join(openagents_prefix, "lib", "node_modules", "openagents-studio"),
        ]

        studio_dir = None
        for dir_path in possible_studio_dirs:
            if os.path.exists(dir_path):
                studio_dir = dir_path
                break

        if not studio_dir:
            # Fallback to static file server
            logging.info("npm package not found, falling back to static file server (no Node.js required)")
            return launch_studio_static(studio_port)

        try:
            # Call craco directly to avoid the Unix-style env var syntax in npm scripts
            # The environment variables (PORT, HOST, DANGEROUSLY_DISABLE_HOST_CHECK) are set via env parameter
            process = subprocess.Popen(
                ["npx", "craco", "start"],
                env=env,
                cwd=studio_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                shell=True
            )
            return process
        except (FileNotFoundError, Exception) as e:
            # Fallback to static file server if npm/npx is not available
            logging.info(f"Failed to start with npm (Node.js may not be installed), falling back to static file server: {e}")
            return launch_studio_static(studio_port)

    # On Unix-like systems, try to find the binary first
    possible_bin_paths = [
        os.path.join(openagents_prefix, "bin", "openagents-studio"),
        os.path.join(openagents_prefix, "node_modules", ".bin", "openagents-studio"),
    ]

    # Find the first existing binary
    studio_bin = None
    for bin_path in possible_bin_paths:
        if os.path.exists(bin_path):
            studio_bin = bin_path
            break

    if not studio_bin:
        # Try using npx as a fallback on Unix systems too
        logging.warning(f"openagents-studio binary not found, trying npx...")
        try:
            process = subprocess.Popen(
                ["npx", "--prefix", openagents_prefix, "openagents-studio", "start"],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )
            return process
        except (FileNotFoundError, Exception) as e:
            # Fallback to static file server if npm/npx is not available
            logging.info(f"Failed to start with npm (Node.js may not be installed), falling back to static file server: {e}")
            return launch_studio_static(studio_port)

    # Set up environment with PATH including ~/.openagents/bin
    current_path = env.get("PATH", "")
    openagents_bin_dir = os.path.join(openagents_prefix, "bin")
    env["PATH"] = f"{openagents_bin_dir}:{current_path}"

    logging.info(f"Starting openagents-studio on port {studio_port}...")

    try:
        process = subprocess.Popen(
            [studio_bin, "start"],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )
        return process
    except (FileNotFoundError, Exception) as e:
        # Fallback to static file server if binary execution fails
        logging.info(f"Failed to execute npm binary, falling back to static file server: {e}")
        return launch_studio_static(studio_port)


def launch_studio_frontend(studio_port: int = 8050) -> subprocess.Popen:
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

    is_windows = sys.platform.startswith('win')

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
                timeout=300,  # 5 minute timeout for npm install
                shell=is_windows
            )
            if install_process.returncode != 0:
                raise RuntimeError(
                    f"Failed to install studio dependencies:\n{install_process.stderr}"
                )
            logging.info("Studio dependencies installed successfully")
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                "npm install timed out after 5 minutes. Please check your internet connection and try again."
            )
        except FileNotFoundError:
            # This shouldn't happen since we checked above, but just in case
            raise RuntimeError("npm command not found. Please install Node.js and npm.")

    # Start the development server
    env = os.environ.copy()
    env["PORT"] = str(studio_port)
    env["HOST"] = "0.0.0.0"
    env["DANGEROUSLY_DISABLE_HOST_CHECK"] = "true"

    # On Windows, increase Node.js memory limit and optimize file watching
    if is_windows:
        env["NODE_OPTIONS"] = "--max-old-space-size=4096"
        env["GENERATE_SOURCEMAP"] = "false"
        env["CHOKIDAR_USEPOLLING"] = "true"
        env["WATCHPACK_POLLING"] = "true"

    logging.info(f"Starting studio frontend on port {studio_port}...")

    try:
        # Use npx to run craco start to ensure our webpack configuration is applied
        # This ensures our PORT value takes precedence over the package.json
        process = subprocess.Popen(
            ["npx", "craco", "start"],
            cwd=studio_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
            shell=is_windows
        )
        return process
    except FileNotFoundError:
        # This shouldn't happen since we checked above, but just in case
        raise RuntimeError("npx command not found. Please install Node.js and npm.")


def studio_command(args) -> None:
    """Handle studio command with Rich styling.

    Args:
        args: Command-line arguments (can be argparse.Namespace or SimpleNamespace)
    """
    import asyncio

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        startup_task = progress.add_task("🚀 Starting OpenAgents Studio...", total=None)

        try:
            # Check if we have a pre-built studio (no Node.js required)
            progress.update(startup_task, description="🔍 Checking for pre-built frontend...")
            build_dir = _find_studio_build_dir()
            use_static_server = build_dir is not None
            
            if use_static_server:
                console.print(f"[green]✅ Found pre-built frontend at: {build_dir}[/green]")
                console.print("[blue]ℹ️  Running in static mode (Node.js not required)[/blue]")
            else:
                # No pre-built frontend, need Node.js
                console.print("[yellow]⚠️  Pre-built frontend not found, checking Node.js...[/yellow]")
                progress.update(startup_task, description="🔍 Checking Node.js/npm availability...")
                is_available, error_msg = check_nodejs_availability()
                if not is_available:
                    console.print(Panel(
                        error_msg,
                        title="[red]❌ Node.js Requirements[/red]",
                        border_style="red"
                    ))
                    raise typer.Exit(1)

                # Check and install openagents-studio package if needed
                progress.update(startup_task, description="📦 Checking openagents-studio package...")
                is_installed, is_latest, installed_version = check_openagents_studio_package()

                if not is_installed:
                    # Create a separate task for installation with progress bar
                    install_task = progress.add_task("📦 Installing openagents-studio package...", total=100)
                    install_openagents_studio_package(progress, install_task)
                    progress.remove_task(install_task)
                elif not is_latest:
                    # Create a separate task for update with progress bar
                    install_task = progress.add_task(f"📦 Updating openagents-studio from {installed_version}...", total=100)
                    install_openagents_studio_package(progress, install_task)
                    progress.remove_task(install_task)
                else:
                    console.print(f"[green]✅ openagents-studio package up-to-date ({installed_version})[/green]")

            # Extract arguments
            network_host = args.host
            network_port = args.port
            studio_port = args.studio_port
            workspace_path = getattr(args, "workspace", None)
            no_browser = args.no_browser
            standalone = getattr(args, "standalone", False)

            # Determine workspace path (optional)
            if workspace_path:
                workspace_path = Path(workspace_path).resolve()
                console.print(f"[blue]📁 Using workspace: {workspace_path}[/blue]")
            else:
                workspace_path = None
                console.print("[blue]📁 Using default network configuration[/blue]")

            # Check for port conflicts early
            progress.update(startup_task, description="🔍 Checking port availability...")
            
            # Check studio port availability
            studio_available, studio_process = check_port_availability("0.0.0.0", studio_port)
            if not studio_available:
                alt_studio_port = studio_port
                for offset in range(1, 20):
                    test_port = studio_port + offset
                    if test_port > 65535:
                        break
                    available, _ = check_port_availability("0.0.0.0", test_port)
                    if available:
                        alt_studio_port = test_port
                        break

                error_panel = Panel(
                    f"🎨 Studio port {studio_port}: occupied by {studio_process}\n\n"
                    f"💡 Solutions:\n"
                    f"1️⃣  Use alternative port: [code]openagents studio --studio-port {alt_studio_port}[/code]\n"
                    f"2️⃣  Stop the conflicting process: [code]sudo lsof -ti:{studio_port} | xargs kill[/code]",
                    title="[red]❌ Studio Port Conflict[/red]",
                    border_style="red"
                )
                console.print(error_panel)
                raise typer.Exit(1)

            # Handle standalone mode or check network port availability
            if standalone:
                skip_network = True
                console.print("[blue]🎨 Starting Studio frontend (connect to an existing network)[/blue]")
            else:
                # Check network port availability 
                network_available, network_process = check_port_availability(network_host, network_port)
                skip_network = False
                
                if not network_available:
                    if network_port == 8700:  # Default network port
                        console.print(f"[yellow]⚠️  Default network port {network_port} is occupied by {network_process}[/yellow]")
                        console.print("[yellow]🎨 Will start studio frontend only (network backend skipped)[/yellow]")
                        skip_network = True
                    else:
                        # Custom port specified, show error
                        error_panel = Panel(
                            f"🌐 Network port {network_port}: occupied by {network_process}\n\n"
                            f"💡 Solutions:\n"
                            f"1️⃣  Use different port: [code]openagents studio --port <available-port>[/code]\n"
                            f"2️⃣  Stop the conflicting process: [code]sudo lsof -ti:{network_port} | xargs kill[/code]\n"
                            f"3️⃣  Use standalone mode: [code]openagents studio --standalone[/code]\n"
                            f"4️⃣  Use default port and skip network: [code]openagents studio[/code] (without --port)",
                            title="[red]❌ Network Port Conflict[/red]",
                            border_style="red"
                        )
                        console.print(error_panel)
                        raise typer.Exit(1)

                if not skip_network:
                    console.print("[green]✅ All ports are available[/green]")

            progress.update(startup_task, description="[green]✅ Pre-flight checks complete![/green]")

        except Exception as e:
            progress.update(startup_task, description=f"[red]❌ Setup failed: {e}[/red]")
            raise

    def frontend_monitor(process):
        """Monitor frontend process output and detect when it's ready."""
        # Check if this is a static file server (MockProcess) which doesn't have stdout
        if hasattr(process, 'httpd') or (hasattr(process, 'stdout') and process.stdout is None):
            # Static file server - it's ready immediately
            studio_url = f"http://localhost:{studio_port}"
            if not no_browser:
                time.sleep(1)  # Brief delay to ensure server is ready
                console.print(f"[green]🌐 Opening studio in browser: {studio_url}[/green]")
                webbrowser.open(studio_url)
            else:
                console.print(f"[green]🌐 Studio is ready at: {studio_url}[/green]")
            return
        
        # For npm-based servers, monitor stdout
        ready_detected = False
        for line in iter(process.stdout.readline, ""):
            if line:
                # Print frontend output with prefix using Rich
                console.print(f"[dim]\\[Studio][/dim] {line.rstrip()}")

                # Detect when the development server is ready
                if not ready_detected and (
                    "webpack compiled" in line.lower()
                    or "compiled successfully" in line.lower()
                    or "local:" in line.lower()
                ):
                    ready_detected = True
                    studio_url = f"http://localhost:{studio_port}"

                    if not no_browser:
                        # Wait a moment then open browser
                        time.sleep(2)
                        console.print(f"[green]🌐 Opening studio in browser: {studio_url}[/green]")
                        webbrowser.open(studio_url)
                    else:
                        console.print(f"[green]🌐 Studio is ready at: {studio_url}[/green]")

    async def run_studio():
        """Run the complete studio setup."""
        frontend_process = None

        try:
            # Start frontend - use static server if build exists, otherwise use npm
            console.print(f"[blue]🎨 Launching studio frontend on port {studio_port}...[/blue]")
            if use_static_server:
                # Use static file server (no Node.js required)
                frontend_process = launch_studio_static(studio_port)
            else:
                # Use npm package (requires Node.js)
                frontend_process = launch_studio_with_package(studio_port)

            # Check if this is a static file server (no Node.js required)
            is_static_server = hasattr(frontend_process, 'httpd') or (
                hasattr(frontend_process, 'stdout') and frontend_process.stdout is None
            )
            
            if is_static_server:
                # Static file server starts immediately, no need to monitor stdout
                studio_url = f"http://localhost:{studio_port}"
                console.print(f"[green]✅ Studio is ready at: {studio_url}[/green]")
                if not no_browser:
                    await asyncio.sleep(1)  # Brief delay to ensure server is ready
                    console.print(f"[green]🌐 Opening studio in browser: {studio_url}[/green]")
                    webbrowser.open(studio_url)
            else:
                # Start monitoring frontend output in background thread for npm-based servers
                frontend_thread = threading.Thread(
                    target=frontend_monitor, args=(frontend_process,), daemon=True
                )
                frontend_thread.start()

                # Small delay to let frontend start
                await asyncio.sleep(2)

            if skip_network:
                # Just wait for frontend without starting network
                console.print(Panel(
                    f"🎨 Studio frontend running on http://localhost:{studio_port}\n"
                    f"🔗 Configure network connection in Studio settings\n\n"
                    f"💡 To start a network: [code]openagents network start[/code]",
                    title="[blue]🎨 OpenAgents Studio[/blue]",
                    border_style="blue"
                ))
                frontend_process.wait()
            else:
                # Launch network (this will run indefinitely)
                console.print(f"[blue]🌐 Starting network on {network_host}:{network_port}...[/blue]")
                await studio_network_launcher(workspace_path, network_host, network_port)

        except KeyboardInterrupt:
            console.print("\n[yellow]📱 Studio shutdown requested...[/yellow]")
        except Exception as e:
            console.print(f"[red]❌ Studio error: {e}[/red]")
            raise
        finally:
            # Clean up frontend process
            if frontend_process:
                console.print("[blue]🔄 Shutting down studio frontend...[/blue]")
                frontend_process.terminate()
                try:
                    frontend_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    frontend_process.kill()
                    frontend_process.wait()
                console.print("[green]✅ Studio frontend shutdown complete[/green]")

    try:
        asyncio.run(run_studio())
    except KeyboardInterrupt:
        console.print("\n[green]✅ OpenAgents Studio stopped[/green]")
    except Exception as e:
        console.print(f"[red]❌ Failed to start OpenAgents Studio: {e}[/red]")
        raise typer.Exit(1)






# ============================================================================
# Typer Command Definitions
# ============================================================================

# Network command group
network_app = typer.Typer(
    name="network",
    help="🌐 Network management commands",
    rich_markup_mode="rich"
)

# Agent command group  
agent_app = typer.Typer(
    name="agent", 
    help="🤖 Agent management commands",
    rich_markup_mode="rich"
)

# Agents command group (plural) for bulk operations
agents_app = typer.Typer(
    name="agents",
    help="🤖🤖 Bulk agent management commands",
    rich_markup_mode="rich"
)

# Certs command group for SSL/TLS certificate management
certs_app = typer.Typer(
    name="certs",
    help="🔐 Certificate management commands",
    rich_markup_mode="rich"
)

# Add subcommands to main app
app.add_typer(network_app, name="network")
app.add_typer(agent_app, name="agent")
app.add_typer(agents_app, name="agents")
app.add_typer(certs_app, name="certs")


@network_app.command("start")
def network_start(
    path: Optional[str] = typer.Argument(None, help="Path to network configuration file (.yaml) or workspace directory (default: ~/.openagents/network)"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory (deprecated: use positional argument)"),
    port: Optional[int] = typer.Option(None, "--port", "-p", help="Network port (overrides config)"),
    detach: bool = typer.Option(False, "--detach", "-d", help="Run in background"),
    runtime: Optional[int] = typer.Option(None, "--runtime", "-t", help="Runtime in seconds"),
):
    """🚀 Start a network"""

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
        def __init__(self, console):
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
    
    network_status = NetworkStatusHandler(console)
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


@app.command("studio")
def studio(
    host: str = typer.Option("localhost", "--host", "-h", help="Network host address"),
    port: int = typer.Option(8700, "--port", "-p", help="Network port"),
    studio_port: int = typer.Option(8050, "--studio-port", help="Studio frontend port"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't automatically open browser"),
    standalone: bool = typer.Option(True, "--standalone", "-s", help="Launch studio frontend only (kept for backward compatibility)"),
):
    """🎨 Launch OpenAgents Studio - A beautiful web interface

    By default, launches only the Studio frontend on port 8050.
    Connect it to a running network (e.g., at localhost:8700).
    """
    import asyncio
    from types import SimpleNamespace
    
    console.print(Panel.fit(
        "[bold blue]🚀 OpenAgents Studio[/bold blue]\n"
        "A beautiful web interface for AI agent collaboration",
        border_style="blue"
    ))

    # Convert to old args format for compatibility
    args = SimpleNamespace(
        host=host,
        port=port, 
        studio_port=studio_port,
        workspace=workspace,
        no_browser=no_browser,
        standalone=standalone
    )
    
    studio_command(args)


@app.command("version")
def version():
    """📖 Show version information"""
    try:
        from openagents import __version__
        console.print(Panel.fit(
            f"[bold blue]OpenAgents[/bold blue] [green]v{__version__}[/green]\n"
            "🤖 AI Agent Networks for Open Collaboration",
            border_style="blue"
        ))
    except ImportError:
        console.print("[yellow]⚠️  Version information not available[/yellow]")


@app.command("examples")
def show_examples():
    """📚 Show usage examples"""
    examples_text = """
[bold blue]🚀 Common Usage Examples:[/bold blue]

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

[bold cyan]📖 For more information, visit:[/bold cyan]
   [link]https://github.com/openagents-org/openagents[/link]
"""
    
    console.print(Panel(
        examples_text,
        title="[bold blue]📚 OpenAgents Examples[/bold blue]",
        border_style="blue",
        expand=False
    ))


@app.command("init")  
def init_workspace(
    path: Optional[str] = typer.Argument(None, help="Workspace directory path"),
    force: bool = typer.Option(False, "--force", "-f", help="Overwrite existing workspace"),
):
    """🏗️ Initialize a new OpenAgents workspace"""
    workspace_path = Path(path) if path else get_default_workspace_path()
    
    if workspace_path.exists() and not force:
        if workspace_path.is_dir() and any(workspace_path.iterdir()):
            console.print(f"[red]❌ Directory already exists and is not empty: {workspace_path}[/red]")
            console.print("[yellow]💡 Use --force to overwrite existing content[/yellow]")
            raise typer.Exit(1)
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("🏗️ Creating workspace...", total=None)
        
        try:
            config_path = initialize_workspace(workspace_path)
            progress.update(task, description="[green]✅ Workspace created successfully!")
            
            console.print(Panel.fit(
                f"[bold green]🎉 Workspace initialized![/bold green]\n\n"
                f"📁 Location: [code]{workspace_path}[/code]\n"
                f"⚙️  Config: [code]{config_path}[/code]\n\n"
                f"[bold cyan]Next steps:[/bold cyan]\n"
                f"1. [code]cd {workspace_path}[/code]\n"
                f"2. [code]openagents studio[/code]",
                border_style="green"
            ))
            
        except Exception as e:
            progress.update(task, description=f"[red]❌ Failed to create workspace: {e}[/red]")
            console.print(f"[red]Error: {e}[/red]")
            raise typer.Exit(1)


# ============================================================================
# Certificate Management Commands
# ============================================================================

@certs_app.command("generate")
def certs_generate(
    output: str = typer.Option("./certs", "--output", "-o", help="Output directory for certificates"),
    common_name: str = typer.Option("localhost", "--common-name", "-cn", help="Common name for the certificate"),
    days: int = typer.Option(365, "--days", "-d", help="Number of days the certificate is valid"),
    san: Optional[List[str]] = typer.Option(None, "--san", help="Subject Alternative Names (can be used multiple times)"),
):
    """
    Generate self-signed certificates for development.
    
    Creates a CA certificate and server certificate for local development and testing.
    """
    from openagents.utils.cert_generator import CertificateGenerator
    
    try:
        console.print(f"[blue]🔐 Generating certificates in {output}...[/blue]")
        
        paths = CertificateGenerator.generate_self_signed(
            output_dir=output,
            common_name=common_name,
            days_valid=days,
            san_names=list(san) if san else None
        )
        
        console.print()
        console.print("[green]✅ Certificate generation successful![/green]")
        console.print()
        console.print(f"[cyan]📄 CA Certificate:[/cyan] {paths['ca_cert']}")
        console.print(f"[cyan]📄 Server Certificate:[/cyan] {paths['server_cert']}")
        console.print(f"[cyan]🔑 Server Key:[/cyan] {paths['server_key']}")
        console.print()
        
        # Show example configuration
        console.print("[yellow]📋 Example network.yaml configuration:[/yellow]")
        console.print()
        example_config = f"""[dim]transports:
  - type: grpc
    config:
      port: 8600
      tls:
        enabled: true
        cert_file: "{paths['server_cert']}"
        key_file: "{paths['server_key']}"
        ca_file: "{paths['ca_cert']}"[/dim]"""
        console.print(example_config)
        console.print()
        
        console.print("[green]💡 Tip:[/green] Use [cyan]openagents certs verify[/cyan] to check certificate details")
        
    except Exception as e:
        console.print(f"[red]❌ Failed to generate certificates: {e}[/red]")
        raise typer.Exit(1)


@certs_app.command("verify")
def certs_verify(
    cert_file: str = typer.Argument(..., help="Path to certificate file to verify"),
):
    """
    Verify and display information about a certificate file.
    
    Shows certificate details including subject, issuer, validity period, and SAN.
    """
    from openagents.utils.cert_generator import CertificateGenerator
    from datetime import datetime
    
    try:
        cert_path = Path(cert_file)
        if not cert_path.exists():
            console.print(f"[red]❌ Certificate file not found: {cert_file}[/red]")
            raise typer.Exit(1)
        
        console.print(f"[blue]🔍 Verifying certificate: {cert_file}[/blue]")
        console.print()
        
        info = CertificateGenerator.verify_certificate(cert_file)
        
        # Create a rich table for certificate info
        table = Table(title="Certificate Information", show_header=False, box=box.ROUNDED)
        table.add_column("Field", style="cyan", no_wrap=True)
        table.add_column("Value", style="white")
        
        table.add_row("Subject", info["subject"])
        table.add_row("Issuer", info["issuer"])
        table.add_row("Valid From", info["valid_from"])
        table.add_row("Valid Until", info["valid_until"])
        table.add_row("Serial Number", info["serial"])
        if info.get("san"):
            table.add_row("Subject Alt Names", info["san"])
        
        console.print(table)
        console.print()
        
        # Check if certificate is expired
        valid_until = datetime.fromisoformat(info["valid_until"])
        if valid_until < datetime.now():
            console.print("[red]⚠️  Certificate has expired![/red]")
        else:
            days_left = (valid_until - datetime.now()).days
            if days_left < 30:
                console.print(f"[yellow]⚠️  Certificate expires in {days_left} days[/yellow]")
            else:
                console.print(f"[green]✅ Certificate is valid (expires in {days_left} days)[/green]")
        
    except Exception as e:
        console.print(f"[red]❌ Failed to verify certificate: {e}[/red]")
        raise typer.Exit(1)


# Global options callback
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
                                                                      
[bold cyan]🤖 AI Agent Networks for Open Collaboration[/bold cyan]
[dim]   Create and manage distributed AI agent networks with ease[/dim]
"""
    console.print(Panel(
        banner_text.strip(),
        border_style="blue",
        expand=False
    ))


@app.callback()
def main(
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
    🤖 [bold blue]OpenAgents[/bold blue] - AI Agent Networks for Open Collaboration
    
    Create and manage distributed AI agent networks with ease.
    """
    setup_logging(log_level, verbose)
    
    # Show banner for studio command (network start shows banner after startup completes)
    if not no_banner and len(sys.argv) > 1 and sys.argv[1] == 'studio':
        show_banner()


def cli_main():
    """Entry point for the CLI"""
    try:
        app()
    except KeyboardInterrupt:
        console.print("\n[yellow]👋 Goodbye![/yellow]")
        sys.exit(0)
    except Exception as e:
        console.print(f"[red]❌ Unexpected error: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli_main()
