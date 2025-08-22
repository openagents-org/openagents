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
from typing import List, Optional, Dict, Any

from openagents.launchers.network_launcher import async_launch_network, launch_network
from openagents.launchers.terminal_console import launch_console
from openagents.agents.simple_openai_agent import SimpleOpenAIAgentRunner
from openagents.agents.simple_echo_agent import SimpleEchoAgentRunner

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


async def studio_network_launcher(host: str, port: int, config_path: Optional[str] = None) -> None:
    """Launch the network for studio mode.
    
    Args:
        host: Host to bind the network to
        port: Port to bind the network to
        config_path: Optional path to custom network configuration
    """
    if config_path is None:
        config_path = create_default_studio_config(host, port)
        logging.info(f"Using default studio configuration: {config_path}")
    
    try:
        await async_launch_network(config_path, runtime=None)
    except Exception as e:
        logging.error(f"Failed to launch studio network: {e}")
        raise


def launch_studio_frontend(studio_port: int = 8055) -> subprocess.Popen:
    """Launch the studio frontend development server.
    
    Args:
        studio_port: Port for the studio frontend
        
    Returns:
        subprocess.Popen: The frontend process
    """
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
        install_process = subprocess.run(
            ["npm", "install"],
            cwd=studio_dir,
            capture_output=True,
            text=True
        )
        if install_process.returncode != 0:
            raise RuntimeError(f"Failed to install studio dependencies: {install_process.stderr}")
        logging.info("Studio dependencies installed successfully")
    
    # Start the development server
    env = os.environ.copy()
    env["PORT"] = str(studio_port)
    env["HOST"] = "0.0.0.0"
    env["DANGEROUSLY_DISABLE_HOST_CHECK"] = "true"
    
    logging.info(f"Starting studio frontend on port {studio_port}...")
    
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
    config_path = getattr(args, 'config', None)
    no_browser = args.no_browser
    
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
            await studio_network_launcher(network_host, network_port, config_path)
            
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


