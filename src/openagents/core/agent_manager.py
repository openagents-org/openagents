"""
Agent Manager for OpenAgents.

This module provides process management for service agents in the workspace/agents/
directory, including discovery, lifecycle management, and log collection.
"""

import asyncio
import logging
import shutil
import sys
import time
import signal
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
import yaml

logger = logging.getLogger(__name__)


@dataclass
class AgentProcessInfo:
    """Information about a managed agent process."""
    
    agent_id: str
    file_path: Path
    file_type: str  # "yaml" or "python"
    pid: Optional[int] = None
    status: str = "stopped"  # stopped, starting, running, stopping, error
    start_time: Optional[float] = None
    error_message: Optional[str] = None
    process: Optional[asyncio.subprocess.Process] = None
    log_file_handle: Optional[Any] = None
    stdout_task: Optional[asyncio.Task] = None
    stderr_task: Optional[asyncio.Task] = None


class AgentManager:
    """
    Manages service agent processes in the workspace.
    
    Handles discovery, start/stop/restart operations, status tracking,
    and log file management for all agents in workspace/agents/ directory.
    """
    
    def __init__(self, workspace_path: Path):
        """Initialize agent manager.
        
        Args:
            workspace_path: Path to workspace directory
        """
        self.workspace_path = Path(workspace_path)
        self.agents_dir = self.workspace_path / "agents"
        self.logs_dir = self.workspace_path / "logs" / "agents"
        
        # Ensure directories exist
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
        # Agent registry: agent_id -> AgentProcessInfo
        self.agents: Dict[str, AgentProcessInfo] = {}
        
        # Manager state
        self.is_running = False
        self._monitor_task: Optional[asyncio.Task] = None
        
        logger.info(f"AgentManager initialized for workspace: {self.workspace_path}")
    
    async def start(self) -> bool:
        """Start the agent manager.
        
        Returns:
            bool: True if started successfully
        """
        if self.is_running:
            logger.warning("AgentManager is already running")
            return True
        
        try:
            # Discover agents
            self._discover_agents()
            
            # Start monitor task
            self._monitor_task = asyncio.create_task(self._monitor_processes())
            
            self.is_running = True
            logger.info(f"AgentManager started with {len(self.agents)} discovered agents")
            return True
        
        except Exception as e:
            logger.error(f"Failed to start AgentManager: {e}")
            return False
    
    async def stop(self) -> bool:
        """Stop the agent manager and all running agents.
        
        Returns:
            bool: True if stopped successfully
        """
        if not self.is_running:
            return True
        
        try:
            logger.info("Stopping AgentManager...")
            
            # Stop all running agents
            await self._stop_all_agents()
            
            # Cancel monitor task
            if self._monitor_task:
                self._monitor_task.cancel()
                try:
                    await self._monitor_task
                except asyncio.CancelledError:
                    pass
            
            self.is_running = False
            logger.info("AgentManager stopped successfully")
            return True
        
        except Exception as e:
            logger.error(f"Error stopping AgentManager: {e}")
            return False
    
    def _discover_agents(self) -> None:
        """Discover agent configuration files in workspace/agents/ directory."""
        if not self.agents_dir.exists():
            logger.warning(f"Agents directory not found: {self.agents_dir}")
            return
        
        discovered_count = 0
        
        # Discover YAML agents
        for yaml_file in self.agents_dir.glob("*.yaml"):
            try:
                agent_id = self._extract_agent_id_from_yaml(yaml_file)
                if agent_id:
                    self.agents[agent_id] = AgentProcessInfo(
                        agent_id=agent_id,
                        file_path=yaml_file,
                        file_type="yaml"
                    )
                    discovered_count += 1
                    logger.debug(f"Discovered YAML agent: {agent_id}")
            except Exception as e:
                logger.error(f"Error discovering YAML agent {yaml_file}: {e}")
        
        # Discover Python agents
        for py_file in self.agents_dir.glob("*.py"):
            # Skip __init__.py
            if py_file.name == "__init__.py":
                continue
            
            try:
                agent_id = self._extract_agent_id_from_python(py_file)
                if agent_id:
                    self.agents[agent_id] = AgentProcessInfo(
                        agent_id=agent_id,
                        file_path=py_file,
                        file_type="python"
                    )
                    discovered_count += 1
                    logger.debug(f"Discovered Python agent: {agent_id}")
            except Exception as e:
                logger.error(f"Error discovering Python agent {py_file}: {e}")
        
        logger.info(f"Discovered {discovered_count} agents")
    
    def _extract_agent_id_from_yaml(self, yaml_file: Path) -> Optional[str]:
        """Extract agent_id from YAML configuration file."""
        try:
            with open(yaml_file, "r") as f:
                config = yaml.safe_load(f)
            
            if config and isinstance(config, dict):
                return config.get("agent_id")
        except Exception as e:
            logger.error(f"Error reading YAML file {yaml_file}: {e}")
        
        return None
    
    def _extract_agent_id_from_python(self, py_file: Path) -> Optional[str]:
        """Extract agent_id from Python file (looking for default_agent_id variable)."""
        try:
            with open(py_file, "r", encoding="utf-8") as f:
                content = f.read()
            
            # Simple pattern matching for default_agent_id or agent_id
            for line in content.split("\n"):
                line = line.strip()
                if line.startswith("default_agent_id") or line.startswith("agent_id"):
                    if "=" in line:
                        parts = line.split("=", 1)
                        if len(parts) == 2:
                            value = parts[1].strip().strip('"\'')
                            if value:
                                return value
            
            # If not found, use filename without extension as fallback
            return py_file.stem
        
        except Exception as e:
            logger.error(f"Error reading Python file {py_file}: {e}")
        
        return None
    
    async def start_agent(self, agent_id: str) -> Dict[str, Any]:
        """Start a specific agent.
        
        Args:
            agent_id: ID of the agent to start
        
        Returns:
            dict: Result with status and message
        """
        if agent_id not in self.agents:
            return {"success": False, "message": f"Agent '{agent_id}' not found"}
        
        agent_info = self.agents[agent_id]
        
        if agent_info.status == "running":
            return {"success": False, "message": f"Agent '{agent_id}' is already running"}
        
        try:
            agent_info.status = "starting"
            agent_info.error_message = None
            
            # Prepare log file
            log_file_path = self.logs_dir / f"{agent_id}.log"
            agent_info.log_file_handle = open(log_file_path, "a", buffering=1)
            
            # Write startup message to log
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            agent_info.log_file_handle.write(f"\n{'='*60}\n")
            agent_info.log_file_handle.write(f"[{timestamp}] Starting agent '{agent_id}'\n")
            agent_info.log_file_handle.write(f"{'='*60}\n\n")
            agent_info.log_file_handle.flush()
            
            # Build command based on file type
            # Use absolute path to ensure correct file location
            abs_file_path = agent_info.file_path.absolute()
            
            if agent_info.file_type == "yaml":
                # Use openagents CLI to start YAML agent
                openagents_cli = shutil.which("openagents")
                if openagents_cli:
                    # Use the installed console script
                    cmd = [openagents_cli, "agent", "start", str(abs_file_path)]
                else:
                    # Fallback: use python -m openagents.cli agent start
                    cmd = [
                        sys.executable, "-m", "openagents.cli",
                        "agent", "start", str(abs_file_path)
                    ]
            else:  # python
                # Direct Python execution
                cmd = [sys.executable, str(abs_file_path)]
            
            # Start process without cwd to avoid path duplication
            # The agent's working directory will be its parent directory
            agent_info.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(abs_file_path.parent)
            )
            
            agent_info.pid = agent_info.process.pid
            agent_info.start_time = time.time()
            agent_info.status = "running"
            
            # Start log capture tasks
            agent_info.stdout_task = asyncio.create_task(
                self._capture_stream(agent_info, agent_info.process.stdout, "stdout")
            )
            agent_info.stderr_task = asyncio.create_task(
                self._capture_stream(agent_info, agent_info.process.stderr, "stderr")
            )
            
            logger.info(f"Started agent '{agent_id}' with PID {agent_info.pid}")
            
            return {
                "success": True,
                "message": f"Agent '{agent_id}' started successfully",
                "pid": agent_info.pid
            }
        
        except Exception as e:
            agent_info.status = "error"
            agent_info.error_message = str(e)
            logger.error(f"Failed to start agent '{agent_id}': {e}")
            
            # Close log file if opened
            if agent_info.log_file_handle:
                try:
                    agent_info.log_file_handle.close()
                except:
                    pass
                agent_info.log_file_handle = None
            
            return {"success": False, "message": f"Failed to start agent: {e}"}
    
    async def stop_agent(self, agent_id: str) -> Dict[str, Any]:
        """Stop a specific agent.
        
        Args:
            agent_id: ID of the agent to stop
        
        Returns:
            dict: Result with status and message
        """
        if agent_id not in self.agents:
            return {"success": False, "message": f"Agent '{agent_id}' not found"}
        
        agent_info = self.agents[agent_id]
        
        if agent_info.status != "running":
            return {"success": False, "message": f"Agent '{agent_id}' is not running"}
        
        try:
            agent_info.status = "stopping"
            
            # Write shutdown message to log
            if agent_info.log_file_handle:
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                agent_info.log_file_handle.write(f"\n[{timestamp}] Stopping agent '{agent_id}'\n")
                agent_info.log_file_handle.flush()
            
            # Terminate process
            if agent_info.process:
                try:
                    agent_info.process.terminate()
                    
                    # Wait for graceful termination with timeout
                    try:
                        await asyncio.wait_for(agent_info.process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        # Force kill if not terminated
                        agent_info.process.kill()
                        await agent_info.process.wait()
                
                except ProcessLookupError:
                    # Process already terminated
                    pass
            
            # Cancel log capture tasks
            for task in [agent_info.stdout_task, agent_info.stderr_task]:
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            
            # Close log file
            if agent_info.log_file_handle:
                try:
                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    agent_info.log_file_handle.write(f"[{timestamp}] Agent stopped\n")
                    agent_info.log_file_handle.write(f"{'='*60}\n\n")
                    agent_info.log_file_handle.close()
                except:
                    pass
                agent_info.log_file_handle = None
            
            agent_info.status = "stopped"
            agent_info.pid = None
            agent_info.process = None
            agent_info.stdout_task = None
            agent_info.stderr_task = None
            
            logger.info(f"Stopped agent '{agent_id}'")
            
            return {"success": True, "message": f"Agent '{agent_id}' stopped successfully"}
        
        except Exception as e:
            logger.error(f"Error stopping agent '{agent_id}': {e}")
            return {"success": False, "message": f"Error stopping agent: {e}"}
    
    async def restart_agent(self, agent_id: str) -> Dict[str, Any]:
        """Restart a specific agent.
        
        Args:
            agent_id: ID of the agent to restart
        
        Returns:
            dict: Result with status and message
        """
        if agent_id not in self.agents:
            return {"success": False, "message": f"Agent '{agent_id}' not found"}
        
        # Stop if running
        if self.agents[agent_id].status == "running":
            stop_result = await self.stop_agent(agent_id)
            if not stop_result["success"]:
                return stop_result
            
            # Wait a moment before restarting
            await asyncio.sleep(1.0)
        
        # Start agent
        return await self.start_agent(agent_id)
    
    def get_agent_status(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get status information for a specific agent.
        
        Args:
            agent_id: ID of the agent
        
        Returns:
            dict: Agent status information, or None if not found
        """
        if agent_id not in self.agents:
            return None
        
        agent_info = self.agents[agent_id]
        
        uptime = None
        if agent_info.start_time and agent_info.status == "running":
            uptime = time.time() - agent_info.start_time
        
        return {
            "agent_id": agent_info.agent_id,
            "status": agent_info.status,
            "pid": agent_info.pid,
            "file_path": str(agent_info.file_path),
            "file_type": agent_info.file_type,
            "start_time": agent_info.start_time,
            "uptime": uptime,
            "error_message": agent_info.error_message
        }
    
    def get_all_agents_status(self) -> List[Dict[str, Any]]:
        """Get status information for all agents.
        
        Returns:
            list: List of agent status dictionaries
        """
        return [self.get_agent_status(agent_id) for agent_id in self.agents.keys()]
    
    def get_agent_logs(self, agent_id: str, lines: int = 100) -> Optional[List[str]]:
        """Get recent log lines for a specific agent.

        Args:
            agent_id: ID of the agent
            lines: Number of recent lines to retrieve (default 100)

        Returns:
            list: List of log lines, or None if agent not found or no logs
        """
        if agent_id not in self.agents:
            return None

        log_file_path = self.logs_dir / f"{agent_id}.log"

        if not log_file_path.exists():
            return []

        try:
            # Read last N lines efficiently
            with open(log_file_path, "r", encoding="utf-8") as f:
                # Read all lines and take last N
                all_lines = f.readlines()
                return all_lines[-lines:] if len(all_lines) > lines else all_lines

        except Exception as e:
            logger.error(f"Error reading log file for agent '{agent_id}': {e}")
            return None

    def get_agent_source(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get the source code of an agent.

        Args:
            agent_id: ID of the agent

        Returns:
            dict: Source code info with 'content', 'file_type', 'file_path', or None if not found
        """
        if agent_id not in self.agents:
            return None

        agent_info = self.agents[agent_id]

        try:
            with open(agent_info.file_path, "r", encoding="utf-8") as f:
                content = f.read()

            return {
                "content": content,
                "file_type": agent_info.file_type,
                "file_path": str(agent_info.file_path),
                "file_name": agent_info.file_path.name
            }

        except Exception as e:
            logger.error(f"Error reading source file for agent '{agent_id}': {e}")
            return None

    def save_agent_source(self, agent_id: str, content: str) -> Dict[str, Any]:
        """Save the source code of an agent.

        Args:
            agent_id: ID of the agent
            content: New source code content

        Returns:
            dict: Result with 'success' and 'message'
        """
        if agent_id not in self.agents:
            return {"success": False, "message": f"Agent '{agent_id}' not found"}

        agent_info = self.agents[agent_id]

        # Check if agent is running - warn but allow save
        if agent_info.status == "running":
            logger.warning(f"Saving source for running agent '{agent_id}' - restart required for changes to take effect")

        try:
            # Create backup before saving
            backup_path = agent_info.file_path.with_suffix(agent_info.file_path.suffix + ".bak")
            if agent_info.file_path.exists():
                import shutil
                shutil.copy2(agent_info.file_path, backup_path)

            # Write new content
            with open(agent_info.file_path, "w", encoding="utf-8") as f:
                f.write(content)

            logger.info(f"Saved source for agent '{agent_id}'")

            # If YAML, re-extract agent_id in case it changed
            if agent_info.file_type == "yaml":
                new_agent_id = self._extract_agent_id_from_yaml(agent_info.file_path)
                if new_agent_id and new_agent_id != agent_id:
                    logger.info(f"Agent ID changed from '{agent_id}' to '{new_agent_id}'")

            return {
                "success": True,
                "message": "Source code saved successfully",
                "needs_restart": agent_info.status == "running"
            }

        except Exception as e:
            logger.error(f"Error saving source file for agent '{agent_id}': {e}")
            return {"success": False, "message": f"Failed to save: {e}"}
    
    async def _capture_stream(
        self,
        agent_info: AgentProcessInfo,
        stream: asyncio.StreamReader,
        stream_name: str
    ) -> None:
        """Capture output from a process stream and write to log file."""
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                
                decoded_line = line.decode("utf-8", errors="ignore")
                
                if agent_info.log_file_handle:
                    try:
                        # Add stream prefix for stderr
                        if stream_name == "stderr":
                            decoded_line = f"[STDERR] {decoded_line}"
                        
                        agent_info.log_file_handle.write(decoded_line)
                        agent_info.log_file_handle.flush()
                    except Exception as e:
                        logger.error(f"Error writing to log file for '{agent_info.agent_id}': {e}")
        
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error capturing {stream_name} for '{agent_info.agent_id}': {e}")
    
    async def _monitor_processes(self) -> None:
        """Monitor running agent processes and handle crashes."""
        while self.is_running:
            try:
                for agent_id, agent_info in list(self.agents.items()):
                    if agent_info.status == "running" and agent_info.process:
                        # Check if process has terminated
                        return_code = agent_info.process.returncode
                        
                        if return_code is not None:
                            # Process has terminated
                            agent_info.status = "error" if return_code != 0 else "stopped"
                            agent_info.error_message = f"Process exited with code {return_code}"
                            agent_info.pid = None
                            
                            # Write crash message to log
                            if agent_info.log_file_handle:
                                try:
                                    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                    agent_info.log_file_handle.write(
                                        f"\n[{timestamp}] Process terminated with exit code {return_code}\n"
                                    )
                                    agent_info.log_file_handle.write(f"{'='*60}\n\n")
                                    agent_info.log_file_handle.close()
                                except:
                                    pass
                                agent_info.log_file_handle = None
                            
                            logger.warning(
                                f"Agent '{agent_id}' process terminated with code {return_code}"
                            )
                
                # Sleep before next check
                await asyncio.sleep(2.0)
            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in process monitor: {e}")
                await asyncio.sleep(2.0)
    
    async def _stop_all_agents(self) -> None:
        """Stop all running agents."""
        running_agents = [
            agent_id for agent_id, info in self.agents.items()
            if info.status == "running"
        ]
        
        for agent_id in running_agents:
            try:
                await self.stop_agent(agent_id)
            except Exception as e:
                logger.error(f"Error stopping agent '{agent_id}': {e}")

