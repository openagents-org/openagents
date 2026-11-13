"""OAuth 2.1 authorization server for the agent hub, plus key management.

Lets ChatGPT, Claude and other MCP clients connect to a person's OpenAgents
account: the client registers itself (RFC 7591), sends the person to the
consent page, and exchanges the code (PKCE S256 only) for an access token the
MCP endpoint accepts. The consent page itself lives in the web app
(`/oauth/authorize`), where the person is already signed in; it calls
`POST /v1/oauth/approve` with their normal session.

    GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
    GET  /.well-known/oauth-authorization-server        RFC 8414
    POST /oauth/register                                dynamic client registration
    GET  /oauth/authorize                               validates, then redirects to the consent page
    POST /v1/oauth/approve                              consent page → authorization code
    POST /oauth/token                                   authorization_code / refresh_token
    POST /oauth/revoke                                  RFC 7009

    GET    /v1/account/hub-credentials                  keys and connected apps
    POST   /v1/account/api-keys                         create a personal API key
    DELETE /v1/account/hub-credentials/{id}             revoke a key / disconnect an app
"""
import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.config import config
from app.database import get_db
from app.models import OAuthAuthorizationCode, OAuthClient, PersonalAccessToken
from app.response import ResponseCode, json_response, success_response
from app.services.hub_auth import (
    MAX_ACTIVE_KEYS,
    create_api_key,
    hash_secret,
    issue_oauth_tokens,
    rotate_refresh_token,
)

router = APIRouter(tags=["Agent hub OAuth"])

SCOPE = "agents"
CODE_TTL = timedelta(minutes=10)
MAX_REDIRECT_URIS = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _base() -> str:
    return config.PUBLIC_API_BASE.rstrip("/")


# ── Discovery ──────────────────────────────────────────────────────────────

def _resource_metadata():
    base = _base()
    return {
        "resource": f"{base}/mcp",
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
        "scopes_supported": [SCOPE],
        "resource_name": "OpenAgents",
        "resource_documentation": f"{base}/v1/hub/docs",
    }


@router.get("/.well-known/oauth-protected-resource")
def protected_resource_metadata():
    return _resource_metadata()


@router.get("/.well-known/oauth-protected-resource/mcp")
def protected_resource_metadata_mcp():
    return _resource_metadata()


@router.get("/.well-known/oauth-authorization-server")
def authorization_server_metadata():
    base = _base()
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [SCOPE],
        "service_documentation": f"{base}/v1/hub/docs",
    }


# ── Registration ───────────────────────────────────────────────────────────

def _valid_redirect(uri: str) -> bool:
    try:
        parsed = urlparse(uri)
    except ValueError:
        return False
    if parsed.fragment or not parsed.netloc:
        return False
    if parsed.scheme == "https":
        return True
    # Native and CLI clients listen on loopback (RFC 8252).
    return parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")


def _oauth_error(error: str, description: str, status: int = 400):
    return JSONResponse(status_code=status, content={"error": error, "error_description": description},
                        headers={"Cache-Control": "no-store"})


