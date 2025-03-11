#!/usr/bin/env python3
"""
OpenAgents CLI

Main entry point for the OpenAgents command-line interface.
"""

import argparse
import sys
import logging
from typing import List, Optional

from openagents.cli.network_launcher import launch_network


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


def network_command(args: argparse.Namespace) -> None:
    """Handle network subcommand.
    
    Args:
        args: Command-line arguments
    """
    if args.network_action == "launch":
        launch_network(args.config, args.runtime)
    else:
        print(f"Unknown network action: {args.network_action}")
        sys.exit(1)


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
    
    # Network command
    network_parser = subparsers.add_parser("network", help="Network management commands")
    network_subparsers = network_parser.add_subparsers(dest="network_action", help="Network action")
    
    # Network launch command
    launch_parser = network_subparsers.add_parser("launch", help="Launch a network")
    launch_parser.add_argument("config", help="Path to network configuration file")
    launch_parser.add_argument("--runtime", type=int, help="Runtime in seconds (default: run indefinitely)")
    
    # Parse arguments
    args = parser.parse_args(argv)
    
    # Set up logging
    setup_logging(args.log_level)
    
    try:
        if args.command == "network":
            network_command(args)
        else:
            parser.print_help()
            return 1
        
        return 0
    except Exception as e:
        logging.error(f"Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main()) 