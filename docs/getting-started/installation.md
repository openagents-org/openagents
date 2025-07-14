# Installation

## Requirements

OpenAgents requires Python 3.8 or later. It's recommended to use a virtual environment to avoid conflicts with other packages.

## Installing from Source (Recommended)

For the latest version with all features, clone the repository and install in development mode:

```bash
git clone https://github.com/bestagents/openagents.git
cd openagents

# Install with all development dependencies (recommended)
pip install -e ".[dev]"
```

This installs OpenAgents with:
- Core framework dependencies
- Testing framework (pytest, pytest-asyncio, pytest-cov)
- Code quality tools (black, flake8, mypy)
- Development utilities (ipython, jupyter)

## Minimal Installation

For production use or minimal dependencies:

```bash
# Install core package only
pip install -e .
```

## Installing with pip (Future)

When published to PyPI, you'll be able to install with:

```bash
pip install openagents
```

## Verifying Installation

You can verify that OpenAgents is installed correctly by running:

```bash
# Check package import
python -c "import openagents; print('OpenAgents installed successfully')"

# Check CLI availability
openagents --help

# Run a quick test
python -m pytest tests/test_network.py::TestNetworkConfig::test_basic_network_config -v
```

## Development Dependencies

The development installation includes:

### Testing Framework
- `pytest>=7.4.0` - Main testing framework
- `pytest-asyncio>=0.21.0` - Async testing support
- `pytest-cov>=4.1.0` - Coverage reporting
- `pytest-mock>=3.11.0` - Enhanced mocking utilities
- `pytest-xdist>=3.3.0` - Parallel test execution

### Code Quality
- `black>=23.7.0` - Code formatting
- `flake8>=6.0.0` - Linting
- `mypy>=1.5.0` - Type checking
- `pre-commit>=3.3.0` - Git hooks

### Development Tools
- `ipython>=8.0.0` - Interactive development
- `jupyter>=1.0.0` - Notebook support

## Running Tests

After installation, verify everything works by running the test suite:

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src/openagents --cov-report=html

# Run specific test categories
pytest tests/test_network.py     # Core network tests
pytest tests/test_transport.py   # Transport layer tests
pytest tests/test_topology.py    # Topology tests
```

## Quick Start Example

Once installed, create a simple network:

```bash
# Create a basic network configuration
cat > network_config.yaml << EOF
network:
  name: "TestNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "localhost"
  port: 8765
  discovery_enabled: true
EOF

# Launch the network
openagents launch-network network_config.yaml
```

In another terminal, connect to the network:

```bash
# Connect with interactive console
openagents connect --ip localhost --port 8765
```

## Troubleshooting

### Common Issues

1. **Python Version**: Ensure you're using Python 3.8+
   ```bash
   python --version
   ```

2. **Import Errors**: Make sure you installed in editable mode
   ```bash
   pip install -e .
   ```

3. **Test Failures**: Ensure all dependencies are installed
   ```bash
   pip install -e ".[dev]"
   ```

4. **Port Conflicts**: Change the port in your configuration if 8765 is in use

### Getting Help

- Check the [documentation](../index.md)
- Look at [example configurations](../../examples/)
- Run `openagents --help` for CLI options
- Check the [test suite](../../tests/) for usage examples

## Next Steps

Once you have OpenAgents installed, you can:

1. [Explore the CLI commands](../index.md#cli-commands)
2. [Learn about network topologies](../index.md#network-topologies)
3. [Try the programming API](../index.md#programming-api)
4. [Run the comprehensive tests](../index.md#development-and-testing) 