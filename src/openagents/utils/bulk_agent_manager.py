#!/usr/bin/env python3
"""
Bulk Agent Manager for OpenAgents

This module provides utilities for discovering, starting, and managing multiple agents
from a directory of YAML configuration files.
"""

import asyncio
import logging
import yaml
import signal
import sys
import os
import ast
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
import threading
import time

from openagents.agents.runner import AgentRunner

logger = logging.getLogger(__name__)


@dataclass
class AgentInfo:
    """Information about an agent configuration."""
    config_path: Path
    agent_id: str
    agent_type: str
    connection_settings: Dict
    file_type: str = "yaml"  # "yaml" or "python"
    is_valid: bool = True
    error_message: Optional[str] = None


@dataclass
class AgentInstance:
    """A running agent instance."""
    info: AgentInfo
    runner: Optional[AgentRunner] = None
    process: Optional[subprocess.Popen] = None
    status: str = "stopped"  # stopped, starting, running, error, stopping
    error_message: Optional[str] = None
    start_time: Optional[float] = None
    log_buffer: List[str] = None
    pid: Optional[int] = None
    
    def __post_init__(self):
        if self.log_buffer is None:
            self.log_buffer = []


class BulkAgentManager:
    """Manages multiple agents from YAML configurations in a directory."""
    
    def __init__(self):
        self.agents: Dict[str, AgentInstance] = {}
        self.running = False
        self._shutdown_event = threading.Event()
        self._executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="AgentRunner")
        self._setup_grpc_environment()
        self._setup_error_filtering()
        
    def _setup_grpc_environment(self):
        """Configure gRPC environment to prevent BlockingIOError."""
        # Aggressive gRPC optimization to prevent resource errors
        os.environ['GRPC_POLL_STRATEGY'] = 'poll'  # Use more stable polling
        os.environ['GRPC_ENABLE_FORK_SUPPORT'] = '1'
        os.environ['GRPC_SO_REUSEPORT'] = '0'  # Disable to prevent conflicts
        
        # Minimize gRPC resource usage
        os.environ['GRPC_VERBOSITY'] = 'NONE'
        os.environ['GRPC_TRACE'] = ''
        
        # Set resource limits to prevent overload
        os.environ['GRPC_MAX_SEND_MESSAGE_LENGTH'] = '4194304'  # 4MB
        os.environ['GRPC_MAX_RECEIVE_MESSAGE_LENGTH'] = '4194304'  # 4MB
        
        # Configure asyncio to handle more concurrent connections
        try:
            import asyncio
            if hasattr(asyncio, 'set_event_loop_policy'):
                # Use a more robust event loop policy
                if sys.platform != 'win32':
                    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())
        except Exception:
            pass
    
    def _setup_error_filtering(self):
        """Setup logging filter to suppress BlockingIOError messages."""
        class BlockingIOErrorFilter(logging.Filter):
            def filter(self, record):
                # Suppress BlockingIOError and gRPC connection messages
                if hasattr(record, 'msg'):
                    msg = str(record.msg)
                    if any(pattern in msg for pattern in [
                        'BlockingIOError',
                        'Resource temporarily unavailable',
                        'PollerCompletionQueue._handle_events',
                        'failed to connect to all addresses',
                        'Connection refused'
                    ]):
                        return False
                return True
        
        # Apply filter to root logger and asyncio logger
        root_logger = logging.getLogger()
        asyncio_logger = logging.getLogger('asyncio')
        grpc_logger = logging.getLogger('grpc')
        
        blocker_filter = BlockingIOErrorFilter()
        root_logger.addFilter(blocker_filter)
        asyncio_logger.addFilter(blocker_filter)
        grpc_logger.addFilter(blocker_filter)
        
    def discover_agents(self, directory: Path) -> List[AgentInfo]:
        """Discover and validate agent configurations in a directory.
        
        Args:
            directory: Directory to scan for YAML and Python files
            
        Returns:
            List of AgentInfo objects for valid agent configurations
        """
        agent_configs = []
        
        # Find YAML files
        yaml_files = list(directory.glob("*.yaml")) + list(directory.glob("*.yml"))
        
        # Find Python files
        python_files = list(directory.glob("*.py"))
        
        all_files = yaml_files + python_files
        
        if not all_files:
            logger.warning(f"No YAML or Python agent files found in {directory}")
            return []
        
        logger.info(f"Found {len(yaml_files)} YAML files and {len(python_files)} Python files")
        
        # Process YAML files
        for yaml_file in yaml_files:
            try:
                agent_info = self._parse_agent_config(yaml_file)
                if agent_info:
                    agent_configs.append(agent_info)
            except Exception as e:
                logger.error(f"Error parsing {yaml_file}: {e}")
                # Still add invalid configs for user feedback
                agent_configs.append(AgentInfo(
                    config_path=yaml_file,
                    agent_id=yaml_file.stem,
                    agent_type="unknown",
                    connection_settings={},
                    file_type="yaml",
                    is_valid=False,
                    error_message=str(e)
                ))
        
        # Process Python files
        for python_file in python_files:
            try:
                agent_info = self._parse_python_agent(python_file)
                if agent_info:
                    agent_configs.append(agent_info)
            except Exception as e:
                logger.error(f"Error parsing {python_file}: {e}")
                # Still add invalid configs for user feedback
                agent_configs.append(AgentInfo(
                    config_path=python_file,
                    agent_id=python_file.stem,
                    agent_type="python_agent",
                    connection_settings={},
                    file_type="python",
                    is_valid=False,
                    error_message=str(e)
                ))
        
        return agent_configs
    
    def _parse_agent_config(self, config_path: Path) -> Optional[AgentInfo]:
        """Parse a single YAML agent configuration.
        
        Args:
            config_path: Path to the YAML configuration file
            
        Returns:
            AgentInfo if valid agent config, None if not an agent config
        """
        try:
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            # Check if this is an agent configuration (not a network config)
            if not config or 'type' not in config:
                logger.debug(f"Skipping {config_path}: not an agent config (no 'type' field)")
                return None
            
            # Skip network configurations
            if 'network' in config and 'agent_id' not in config:
                logger.debug(f"Skipping {config_path}: appears to be a network config")
                return None
            
            # Extract agent information
            agent_type = config.get('type', 'unknown')
            agent_id = config.get('agent_id', config_path.stem)
            connection_settings = config.get('connection', {})
            
            return AgentInfo(
                config_path=config_path,
                agent_id=agent_id,
                agent_type=agent_type,
                connection_settings=connection_settings,
                file_type="yaml",
                is_valid=True
            )
            
        except Exception as e:
            logger.error(f"Error parsing config {config_path}: {e}")
            raise
    
    def _parse_python_agent(self, python_path: Path) -> Optional[AgentInfo]:
        """Parse a single Python agent file.
        
        Args:
            python_path: Path to the Python agent file
            
        Returns:
            AgentInfo if valid Python agent, None if not an agent file
        """
        try:
            with open(python_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Parse the Python file using AST
            tree = ast.parse(content, filename=str(python_path))
            
            agent_class = None
            agent_id = None
            default_network_host = "localhost"
            default_network_port = 8700
            
            # Look for agent class definitions and metadata
            for node in ast.walk(tree):
                # Find classes that inherit from agent base classes
                if isinstance(node, ast.ClassDef):
                    # Check if it inherits from known agent classes
                    for base in node.bases:
                        base_name = self._get_ast_name(base)
                        if base_name in ['WorkerAgent', 'SimpleAgent', 'CollaboratorAgent', 'AgentRunner']:
                            agent_class = node.name
                            break
                
                # Look for default_agent_id attribute
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name) and target.id == 'default_agent_id':
                            if isinstance(node.value, ast.Constant):
                                agent_id = node.value.value
                
                # Look for network connection calls in main() or start()
                if isinstance(node, ast.Call):
                    func_name = self._get_ast_name(node.func)
                    if func_name in ['start', 'async_start']:
                        # Extract network_host and network_port from arguments
                        for keyword in node.keywords:
                            if keyword.arg == 'network_host':
                                if isinstance(keyword.value, ast.Constant):
                                    default_network_host = keyword.value.value
                            elif keyword.arg == 'network_port':
                                if isinstance(keyword.value, ast.Constant):
                                    default_network_port = keyword.value.value
            
            # Check if this looks like an agent file
            if not agent_class:
                logger.debug(f"Skipping {python_path}: no agent class found")
                return None
            
            # Check for if __name__ == "__main__" block
            has_main_block = any(
                isinstance(node, ast.If) and 
                isinstance(node.test, ast.Compare) and
                isinstance(node.test.left, ast.Name) and
                node.test.left.id == '__name__' and
                any(isinstance(comp, ast.Constant) and comp.value == '__main__' 
                    for comp in node.test.comparators)
                for node in tree.body
            )
            
            if not has_main_block:
                logger.debug(f"Skipping {python_path}: no __main__ block found")
                return None
            
            # Use filename as agent_id if not found in code
            if not agent_id:
                agent_id = python_path.stem
            
            return AgentInfo(
                config_path=python_path,
                agent_id=agent_id,
                agent_type=agent_class,
                connection_settings={
                    "host": default_network_host,
                    "port": default_network_port
                },
                file_type="python",
                is_valid=True
            )
            
        except Exception as e:
            logger.error(f"Error parsing Python file {python_path}: {e}")
            raise
    
    def _get_ast_name(self, node: ast.AST) -> str:
        """Extract name from an AST node (handles Name, Attribute, etc.)."""
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Attribute):
            return node.attr
        elif isinstance(node, ast.Call):
            return self._get_ast_name(node.func)
        return ""
    
    def add_agents(self, agent_infos: List[AgentInfo]) -> None:
        """Add agent configurations to the manager.
        
        Args:
            agent_infos: List of agent configurations to add
        """
        for info in agent_infos:
            if info.agent_id in self.agents:
                logger.warning(f"Agent ID '{info.agent_id}' already exists, skipping")
                continue
                
            self.agents[info.agent_id] = AgentInstance(info=info)
    
    async def start_agent(self, agent_id: str, connection_override: Optional[Dict] = None) -> bool:
        """Start a single agent using subprocess.
        
        Args:
            agent_id: ID of the agent to start
            connection_override: Optional connection settings to override config
            
        Returns:
            True if agent started successfully, False otherwise
        """
        if agent_id not in self.agents:
            logger.error(f"Agent '{agent_id}' not found")
            return False
        
        agent_instance = self.agents[agent_id]
        
        if not agent_instance.info.is_valid:
            logger.error(f"Agent '{agent_id}' has invalid configuration: {agent_instance.info.error_message}")
            agent_instance.status = "error"
            agent_instance.error_message = agent_instance.info.error_message
            return False
        
        if agent_instance.status == "running":
            logger.warning(f"Agent '{agent_id}' is already running")
            return True
        
        try:
            agent_instance.status = "starting"
            agent_instance.start_time = time.time()
            agent_instance.error_message = None
            
            # Prepare connection settings
            connection_settings = agent_instance.info.connection_settings.copy()
            if connection_override:
                connection_settings.update(connection_override)
            
            # Build command based on file type
            if agent_instance.info.file_type == "yaml":
                # YAML agent: use openagents CLI
                cmd = [
                    sys.executable, "-m", "openagents.cli", "agent", "start",
                    str(agent_instance.info.config_path)
                ]
                
                # Add connection overrides as CLI arguments
                if connection_settings.get("host"):
                    cmd.extend(["--network-host", connection_settings["host"]])
                if connection_settings.get("port"):
                    cmd.extend(["--network-port", str(connection_settings["port"])])
                if connection_settings.get("network_id"):
                    cmd.extend(["--network-id", connection_settings["network_id"]])
            
            elif agent_instance.info.file_type == "python":
                # Python agent: direct execution
                cmd = [sys.executable, str(agent_instance.info.config_path)]
            
            else:
                raise ValueError(f"Unsupported file type: {agent_instance.info.file_type}")
            
            # Set environment variables for Python agents
            env = os.environ.copy()
            if agent_instance.info.file_type == "python":
                env["OPENAGENTS_NETWORK_HOST"] = connection_settings.get("host", "localhost")
                env["OPENAGENTS_NETWORK_PORT"] = str(connection_settings.get("port", 8700))
                if connection_settings.get("network_id"):
                    env["OPENAGENTS_NETWORK_ID"] = connection_settings["network_id"]
            
            # Set working directory to the agent file's directory
            cwd = agent_instance.info.config_path.parent
            
            # Start subprocess
            logger.info(f"Starting {agent_instance.info.file_type} agent '{agent_id}' with command: {' '.join(cmd)}")
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                cwd=cwd,
                env=env
            )
            
            agent_instance.process = process
            agent_instance.pid = process.pid
            agent_instance.status = "running"
            
            logger.info(f"Agent '{agent_id}' started successfully with PID {process.pid}")
            
            # Start log monitoring in background
            asyncio.create_task(self._monitor_process_logs(agent_instance))
            
            return True
            
        except Exception as e:
            agent_instance.status = "error" 
            agent_instance.error_message = str(e)
            logger.error(f"Failed to start agent '{agent_id}': {e}")
            return False
    
    async def _monitor_process_logs(self, agent_instance: AgentInstance) -> None:
        """Monitor subprocess logs and update log buffer."""
        if not agent_instance.process:
            return
        
        try:
            # Simple process monitoring - just check if process is still alive
            # Don't try to read logs in real-time as it can cause blocking issues
            while agent_instance.process and agent_instance.process.poll() is None:
                # Check if process is still running
                await asyncio.sleep(2.0)  # Check every 2 seconds
            
            # Process has ended, check exit code
            if agent_instance.process:
                exit_code = agent_instance.process.returncode
                if exit_code != 0:
                    agent_instance.status = "error"
                    agent_instance.error_message = f"Process exited with code {exit_code}"
                    logger.error(f"Agent '{agent_instance.info.agent_id}' process exited with code {exit_code}")
                else:
                    agent_instance.status = "stopped"
                    logger.info(f"Agent '{agent_instance.info.agent_id}' process ended normally")
        
        except Exception as e:
            logger.error(f"Error monitoring process for agent '{agent_instance.info.agent_id}': {e}")
            agent_instance.status = "error"
            agent_instance.error_message = f"Process monitoring error: {e}"
    
    async def start_all_agents(
        self,
        connection_override: Optional[Dict] = None,
        max_concurrent: int = 3  # Reduced default to minimize gRPC resource contention
    ) -> Dict[str, bool]:
        """Start all agents concurrently with gRPC error handling.
        
        Args:
            connection_override: Optional connection settings to override all agent configs
            max_concurrent: Maximum number of agents to start concurrently (reduced default)
            
        Returns:
            Dictionary mapping agent_id to success status
        """
        if not self.agents:
            logger.warning("No agents to start")
            return {}
        
        self.running = True
        
        # Reduce concurrency further for gRPC stability
        effective_max_concurrent = min(max_concurrent, 2)
        logger.info(f"Starting agents with max concurrency: {effective_max_concurrent}")
        
        # Create semaphore to limit concurrent startups
        semaphore = asyncio.Semaphore(effective_max_concurrent)
        
        async def start_single_agent(agent_id: str) -> Tuple[str, bool]:
            async with semaphore:
                # Add delay between agent starts to prevent resource conflicts
                await asyncio.sleep(1.0)
                success = await self.start_agent(agent_id, connection_override)
                # Add delay after startup to allow stabilization
                await asyncio.sleep(2.0)
                return agent_id, success
        
        # Start all agents concurrently
        tasks = [
            start_single_agent(agent_id) 
            for agent_id in self.agents.keys() 
            if self.agents[agent_id].info.is_valid
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        success_map = {}
        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Error in agent startup: {result}")
                continue
            agent_id, success = result
            success_map[agent_id] = success
        
        return success_map
    
    def stop_agent(self, agent_id: str) -> bool:
        """Stop a single agent subprocess.
        
        Args:
            agent_id: ID of the agent to stop
            
        Returns:
            True if agent stopped successfully, False otherwise
        """
        if agent_id not in self.agents:
            logger.error(f"Agent '{agent_id}' not found")
            return False
        
        agent_instance = self.agents[agent_id]
        
        if agent_instance.status not in ["running", "starting"]:
            logger.warning(f"Agent '{agent_id}' is not running (status: {agent_instance.status})")
            return True
        
        try:
            agent_instance.status = "stopping"
            
            if agent_instance.process:
                logger.info(f"Terminating agent '{agent_id}' with PID {agent_instance.process.pid}")
                
                # Try graceful termination first
                agent_instance.process.terminate()
                
                # Wait for graceful termination
                try:
                    agent_instance.process.wait(timeout=5)
                    logger.info(f"Agent '{agent_id}' terminated gracefully")
                except subprocess.TimeoutExpired:
                    # Force kill if graceful termination fails
                    logger.warning(f"Agent '{agent_id}' didn't terminate gracefully, force killing")
                    agent_instance.process.kill()
                    agent_instance.process.wait()
                
                agent_instance.process = None
                agent_instance.pid = None
            
            # Also stop runner if it exists (backward compatibility)
            if agent_instance.runner:
                agent_instance.runner.stop()
                agent_instance.runner = None
            
            agent_instance.status = "stopped"
            logger.info(f"Agent '{agent_id}' stopped successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping agent '{agent_id}': {e}")
            agent_instance.status = "error"
            agent_instance.error_message = str(e)
            return False
    
    def stop_all_agents(self) -> Dict[str, bool]:
        """Stop all running agents.
        
        Returns:
            Dictionary mapping agent_id to success status
        """
        self.running = False
        self._shutdown_event.set()
        
        results = {}
        for agent_id in self.agents.keys():
            results[agent_id] = self.stop_agent(agent_id)
        
        return results
    
    def get_agent_status(self, agent_id: str) -> Optional[Dict]:
        """Get status information for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            Dictionary with agent status information, None if agent not found
        """
        if agent_id not in self.agents:
            return None
        
        agent_instance = self.agents[agent_id]
        
        status = {
            "agent_id": agent_id,
            "config_path": str(agent_instance.info.config_path),
            "agent_type": agent_instance.info.agent_type,
            "file_type": agent_instance.info.file_type,
            "status": agent_instance.status,
            "is_valid": agent_instance.info.is_valid,
            "error_message": agent_instance.error_message,
            "start_time": agent_instance.start_time,
            "uptime": time.time() - agent_instance.start_time if agent_instance.start_time else None,
            "pid": agent_instance.pid
        }
        
        return status
    
    def get_all_status(self) -> Dict[str, Dict]:
        """Get status information for all agents.
        
        Returns:
            Dictionary mapping agent_id to status information
        """
        return {
            agent_id: self.get_agent_status(agent_id)
            for agent_id in self.agents.keys()
        }
    
    def get_running_agents(self) -> List[str]:
        """Get list of currently running agent IDs.
        
        Returns:
            List of agent IDs with status 'running'
        """
        return [
            agent_id for agent_id, instance in self.agents.items()
            if instance.status == "running"
        ]
    
    def get_agent_logs(self, agent_id: str, max_lines: int = 100) -> List[str]:
        """Get recent log entries for an agent.
        
        Args:
            agent_id: ID of the agent
            max_lines: Maximum number of log lines to return
            
        Returns:
            List of log lines, empty if agent not found
        """
        if agent_id not in self.agents:
            return []
        
        agent_instance = self.agents[agent_id]
        return agent_instance.log_buffer[-max_lines:] if agent_instance.log_buffer else []
    
    def shutdown(self) -> None:
        """Shutdown the bulk agent manager and clean up resources."""
        logger.info("Shutting down BulkAgentManager...")
        
        # Stop all agents
        self.stop_all_agents()
        
        # Shutdown executor
        self._executor.shutdown(wait=True)
        
        logger.info("BulkAgentManager shutdown complete")