@router.post("/oauth/register")
async def register_client(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
    except ValueError:
        return _oauth_error("invalid_client_metadata", "Body must be JSON")
    if not isinstance(body, dict):
        return _oauth_error("invalid_client_metadata", "Body must be a JSON object")
    uris = body.get("redirect_uris")
    if (not isinstance(uris, list) or not uris or len(uris) > MAX_REDIRECT_URIS
            or not all(isinstance(u, str) and len(u) <= 2000 and _valid_redirect(u) for u in uris)):
        return _oauth_error("invalid_redirect_uri", "redirect_uris must be https URLs (or http on localhost)")
    method = body.get("token_endpoint_auth_method") or "none"
    if method != "none":
        return _oauth_error("invalid_client_metadata", "Only public clients (token_endpoint_auth_method=none) are supported")
    name = str(body.get("client_name") or "").strip()[:80] or urlparse(uris[0]).hostname or "MCP client"
    client = OAuthClient(client_id="oac_" + secrets.token_urlsafe(18), client_name=name, redirect_uris=uris)
    db.add(client)
    db.commit()
    return JSONResponse(status_code=201, content={
        "client_id": client.client_id,
        "client_id_issued_at": int(_now().timestamp()),
        "client_name": name,
        "redirect_uris": uris,
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": SCOPE,
    })


# ── Authorization ──────────────────────────────────────────────────────────

def _check_authorize(db, client_id, redirect_uri, response_type, code_challenge, code_challenge_method):
    """(client, None) when the request may proceed, else (None, error message)."""
    client = db.get(OAuthClient, client_id) if client_id else None
    if client is None:
        return None, "Unknown client. Remove the connector and add it again."
    if not redirect_uri or redirect_uri not in (client.redirect_uris or []):
        return None, "This redirect address is not registered for the client."
    if response_type != "code":
        return None, "response_type must be code"
    if not code_challenge or code_challenge_method != "S256":
        return None, "PKCE with S256 is required"
    return client, None


@router.get("/oauth/authorize")
def authorize(
    client_id: Optional[str] = Query(None), redirect_uri: Optional[str] = Query(None),
    response_type: Optional[str] = Query(None), code_challenge: Optional[str] = Query(None),
    code_challenge_method: Optional[str] = Query(None), state: Optional[str] = Query(None),
    scope: Optional[str] = Query(None), resource: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    client, problem = _check_authorize(db, client_id, redirect_uri, response_type, code_challenge, code_challenge_method)
    if problem:
        # Without a trusted redirect we must not bounce back to the client.
        return PlainTextResponse(f"OpenAgents could not start the sign-in: {problem}", status_code=400)
    params = {"client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
              "code_challenge": code_challenge, "code_challenge_method": "S256", "client_name": client.client_name}
    if state:
        params["state"] = state
    return RedirectResponse(f"{config.FRONTEND_BASE_URL.rstrip('/')}/oauth/authorize?{urlencode(params)}", status_code=302)


class ApproveRequest(BaseModel):
    client_id: str
    redirect_uri: str
    code_challenge: str
    code_challenge_method: str = "S256"
    state: Optional[str] = None
    approve: bool = True


@router.post("/v1/oauth/approve")
def approve(body: ApproveRequest, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in first")
    client, problem = _check_authorize(db, body.client_id, body.redirect_uri, "code",
                                       body.code_challenge, body.code_challenge_method)
    if problem:
        return json_response(ResponseCode.BAD_REQUEST, problem)
    query = {"state": body.state} if body.state else {}
    if not body.approve:
        query = {"error": "access_denied", **query}
    else:
        code = secrets.token_urlsafe(32)
        db.add(OAuthAuthorizationCode(
            code_hash=hash_secret(code), client_id=client.client_id, user_id=user.id,
            redirect_uri=body.redirect_uri, code_challenge=body.code_challenge, expires_at=_now() + CODE_TTL,
        ))
        query = {"code": code, **query}
    db.commit()
    separator = "&" if urlparse(body.redirect_uri).query else "?"
    return success_response({"redirect": f"{body.redirect_uri}{separator}{urlencode(query)}",
                             "client_name": client.client_name})


# ── Tokens ─────────────────────────────────────────────────────────────────

def _pkce_matches(verifier: str, challenge: str) -> bool:
    if not verifier or not 43 <= len(verifier) <= 128:
        return False
    digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return secrets.compare_digest(digest, challenge)


async def _form(request: Request) -> dict:
    raw = (await request.body()).decode("utf-8", "replace")
    if "json" in (request.headers.get("content-type") or ""):
        import json
        try:
            data = json.loads(raw)
            return {k: str(v) for k, v in data.items()} if isinstance(data, dict) else {}
        except ValueError:
            return {}
    return {k: v[0] for k, v in parse_qs(raw).items()}


@router.post("/oauth/token")
async def token(request: Request, db: Session = Depends(get_db)):
    form = await _form(request)
    grant = form.get("grant_type")
    client_id = form.get("client_id") or ""
    client = db.get(OAuthClient, client_id) if client_id else None
    if client is None:
        return _oauth_error("invalid_client", "Unknown client_id", 401)
    if grant == "authorization_code":
        row = db.execute(select(OAuthAuthorizationCode).where(
            OAuthAuthorizationCode.code_hash == hash_secret(form.get("code") or ""),
        ).with_for_update()).scalar_one_or_none()
        if (row is None or row.used_at is not None or _aware(row.expires_at) <= _now()
                or row.client_id != client.client_id or row.redirect_uri != form.get("redirect_uri")):
            return _oauth_error("invalid_grant", "The authorization code is invalid or expired")
        if not _pkce_matches(form.get("code_verifier") or "", row.code_challenge):
            return _oauth_error("invalid_grant", "code_verifier does not match")
        row.used_at = _now()
        tokens = issue_oauth_tokens(db, row.user_id, client.client_id, client.client_name)
        db.commit()
        return JSONResponse(tokens, headers={"Cache-Control": "no-store"})
    if grant == "refresh_token":
        tokens = rotate_refresh_token(db, form.get("refresh_token") or "", client.client_id)
        if tokens is None:
            db.rollback()
            return _oauth_error("invalid_grant", "The refresh token is invalid, expired or revoked")
        db.commit()
        return JSONResponse(tokens, headers={"Cache-Control": "no-store"})
    return _oauth_error("unsupported_grant_type", "Use authorization_code or refresh_token")


@router.post("/oauth/revoke")
async def revoke(request: Request, db: Session = Depends(get_db)):
    raw = (await _form(request)).get("token") or ""
    digest = hash_secret(raw)
    row = db.execute(select(PersonalAccessToken).where(
        (PersonalAccessToken.token_hash == digest) | (PersonalAccessToken.refresh_hash == digest),
    )).scalar_one_or_none()
    if row is not None and row.revoked_at is None:
        row.revoked_at = _now()
        db.commit()
    # RFC 7009: unknown tokens are not an error.
    return JSONResponse({}, status_code=200)


# ── Key management for the signed-in person ────────────────────────────────

class CreateKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return _aware(value).isoformat() if value else None


@router.get("/v1/account/hub-credentials")
def list_credentials(db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in first")
    rows = db.execute(select(PersonalAccessToken).where(
        PersonalAccessToken.user_id == user.id, PersonalAccessToken.revoked_at.is_(None),
    ).order_by(PersonalAccessToken.created_at.desc())).scalars().all()
    now = _now()
    keys, apps = [], {}
    for row in rows:
        if row.kind == "api_key":
            keys.append({"id": row.id, "name": row.name, "prefix": row.token_prefix,
                         "created_at": _iso(row.created_at), "last_used_at": _iso(row.last_used_at)})
        elif row.refresh_expires_at is None or _aware(row.refresh_expires_at) > now:
            app = apps.setdefault(row.client_id, {"id": row.id, "client_id": row.client_id, "name": row.name,
                                                  "connected_at": _iso(row.created_at), "last_used_at": None})
            if row.last_used_at and (app["last_used_at"] is None or _iso(row.last_used_at) > app["last_used_at"]):
                app["last_used_at"] = _iso(row.last_used_at)
    return success_response({"api_keys": keys, "connected_apps": list(apps.values()),
                             "mcp_url": f"{_base()}/mcp", "docs_url": f"{_base()}/v1/hub/docs"})


@router.post("/v1/account/api-keys")
def create_key(body: CreateKeyRequest, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in first")
    active = db.execute(select(PersonalAccessToken.id).where(
        PersonalAccessToken.user_id == user.id, PersonalAccessToken.kind == "api_key",
        PersonalAccessToken.revoked_at.is_(None),
    )).all()
    if len(active) >= MAX_ACTIVE_KEYS:
        return json_response(ResponseCode.BAD_REQUEST, f"You can have up to {MAX_ACTIVE_KEYS} keys. Revoke one first.")
    row, raw = create_api_key(db, user, body.name.strip())
    db.commit()
    return success_response({"id": row.id, "name": row.name, "prefix": row.token_prefix, "key": raw,
                             "created_at": _iso(row.created_at)})


@router.delete("/v1/account/hub-credentials/{credential_id}")
def revoke_credential(credential_id: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in first")
    row = db.get(PersonalAccessToken, credential_id)
    if row is None or row.user_id != user.id:
        return json_response(ResponseCode.NOT_FOUND, "Not found")
    now = _now()
    if row.kind == "oauth":
        # Disconnecting an app ends every token it holds for this person.
        for other in db.execute(select(PersonalAccessToken).where(
            PersonalAccessToken.user_id == user.id, PersonalAccessToken.client_id == row.client_id,
            PersonalAccessToken.revoked_at.is_(None),
        )).scalars():
            other.revoked_at = now
    else:
        row.revoked_at = row.revoked_at or now
    db.commit()
    return success_response({"revoked": True})
