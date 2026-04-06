"""
AgentID client for verification and authentication.

This module provides:
- AgentIDVerifier: For verifying agent IDs, validating tokens, and resolving DIDs
- AgentIDAuth: For authenticating as an agent (challenge-response + JWT)
"""

import asyncio
import base64
import logging
from pathlib import Path
from typing import Optional, Union

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

from openagents.agentid.models import (
    AgentInfo,
    VerificationResult,
    ChallengeResponse,
    TokenResponse,
    TokenValidationResult,
    ClaimResponse,
    DIDDocument,
    AgentIDLevel,
)
from openagents.agentid.parser import parse_agent_id, extract_components
from openagents.agentid.exceptions import (
    AgentIDError,
    AgentIDNotFoundError,
    AgentIDConnectionError,
    AgentIDAuthenticationError,
    AgentIDSignatureError,
    AgentIDChallengeExpiredError,
    AgentIDTokenExpiredError,
)

logger = logging.getLogger(__name__)

# Default API endpoint
DEFAULT_ENDPOINT = "https://endpoint.openagents.org"


class AgentIDVerifier:
    """Client for AgentID verification and lookup operations.

    This client provides methods to:
    - Validate agent IDs exist in the registry
    - Get agent information
    - Verify JWT tokens
    - Resolve DID documents
    - Request authentication challenges
    - Exchange signatures for tokens

    Usage:
        client = AgentIDVerifier()

        # Validate an agent exists
        result = client.validate("openagents:my-agent")

        # Get agent info
        info = client.get_agent_info("my-agent")

        # Resolve DID
        did_doc = client.resolve_did("did:openagents:my-agent")

        # Verify a token
        validation = client.verify_token("eyJ...")
    """

    def __init__(
        self,
        endpoint: str = DEFAULT_ENDPOINT,
        timeout: int = 30,
    ):
        """Initialize the AgentID client.

        Args:
            endpoint: Base URL for the AgentID API
            timeout: Request timeout in seconds
        """
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self._session = None
        self._aiohttp = None

    async def _get_session(self):
        """Get or create an aiohttp session."""
        if self._aiohttp is None:
            import aiohttp

            self._aiohttp = aiohttp

        if self._session is None or self._session.closed:
            connector = self._aiohttp.TCPConnector(
                limit=100,
                limit_per_host=30,
                ttl_dns_cache=300,
            )
            timeout = self._aiohttp.ClientTimeout(total=self.timeout)
            self._session = self._aiohttp.ClientSession(
                connector=connector,
                timeout=timeout,
                headers={"Content-Type": "application/json"},
            )
        return self._session

    async def close(self):
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    # =========================================================================
    # Async API Methods
    # =========================================================================

    async def validate_async(self, agent_id: str) -> VerificationResult:
        """Verify that an agent ID exists in the registry.

        Args:
            agent_id: Agent ID in any format (simple, Level 2, or Level 3)

        Returns:
            VerificationResult with verification status

        Raises:
            AgentIDConnectionError: On network errors
        """
        agent_name, org = extract_components(agent_id)

        try:
            info = await self.get_agent_info_async(agent_name, org=org)
            return VerificationResult(
                verified=True,
                level=AgentIDLevel.LEVEL_2,
                agent_name=agent_name,
                org=org,
                status=info.status,
                message="Agent verified successfully",
            )
        except AgentIDNotFoundError:
            return VerificationResult(
                verified=False,
                level=AgentIDLevel.LEVEL_2,
                agent_name=agent_name,
                org=org,
                status=None,
                message="Agent not found in registry",
            )

    async def get_agent_info_async(
        self, agent_name: str, org: str = None
    ) -> AgentInfo:
        """Get agent information from the registry.

        Args:
            agent_name: Agent name (globally unique)
            org: Deprecated. Legacy organization scope, ignored for new agents.

        Returns:
            AgentInfo with agent details

        Raises:
            AgentIDNotFoundError: If agent doesn't exist
            AgentIDConnectionError: On network errors
        """
        session = await self._get_session()
        url = f"{self.endpoint}/v1/agent-ids/{agent_name}"
        params = {}
        if org:
            params["org"] = org

        try:
            async with session.get(url, params=params) as resp:
                data = await resp.json()

                if resp.status == 404 or data.get("code") == 404:
                    raise AgentIDNotFoundError(agent_name, org)

                if resp.status != 200:
                    raise AgentIDConnectionError(
                        f"API error: {data.get('message', 'Unknown error')}",
                        status_code=resp.status,
                        response=str(data),
                    )

                agent_data = data.get("data", data)
                return AgentInfo(
                    agent_name=agent_data.get("agentName", agent_name),
                    org=agent_data.get("org", org),
                    status=agent_data.get("status", "active"),
                    public_key_pem=agent_data.get("publicKeyPem"),
                    cert_serial=agent_data.get("serial"),
                    algorithm=agent_data.get("algorithm"),
                )

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    async def resolve_did_async(self, did: str) -> DIDDocument:
        """Resolve a DID to get the DID document.

        Args:
            did: DID in format did:openagents:xxx

        Returns:
            DIDDocument with verification methods and services

        Raises:
            AgentIDNotFoundError: If DID doesn't exist
            AgentIDConnectionError: On network errors
        """
        # Ensure it's a valid DID format
        parsed = parse_agent_id(did)
        did_str = parsed.level_3_id

        session = await self._get_session()
        url = f"{self.endpoint}/v1/agentid/did/{did_str}"

        try:
            async with session.get(url) as resp:
                data = await resp.json()

                if resp.status == 404 or data.get("code") == 404:
                    raise AgentIDNotFoundError(
                        parsed.agent_name, parsed.org
                    )

                if resp.status != 200:
                    raise AgentIDConnectionError(
                        f"API error: {data.get('message', 'Unknown error')}",
                        status_code=resp.status,
                        response=str(data),
                    )

                doc_data = data.get("data", data)
                return DIDDocument(**doc_data)

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    async def verify_token_async(self, token: str) -> TokenValidationResult:
        """Validate a JWT token.

        Args:
            token: JWT token to validate

        Returns:
            TokenValidationResult with validation status

        Raises:
            AgentIDConnectionError: On network errors
        """
        session = await self._get_session()
        url = f"{self.endpoint}/v1/agentid/verify-token"

        try:
            async with session.post(url, json={"token": token}) as resp:
                data = await resp.json()

                if resp.status != 200:
                    return TokenValidationResult(
                        valid=False,
                        reason=data.get("message", "Validation failed"),
                    )

                result_data = data.get("data", data)
                return TokenValidationResult(
                    valid=result_data.get("valid", False),
                    agent_name=result_data.get("agentName"),
                    org=result_data.get("org"),
                    expires_at=result_data.get("expiresAt"),
                    verification_level=result_data.get("verificationLevel"),
                    reason=result_data.get("reason"),
                )

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    async def request_challenge_async(
        self,
        agent_name: str,
        org: str = None,
        algorithm: str = "RS256",
    ) -> ChallengeResponse:
        """Request an authentication challenge.

        Args:
            agent_name: Agent name (globally unique)
            org: Deprecated. Legacy organization scope, kept for backward compat.
            algorithm: Signing algorithm (RS256 or Ed25519)

        Returns:
            ChallengeResponse with challenge and nonce

        Raises:
            AgentIDNotFoundError: If agent doesn't exist
            AgentIDConnectionError: On network errors
        """
        session = await self._get_session()
        url = f"{self.endpoint}/v1/agentid/challenge"

        payload = {
            "agentName": agent_name,
            "algorithm": algorithm,
        }
        if org:
            payload["org"] = org

        try:
            async with session.post(url, json=payload) as resp:
                data = await resp.json()

                if resp.status == 404 or data.get("code") == 404:
                    raise AgentIDNotFoundError(agent_name, org)

                if resp.status != 200:
                    raise AgentIDConnectionError(
                        f"API error: {data.get('message', 'Unknown error')}",
                        status_code=resp.status,
                        response=str(data),
                    )

                challenge_data = data.get("data", data)
                return ChallengeResponse(
                    challenge=challenge_data["challenge"],
                    nonce=challenge_data["nonce"],
                    algorithm=challenge_data.get("algorithm", algorithm),
                    expires_in=challenge_data.get("expiresIn", 300),
                )

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    async def get_token_async(
        self,
        agent_name: str,
        nonce: str,
        signature: str,
        org: str = None,
    ) -> TokenResponse:
        """Exchange a signature for a JWT token.

        Args:
            agent_name: Agent name (globally unique)
            nonce: Challenge nonce
            signature: Base64-encoded signature of the challenge
            org: Deprecated. Legacy organization scope, kept for backward compat.

        Returns:
            TokenResponse with JWT token

        Raises:
            AgentIDAuthenticationError: If signature verification fails
            AgentIDConnectionError: On network errors
        """
        session = await self._get_session()
        url = f"{self.endpoint}/v1/agentid/token"

        payload = {
            "agentName": agent_name,
            "nonce": nonce,
            "signature": signature,
        }
        if org:
            payload["org"] = org

        try:
            async with session.post(url, json=payload) as resp:
                data = await resp.json()

                if resp.status == 401:
                    message = data.get("message", "Authentication failed")
                    if "expired" in message.lower():
                        raise AgentIDChallengeExpiredError()
                    raise AgentIDSignatureError(message)

                if resp.status != 200:
                    raise AgentIDConnectionError(
                        f"API error: {data.get('message', 'Unknown error')}",
                        status_code=resp.status,
                        response=str(data),
                    )

                token_data = data.get("data", data)
                return TokenResponse(
                    access_token=token_data["accessToken"],
                    token_type=token_data.get("tokenType", "bearer"),
                    expires_in=token_data["expiresIn"],
                    verification_level=token_data.get("verificationLevel", 2),
                )

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    async def claim_agent_id_async(
        self,
        agent_name: str,
        public_key_pem: str,
        org: str = None,
        api_key: str = None,
        namespace_type: str = "global",
    ) -> ClaimResponse:
        """Claim/register a new agent ID.

        Agent names are globally unique (like Twitter handles). The org parameter
        is deprecated and only kept for backward compatibility with legacy agents.

        Args:
            agent_name: Desired agent name (must be globally unique)
            public_key_pem: Public key in PEM format
            org: Deprecated. Legacy organization scope, kept for backward compat.
            api_key: API key for authentication
            namespace_type: Namespace type (default "global")

        Returns:
            ClaimResponse with the claimed agent details and certificate

        Raises:
            AgentIDConnectionError: On network errors or API failures
            AgentIDAuthenticationError: If authentication fails
        """
        session = await self._get_session()
        url = f"{self.endpoint}/v1/agent-ids/create"

        payload = {
            "agentName": agent_name,
            "publicKeyPem": public_key_pem,
            "namespaceType": namespace_type,
        }
        if org:
            payload["org"] = org

        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            async with session.post(url, json=payload, headers=headers) as resp:
                data = await resp.json()

                if resp.status == 401:
                    raise AgentIDAuthenticationError(
                        data.get("message", "Authentication failed")
                    )

                if resp.status == 409:
                    raise AgentIDConnectionError(
                        f"Agent ID already exists: {agent_name}",
                        status_code=resp.status,
                        response=str(data),
                    )

                if resp.status not in (200, 201):
                    raise AgentIDConnectionError(
                        f"API error: {data.get('message', 'Unknown error')}",
                        status_code=resp.status,
                        response=str(data),
                    )

                claim_data = data.get("data", data)
                return ClaimResponse(
                    agent_name=claim_data.get("agentName", agent_name),
                    org=claim_data.get("org", org),
                    cert_pem=claim_data.get("certPem"),
                    serial=claim_data.get("serial"),
                    status=claim_data.get("status", "active"),
                )

        except Exception as e:
            if aiohttp and isinstance(e, aiohttp.ClientError):
                raise AgentIDConnectionError(f"Connection error: {e}")
            raise

    # =========================================================================
    # Sync API Methods (wrappers around async methods)
    # =========================================================================

    def _run_async(self, coro):
        """Run an async coroutine synchronously with proper cleanup."""

        async def run_with_cleanup():
            try:
                return await coro
            finally:
                await self.close()

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # We're in an async context, can't use run_until_complete
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, run_with_cleanup())
                return future.result()
        else:
            return asyncio.run(run_with_cleanup())

    def validate(self, agent_id: str) -> VerificationResult:
        """Validate that an agent ID exists (sync version)."""
        return self._run_async(self.validate_async(agent_id))

    def get_agent_info(self, agent_name: str, org: str = None) -> AgentInfo:
        """Get agent information (sync version).

        Args:
            agent_name: Agent name (globally unique)
            org: Deprecated. Legacy organization scope.
        """
        return self._run_async(self.get_agent_info_async(agent_name, org=org))

    def resolve_did(self, did: str) -> DIDDocument:
        """Resolve a DID document (sync version)."""
        return self._run_async(self.resolve_did_async(did))

    def verify_token(self, token: str) -> TokenValidationResult:
        """Verify a JWT token (sync version)."""
        return self._run_async(self.verify_token_async(token))

    def request_challenge(
        self,
        agent_name: str,
        org: str = None,
        algorithm: str = "RS256",
    ) -> ChallengeResponse:
        """Request an authentication challenge (sync version)."""
        return self._run_async(
            self.request_challenge_async(agent_name, org=org, algorithm=algorithm)
        )

    def get_token(
        self,
        agent_name: str,
        nonce: str,
        signature: str,
        org: str = None,
    ) -> TokenResponse:
        """Exchange a signature for a JWT token (sync version)."""
        return self._run_async(
            self.get_token_async(agent_name, nonce, signature, org=org)
        )

    def claim_agent_id(
        self,
        agent_name: str,
        public_key_pem: str,
        org: str = None,
        api_key: str = None,
        namespace_type: str = "global",
    ) -> ClaimResponse:
        """Claim/register a new agent ID (sync version)."""
        return self._run_async(
            self.claim_agent_id_async(
                agent_name,
                public_key_pem,
                org=org,
                api_key=api_key,
                namespace_type=namespace_type,
            )
        )


