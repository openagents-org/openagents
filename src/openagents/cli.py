#!/usr/bin/env python3
"""
OpenAgents CLI

Main entry point for the OpenAgents command-line interface.
"""

import argparse
import sys
import logging
from typing import List, Optional

from openagents.launchers.network_launcher import launch_network
from openagents.launchers.terminal_console import launch_console


def setup_logging(level: str = "INFO") -> None:
    """Set up logging configuration.
    
    Args:
        level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
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
    launch_network(args.config, args.runtime)


def connect_command(args: argparse.Namespace) -> None:
    """Handle connect command.
    
    Args:
        args: Command-line arguments
    """
    launch_console(args.ip, args.port, args.id)


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
    
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Launch network command
    launch_network_parser = subparsers.add_parser("launch-network", help="Launch a network")
    launch_network_parser.add_argument("config", help="Path to network configuration file")
    launch_network_parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    
    # Connect command
    connect_parser = subparsers.add_parser("connect", help="Connect to a network server")
    connect_parser.add_argument("--ip", required=True, help="Server IP address")
    connect_parser.add_argument("--port", type=int, default=8765, help="Server port (default: 8765)")
    connect_parser.add_argument("--id", help="Agent ID (default: auto-generated)")
    
    # Parse arguments
    args = parser.parse_args(argv)
    
    # Set up logging
    setup_logging(args.log_level)
    
    try:
        if args.command == "launch-network":
            launch_network_command(args)
        elif args.command == "connect":
            connect_command(args)
        else:
            parser.print_help()
            return 1
        
        return 0
    except Exception as e:
        logging.error(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main()) 