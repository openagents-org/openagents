"""
Workspace tool loader for discovering tools from workspace `tools/` folder.

This module provides functionality to auto-discover and load tools defined
with the @tool decorator in Python files within the workspace tools directory.
"""

import importlib.util
import logging
import sys
from pathlib import Path
from typing import List, Optional

from openagents.workspace.tool_decorator import TOOL_MARKER, get_tool_metadata, is_tool
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class WorkspaceToolLoader:
    """
    Loads tools from the workspace `tools/` folder.

    Discovers Python files containing functions decorated with @tool
    and converts them to AgentTool instances.
    """

    def __init__(self, workspace_path: str):
        """
        Initialize the workspace tool loader.

        Args:
            workspace_path: Path to the workspace root directory
        """
        self.workspace_path = Path(workspace_path)
        self.tools_dir = self.workspace_path / "tools"

    def load_tools(self) -> List[AgentTool]:
        """
        Load all tools from the workspace tools directory.

        Returns:
            List of AgentTool instances found in tools/*.py files
        """
        tools: List[AgentTool] = []

        if not self.tools_dir.exists():
            logger.debug(f"Tools directory not found: {self.tools_dir}")
            return tools

        if not self.tools_dir.is_dir():
            logger.warning(f"Tools path is not a directory: {self.tools_dir}")
            return tools

        # Find all Python files in tools directory (non-recursive)
        py_files = list(self.tools_dir.glob("*.py"))

        for py_file in py_files:
            # Skip __init__.py and private files
            if py_file.name.startswith("_"):
                continue

            try:
                file_tools = self._load_tools_from_file(py_file)
                tools.extend(file_tools)
            except Exception as e:
                logger.error(f"Error loading tools from {py_file}: {e}")

        logger.info(f"Loaded {len(tools)} workspace tools from {self.tools_dir}")
        return tools

    def _load_tools_from_file(self, file_path: Path) -> List[AgentTool]:
        """
        Load tools from a single Python file.

        Args:
            file_path: Path to the Python file

        Returns:
            List of AgentTool instances found in the file
        """
        tools: List[AgentTool] = []

        # Create a unique module name to avoid conflicts
        module_name = f"openagents_workspace_tools_{file_path.stem}"

        # Load the module from file path
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            logger.warning(f"Could not load module spec from {file_path}")
            return tools

        module = importlib.util.module_from_spec(spec)

        # Add to sys.modules temporarily so imports within the module work
        sys.modules[module_name] = module

        try:
            spec.loader.exec_module(module)
        except Exception as e:
            logger.error(f"Error executing module {file_path}: {e}")
            del sys.modules[module_name]
            return tools

        # Find all functions with @tool decorator
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue

            attr = getattr(module, attr_name)
            if callable(attr) and is_tool(attr):
                try:
                    agent_tool = self._create_agent_tool(attr)
                    tools.append(agent_tool)
                    logger.debug(f"Loaded tool '{agent_tool.name}' from {file_path}")
                except Exception as e:
                    logger.error(f"Error creating tool from {attr_name} in {file_path}: {e}")

        return tools

    def _create_agent_tool(self, func) -> AgentTool:
        """
        Create an AgentTool from a decorated function.

        Args:
            func: Function decorated with @tool

        Returns:
            AgentTool instance
        """
        metadata = get_tool_metadata(func)
        if metadata is None:
            raise ValueError(f"Function {func.__name__} is not decorated with @tool")

        # Get the original function if wrapped
        original_func = func
        while hasattr(original_func, "__wrapped__"):
            original_func = original_func.__wrapped__

        return AgentTool(
            name=metadata["name"],
            description=metadata["description"],
            input_schema=metadata["input_schema"],
            func=original_func,
        )


def load_workspace_tools(workspace_path: str) -> List[AgentTool]:
    """
    Convenience function to load tools from a workspace.

    Args:
        workspace_path: Path to the workspace root directory

    Returns:
        List of AgentTool instances
    """
    loader = WorkspaceToolLoader(workspace_path)
    return loader.load_tools()