class AgentIDAuth:
    """Authentication helper for getting JWT tokens.

    This class handles the full challenge-response flow to obtain
    JWT tokens for an agent you own.

    Usage:
        auth = AgentIDAuth(
            agent_name="my-agent",
            private_key_path="agent_private.pem"
        )

        # Get a JWT token (handles challenge-response automatically)
        token = auth.get_token()

        # Use the token for API calls
        headers = {"Authorization": f"Bearer {token.access_token}"}
    """

    def __init__(
        self,
        agent_name: str,
        org: str = None,
        private_key_path: Union[str, Path] = None,
        private_key_pem: str = None,
        algorithm: str = "RS256",
        endpoint: str = DEFAULT_ENDPOINT,
    ):
        """Initialize the authentication helper.

        Args:
            agent_name: Agent name (globally unique)
            org: Deprecated. Legacy organization scope, kept for backward compat.
            private_key_path: Path to private key PEM file
            private_key_pem: Private key in PEM format (alternative to path)
            algorithm: Signing algorithm (RS256 or Ed25519)
            endpoint: API endpoint URL

        Raises:
            ValueError: If neither private_key_path nor private_key_pem is provided
        """
        if not private_key_path and not private_key_pem:
            raise ValueError(
                "Either private_key_path or private_key_pem must be provided"
            )

        self.agent_name = agent_name
        self.org = org
        self.algorithm = algorithm
        self.client = AgentIDVerifier(endpoint=endpoint)

        # Load private key
        if private_key_path:
            with open(private_key_path, "rb") as f:
                private_key_pem = f.read()
        elif isinstance(private_key_pem, str):
            private_key_pem = private_key_pem.encode()

        self._private_key_pem = private_key_pem
        self._private_key = None

    def _load_private_key(self):
        """Load and cache the private key."""
        if self._private_key is None:
            from cryptography.hazmat.primitives.serialization import (
                load_pem_private_key,
            )

            self._private_key = load_pem_private_key(
                self._private_key_pem, password=None
            )
        return self._private_key

    def sign_challenge(self, challenge_b64: str) -> str:
        """Sign a challenge with the private key.

        Args:
            challenge_b64: Base64-encoded challenge bytes

        Returns:
            Base64-encoded signature
        """
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, ec

        private_key = self._load_private_key()
        challenge_bytes = base64.b64decode(challenge_b64)

        # Determine signing method based on key type
        if hasattr(private_key, "sign"):
            if self.algorithm == "RS256":
                # RSA signature
                signature = private_key.sign(
                    challenge_bytes,
                    padding.PKCS1v15(),
                    hashes.SHA256(),
                )
            elif self.algorithm in ("Ed25519", "EdDSA"):
                # Ed25519 signature (no extra params needed)
                signature = private_key.sign(challenge_bytes)
            elif self.algorithm == "ES256":
                # ECDSA signature
                signature = private_key.sign(
                    challenge_bytes,
                    ec.ECDSA(hashes.SHA256()),
                )
            else:
                raise ValueError(f"Unsupported algorithm: {self.algorithm}")
        else:
            raise ValueError("Private key does not support signing")

        return base64.b64encode(signature).decode()

    async def get_token_async(self) -> TokenResponse:
        """Get a JWT token using challenge-response (async).

        Returns:
            TokenResponse with JWT token

        Raises:
            AgentIDAuthenticationError: If authentication fails
            AgentIDConnectionError: On network errors
        """
        # Step 1: Request challenge
        challenge = await self.client.request_challenge_async(
            self.agent_name,
            org=self.org,
            algorithm=self.algorithm,
        )

        # Step 2: Sign challenge
        signature = self.sign_challenge(challenge.challenge)

        # Step 3: Get token
        token = await self.client.get_token_async(
            self.agent_name,
            nonce=challenge.nonce,
            signature=signature,
            org=self.org,
        )

        return token

    def get_token(self) -> TokenResponse:
        """Get a JWT token using challenge-response (sync).

        Returns:
            TokenResponse with JWT token

        Raises:
            AgentIDAuthenticationError: If authentication fails
            AgentIDConnectionError: On network errors
        """
        return self.client._run_async(self.get_token_async())

    async def close(self):
        """Close the underlying client."""
        await self.client.close()

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
