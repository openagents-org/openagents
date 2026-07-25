# -*- coding: utf-8 -*-
"""
Local TLS/SNI integration test for the SSRF IP-pinning transport.

Starts a real HTTPS server on 127.0.0.1 with a self-signed cert whose SAN is a
hostname (not the IP). The pinned transport is told to connect that hostname to
127.0.0.1. The test passes only if the TLS handshake succeeds — proving the
transport pins the socket to the validated IP while still driving SNI and
certificate verification with the real hostname (httpcore sni_hostname). No
external network is used.
"""

import asyncio
import datetime
import http.server
import ssl
import threading

import httpx
import pytest

pytest.importorskip("cryptography")

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from app import net_security

HOSTNAME = "pinned.test"


def _make_cert(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, HOSTNAME)])
    now = datetime.datetime(2020, 1, 1)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(datetime.datetime(2050, 1, 1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(HOSTNAME)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / "cert.pem"
    key_path = tmp_path / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return str(cert_path), str(key_path)


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"pinned-ok")

    def log_message(self, *args):
        pass


def test_pinned_transport_real_tls_sni(tmp_path):
    cert_path, key_path = _make_cert(tmp_path)

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        async def _run():
            # Pin the hostname to loopback; verify against our self-signed CA.
            transport = net_security._PinnedTransport({HOSTNAME: ["127.0.0.1"]}, verify=cert_path)
            async with httpx.AsyncClient(transport=transport, timeout=10) as client:
                # URL uses the HOSTNAME (cert has no IP SAN), transport connects to 127.0.0.1.
                return await client.get(f"https://{HOSTNAME}:{port}/")

        resp = asyncio.run(_run())
        assert resp.status_code == 200
        assert resp.text == "pinned-ok"
    finally:
        server.shutdown()
        t.join(timeout=5)
