#!/usr/bin/env python3
"""
CLI utility to generate password hashes for OpenAgents network configuration.

This script helps network administrators generate secure password hashes
that can be stored in network configuration files.

Usage:
    python scripts/generate_network_password.py
    
Or:
    python scripts/generate_network_password.py --password "your_password"
"""

import argparse
import getpass
import sys
import os

# Add the src directory to the path so we can import openagents modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

try:
    from openagents.utils.password_utils import generate_password_hash_for_config, validate_password_strength
except ImportError as e:
    print(f"Error importing OpenAgents modules: {e}")
    print("Make sure you're running this script from the OpenAgents root directory.")
    sys.exit(1)


def main():
    """Main function for the password generation CLI."""
    parser = argparse.ArgumentParser(
        description="Generate password hashes for OpenAgents network configuration"
    )
    parser.add_argument(
        "--password", 
        type=str, 
        help="Password to hash (if not provided, will prompt interactively)"
    )
    parser.add_argument(
        "--validate", 
        action="store_true", 
        help="Validate password strength before hashing"
    )
    
    args = parser.parse_args()
    
    # Get password
    if args.password:
        password = args.password
    else:
        print("Enter the password for your OpenAgents network:")
        password = getpass.getpass("Password: ")
        
        if not password:
            print("Error: Empty password provided.")
            sys.exit(1)
    
    # Validate password strength if requested
    if args.validate:
        is_valid, error_message = validate_password_strength(password)
        if not is_valid:
            print(f"Password validation failed: {error_message}")
            response = input("Continue anyway? (y/N): ")
            if response.lower() != 'y':
                print("Password generation cancelled.")
                sys.exit(1)
        else:
            print("✓ Password strength validation passed.")
    
    try:
        # Generate the hash
        print("Generating password hash...")
        password_hash = generate_password_hash_for_config(password)
        
        print("\n" + "="*60)
        print("PASSWORD HASH GENERATED SUCCESSFULLY")
        print("="*60)
        print(f"Password Hash: {password_hash}")
        print("\nAdd this to your network configuration:")
        print("\nnetwork:")
        print("  name: \"your_network_name\"")
        print("  require_password: true")
        print(f"  password_hash: \"{password_hash}\"")
        print("\n" + "="*60)
        print("SECURITY NOTES:")
        print("- Store this hash in your network configuration file")
        print("- Never store the plain text password")
        print("- Keep the configuration file secure")
        print("- Share the plain text password securely with authorized users")
        print("="*60)
        
    except Exception as e:
        print(f"Error generating password hash: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()