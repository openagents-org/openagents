#!/usr/bin/env python3
"""
Example script demonstrating how to use the OpenAgents CLI.
"""

import os
import sys
import subprocess

# Get the path to the network_config.yaml file
current_dir = os.path.dirname(os.path.abspath(__file__))
config_path = os.path.join(current_dir, "network_config.yaml")

# Run the network launcher CLI
cmd = [
    sys.executable,
    "-m", "openagents.cli.main",
    "--log-level", "INFO",
    "network", "launch",
    config_path,
    "--runtime", "60"  # Run for 60 seconds
]

print(f"Running command: {' '.join(cmd)}")
subprocess.run(cmd) 