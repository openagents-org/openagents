"""
Tool model for OpenAgents.

This module defines the Tool class, which represents a callable tool that can be used by agents.
"""

from typing import Any, Callable, Dict, Optional, Union, List
from pydantic import BaseModel, Field, validator, ConfigDict
import inspect


class AgentTool(BaseModel):
    """
    A tool that can be used by an agent.

    A tool consists of:
    - A name (function name for function calling)
    - An input schema defining the expected parameters
    - A callback function that executes the tool's functionality
    """

    name: str = Field(
        description="The name of the tool (function name for function calling)"
    )

    description: str = Field(
        description="A description of what the tool does and how to use it"
    )

    input_schema: Dict[str, Any] = Field(
        description="JSON schema defining the expected input parameters",
        default_factory=dict,
    )

    func: Callable[..., Any] = Field(
        description="The function to call when executing this tool"
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)

    async def execute(self, **kwargs) -> Any:
        """
        Execute the tool with the provided parameters.

        Automatically detects whether the underlying function is async or sync
        and handles the execution accordingly.

        Args:
            **kwargs: Parameters to pass to the callback function

        Returns:
            Any: The result of the callback function
        """
        # Validate required parameters from the input schema
        if "required" in self.input_schema:
            for param in self.input_schema["required"]:
                if param not in kwargs:
                    raise ValueError(f"Missing required parameter: {param}")

        # Check if the underlying function is async
        is_async = inspect.iscoroutinefunction(self.func)

        if is_async:
            return await self.func(**kwargs)
        else:
            return self.func(**kwargs)

    def to_openai_function(self) -> Dict[str, Any]:
        """
        Convert the tool to an OpenAI function format.

        Returns:
            Dict[str, Any]: The tool in OpenAI function format
        """
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema,
        }
