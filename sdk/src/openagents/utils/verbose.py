"""
Verbose output utilities for OpenAgents.

Provides utilities for controlling verbose debug output across the system.
"""


def verbose_print(*args, **kwargs) -> None:
    """Print message only if verbose mode is enabled.

    Args:
        *args: Arguments to pass to print()
        **kwargs: Keyword arguments to pass to print()
    """
    try:
        from openagents.cli import VERBOSE_MODE

        if VERBOSE_MODE:
            print(*args, **kwargs)
    except ImportError:
        # If CLI module not available, default to not printing
        pass


def is_verbose() -> bool:
    """Check if verbose mode is enabled.

    Returns:
        bool: True if verbose mode is enabled, False otherwise
    """
    try:
        from openagents.cli import VERBOSE_MODE

        return VERBOSE_MODE
    except ImportError:
        # If CLI module not available, default to False
        return False
