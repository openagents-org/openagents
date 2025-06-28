# OpenAgents Testing Guide

This directory contains comprehensive tests for the OpenAgents framework. The test suite covers all major components including network architecture, transport layer, topology management, and protocol handling.

## Test Dependencies

All testing dependencies are defined in `pyproject.toml` under the `[project.optional-dependencies.dev]` section.

### Required Dependencies

The following packages are required to run the tests:

- **pytest>=7.4.0** - Main testing framework
- **pytest-asyncio>=0.21.0** - Async testing support  
- **pytest-cov>=4.1.0** - Coverage reporting
- **pytest-mock>=3.11.0** - Advanced mocking utilities
- **pytest-xdist>=3.3.0** - Parallel test execution

### Development Tools

Additional development dependencies for code quality:

- **black>=23.7.0** - Code formatting
- **flake8>=6.0.0** - Linting
- **mypy>=1.5.0** - Type checking
- **coverage>=7.3.0** - Coverage analysis

## Installation

### Option 1: Install Development Dependencies (Recommended)

```bash
# Install the package with all development dependencies
pip install -e ".[dev]"
```

### Option 2: Install Core Dependencies Only

```bash
# Install just the core package
pip install -e .

# Then install testing dependencies manually
pip install pytest>=7.4.0 pytest-asyncio>=0.21.0 pytest-cov>=4.1.0
```

### Option 3: From Requirements File

You can also create a `requirements-dev.txt` file:

```bash
# Extract dev dependencies to requirements file
pip-compile --extra dev pyproject.toml --output-file requirements-dev.txt
pip install -r requirements-dev.txt
```

## Running Tests

### Basic Test Commands

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test file
pytest tests/test_network.py

# Run specific test class
pytest tests/test_network.py::TestAgentNetwork

# Run specific test method
pytest tests/test_network.py::TestAgentNetwork::test_network_initialization
```

### Advanced Test Options

```bash
# Run tests with coverage
pytest --cov=src/openagents --cov-report=html

# Run tests in parallel (requires pytest-xdist)
pytest -n auto

# Run tests with detailed output
pytest -v --tb=long

# Run only failed tests from last run
pytest --lf

# Run tests and drop into debugger on failure
pytest --pdb
```

### Test Categories

The test suite is organized into several categories:

#### Core Network Tests (`test_network.py`)
- Network configuration and initialization
- Agent registration and lifecycle management
- Message routing and delivery
- Network statistics and monitoring
- Error handling and edge cases

#### Transport Layer Tests (`test_transport.py`)
- WebSocket transport implementation
- Transport message models
- Connection management
- Transport manager functionality

#### Topology Tests (`test_topology.py`)
- Centralized and decentralized topology
- Agent discovery and capability matching
- Network topology management

#### Protocol Tests
- **Agent Discovery** (`test_discovery_agent_discovery/`)
- **Simple Messaging** (`test_simple_messaging.py`)
- **Protocol Loaders** (`test_protocol_loaders.py`)

#### Launcher Tests (`test_network_launcher.py`)
- Configuration loading from YAML
- Network launcher functionality
- Async network initialization

## Test Configuration

Tests are configured via `pyproject.toml` with the following settings:

- **Test Discovery**: Automatically finds tests in `tests/` directory
- **Python Path**: Adds `src/` to path for imports
- **Async Mode**: Automatically handles async test functions
- **Warnings**: Filters out common warnings for cleaner output

## Coverage Reports

Generate coverage reports to see test coverage:

```bash
# Generate HTML coverage report
pytest --cov=src/openagents --cov-report=html

# View coverage report
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

## Continuous Integration

The test suite is designed to run in CI environments:

```bash
# CI-friendly test command
pytest --cov=src/openagents --cov-report=xml --junitxml=test-results.xml
```

## Test Architecture

### Test Organization

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions
- **Mock-based Testing**: Extensive use of mocks for external dependencies
- **Async Testing**: Full support for async/await patterns

### Test Patterns

- **Fixture-based Setup**: Reusable test components
- **Parametrized Tests**: Testing multiple scenarios
- **Error Simulation**: Testing failure conditions
- **Lifecycle Testing**: Testing initialization and cleanup

## Debugging Tests

### Common Issues and Solutions

1. **Import Errors**: Ensure package is installed with `pip install -e .`
2. **Async Errors**: Use `pytest-asyncio` for async test functions
3. **Mock Issues**: Check mock configurations and assertions
4. **Path Issues**: Verify `src/` is in Python path

### Debug Commands

```bash
# Run with debug output
pytest -s --log-cli-level=DEBUG

# Run single test with full traceback
pytest tests/test_network.py::test_specific_function -vvv --tb=long
```

## Contributing

When adding new tests:

1. Follow existing naming conventions (`test_*.py`)
2. Use descriptive test names
3. Include docstrings for complex tests
4. Add appropriate fixtures for setup/teardown
5. Mock external dependencies
6. Test both success and failure cases

## Test Results

Current test suite status:
- **Total Tests**: 57
- **Passing**: 56 
- **Skipped**: 1
- **Coverage**: >90% of core functionality

The test suite provides comprehensive coverage of the OpenAgents framework with focus on reliability, error handling, and real-world usage scenarios. 