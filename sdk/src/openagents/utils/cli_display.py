"""CLI display utilities for OpenAgents."""

import re
import shutil
from typing import List, Optional


def get_terminal_width() -> int:
    """
    Get the current terminal width.

    Returns:
        Terminal width in characters (default 100 if can't detect)
    """
    try:
        return shutil.get_terminal_size().columns
    except:
        return 100  # Default fallback


def get_visual_length(text: str) -> int:
    """
    Calculate the visual length of a string, excluding ANSI escape codes.

    Args:
        text: String that may contain ANSI escape codes

    Returns:
        The visual length of the string
    """
    # Remove ANSI escape codes
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    clean_text = ansi_escape.sub('', text)

    # Count emoji and other wide characters (simplified - most emojis are 2 chars wide)
    visual_len = 0
    for char in clean_text:
        # Check if character is emoji or wide character (Unicode > 0x1F300)
        if ord(char) > 0x1F300:
            visual_len += 2
        else:
            visual_len += 1

    return visual_len


def pad_line(text: str, width: int, align: str = 'left') -> str:
    """
    Pad a line to a specific visual width, accounting for ANSI codes and emojis.

    Args:
        text: Text to pad
        width: Target visual width
        align: Alignment ('left', 'right', 'center')

    Returns:
        Padded string
    """
    visual_len = get_visual_length(text)
    padding_needed = max(0, width - visual_len)

    if align == 'left':
        return text + (' ' * padding_needed)
    elif align == 'right':
        return (' ' * padding_needed) + text
    else:  # center
        left_pad = padding_needed // 2
        right_pad = padding_needed - left_pad
        return (' ' * left_pad) + text + (' ' * right_pad)


def print_box(title: str, lines: List[str], color_code: str = "\033[96m", width: Optional[int] = None):
    """
    Print a colored box with consistent formatting at full terminal width.

    Args:
        title: Box title
        lines: List of lines to display in the box
        color_code: ANSI color code for the box
        width: Total box width (default None = use terminal width)
    """
    reset = "\033[0m"
    bold = "\033[1m"

    # Use terminal width if not specified
    if width is None:
        width = get_terminal_width()

    # Calculate content width (box width - borders and padding)
    content_width = width - 4  # 2 for borders, 2 for padding

    # Top border
    print(f"\n{color_code}╔{'═' * (width - 2)}╗{reset}")

    # Title
    title_text = f" {bold}{title}{reset}"
    padding = content_width - get_visual_length(title)
    print(f"{color_code}║{reset}{title_text}{' ' * padding} {color_code}║{reset}")

    # Separator
    print(f"{color_code}╠{'═' * (width - 2)}╣{reset}")

    # Content lines
    for line in lines:
        # Handle separator lines specially
        if line.strip() and all(c == '─' or c == '═' or c == '―' for c in line.strip()):
            # Create separator that fits the content width
            print(f"{color_code}║{reset} {'─' * content_width} {color_code}║{reset}")
        else:
            padded_line = pad_line(f" {line}", content_width)
            print(f"{color_code}║{reset}{padded_line} {color_code}║{reset}")

    # Bottom border
    print(f"{color_code}╚{'═' * (width - 2)}╝{reset}\n")
