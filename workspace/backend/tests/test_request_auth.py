"""Authentication work is shared within a request, never across requests."""
import asyncio
from contextvars import copy_context
from unittest.mock import Mock

import anyio
import pytest
from firebase_admin import auth
from sqlalchemy import event, update

from app import firebase_auth as fa
from app.access import resolve_user_role
from app.models import User, Workspace, WorkspaceMembership
from app.request_auth import RequestAuthMiddleware


async def _request(fn):
    async def app(scope, receive, send):
        await anyio.to_thread.run_sync(fn)
    await RequestAuthMiddleware(app)({"type": "http"}, None, None)


@pytest.fixture
def sdk(monkeypatch):
    monkeypatch.setattr(fa, "_init_firebase", lambda: True)
    verify = Mock(return_value={"email": "a@example.com", "uid": "uid-a", "name": "Alice",
                               "email_verified": True})
    monkeypatch.setattr(auth, "verify_id_token", verify)
    return verify


def test_claims_use_one_sdk_verification_even_outside_http(sdk):
    assert fa.verify_firebase_claims("token") == {
        "provider": "firebase", "email": "a@example.com", "firebase_uid": "uid-a",
        "display_name": "Alice", "email_verified": True,
    }
    sdk.assert_called_once_with("token", check_revoked=False)


def test_email_and_claims_reuse_verification_in_sync_worker(sdk):
    def check():
        assert fa.verify_identity_token("token") == "a@example.com"
        claims = fa.verify_identity_claims("token")
        claims["email"] = "tampered@example.com"
        assert fa.verify_identity_claims("token")["email"] == "a@example.com"
        assert fa.verify_firebase_token("token") == "a@example.com"
    asyncio.run(_request(check))
    assert sdk.call_count == 1
    asyncio.run(_request(check))
    assert sdk.call_count == 2


def test_expired_token_is_rechecked_on_next_request(sdk, monkeypatch):
    monkeypatch.setattr(fa, "verify_apple_claims", lambda _: None)
    asyncio.run(_request(lambda: fa.verify_identity_claims("token")))
    sdk.side_effect = ValueError("expired")
    def check():
        assert fa.verify_identity_token("token") is None
        assert fa.verify_identity_claims("token") is None
    asyncio.run(_request(check))
    assert sdk.call_count == 2


@pytest.mark.parametrize("result", [None, {"uid": "missing-email"}])
def test_invalid_identity_fails_closed(sdk, monkeypatch, result):
    sdk.return_value = result
    monkeypatch.setattr(fa, "verify_apple_claims", lambda _: None)
    asyncio.run(_request(lambda: _assert_no_identity()))
    assert sdk.call_count == 1


def _assert_no_identity():
    assert fa.verify_identity_claims("bad") is None
    assert fa.verify_identity_token("bad") is None


def test_concurrent_requests_do_not_share_cache(sdk):
    async def run():
        ready = asyncio.Event()
        count = 0
        async def app(scope, receive, send):
            nonlocal count
            await anyio.to_thread.run_sync(fa.verify_identity_claims, "same-token")
            count += 1
            if count == 2:
                ready.set()
            await ready.wait()
            assert fa.verify_identity_token("same-token") == "a@example.com"
        middleware = RequestAuthMiddleware(app)
        await asyncio.gather(*(middleware({"type": "http"}, None, None) for _ in range(2)))
    asyncio.run(run())
    assert sdk.call_count == 2


def test_response_start_and_inherited_context_cannot_reuse_cache(sdk):
    saved = []
    async def run():
        async def app(scope, receive, send):
            fa.verify_identity_claims("token")
            saved.append(copy_context())
            await send({"type": "http.response.start", "status": 200})
            fa.verify_identity_claims("token")
        async def send(message):
            pass
        await RequestAuthMiddleware(app)({"type": "http"}, None, send)
    asyncio.run(run())
    saved[0].run(fa.verify_identity_claims, "token")
    assert sdk.call_count == 3


