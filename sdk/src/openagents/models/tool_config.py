"""
Tool configuration models for OpenAgents.

This module defines models for configuring tools in YAML agent configurations.
"""

import importlib
import inspect
from typing import Any, Dict, List, Optional, Callable
from pydantic import BaseModel, Field, field_validator

from openagents.models.tool import AgentTool


class AgentToolConfig(BaseModel):
    """Configuration for an agent tool defined in YAML."""
    
    name: str = Field(
        description="The name of the tool (function name for function calling)"
    )
    
    description: str = Field(
        description="A description of what the tool does and how to use it"
    )
    
    implementation: str = Field(
        description="Python import path to the function (e.g., 'module.submodule.function_name')"
    )
    
    input_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        description="JSON schema defining the expected input parameters"
    )
    
    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        """Validate tool name is a valid identifier."""
        if not v or not isinstance(v, str) or not v.isidentifier():
            raise ValueError("Tool name must be a valid Python identifier")
        return v
    
    @field_validator("implementation")
    @classmethod
    def validate_implementation(cls, v):
        """Validate implementation path format."""
        if not v or not isinstance(v, str):
            raise ValueError("Implementation must be a non-empty string")
        
        # Basic validation of import path format
        parts = v.split('.')
        if len(parts) < 2:
            raise ValueError("Implementation must be in format 'module.function' or 'module.submodule.function'")
        
        return v
    
    def load_function(self) -> Callable:
        """
        Load and return the function from the implementation path.
        
        Returns:
            The loaded function
            
        Raises:
            ImportError: If module cannot be imported
            AttributeError: If function doesn't exist in module
            ValueError: If the loaded object is not a function
        """
        try:
            # Split module path and function name
            parts = self.implementation.split('.')
            function_name = parts[-1]
            module_path = '.'.join(parts[:-1])
            
            # Import the module
            module = importlib.import_module(module_path)
            
            # Get the function
            func = getattr(module, function_name)
            
            # Validate it's callable
            if not callable(func):
                raise ValueError(f"'{self.implementation}' is not a callable function")
            
            return func
            
        except ImportError as e:
            raise ImportError(f"Could not import module '{module_path}': {e}")
        except AttributeError as e:
            raise AttributeError(f"Function '{function_name}' not found in module '{module_path}': {e}")
    
    def create_agent_tool(self) -> AgentTool:
        """
        Create an AgentTool instance from this configuration.
        
        Returns:
            AgentTool instance
            
        Raises:
            ImportError: If function cannot be loaded
            ValueError: If configuration is invalid
        """
        # Load the function
        func = self.load_function()
        
        # Auto-generate input schema if not provided
        input_schema = self.input_schema
        if input_schema is None:
            input_schema = self._generate_input_schema(func)
        
        # Create and return AgentTool
        return AgentTool(
            name=self.name,
            description=self.description,
            input_schema=input_schema,
            func=func
        )
    
    def _generate_input_schema(self, func: Callable) -> Dict[str, Any]:
        """
        Auto-generate JSON schema from function signature.
        
        Args:
            func: The function to analyze
            
        Returns:
            JSON schema dictionary
        """
        try:
            # Get function signature
            sig = inspect.signature(func)
            
            # Build schema properties
            properties = {}
            required = []
            
            for param_name, param in sig.parameters.items():
                # Skip *args and **kwargs
                if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                    continue
                
                # Determine parameter type
                param_type = "string"  # Default
                if param.annotation != param.empty:
                    if param.annotation == int:
                        param_type = "integer"
                    elif param.annotation == float:
                        param_type = "number"
                    elif param.annotation == bool:
                        param_type = "boolean"
                    elif param.annotation == list or str(param.annotation).startswith("List"):
                        param_type = "array"
                    elif param.annotation == dict or str(param.annotation).startswith("Dict"):
                        param_type = "object"
                
                # Add to properties
                properties[param_name] = {"type": param_type}
                
                # Add description if available in docstring
                if func.__doc__:
                    # Try to extract parameter description from docstring
                    # This is a simple implementation - could be enhanced with proper docstring parsing
                    pass
                
                # Check if required (no default value)
                if param.default == param.empty:
                    required.append(param_name)
            
            return {
                "type": "object",
                "properties": properties,
                "required": required
            }
            
        except Exception:
            # Fallback to empty schema if introspection fails
            return {
                "type": "object",
                "properties": {},
                "required": []
            }


def create_tools_from_configs(tool_configs: List[AgentToolConfig]) -> List[AgentTool]:
    """
    Create a list of AgentTool instances from tool configurations.
    
    Args:
        tool_configs: List of tool configurations
        
    Returns:
        List of AgentTool instances
        
    Raises:
        ImportError: If any tool function cannot be loaded
        ValueError: If any tool configuration is invalid
    """
    tools = []
    
    for config in tool_configs:
        try:
            tool = config.create_agent_tool()
            tools.append(tool)
        except Exception as e:
            raise ValueError(f"Failed to create tool '{config.name}': {e}")
    
    return tools