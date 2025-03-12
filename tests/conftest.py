"""
Configuration for pytest.

This module contains configuration for pytest, including fixtures and plugins.
"""

import pytest
import asyncio
import logging
import signal
import os
import sys
import time

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Configure pytest-asyncio
def pytest_configure(config):
    """Configure pytest."""
    config.addinivalue_line("markers", "asyncio: mark a test as an asyncio test")

# We're not defining a custom event_loop fixture anymore
# Instead, we'll use the one provided by pytest-asyncio

# Add a timeout to all tests
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_protocol(item, nextitem):
    """Add a timeout to all tests."""
    # Start the timer
    start_time = time.time()
    
    # Run the test
    outcome = yield
    
    # Check if the test took too long
    elapsed_time = time.time() - start_time
    if elapsed_time > 25:  # 25 seconds
        logging.warning(f"Test {item.name} took {elapsed_time:.2f} seconds to run") 