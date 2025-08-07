"""
OpenAgents Agent Identity Management

This module provides certificate-based identity management for agents,
allowing agents to claim unique IDs and prove their identity for reconnection.
"""

import hashlib
import hmac
import json
import secrets
import time
from typing import Dict, Any, Optional, Set
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)


class AgentCertificate:
    """Represents an agent identity certificate."""
    
    def __init__(self, agent_id: str, issued_at: float, expires_at: float, 
                 certificate_hash: str, signature: str):
        """Initialize an agent certificate.
        
        Args:
            agent_id: The agent ID this certificate is for
            issued_at: Unix timestamp when certificate was issued
            expires_at: Unix timestamp when certificate expires
            certificate_hash: Hash of the certificate data
            signature: HMAC signature of the certificate
        """
        self.agent_id = agent_id
        self.issued_at = issued_at
        self.expires_at = expires_at
        self.certificate_hash = certificate_hash
        self.signature = signature
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert certificate to dictionary."""
        return {
            "agent_id": self.agent_id,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "certificate_hash": self.certificate_hash,
            "signature": self.signature
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentCertificate':
        """Create certificate from dictionary."""
        return cls(
            agent_id=data["agent_id"],
            issued_at=data["issued_at"],
            expires_at=data["expires_at"],
            certificate_hash=data["certificate_hash"],
            signature=data["signature"]
        )
    
    def is_expired(self) -> bool:
        """Check if certificate is expired."""
        return time.time() > self.expires_at
    
    def is_valid_for_agent(self, agent_id: str) -> bool:
        """Check if certificate is valid for the given agent ID."""
        return self.agent_id == agent_id and not self.is_expired()


class AgentIdentityManager:
    """Manages agent identity certificates and claims."""
    
    def __init__(self, secret_key: Optional[str] = None, certificate_ttl_hours: int = 24):
        """Initialize the identity manager.
        
        Args:
            secret_key: Secret key for HMAC signatures (auto-generated if None)
            certificate_ttl_hours: How long certificates are valid (default 24 hours)
        """
        self.secret_key = secret_key or secrets.token_hex(32)
        self.certificate_ttl = certificate_ttl_hours * 3600  # Convert to seconds
        self.claimed_agents: Set[str] = set()
        self.certificates: Dict[str, AgentCertificate] = {}
        logger.info(f"AgentIdentityManager initialized with TTL={certificate_ttl_hours}h")
    
    def _generate_certificate_data(self, agent_id: str, issued_at: float, expires_at: float) -> str:
        """Generate the data to be signed for a certificate."""
        data = {
            "agent_id": agent_id,
            "issued_at": issued_at,
            "expires_at": expires_at
        }
        return json.dumps(data, sort_keys=True)
    
    def _generate_signature(self, data: str) -> str:
        """Generate HMAC signature for certificate data."""
        return hmac.new(
            self.secret_key.encode(),
            data.encode(),
            hashlib.sha256
        ).hexdigest()
    
    def _generate_certificate_hash(self, data: str) -> str:
        """Generate hash of certificate data."""
        return hashlib.sha256(data.encode()).hexdigest()
    
    def claim_agent_id(self, agent_id: str, force: bool = False) -> Optional[AgentCertificate]:
        """Claim an agent ID and issue a certificate.
        
        Args:
            agent_id: The agent ID to claim
            force: If True, forcefully reclaim even if already claimed
            
        Returns:
            AgentCertificate if successful, None if agent ID already claimed
        """
        # Check if agent ID is already claimed
        if agent_id in self.claimed_agents and not force:
            logger.warning(f"Agent ID {agent_id} is already claimed")
            return None
        
        # Clean up expired certificates
        self._cleanup_expired_certificates()
        
        # Generate certificate
        current_time = time.time()
        expires_at = current_time + self.certificate_ttl
        
        cert_data = self._generate_certificate_data(agent_id, current_time, expires_at)
        cert_hash = self._generate_certificate_hash(cert_data)
        signature = self._generate_signature(cert_data)
        
        certificate = AgentCertificate(
            agent_id=agent_id,
            issued_at=current_time,
            expires_at=expires_at,
            certificate_hash=cert_hash,
            signature=signature
        )
        
        # Store the claim and certificate
        self.claimed_agents.add(agent_id)
        self.certificates[agent_id] = certificate
        
        logger.info(f"Issued certificate for agent {agent_id} (expires: {datetime.fromtimestamp(expires_at)})")
        return certificate
    
    def validate_certificate(self, certificate_data: Dict[str, Any]) -> bool:
        """Validate an agent certificate.
        
        Args:
            certificate_data: Certificate data to validate
            
        Returns:
            bool: True if certificate is valid, False otherwise
        """
        try:
            certificate = AgentCertificate.from_dict(certificate_data)
            
            # Check if certificate is expired
            if certificate.is_expired():
                logger.warning(f"Certificate for agent {certificate.agent_id} is expired")
                return False
            
            # Regenerate certificate data and verify signature
            cert_data = self._generate_certificate_data(
                certificate.agent_id, 
                certificate.issued_at, 
                certificate.expires_at
            )
            
            expected_hash = self._generate_certificate_hash(cert_data)
            expected_signature = self._generate_signature(cert_data)
            
            # Verify hash and signature
            if certificate.certificate_hash != expected_hash:
                logger.warning(f"Certificate hash mismatch for agent {certificate.agent_id}")
                return False
            
            if certificate.signature != expected_signature:
                logger.warning(f"Certificate signature invalid for agent {certificate.agent_id}")
                return False
            
            # Check if this agent ID is still claimed by this certificate
            stored_cert = self.certificates.get(certificate.agent_id)
            if stored_cert and stored_cert.certificate_hash == certificate.certificate_hash:
                logger.debug(f"Certificate validated for agent {certificate.agent_id}")
                return True
            
            logger.warning(f"Certificate not found in store for agent {certificate.agent_id}")
            return False
            
        except Exception as e:
            logger.error(f"Error validating certificate: {e}")
            return False
    
    def is_agent_claimed(self, agent_id: str) -> bool:
        """Check if an agent ID is claimed.
        
        Args:
            agent_id: The agent ID to check
            
        Returns:
            bool: True if claimed, False otherwise
        """
        self._cleanup_expired_certificates()
        return agent_id in self.claimed_agents
    
    def release_agent_id(self, agent_id: str) -> bool:
        """Release an agent ID claim.
        
        Args:
            agent_id: The agent ID to release
            
        Returns:
            bool: True if released, False if not claimed
        """
        if agent_id in self.claimed_agents:
            self.claimed_agents.remove(agent_id)
            if agent_id in self.certificates:
                del self.certificates[agent_id]
            logger.info(f"Released agent ID {agent_id}")
            return True
        return False
    
    def _cleanup_expired_certificates(self):
        """Clean up expired certificates and claims."""
        current_time = time.time()
        expired_agents = []
        
        for agent_id, certificate in self.certificates.items():
            if certificate.is_expired():
                expired_agents.append(agent_id)
        
        for agent_id in expired_agents:
            logger.info(f"Cleaning up expired certificate for agent {agent_id}")
            self.claimed_agents.discard(agent_id)
            del self.certificates[agent_id]
    
    def get_certificate(self, agent_id: str) -> Optional[AgentCertificate]:
        """Get the certificate for an agent ID.
        
        Args:
            agent_id: The agent ID to get certificate for
            
        Returns:
            AgentCertificate if exists and not expired, None otherwise
        """
        self._cleanup_expired_certificates()
        certificate = self.certificates.get(agent_id)
        if certificate and not certificate.is_expired():
            return certificate
        return None
    
    def get_stats(self) -> Dict[str, Any]:
        """Get identity manager statistics.
        
        Returns:
            Dict containing statistics about claimed agents and certificates
        """
        self._cleanup_expired_certificates()
        return {
            "claimed_agents": len(self.claimed_agents),
            "active_certificates": len(self.certificates),
            "certificate_ttl_hours": self.certificate_ttl / 3600
        }