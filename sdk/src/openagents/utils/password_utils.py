"""
Password utilities for OpenAgents network security.

This module provides secure password hashing and verification using SHA-256.
"""

import hashlib
import logging

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """
    Hash a password using SHA-256.
    
    Args:
        password: Plain text password to hash
        
    Returns:
        str: SHA-256 hash of the password
        
    Raises:
        ValueError: If password is empty or None
    """
    if not password:
        raise ValueError("Password cannot be empty")
        
    # Hash the password
    password_bytes = password.encode('utf-8')
    hash_obj = hashlib.sha256(password_bytes)
    password_hash = hash_obj.hexdigest()
    
    return password_hash


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verify a password against a SHA-256 hash.
    
    Args:
        password: Plain text password to verify
        password_hash: SHA-256 hash to verify against
        
    Returns:
        bool: True if password matches hash, False otherwise
    """
    if not password or not password_hash:
        return False
        
    try:
        # Hash the provided password
        password_bytes = password.encode('utf-8')
        hash_obj = hashlib.sha256(password_bytes)
        computed_hash = hash_obj.hexdigest()
        
        # Compare hashes
        return computed_hash == password_hash
    except Exception as e:
        logger.warning(f"Password verification failed: {e}")
        return False


def generate_password_hash_for_config(password: str) -> str:
    """
    Generate a password hash for use in network configuration.
    
    This is a convenience function for creating password hashes
    that can be stored in network configuration files.
    
    Args:
        password: Plain text password
        
    Returns:
        str: SHA-256 hash suitable for configuration storage
        
    Example:
        >>> hash_value = generate_password_hash_for_config("my_secure_password")
        >>> # Store hash_value in network config's password_hash field
    """
    return hash_password(password)


def validate_password_strength(password: str) -> tuple[bool, str]:
    """
    Validate password strength requirements.
    
    Args:
        password: Password to validate
        
    Returns:
        tuple: (is_valid, error_message)
    """
    if not password:
        return False, "Password cannot be empty"
        
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
        
    # Add more strength requirements as needed
    # For now, just check minimum length
    
    return True, ""