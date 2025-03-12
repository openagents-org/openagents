# OpenAgents Tests

This directory contains tests for the OpenAgents framework.

## Requirements

To run the tests, you need to install the following dependencies:

```bash
pip install pytest pytest-asyncio
```

The `pytest-asyncio` plugin is required for running asynchronous tests.

## Running Tests

You can run the tests using the `run_tests.py` script:

```bash
# Run all tests
python tests/run_tests.py

# Run specific test modules
python tests/run_tests.py test_simple_messaging.py
```

Alternatively, you can use pytest directly:

```bash
# Run all tests
pytest --asyncio-mode=auto tests/

# Run a specific test module
pytest --asyncio-mode=auto tests/test_simple_messaging.py

# Run with verbose output
pytest -v --asyncio-mode=auto tests/

# Run with more detailed output
pytest -xvs --asyncio-mode=auto tests/
```

## Test Modules

- `test_simple_messaging.py`: Tests for the simple messaging protocol, including direct messaging, broadcast messaging, and file transfers.

## Writing Tests

When writing tests for OpenAgents, follow these guidelines:

1. Use pytest fixtures for setup and teardown
2. Use `pytest.mark.asyncio` for running async tests
3. Properly clean up resources after tests (network connections, temporary files, etc.)
4. Use descriptive test names and docstrings
5. Include assertions that verify the expected behavior

Example:

```python
import pytest

class TestMyFeature:
    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        # Set up test environment
        yield
        # Clean up test environment
    
    @pytest.mark.asyncio
    async def test_my_feature(self):
        """Test that my feature works correctly."""
        # Test code here
        assert result, "Feature should work correctly"

## Troubleshooting

If you encounter the error `RuntimeError: Event loop is closed`, make sure you're using the `pytest-asyncio` plugin and running pytest with the `--asyncio-mode=auto` option. 