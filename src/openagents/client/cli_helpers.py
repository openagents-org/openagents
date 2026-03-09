"""
CLI helper utilities — logging, workspace init, studio launcher, port checks.

Shared functions used by multiple CLI command modules.
"""

import http.server
import logging
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
import typer
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)

try:
    from importlib.resources import files
except ImportError:
    from importlib_resources import files

from openagents.client.cli_shared import (
    LOCALHOST_HOSTS,
    OPENAGENTS_API_BASE,
    OPENAGENTS_RELAY_URL,
    console,
)

def setup_logging(level: str = "INFO", verbose: bool = False) -> None:
    """Set up logging configuration with Rich formatting.

    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        verbose: Whether to enable verbose mode
    """
    global VERBOSE_MODE
    VERBOSE_MODE = verbose

    import sys

    from rich.logging import RichHandler

    # Fix Windows console encoding for emoji/unicode support
    # This prevents UnicodeEncodeError on Windows with non-UTF-8 locales (e.g., GBK)
    if sys.platform == "win32":
        import io

        # Reconfigure stdout/stderr to use UTF-8 with error replacement
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        else:
            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer, encoding="utf-8", errors="replace"
            )

        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        else:
            sys.stderr = io.TextIOWrapper(
                sys.stderr.buffer, encoding="utf-8", errors="replace"
            )

    numeric_level = getattr(logging, level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError(f"Invalid log level: {level}")

    # Configure logging with Rich handler (file handler added later when workspace is known)
    logging.basicConfig(
        level=numeric_level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[
            RichHandler(console=console, rich_tracebacks=True, show_path=verbose),
        ]
    )


def configure_workspace_logging(workspace_path: Path) -> None:
    """Configure file logging to the workspace directory.

    This should be called once the workspace path is known to save logs
    to the workspace folder.

    Args:
        workspace_path: Path to the workspace directory
    """
    # Create a file handler for the workspace
    log_file = workspace_path / "openagents.log"
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))

    # Add to root logger
    root_logger = logging.getLogger()
    root_logger.addHandler(file_handler)

    logging.info(f"Logging to file: {log_file}")

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

        # Copy the main network.yaml template and inject version
        network_yaml_content = (template_files / "network.yaml").read_text()

        # Inject created_by_version into the network config
        from openagents import __version__
        config_dict = yaml.safe_load(network_yaml_content)
        if 'network' in config_dict:
            # Only set created_by_version if not already present
            if 'created_by_version' not in config_dict['network']:
                config_dict['network']['created_by_version'] = __version__

        with open(config_path, 'w') as f:
            yaml.dump(config_dict, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
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
            # Copy and inject version
            from openagents import __version__
            with open(template_path, 'r') as f:
                config_dict = yaml.safe_load(f)
            if 'network' in config_dict:
                # Only set created_by_version if not already present
                if 'created_by_version' not in config_dict['network']:
                    config_dict['network']['created_by_version'] = __version__
            with open(config_path, 'w') as f:
                yaml.dump(config_dict, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
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
            from openagents import __version__
            for item in default_network_path.iterdir():
                if item.is_file():
                    dest_path = workspace_path / item.name
                    # Special handling for network.yaml to inject version
                    if item.name == "network.yaml":
                        with open(item, 'r') as f:
                            config_dict = yaml.safe_load(f)
                        if 'network' in config_dict:
                            # Only set created_by_version if not already present
                            if 'created_by_version' not in config_dict['network']:
                                config_dict['network']['created_by_version'] = __version__
                        with open(dest_path, 'w') as f:
                            yaml.dump(config_dict, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
                        logging.info(f"Copied network.yaml to workspace")
                    else:
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





def parse_publish_to(publish_to: str) -> str:
    """Parse the --publish-to argument and extract the network ID.

    Supports both 'openagents://network-id' and 'network-id' formats.
    """
    if publish_to.startswith("openagents://"):
        return publish_to[len("openagents://"):]
    return publish_to


def is_localhost_or_private(host: str) -> bool:
    """Check if a host is localhost or a private IP address."""
    host = host.strip().lower()

    # Check against localhost variants
    if host in LOCALHOST_HOSTS:
        return True

    # Check for private IP ranges
    if (host.startswith("10.") or
        host.startswith("192.168.") or
        host.endswith(".local")):
        return True

    # Check for 172.16-31.x.x range
    if host.startswith("172."):
        parts = host.split(".")
        if len(parts) >= 2:
            try:
                second_octet = int(parts[1])
                if 16 <= second_octet <= 31:
                    return True
            except ValueError:
                pass

    return False


def connect_to_relay(local_port: int, timeout: int = 30) -> Dict[str, Any]:
    """Connect the local network to the OpenAgents relay server.

    Returns relay connection info including the public URL.
    """
    relay_connect_url = f"http://127.0.0.1:{local_port}/api/relay/connect"

    try:
        response = requests.post(
            relay_connect_url,
            json={"relay_url": OPENAGENTS_RELAY_URL},
            timeout=timeout
        )
        result = response.json()

        if result.get("success") and result.get("connected"):
            return {
                "success": True,
                "relay_url": result.get("relay_url"),
                "tunnel_id": result.get("tunnel_id"),
            }
        else:
            return {
                "success": False,
                "error": result.get("error", "Failed to connect to relay"),
            }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "Could not connect to local network (is it running?)",
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


def get_relay_status(local_port: int) -> Dict[str, Any]:
    """Get the current relay connection status."""
    relay_status_url = f"http://127.0.0.1:{local_port}/api/relay/status"

    try:
        response = requests.get(relay_status_url, timeout=5)
        return response.json()
    except Exception:
        return {"success": False, "connected": False}


def publish_network_to_openagents(
    network_id: str,
    api_key: str,
    host: str,
    port: int,
    network_name: Optional[str] = None,
    relay_url: Optional[str] = None,
    network_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Publish a network to the OpenAgents discovery server.

    Args:
        network_id: The ID to publish the network under
        api_key: OpenAgents API key for authentication
        host: Public host address
        port: Public port number
        network_name: Optional display name for the network
        relay_url: Optional relay URL if using relay tunneling
        network_profile: Optional profile dict from network's health endpoint

    Returns:
        Dict with success status and any error messages
    """
    publish_url = f"{OPENAGENTS_API_BASE}/networks/"

    # Use profile from network if available, otherwise use defaults
    if network_profile:
        profile_name = network_profile.get("name") or network_name or network_id
        profile_description = network_profile.get("description") or f"Network {network_id}"
        profile_tags = network_profile.get("tags", ["network"])
        profile_categories = network_profile.get("categories", [])
        profile_discoverable = network_profile.get("discoverable", True)
    else:
        profile_name = network_name or network_id
        profile_description = f"Network published via CLI"
        profile_tags = ["network", "cli"]
        profile_categories = []
        profile_discoverable = True

    # Prepare the network data
    network_data = {
        "id": network_id,
        "profile": {
            "name": profile_name,
            "description": profile_description,
            "host": host,
            "port": port,
            "discoverable": profile_discoverable,
            "tags": profile_tags,
            "categories": profile_categories,
            "country": "",
            "capacity": 100,
            "authentication": {"type": "none"},
        }
    }

    # Add relay URL if using relay
    if relay_url:
        network_data["profile"]["relay_url"] = relay_url
        network_data["profile"]["tags"].append("relay")

    try:
        response = requests.post(
            publish_url,
            json=network_data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=30
        )

        result = response.json()

        if response.ok and result.get("code") in [200, 201]:
            return {
                "success": True,
                "network_id": network_id,
                "message": "Network published successfully",
            }
        elif response.status_code == 401:
            return {
                "success": False,
                "error": "Invalid or expired API key",
            }
        else:
            return {
                "success": False,
                "error": result.get("message", f"Failed to publish (status {response.status_code})"),
            }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "Could not connect to OpenAgents API",
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


def validate_api_key(api_key: str) -> Dict[str, Any]:
    """Validate an OpenAgents API key.

    Returns organization info if valid, error otherwise.
    """
    validate_url = f"{OPENAGENTS_API_BASE}/networks/private"

    try:
        response = requests.get(
            validate_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15
        )

        result = response.json()

        if response.ok and result.get("code") == 200:
            data = result.get("data", {})
            return {
                "valid": True,
                "org_name": data.get("org_name", ""),
                "org_id": data.get("org_id", ""),
            }
        else:
            return {
                "valid": False,
                "error": result.get("message", "Invalid API key"),
            }
    except Exception as e:
        return {
            "valid": False,
            "error": str(e),
        }