def test_exception_also_discards_request_identity(sdk):
    def fail():
        fa.verify_identity_claims("token")
        raise RuntimeError("endpoint failed")
    with pytest.raises(RuntimeError):
        asyncio.run(_request(fail))
    fa.verify_identity_claims("token")
    assert sdk.call_count == 2


def test_roles_reused_but_writes_and_transaction_boundaries_invalidate(db, sdk):
    ws = Workspace(name="A", slug="auth-a", password_hash="secret")
    user = User(email="a@example.com")
    db.add_all([ws, user]); db.flush()
    member = WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="member")
    db.add(member); db.commit()
    # Avoid attribute-expiry SELECTs polluting the query-count assertion.
    _ = ws.id, member.user_id
    selects = []
    def capture(conn, cursor, sql, params, context, many):
        if sql.startswith("SELECT"):
            selects.append(sql)
    event.listen(db.bind, "before_cursor_execute", capture)
    def check():
        assert resolve_user_role(db, ws, "Bearer token") == "member"
        first = len(selects)
        assert first == 2  # user + membership
        assert resolve_user_role(db, ws, "Bearer token") == "member"
        assert len(selects) == first
        # Pending ORM changes bypass reuse; flushing a revocation invalidates it.
        member.role = "viewer"
        db.flush()
        assert resolve_user_role(db, ws, "Bearer token") == "viewer"
        # Bulk updates invalidate it too.
        db.execute(update(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == ws.id).values(role="guest"))
        assert resolve_user_role(db, ws, "Bearer token") == "guest"
        db.rollback()
        assert resolve_user_role(db, ws, "Bearer token") == "member"
    try:
        asyncio.run(_request(check))
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert sdk.call_count == 1


def test_roles_are_scoped_to_workspace_and_bearer(db, monkeypatch):
    import app.access as access
    monkeypatch.setattr(access, "verify_identity_claims", lambda token: {"email": token})
    a = Workspace(name="A", slug="auth-a", creator_email="alice@example.com")
    b = Workspace(name="B", slug="auth-b", creator_email="bob@example.com")
    db.add_all([a, b]); db.commit()
    def check():
        assert resolve_user_role(db, a, "Bearer alice@example.com") == "owner"
        assert resolve_user_role(db, a, "Bearer bob@example.com") is None
        assert resolve_user_role(db, b, "Bearer alice@example.com") is None
        assert resolve_user_role(db, b, "Bearer bob@example.com") == "owner"
    asyncio.run(_request(check))


def test_real_event_poll_verifies_firebase_only_once(client, workspace, db, sdk):
    db.add(User(email="a@example.com", firebase_uid="uid-a", display_name="Alice"))
    db.flush()
    user = db.query(User).filter_by(email="a@example.com").one()
    db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role="member"))
    db.commit()
    response = client.get("/v1/events", params={"network": workspace["id"],
                          "type": "workspace.message"},
                          headers={"Authorization": "Bearer token"})
    assert response.status_code == 200
    sdk.assert_called_once_with("token", check_revoked=False)


def test_distinct_bearers_do_not_share_verified_identity(sdk):
    sdk.side_effect = lambda token, **_: {"email": f"{token}@example.com"}
    def check():
        assert fa.verify_identity_token("alice") == "alice@example.com"
        assert fa.verify_identity_token("bob") == "bob@example.com"
        assert fa.verify_identity_claims("alice")["email"] == "alice@example.com"
    asyncio.run(_request(check))
    assert sdk.call_count == 2


def test_apple_identity_is_reused_only_within_request(monkeypatch):
    monkeypatch.setattr(fa, "verify_firebase_claims", lambda _: None)
    apple = Mock(return_value={"email": "apple@example.com", "provider": "apple"})
    monkeypatch.setattr(fa, "verify_apple_claims", apple)
    def check():
        assert fa.verify_identity_token("apple") == "apple@example.com"
        assert fa.verify_identity_claims("apple")["provider"] == "apple"
    asyncio.run(_request(check))
    assert apple.call_count == 1
    asyncio.run(_request(check))
    assert apple.call_count == 2
