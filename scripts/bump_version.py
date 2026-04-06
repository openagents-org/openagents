#!/usr/bin/env python3
"""Version bump script for OpenAgents project.

This script automates the version bumping process by:
1. Reading the current version from pyproject.toml
2. Incrementing the version based on the specified type (major/minor/patch/post)
3. Updating both pyproject.toml and sdk/src/openagents/__init__.py
4. Committing the changes to git
5. Creating a git tag
6. Optionally pushing changes and tag to remote

Usage:
    python scripts/bump_version.py <major|minor|patch|post> [--push]

Arguments:
    version_type    Type of version bump: major, minor, patch, or post
    --push         Push changes and tag to remote

Examples:
    python scripts/bump_version.py patch              # 0.8.5 -> 0.8.6 (local only)
    python scripts/bump_version.py patch --push       # 0.8.5 -> 0.8.6 (push to remote)
    python scripts/bump_version.py minor --push       # 0.8.5 -> 0.9.0 (push to remote)
    python scripts/bump_version.py major --push       # 0.8.5 -> 1.0.0 (push to remote)
    python scripts/bump_version.py post --push        # 0.8.5 -> 0.8.5.post1 (push to remote)
"""
import re
import sys
import subprocess
import argparse
from pathlib import Path


def run_command(command):
    """Execute a shell command and handle errors."""
    try:
        subprocess.run(command, check=True, shell=True)
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {command}")
        print(f"Error: {e}")
        sys.exit(1)


def parse_version(version_str):
    """Parse version string into components.
    
    Supports formats like:
    - 0.8.5
    - 0.8.5.post1
    - 0.8.5.post2
    
    Returns:
        tuple: (major, minor, patch, post_number or None)
    """
    # Match version pattern: major.minor.patch[.postN]
    match = re.match(r'^(\d+)\.(\d+)\.(\d+)(?:\.post(\d+))?$', version_str)
    if not match:
        print(f"Invalid version format: {version_str}")
        sys.exit(1)
    
    major, minor, patch, post = match.groups()
    return int(major), int(minor), int(patch), int(post) if post else None


def format_version(major, minor, patch, post=None):
    """Format version components into a version string."""
    base_version = f"{major}.{minor}.{patch}"
    if post is not None:
        return f"{base_version}.post{post}"
    return base_version


def bump_version(version_type, push=False):
    """Bump version based on the specified type.
    
    Args:
        version_type: Type of version bump (major/minor/patch/post)
        push: Whether to push changes to remote and create GitHub release
    """
    # File paths
    pyproject_file = Path("pyproject.toml")
    init_file = Path("sdk/src/openagents/__init__.py")
    
    # Validate files exist
    if not pyproject_file.exists():
        print(f"Error: {pyproject_file} not found")
        sys.exit(1)
    if not init_file.exists():
        print(f"Error: {init_file} not found")
        sys.exit(1)
    
    # Read current version from pyproject.toml
    pyproject_content = pyproject_file.read_text()
    version_match = re.search(r'^version = ["\']([^"\']+)["\']', pyproject_content, re.MULTILINE)
    if not version_match:
        print("Error: Could not find version in pyproject.toml")
        sys.exit(1)
    
    current_version = version_match.group(1)
    major, minor, patch, post = parse_version(current_version)
    
    # Calculate new version based on type
    if version_type == "major":
        new_version = format_version(major + 1, 0, 0)
    elif version_type == "minor":
        new_version = format_version(major, minor + 1, 0)
    elif version_type == "patch":
        new_version = format_version(major, minor, patch + 1)
    elif version_type == "post":
        # If already a post release, increment post number
        # Otherwise, create .post1
        if post is not None:
            new_version = format_version(major, minor, patch, post + 1)
        else:
            new_version = format_version(major, minor, patch, 1)
    else:
        print("Invalid version type. Use 'major', 'minor', 'patch', or 'post'")
        sys.exit(1)
    
    print(f"Bumping version from {current_version} to {new_version}")
    
    # Update pyproject.toml
    new_pyproject_content = re.sub(
        r'^version = ["\']([^"\']+)["\']',
        f'version = "{new_version}"',
        pyproject_content,
        count=1,
        flags=re.MULTILINE
    )
    pyproject_file.write_text(new_pyproject_content)
    print(f"✓ Updated {pyproject_file}")
    
    # Update __init__.py
    init_content = init_file.read_text()
    new_init_content = re.sub(
        r'__version__ = ["\']([^"\']+)["\']',
        f'__version__ = "{new_version}"',
        init_content
    )
    init_file.write_text(new_init_content)
    print(f"✓ Updated {init_file}")
    
    # Git operations
    print("\nPerforming git operations...")
    run_command("git add pyproject.toml sdk/src/openagents/__init__.py")
    run_command(f'git commit -m "chore(release): bump version to {new_version}"')
    print("✓ Created commit")
    
    if push:
        run_command("git push")
        print("✓ Pushed commit")
        
        run_command(f"git tag v{new_version}")
        print(f"✓ Created tag v{new_version}")
        
        run_command("git push --tags")
        print("✓ Pushed tag")
        
        print(f"\n🎉 Successfully bumped version from {current_version} to {new_version}")
        print(f"   Tag v{new_version} has been pushed to remote")
        print(f"   You can create a GitHub release at: https://github.com/openagents-org/openagents/releases/new?tag=v{new_version}")
    else:
        run_command(f"git tag v{new_version}")
        print(f"✓ Created tag v{new_version}")
        
        print(f"\n🎉 Successfully bumped version from {current_version} to {new_version}")
        print(f"   Changes committed locally. Use --push to push to remote")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Bump version for OpenAgents project',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        'version_type',
        choices=['major', 'minor', 'patch', 'post'],
        help='Type of version bump'
    )
    parser.add_argument(
        '--push',
        action='store_true',
        help='Push changes and tag to remote'
    )
    
    args = parser.parse_args()
    bump_version(args.version_type, push=args.push)


if __name__ == "__main__":
    main()
