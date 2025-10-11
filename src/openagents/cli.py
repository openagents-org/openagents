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

    # Get the default workspace template from package resources
    try:
        # First, try to get the network.yaml template from package resources
        template_files = files("openagents.templates.default_workspace")
        
        # Copy the main network.yaml template
        network_yaml_content = (template_files / "network.yaml").read_text()
        with open(config_path, 'w') as f:
            f.write(network_yaml_content)
        logging.info(f"Created network.yaml in workspace")
        
    except (FileNotFoundError, ModuleNotFoundError):
        # Fallback to development mode path resolution
        script_dir = Path(__file__).parent
        
        # Try templates directory first (package mode)
        template_path = script_dir / "templates" / "default_workspace" / "network.yaml"
        if template_path.exists():
            shutil.copy2(template_path, config_path)
            logging.info(f"Copied network.yaml from templates to workspace")
        else:
            # Fallback to examples directory (development mode)
            project_root = script_dir.parent.parent
            default_workspace_path = project_root / "examples" / "default_workspace"
            
            if not default_workspace_path.exists():
                logging.error(f"Default workspace template not found: {default_workspace_path}")
                raise FileNotFoundError(
                    f"Default workspace template not found: {default_workspace_path}"
                )
            
            # Copy all files from default workspace to the new workspace
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


def launch_studio_with_package(studio_port: int = 8050) -> subprocess.Popen:
    """Launch studio using the installed openagents-studio package.

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
            raise RuntimeError(
                f"openagents-studio package directory not found.\n"
                f"Searched in: {', '.join(possible_studio_dirs)}\n"
                f"Try reinstalling with: pip install --upgrade openagents"
            )

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
        except Exception as e:
            raise RuntimeError(
                f"Failed to run openagents-studio with npx: {e}\n"
                f"Make sure Node.js and npm are properly installed.\n"
                f"Try reinstalling with: pip install --upgrade openagents"
            )

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
        except Exception as e:
            raise RuntimeError(
                f"openagents-studio binary not found in any of: {', '.join(possible_bin_paths)}\n"
                f"Also failed to run with npx: {e}\n"
                f"Try reinstalling with: pip install --upgrade openagents"
            )

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
    except FileNotFoundError:
        raise RuntimeError(f"Failed to execute openagents-studio binary: {studio_bin}")


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
            # Check Node.js/npm availability first
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
                console.print("[blue]🎨 Starting in standalone mode (frontend only)[/blue]")
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
            # Start frontend using the installed package
            console.print(f"[blue]🎨 Launching studio frontend on port {studio_port}...[/blue]")
            frontend_process = launch_studio_with_package(studio_port)

            # Start monitoring frontend output in background thread
            frontend_thread = threading.Thread(
                target=frontend_monitor, args=(frontend_process,), daemon=True
            )
            frontend_thread.start()

            # Small delay to let frontend start
            await asyncio.sleep(2)

            if skip_network:
                # Just wait for frontend without starting network
                if standalone:
                    # Explicit standalone mode
                    console.print(Panel(
                        "🎨 Studio frontend running in standalone mode\n"
                        "💡 Start a network separately with: [code]openagents network start[/code]",
                        title="[blue]🎨 Standalone Mode[/blue]",
                        border_style="blue"
                    ))
                else:
                    # Automatic standalone due to port conflict
                    console.print(Panel(
                        "🎨 Studio frontend running in standalone mode\n"
                        "💡 Start a network separately with: [code]openagents network start[/code]",
                        title="[yellow]⚠️  Standalone Mode (Port Conflict)[/yellow]",
                        border_style="yellow"
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

# Add subcommands to main app
app.add_typer(network_app, name="network")
app.add_typer(agent_app, name="agent")


@network_app.command("start")
def network_start(
    path: Optional[str] = typer.Argument(None, help="Path to network configuration file (.yaml) or workspace directory"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory (deprecated: use positional argument)"),
    port: Optional[int] = typer.Option(None, "--port", "-p", help="Network port (overrides config)"),
    detach: bool = typer.Option(False, "--detach", "-d", help="Run in background"),
    runtime: Optional[int] = typer.Option(None, "--runtime", "-t", help="Runtime in seconds"),
):
    """🚀 Start a network"""
    
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
                # Show status immediately when network starts successfully
                if not self.status_displayed and not self.has_error:
                    self.status_displayed = True
                    self.console.print()  # Add blank line  
                    self.console.print(Panel.fit(
                        f"[bold green]✅ OpenAgents network is online[/bold green]\n"
                        f"🌐 Network: [code]WorkspaceTestNetwork[/code]\n"
                        f"🔌 Check the logs above for host and port details",
                        border_style="green"
                    ))
                    self.console.print("[dim]Network is running... Press Ctrl+C to stop[/dim]")
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
            # Display status line once we have all the information and network is started
            if (not self.status_displayed and 
                self.network_started and 
                self.network_host and 
                self.network_ports and 
                not self.has_error):
                
                self.status_displayed = True
                ports_str = ", ".join(self.network_ports)
                self.console.print()  # Add blank line
                self.console.print(Panel.fit(
                    f"[bold green]✅ OpenAgents network is online[/bold green]\n"
                    f"🌐 Host: [code]{self.network_host}[/code]\n"
                    f"🔌 Ports: [code]{ports_str}[/code]",
                    border_style="green"
                ))
                self.console.print("[dim]Network is running... Press Ctrl+C to stop[/dim]")
                
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


@app.command("studio")
def studio(
    host: str = typer.Option("localhost", "--host", "-h", help="Network host address"),
    port: int = typer.Option(8700, "--port", "-p", help="Network port"),
    studio_port: int = typer.Option(8050, "--studio-port", help="Studio frontend port"),
    workspace: Optional[str] = typer.Option(None, "--workspace", "-w", help="Path to workspace directory"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't automatically open browser"),
    standalone: bool = typer.Option(False, "--standalone", "-s", help="Launch studio frontend only (without network)"),
):
    """🎨 Launch OpenAgents Studio - A beautiful web interface"""
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

[bold green]1. Quick Start with Studio:[/bold green]
   [code]openagents studio[/code]
   
[bold green]2. Start a Network:[/bold green]
   [code]openagents network start examples/my_network.yaml[/code]
   
[bold green]3. Connect to a Network:[/bold green]
   [code]openagents network interact --host localhost --port 8570[/code]
   
[bold green]4. Launch an Agent:[/bold green]
   [code]openagents agent start examples/my_agent.yaml[/code]
   
[bold green]5. Studio with Custom Workspace:[/bold green]
   [code]openagents studio --workspace ./my_workspace[/code]
   
[bold green]6. Network with Custom Port:[/bold green]
   [code]openagents network start --runtime 300 network.yaml[/code]

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
[bold blue] | |_| | |_) ||  __/| | | |       / /_// | (_| ||  __/| | | | | |_\\__ \\[/bold blue]
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
    
    # Show banner for the studio command (most common entry point)
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
