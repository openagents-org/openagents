"""
Password utilities for OpenAgents network security.

This module provides secure password hashing and verification using bcrypt.
"""

import bcrypt
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.
    
    Args:
        password: Plain text password to hash
        
    Returns:
        str: Bcrypt hash of the password
        
    Raises:
        ValueError: If password is empty or None
    """
    if not password:
        raise ValueError("Password cannot be empty")
        
    # Generate salt and hash the password
    salt = bcrypt.gensalt()
    password_bytes = password.encode('utf-8')
    hashed = bcrypt.hashpw(password_bytes, salt)
    
    # Return as string for storage
    return hashed.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verify a password against a bcrypt hash.
    
    Args:
        password: Plain text password to verify
        password_hash: Bcrypt hash to verify against
        
    Returns:
        bool: True if password matches hash, False otherwise
    """
    if not password or not password_hash:
        return False
        
    try:
        password_bytes = password.encode('utf-8')
        hash_bytes = password_hash.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hash_bytes)
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
        str: Bcrypt hash suitable for configuration storage
        
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