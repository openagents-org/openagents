import app.routers.public_profiles as profile_routes
from app.models import User


SETTINGS = "/v1/account/public-profile"


def test_profiles_are_opt_in_and_public_response_is_allowlisted(client, db, monkeypatch):
    user = User(email="maya@example.test", display_name="Maya Chen", avatar_url="https://example.test/private.png")
    db.add(user)
    db.commit()
    monkeypatch.setattr(profile_routes, "resolve_current_user", lambda session, auth: session.get(User, user.id) if auth else None)
    headers = {"Authorization": "Bearer test-user"}
    assert client.put(SETTINGS, json={"handle": "maya-chen"}).status_code == 401
    assert client.get(SETTINGS, headers=headers).json()["data"] == {"handle": None, "bio": "", "isPublic": False}
    assert client.put(SETTINGS, headers=headers, json={"handle": " Maya-Chen "}).status_code == 200
    assert client.get("/v1/profiles/maya-chen").status_code == 404

    body = {"handle": "maya-chen", "bio": "Designs developer tools", "is_public": True}
    assert client.put(SETTINGS, headers=headers, json=body).status_code == 200
    response = client.get("/v1/profiles/MAYA-CHEN")
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["data"] == {
        "handle": "maya-chen", "displayName": "Maya Chen",
        "bio": "Designs developer tools", "avatarUrl": None,
    }
    assert client.put(SETTINGS, headers=headers, json={"handle": "maya-new"}).status_code == 409
    assert client.put(SETTINGS, headers=headers, json={**body, "is_public": False}).status_code == 200
    assert client.get("/v1/profiles/maya-chen").status_code == 404


def test_handle_is_unique_even_for_accounts_without_workspace_membership(client, db, monkeypatch):
    first = User(email="first@example.test")
    second = User(email="second@example.test")
    db.add_all([first, second])
    db.commit()
    identities = {"Bearer first": first.id, "Bearer second": second.id}
    monkeypatch.setattr(profile_routes, "resolve_current_user", lambda session, auth: session.get(User, identities[auth]))
    first_auth = {"Authorization": "Bearer first"}
    second_auth = {"Authorization": "Bearer second"}
    assert client.put(SETTINGS, headers=first_auth, json={"handle": "OpenAgents"}).status_code == 400
    assert client.put(SETTINGS, headers=first_auth, json={"handle": "my-handle"}).status_code == 200
    response = client.put(SETTINGS, headers=second_auth, json={"handle": "MY-HANDLE"})
    assert response.status_code == 409
    assert client.get(SETTINGS, headers=second_auth).json()["data"]["handle"] is None
