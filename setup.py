#!/usr/bin/env python3
"""
Setup script for OpenAgents.
This is a minimal setup.py that defers to pyproject.toml for configuration.
"""

from setuptools import setup, find_packages

if __name__ == "__main__":
    setup(
        packages=find_packages(where="src"),
        package_dir={"": "src"},
        test_suite="tests",
    ) 