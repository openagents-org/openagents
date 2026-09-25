"""Generic OpenID Connect client built on Authlib."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import urlsplit

from authlib.integrations.starlette_client import OAuth
from authlib.oauth2 import OAuth2Error
from authlib.oidc.core.claims import IDToken
from fastapi import Request
from starlette.responses import RedirectResponse

from app.config import config

logger = logging.getLogger(__name__)

OIDC_SESSION_COOKIE = "oa_oidc_session"

_client: Any | None = None
_client_signature: tuple[Any, ...] | None = None


def oidc_enabled() -> bool:
    return str(getattr(config, "AUTH_MODE", "")).strip().lower() == "oidc"


def oidc_email_verification_required() -> bool:
    value = getattr(config, "OIDC_REQUIRE_EMAIL_VERIFICATION", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no"}
    return bool(value)


def _url_allowed(parsed: Any) -> bool:
    try:
        hostname = parsed.hostname
    except ValueError:
        return False
    if not hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if parsed.scheme == "https":
        return bool(parsed.netloc)
    return bool(
        getattr(config, "OIDC_ALLOW_INSECURE_HTTP", False)
        and parsed.scheme == "http"
        and hostname in {"localhost", "127.0.0.1", "::1"}
    )


def redirect_uri() -> str:
    configured = str(getattr(config, "OIDC_REDIRECT_URI", "") or "").strip()
    if configured:
        return configured
    return f"{str(getattr(config, 'PUBLIC_API_BASE', '')).rstrip('/')}/v1/auth/oidc/callback"


def _issuer() -> str:
    issuer = str(getattr(config, "OIDC_ISSUER", "") or "").strip()
    if not issuer:
        raise RuntimeError("OIDC_ISSUER is required")
    try:
        parsed = urlsplit(issuer)
    except ValueError as exc:
        raise RuntimeError("OIDC_ISSUER must be an HTTPS URL") from exc
    if not _url_allowed(parsed):
        raise RuntimeError("OIDC_ISSUER must be an HTTPS URL")
    return issuer


def _origin(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return None
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            return None
        port = parsed.port
    except (TypeError, ValueError):
        return None
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    scheme = parsed.scheme.lower()
    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    port_suffix = "" if port is None or default_port else f":{port}"
    return f"{scheme}://{host}{port_suffix}"


def allowed_browser_origins() -> set[str]:
    values = [
        str(getattr(config, "FRONTEND_BASE_URL", "") or ""),
        *str(getattr(config, "CORS_ORIGINS", "") or "").split(","),
    ]
    return {origin for value in values if (origin := _origin(value))}


def is_allowed_browser_origin(value: str | None) -> bool:
    origin = _origin(value)
    return origin is not None and origin in allowed_browser_origins()


def configuration_error(*, require_session: bool = True) -> str | None:
    if not oidc_enabled():
        return "OIDC authentication is not enabled"
    if not str(getattr(config, "OIDC_CLIENT_ID", "") or "").strip():
        return "OIDC_CLIENT_ID is required"
    if str(getattr(config, "OIDC_TOKEN_ENDPOINT_AUTH_METHOD", "client_secret_basic")) not in {
        "client_secret_basic",
        "client_secret_post",
        "none",
    }:
        return "OIDC_TOKEN_ENDPOINT_AUTH_METHOD is invalid"
    try:
        _issuer()
        callback = redirect_uri()
    except RuntimeError as exc:
        return str(exc)
    try:
        parsed = urlsplit(callback)
        if not _url_allowed(parsed):
            return "OIDC_REDIRECT_URI must be an HTTPS URL"
    except (TypeError, ValueError):
        return "OIDC_REDIRECT_URI must be an HTTPS URL"

    frontend = _origin(str(getattr(config, "FRONTEND_BASE_URL", "") or ""))
    if not frontend:
        return "FRONTEND_BASE_URL is required for OIDC browser sessions"
    cors_values = [value.strip() for value in str(getattr(config, "CORS_ORIGINS", "") or "").split(",")]
    if "*" in cors_values:
        return "CORS_ORIGINS must not contain '*' when OIDC is enabled"
    cors_origins = {origin for value in cors_values if (origin := _origin(value))}
    if frontend not in cors_origins:
        return "CORS_ORIGINS must include FRONTEND_BASE_URL"
    if require_session:
        session_secret = str(getattr(config, "WORKSPACE_SESSION_SECRET", "") or "")
        if len(session_secret) < 32:
            return "WORKSPACE_SESSION_SECRET must be at least 32 characters"
    return None


def _scopes() -> str:
    values = [
        value.strip() for value in str(getattr(config, "OIDC_SCOPES", "openid profile email")).split() if value.strip()
    ]
    if "openid" not in values:
        values.insert(0, "openid")
    return " ".join(dict.fromkeys(values))


def _client_config_signature() -> tuple[Any, ...]:
    return (
        getattr(config, "OIDC_ISSUER", ""),
        getattr(config, "OIDC_CLIENT_ID", ""),
        getattr(config, "OIDC_CLIENT_SECRET", ""),
        getattr(config, "OIDC_SCOPES", "openid profile email"),
        getattr(config, "OIDC_TOKEN_ENDPOINT_AUTH_METHOD", "client_secret_basic"),
    )


def get_oidc_client() -> Any:
    global _client, _client_signature
    error = configuration_error(require_session=False)
    if error:
        raise RuntimeError(error)
    signature = _client_config_signature()
    if _client is not None and _client_signature == signature:
        return _client
    oauth = OAuth()
    client_secret = str(getattr(config, "OIDC_CLIENT_SECRET", "")) or None
    token_endpoint_auth_method = str(getattr(config, "OIDC_TOKEN_ENDPOINT_AUTH_METHOD", "client_secret_basic"))
    if client_secret is None and token_endpoint_auth_method.startswith("client_secret_"):
        token_endpoint_auth_method = "none"
    oauth.register(
        name="oidc",
        client_id=str(config.OIDC_CLIENT_ID),
        client_secret=client_secret,
        server_metadata_url=f"{_issuer().rstrip('/')}/.well-known/openid-configuration",
        client_kwargs={
            "scope": _scopes(),
            "code_challenge_method": "S256",
            "timeout": 10.0,
            "follow_redirects": False,
            "trust_env": False,
            "token_endpoint_auth_method": token_endpoint_auth_method,
        },
    )
    client = oauth.create_client("oidc")
    if client is None:
        raise RuntimeError("Unable to create OIDC client")
    _client = client
    _client_signature = signature
    return client


def reset_oidc_client() -> None:
    global _client, _client_signature
    _client = None
    _client_signature = None


async def validate_metadata(client: Any) -> None:
    metadata = await client.load_server_metadata()
    if metadata.get("issuer") != _issuer():
        raise RuntimeError("OIDC discovery issuer does not match configuration")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        value = metadata.get(key)
        try:
            parsed = urlsplit(str(value or ""))
        except ValueError as exc:
            raise RuntimeError(f"OIDC discovery has an invalid {key}") from exc
        if not _url_allowed(parsed):
            raise RuntimeError(f"OIDC discovery has an invalid {key}")


async def start_login(request: Request, return_to: str) -> RedirectResponse:
    client = get_oidc_client()
    await validate_metadata(client)
    request.session["oidc_return_to"] = return_to
    return await client.authorize_redirect(request, redirect_uri=redirect_uri())


def _claim_text(claims: dict, name: str) -> str | None:
    value = claims.get(name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def principal_from_claims(claims: dict, issuer: str) -> dict:
    subject = _claim_text(claims, "sub")
    if not subject:
        raise RuntimeError("OIDC token subject is missing")
    email = _claim_text(claims, str(getattr(config, "OIDC_EMAIL_CLAIM", "email")))
    if not email:
        raise RuntimeError("OIDC email claim is missing")
    name = _claim_text(claims, str(getattr(config, "OIDC_NAME_CLAIM", "name")))
    email = email.lower()
    email_verified = claims.get("email_verified") is True
    result = {
        "provider": "oidc",
        "identity_provider": "oidc",
        "issuer": issuer,
        "subject": subject,
        "email": email,
        "display_name": name,
        "email_verified": email_verified,
        "claims": claims,
    }
    return result


async def complete_login(request: Request) -> dict:
    client = get_oidc_client()
    await validate_metadata(client)
    try:
        token = await client.authorize_access_token(
            request,
            leeway=max(0, int(getattr(config, "OIDC_CLOCK_SKEW_SECONDS", 30))),
        )
    except OAuth2Error:
        raise
    except Exception as exc:
        raise RuntimeError("OIDC token exchange failed") from exc
    userinfo = token.get("userinfo")
    if not isinstance(userinfo, dict):
        raise RuntimeError("OIDC provider did not return verified user information")
    return principal_from_claims(dict(userinfo), _issuer())


async def verify_oidc_token(token: str, nonce: str | None = None) -> Optional[dict]:
    client = get_oidc_client()
    await validate_metadata(client)
    try:
        userinfo = await client.parse_id_token(
            {"id_token": token},
            nonce=nonce,
            claims_cls=IDToken,
            leeway=max(0, int(getattr(config, "OIDC_CLOCK_SKEW_SECONDS", 30))),
        )
        return principal_from_claims(dict(userinfo), _issuer())
    except Exception:
        logger.warning("OIDC ID-token verification failed")
        return None


async def logout_redirect(request: Request) -> str | None:
    client = get_oidc_client()
    await validate_metadata(client)
    try:
        result = await client.create_logout_url(
            post_logout_redirect_uri=str(getattr(config, "FRONTEND_BASE_URL", "") or ""),
        )
    except Exception:
        return None
    return result.get("url") if isinstance(result, dict) else None
