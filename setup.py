#!/usr/bin/env python3
"""
Setup script for OpenAgents.
This is a minimal setup.py that defers to pyproject.toml for configuration.
"""

import os
import shutil
from pathlib import Path
from setuptools import setup, find_packages

def copy_studio_build():
    """Copy studio build files to package directory if they exist."""
    project_root = Path(__file__).parent
    studio_build_src = project_root / "studio" / "build"
    studio_build_dst = project_root / "src" / "openagents" / "studio" / "build"
    
    if studio_build_src.exists() and studio_build_src.is_dir():
        # Create destination directory
        studio_build_dst.parent.mkdir(parents=True, exist_ok=True)
        
        # Remove existing destination if it exists
        if studio_build_dst.exists():
            shutil.rmtree(studio_build_dst)
        
        # Copy build directory
        shutil.copytree(studio_build_src, studio_build_dst)
        print(f"✅ Copied studio build files from {studio_build_src} to {studio_build_dst}")
    else:
        print(f"⚠️  Studio build directory not found at {studio_build_src}")
        print("   The package will work, but users will need Node.js to run the studio.")
        print("   To include the built frontend, run 'npm run build' in the studio directory first.")

if __name__ == "__main__":
    # Copy studio build files before setup
    copy_studio_build()
    
    setup(
        packages=find_packages(where="src"),
        package_dir={"": "src"},
        test_suite="tests",
    ) 