"""The rolling window for message unread counts (history is never removed)."""
from time import time

UNREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000


def unread_cutoff_ms():
    return int(time() * 1000) - UNREAD_WINDOW_MS