def launch_agent_command(args: argparse.Namespace) -> None:
    """Handle launch-agent command.
    
    Args:
        args: Command-line arguments
    """
    # Load agent configuration from YAML file
    try:
        with open(args.config, 'r') as file:
            config = yaml.safe_load(file)
    except Exception as e:
        logging.error(f"Failed to load agent configuration: {e}")
        return

    # Validate configuration
    if 'type' not in config:
        logging.error("Agent configuration must specify 'type'")
        return
    
    if 'config' not in config:
        logging.error("Agent configuration must include a 'config' section")
        return

    # Get the agent type and configuration
    agent_type = config['type']
    agent_config = config['config']
    
    # Create and launch the agent based on type
    try:
        # Check if the agent type is a fully qualified class path
        if '.' in agent_type:
            # Import the module and get the class
            module_path, class_name = agent_type.rsplit('.', 1)
            try:
                module = __import__(module_path, fromlist=[class_name])
                agent_class = getattr(module, class_name)
            except (ImportError, AttributeError) as e:
                logging.error(f"Failed to import agent class '{agent_type}': {e}")
                return
        else:
            # Handle predefined agent types
            if agent_type.lower() == 'openai':
                agent_class = SimpleOpenAIAgentRunner
            elif agent_type.lower() == 'simple':
                from openagents.agents.simple_agent import SimpleAgentRunner
                agent_class = SimpleAgentRunner
            elif agent_type.lower() == 'echo':
                agent_class = SimpleEchoAgentRunner
            else:
                logging.error(f"Unsupported predefined agent type: {agent_type}")
                logging.info("Supported predefined types: 'openai', 'simple', 'echo'")
                logging.info("Or use a fully qualified class path (e.g., 'openagents.agents.simple_agent.SimpleAgentRunner')")
                return
        
        # Create the agent using the config parameters directly as kwargs
        try:
            agent = agent_class(**agent_config)
            
            # Start the agent
            logging.info(f"Starting agent of type '{agent_type}' with ID '{agent_config.get('agent_id', 'unknown')}'")
            
            # Connection settings - prioritize command line arguments over config file
            host = args.host
            port = args.port
            network_id = args.network_id
            
            # If not provided in command line, try to get from config file
            if 'connection' in config:
                conn_config = config['connection']
                
                # Get host from config if not provided in command line
                if host is None:
                    host = conn_config.get('host')
                
                # Get port from config if not provided in command line
                if port is None:
                    port = conn_config.get('port')
                
                # Get network_id from config if not provided in command line
                if network_id is None:
                    # Support both network_id and network-id keys
                    network_id = conn_config.get('network_id') or conn_config.get('network-id')
            
            # Apply default values as last resort if still None
            if host is None:
                host = "localhost"
            if port is None:
                port = 8570
            
            # Start the agent and wait for it to stop
            try:
                # Start the agent
                agent.start(
                    host=host,
                    port=port,
                    network_id=network_id,
                    metadata={"agent_type": agent_type}
                )
                
                # Wait for the agent to stop
                agent.wait_for_stop()
                
            except KeyboardInterrupt:
                logging.info("Agent stopped by user")
                agent.stop()
            except Exception as e:
                logging.error(f"Error running agent: {e}")
                agent.stop()
            
        except TypeError as e:
            logging.error(f"Error creating agent: {e}")
            logging.error("Check that your configuration parameters match the agent's constructor")
            return
        except Exception as e:
            logging.error(f"Unexpected error creating agent: {e}")
            return
    except Exception as e:
        logging.error(f"Failed to create agent: {e}")
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
    
    # Launch network command
    launch_network_parser = subparsers.add_parser("launch-network", help="Launch a network")
    launch_network_parser.add_argument("config", help="Path to network configuration file")
    launch_network_parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    
    # Connect command
    connect_parser = subparsers.add_parser("connect", help="Connect to a network server")
    connect_parser.add_argument("--host", default="localhost", help="Server host address (required if --network-id is not provided)")
    connect_parser.add_argument("--port", type=int, default=8570, help="Server port (default: 8570)")
    connect_parser.add_argument("--id", help="Agent ID (default: auto-generated)")
    connect_parser.add_argument("--network-id", help="Network ID to connect to (required if --host is not provided)")
    
    # Launch agent command
    launch_agent_parser = subparsers.add_parser("launch-agent", help="Launch an agent from a configuration file")
    launch_agent_parser.add_argument("config", help="Path to agent configuration file")
    launch_agent_parser.add_argument("--network-id", help="Network ID to connect to (overrides config file)")
    launch_agent_parser.add_argument("--host", help="Server host address (overrides config file)")
    launch_agent_parser.add_argument("--port", type=int, help="Server port (overrides config file)")
    
    # Studio command
    studio_parser = subparsers.add_parser("studio", help="Launch OpenAgents Studio - a Jupyter-like web interface")
    studio_parser.add_argument("--host", default="localhost", help="Network host address (default: localhost)")
    studio_parser.add_argument("--port", type=int, default=8570, help="Network port (default: 8570)")
    studio_parser.add_argument("--studio-port", type=int, default=8055, help="Studio frontend port (default: 8055)")
    studio_parser.add_argument("--config", help="Path to custom network configuration file")
    studio_parser.add_argument("--no-browser", action="store_true", help="Don't automatically open browser")
    
    # Parse arguments
    args = parser.parse_args(argv)
    
    # Set up logging
    setup_logging(args.log_level, args.verbose)
    
    try:
        if args.command == "launch-network":
            launch_network_command(args)
        elif args.command == "connect":
            connect_command(args)
        elif args.command == "launch-agent":
            launch_agent_command(args)
        elif args.command == "studio":
            studio_command(args)
        else:
            parser.print_help()
            return 1
        
        return 0
    except Exception as e:
        logging.error(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main()) 