"""
Certificate Generation Utility for OpenAgents.

This module provides utilities for generating self-signed certificates
for development and testing purposes.
"""

import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Dict

from cryptography import x509
from cryptography.x509.oid import NameOID, ExtensionOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

logger = logging.getLogger(__name__)


class CertificateGenerator:
    """Generate self-signed certificates for development."""

    @staticmethod
    def generate_self_signed(
        output_dir: str,
        common_name: str = "localhost",
        days_valid: int = 365,
        san_names: Optional[List[str]] = None
    ) -> Dict[str, Path]:
        """
        Generate self-signed CA and server certificates.

        Args:
            output_dir: Directory to write certificate files
            common_name: Common name for the server certificate
            days_valid: Number of days the certificates should be valid
            san_names: Additional Subject Alternative Names for the certificate

        Returns:
            Dict with paths to generated files (ca_cert, server_cert, server_key)
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        logger.info(f"Generating certificates in {output_dir}...")

        # Generate CA key and certificate
        ca_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=4096
        )

        ca_subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenAgents Development"),
            x509.NameAttribute(NameOID.COMMON_NAME, "OpenAgents Dev CA"),
        ])

        ca_cert = (
            x509.CertificateBuilder()
            .subject_name(ca_subject)
            .issuer_name(ca_subject)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(timezone.utc))
            .not_valid_after(datetime.now(timezone.utc) + timedelta(days=days_valid * 2))
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=0),
                critical=True
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_cert_sign=True,
                    crl_sign=True,
                    key_encipherment=False,
                    content_commitment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    encipher_only=False,
                    decipher_only=False
                ),
                critical=True
            )
            .sign(ca_key, hashes.SHA256())
        )

        logger.debug("Generated CA certificate")

        # Generate server key and certificate
        server_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )

        server_subject = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "OpenAgents"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ])

        # Subject Alternative Names
        san_list = [x509.DNSName(common_name)]
        if san_names:
            san_list.extend([x509.DNSName(name) for name in san_names])

        # Always include localhost
        if "localhost" not in [common_name] + (san_names or []):
            san_list.append(x509.DNSName("localhost"))

        # Add IP addresses
        san_list.append(x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")))
        san_list.append(x509.IPAddress(ipaddress.IPv6Address("::1")))

        server_cert = (
            x509.CertificateBuilder()
            .subject_name(server_subject)
            .issuer_name(ca_subject)
            .public_key(server_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.now(timezone.utc))
            .not_valid_after(datetime.now(timezone.utc) + timedelta(days=days_valid))
            .add_extension(
                x509.SubjectAlternativeName(san_list),
                critical=False
            )
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_encipherment=True,
                    key_cert_sign=False,
                    crl_sign=False,
                    content_commitment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    encipher_only=False,
                    decipher_only=False
                ),
                critical=True
            )
            .add_extension(
                x509.ExtendedKeyUsage([
                    x509.oid.ExtendedKeyUsageOID.SERVER_AUTH,
                    x509.oid.ExtendedKeyUsageOID.CLIENT_AUTH,
                ]),
                critical=False
            )
            .sign(ca_key, hashes.SHA256())
        )

        logger.debug("Generated server certificate")

        # Write files
        ca_cert_path = output_path / "ca.crt"
        server_cert_path = output_path / "server.crt"
        server_key_path = output_path / "server.key"

        with open(ca_cert_path, "wb") as f:
            f.write(ca_cert.public_bytes(serialization.Encoding.PEM))

        with open(server_cert_path, "wb") as f:
            f.write(server_cert.public_bytes(serialization.Encoding.PEM))

        with open(server_key_path, "wb") as f:
            f.write(server_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            ))

        # Set restrictive permissions on private key
        server_key_path.chmod(0o600)

        logger.info(f"✓ Generated certificates in {output_dir}")
        logger.info(f"  CA Certificate: {ca_cert_path}")
        logger.info(f"  Server Certificate: {server_cert_path}")
        logger.info(f"  Server Key: {server_key_path}")

        return {
            "ca_cert": ca_cert_path,
            "server_cert": server_cert_path,
            "server_key": server_key_path
        }

    @staticmethod
    def verify_certificate(cert_file: str) -> Dict[str, str]:
        """
        Verify and display information about a certificate file.

        Args:
            cert_file: Path to certificate file

        Returns:
            Dict with certificate information
        """
        from cryptography import x509

        with open(cert_file, 'rb') as f:
            cert = x509.load_pem_x509_certificate(f.read())

        info = {
            "subject": str(cert.subject),
            "issuer": str(cert.issuer),
            "valid_from": cert.not_valid_before.isoformat(),
            "valid_until": cert.not_valid_after.isoformat(),
            "serial": str(cert.serial_number),
        }

        # Extract SAN if present
        try:
            san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            san_names = [str(name) for name in san_ext.value]
            info["san"] = ", ".join(san_names)
        except x509.ExtensionNotFound:
            info["san"] = "None"

        return info
