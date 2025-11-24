"""
Test tools for pytest agent testing.
"""

def add_numbers(a: int, b: int) -> int:
    """Add two numbers together.
    
    Args:
        a: First number
        b: Second number
        
    Returns:
        The sum of a and b
    """
    return a + b


def greet_user(name: str, greeting: str = "Hello") -> str:
    """Greet a user with a custom greeting.
    
    Args:
        name: Name of the user to greet
        greeting: Greeting to use (default: "Hello")
        
    Returns:
        A greeting message
    """
    return f"{greeting}, {name}!"


def process_text(text: str, operation: str = "upper") -> str:
    """Process text with various operations.
    
    Args:
        text: Text to process
        operation: Operation to perform (upper, lower, reverse, length)
        
    Returns:
        Processed text or result
    """
    if operation == "upper":
        return text.upper()
    elif operation == "lower":
        return text.lower()
    elif operation == "reverse":
        return text[::-1]
    elif operation == "length":
        return f"Length: {len(text)}"
    else:
        return f"Unknown operation: {operation}"