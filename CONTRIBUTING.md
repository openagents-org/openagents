# Contributing to OpenAgents

Thank you for your interest in contributing to OpenAgents! This document provides guidelines and instructions to help you contribute effectively.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Pull Requests](#pull-requests)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/openagents.git
   cd openagents
   ```
3. **Set up the development environment**:
   ```bash
   # Install dependencies
   pip install -e ".[dev]"
   ```
4. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## How to Contribute

### Reporting Bugs

If you find a bug, please report it by creating an issue on our GitHub repository. When filing a bug report, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Any relevant logs or screenshots
- Your environment (OS, Python version, etc.)

### Suggesting Features

We welcome feature suggestions! To suggest a feature:

1. Check if the feature has already been suggested or implemented.
2. Create a new issue describing the feature and its benefits.
3. Use the "feature request" label if available.

### Pull Requests

1. Update your fork to the latest code from the main repository.
2. Create a new branch for your changes.
3. Make your changes, following our coding standards.
4. Add or update tests as necessary.
5. Update documentation if needed.
6. Submit a pull request with a clear description of the changes.

## Development Workflow

1. **Commit Messages**: Write clear, concise commit messages that explain the changes made.
2. **Branch Naming**: Use descriptive branch names (e.g., `feature/add-new-agent`, `fix/memory-leak`).
3. **Keep PRs Focused**: Each PR should address a single concern.

## Coding Standards

- Follow PEP 8 style guidelines for Python code.
- Use meaningful variable and function names.
- Write docstrings for all functions, classes, and modules.
- Keep functions small and focused on a single task.
- Comment complex code sections.

## Testing

- Write tests for all new features and bug fixes.
- Ensure all tests pass before submitting a PR.
- Aim for good test coverage.

To run tests:
```bash
pytest
```

## Documentation

- Update documentation for any changed functionality.
- Document new features thoroughly.
- Use clear, concise language in documentation.

## Community

- Join our [community discussions](https://github.com/YOUR-USERNAME/openagents/discussions) to ask questions and share ideas.
- Help answer questions from other contributors.
- Be respectful and constructive in all interactions.

Thank you for contributing to OpenAgents! 