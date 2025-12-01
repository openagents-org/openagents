"""Calculator tools for testing MCP workspace tools."""

from openagents.workspace.tool_decorator import tool


@tool(description="Add two numbers together")
async def add(a: float, b: float) -> float:
    """Add two numbers.

    Args:
        a: First number
        b: Second number

    Returns:
        Sum of a and b
    """
    return a + b


@tool(description="Subtract second number from first")
async def subtract(a: float, b: float) -> float:
    """Subtract two numbers.

    Args:
        a: First number
        b: Second number to subtract

    Returns:
        Difference of a and b
    """
    return a - b


@tool(description="Multiply two numbers")
async def multiply(a: float, b: float) -> float:
    """Multiply two numbers.

    Args:
        a: First number
        b: Second number

    Returns:
        Product of a and b
    """
    return a * b


@tool(description="Divide first number by second")
async def divide(a: float, b: float) -> float:
    """Divide two numbers.

    Args:
        a: Numerator
        b: Denominator (must not be zero)

    Returns:
        Quotient of a divided by b

    Raises:
        ValueError: If b is zero
    """
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
