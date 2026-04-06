"""Greeting tools for testing MCP workspace tools."""

from typing import Optional

from openagents.workspace.tool_decorator import tool


@tool
async def greet(name: str, greeting: str = "Hello") -> str:
    """Greet someone by name.

    Args:
        name: The name of the person to greet
        greeting: The greeting to use (default: Hello)

    Returns:
        A personalized greeting message
    """
    return f"{greeting}, {name}!"


@tool(name="farewell", description="Say goodbye to someone")
async def say_goodbye(name: str) -> str:
    """Say goodbye to someone.

    Args:
        name: The name of the person to say goodbye to

    Returns:
        A farewell message
    """
    return f"Goodbye, {name}! See you next time!"


@tool
def get_current_time() -> str:
    """Get the current time as a string.

    Returns:
        Current time in HH:MM:SS format
    """
    from datetime import datetime

    return datetime.now().strftime("%H:%M:%S")
