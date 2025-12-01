"""
Tool decorator for workspace tools.

This module provides the @tool decorator for marking functions as agent tools
in the workspace `tools/` folder.
"""

import inspect
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

F = TypeVar("F", bound=Callable[..., Any])

# Marker attribute for decorated functions
TOOL_MARKER = "__openagents_tool__"


def tool(
    func: Optional[F] = None,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    input_schema: Optional[Dict[str, Any]] = None,
) -> Union[F, Callable[[F], F]]:
    """
    Decorator to mark a function as an agent tool.

    When applied to a function in the workspace `tools/` folder, the function
    becomes available as an MCP tool for external agents.

    Can be used with or without parentheses:
        @tool
        def my_function(): ...

        @tool()
        def my_function(): ...

        @tool(name="custom_name")
        def my_function(): ...

    Args:
        name: Tool name. Defaults to the function name.
        description: Tool description. Defaults to the function's docstring.
        input_schema: JSON schema for input parameters. Auto-generated if not provided.

    Returns:
        The decorated function with tool metadata attached.

    Example:
        @tool
        def add(a: int, b: int) -> int:
            return a + b

        @tool(description="Add two numbers together")
        def add(a: int, b: int) -> int:
            return a + b

        @tool(name="multiply_numbers")
        def multiply(x: float, y: float) -> float:
            '''Multiply two numbers.'''
            return x * y
    """

    def decorator(fn: F) -> F:
        # Get tool name from parameter or function name
        tool_name = name if name is not None else fn.__name__

        # Get description from parameter or docstring
        tool_description = description
        if tool_description is None:
            tool_description = inspect.getdoc(fn) or f"Tool: {tool_name}"

        # Get or generate input schema
        tool_input_schema = input_schema
        if tool_input_schema is None:
            tool_input_schema = _generate_input_schema(fn)

        # Store metadata on the function
        setattr(
            fn,
            TOOL_MARKER,
            {
                "name": tool_name,
                "description": tool_description,
                "input_schema": tool_input_schema,
            },
        )

        @wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)

        # Copy the marker to the wrapper
        setattr(wrapper, TOOL_MARKER, getattr(fn, TOOL_MARKER))

        return wrapper  # type: ignore

    # Handle both @tool and @tool() cases
    if func is not None:
        # @tool used without parentheses - func is the decorated function
        return decorator(func)
    else:
        # @tool() used with parentheses - return decorator to be called with function
        return decorator


def is_tool(func: Callable) -> bool:
    """Check if a function is decorated with @tool."""
    return hasattr(func, TOOL_MARKER)


def get_tool_metadata(func: Callable) -> Optional[Dict[str, Any]]:
    """Get tool metadata from a decorated function."""
    return getattr(func, TOOL_MARKER, None)


def _generate_input_schema(func: Callable) -> Dict[str, Any]:
    """
    Auto-generate JSON schema from function signature.

    Args:
        func: The function to analyze

    Returns:
        JSON schema dictionary
    """
    try:
        sig = inspect.signature(func)
        type_hints = {}
        try:
            type_hints = func.__annotations__
        except AttributeError:
            pass

        properties: Dict[str, Any] = {}
        required: List[str] = []

        for param_name, param in sig.parameters.items():
            # Skip *args and **kwargs
            if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                continue

            # Determine parameter type from annotation
            param_type = "string"  # Default
            annotation = type_hints.get(param_name, param.annotation)

            if annotation != param.empty:
                param_type = _python_type_to_json_type(annotation)

            # Build property schema
            prop: Dict[str, Any] = {"type": param_type}

            # Try to extract description from docstring
            param_desc = _extract_param_description(func, param_name)
            if param_desc:
                prop["description"] = param_desc

            properties[param_name] = prop

            # Check if required (no default value)
            if param.default == param.empty:
                required.append(param_name)

        return {"type": "object", "properties": properties, "required": required}

    except Exception:
        # Fallback to empty schema if introspection fails
        return {"type": "object", "properties": {}, "required": []}


def _python_type_to_json_type(annotation: Any) -> str:
    """Convert Python type annotation to JSON schema type."""
    # Handle None type
    if annotation is None or annotation is type(None):
        return "null"

    # Handle basic types
    if annotation == int:
        return "integer"
    if annotation == float:
        return "number"
    if annotation == bool:
        return "boolean"
    if annotation == str:
        return "string"
    if annotation == list:
        return "array"
    if annotation == dict:
        return "object"

    # Handle typing module types
    type_str = str(annotation)
    if "List" in type_str or "list" in type_str:
        return "array"
    if "Dict" in type_str or "dict" in type_str:
        return "object"
    if "Optional" in type_str:
        # For Optional types, extract the inner type
        # Optional[X] is Union[X, None]
        args = getattr(annotation, "__args__", ())
        for arg in args:
            if arg is not type(None):
                return _python_type_to_json_type(arg)
        return "string"
    if "Union" in type_str:
        return "string"  # Fallback for complex unions

    return "string"  # Default fallback


def _extract_param_description(func: Callable, param_name: str) -> Optional[str]:
    """
    Extract parameter description from function docstring.

    Supports Google-style and numpy-style docstrings.
    """
    docstring = inspect.getdoc(func)
    if not docstring:
        return None

    # Simple pattern matching for common docstring styles
    lines = docstring.split("\n")
    in_args_section = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Check for args section start
        if stripped.lower() in ("args:", "arguments:", "parameters:"):
            in_args_section = True
            continue

        # Check for section end
        if in_args_section and stripped.endswith(":") and not stripped.startswith(param_name):
            if stripped.lower() in ("returns:", "raises:", "yields:", "examples:"):
                in_args_section = False
                continue

        # Look for parameter in args section
        if in_args_section:
            # Google style: "param_name: description" or "param_name (type): description"
            if stripped.startswith(f"{param_name}:") or stripped.startswith(f"{param_name} ("):
                # Extract description after colon
                colon_idx = stripped.find(":")
                if colon_idx != -1:
                    desc = stripped[colon_idx + 1 :].strip()
                    # Check if description continues on next line
                    if i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        if next_line and not next_line.endswith(":") and not ":" in next_line[:20]:
                            desc = f"{desc} {next_line}"
                    return desc if desc else None

    return None
