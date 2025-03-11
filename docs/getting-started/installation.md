# Installation

## Requirements

OpenAgents requires Python 3.7 or later. It's recommended to use a virtual environment to avoid conflicts with other packages.

## Installing with pip

The simplest way to install OpenAgents is using pip:

```bash
pip install openagents
```

This will install OpenAgents and all its dependencies.

## Installing from source

If you want to install the latest development version, you can install directly from the GitHub repository:

```bash
pip install git+https://github.com/bestagents/openagents.git
```

## Development installation

For development, it's recommended to clone the repository and install in development mode:

```bash
git clone https://github.com/bestagents/openagents.git
cd openagents
pip install -e .
```

This will install the package in development mode, allowing you to make changes to the code and have them immediately reflected without reinstalling.

## Verifying installation

You can verify that OpenAgents is installed correctly by running:

```bash
python -c "import openagents; print(openagents.__version__)"
```

This should print the version number of the installed OpenAgents package.

## Next steps

Once you have OpenAgents installed, you can proceed to the [Quick Start](quick-start.md) guide to learn how to create your first agent network. 