"""Agent hub: personal API keys, the hub REST API, the MCP endpoint and OAuth."""

import base64
import hashlib
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app.config import config
from app.firebase_auth import mint_workspace_session
from app.models import Channel, EventRecord, User, WorkspaceMembership


@pytest.fixture(autouse=True)
def session_secret(monkeypatch):
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "test-session-secret-at-least-32-bytes")


@pytest.fixture(autouse=True)
def no_cloud_dispatch():
    with patch("app.services.cloud_agent.invoke_cloud_agents", new_callable=AsyncMock):
        yield


@pytest.fixture
def person(db, workspace):
    user = User(email="test@example.com", display_name="Tess")
    db.add(user)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role="owner"))
    db.commit()
    token, _ = mint_workspace_session({"email": user.email, "display_name": "Tess"})
    return {"user": user, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture
def api_key(client, person):
    response = client.post("/v1/account/api-keys", headers=person["headers"], json={"name": "Muse"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["key"].startswith("oa_pk_") and data["prefix"] == data["key"][:10]
    return data


def auth(key):
    return {"Authorization": f"Bearer {key}"}


def test_hub_requires_a_hub_credential(client, person, workspace):
    assert client.get("/v1/hub/agents").status_code == 401
    # A normal web session is not a hub credential, and a workspace token is not either.
    assert client.get("/v1/hub/agents", headers=person["headers"]).status_code == 401
    response = client.get("/v1/hub/agents", headers=auth(workspace["token"]))
    assert response.status_code == 401
    assert "oauth-protected-resource" in response.headers["www-authenticate"]


def test_key_lists_workspaces_and_agents(client, api_key, workspace):
    response = client.get("/v1/hub/workspaces", headers=auth(api_key["key"]))
    assert response.status_code == 200, response.text
    assert [w["id"] for w in response.json()["data"]["workspaces"]] == [workspace["id"]]
    response = client.get("/v1/hub/agents", headers=auth(api_key["key"]))
    assert response.status_code == 200, response.text
    assert "agent-alpha" in [a["name"] for a in response.json()["data"]["agents"]]


def test_delegate_check_reply_and_list(client, db, api_key, workspace):
    response = client.post("/v1/hub/threads", headers=auth(api_key["key"]),
                           json={"task": "Summarize the open issues", "agents": ["agent-alpha"]})
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    thread = result["thread"]
    assert result["url"].endswith(f"/threads/{thread}") and result["agents"] == ["agent-alpha"]
    channel = db.execute(select(Channel).where(Channel.name == thread)).scalar_one()
    assert channel.created_by == "human:test@example.com" and channel.master_agent == "agent-alpha"
    task = db.execute(select(EventRecord).where(EventRecord.target == f"channel/{thread}",
                                                EventRecord.type == "workspace.message.posted")).scalar_one()
    assert task.source == "human:test@example.com"
    assert task.payload["content"] == "@agent-alpha Summarize the open issues"
    assert task.payload["mentions"] == ["agent-alpha"] and task.payload["hub_client"] == "API key “Muse”"

    check = client.get(f"/v1/hub/threads/{thread}", headers=auth(api_key["key"]))
    assert check.status_code == 200, check.text
    data = check.json()["data"]
    assert data["state"] == "waiting" and data["messages"][-1]["content"].endswith("Summarize the open issues")

    response = client.post(f"/v1/hub/threads/{thread}/messages", headers=auth(api_key["key"]),
                           json={"content": "Group them by label", "agents": ["agent-alpha"]})
    assert response.status_code == 200, response.text
    listed = client.get("/v1/hub/threads", headers=auth(api_key["key"])).json()["data"]["threads"]
    assert [t["thread"] for t in listed] == [thread]


def test_hub_key_is_not_a_workspace_credential(client, api_key, workspace):
    # The key opens the hub only, never the rest of the workspace API.
    response = client.get(f"/v1/discover?network={workspace['id']}", headers=auth(api_key["key"]))
    assert response.status_code in (401, 403) or response.json().get("code") in (401, 403)


def test_agent_reply_marks_the_thread_replied(client, db, api_key, workspace):
    thread = client.post("/v1/hub/threads", headers=auth(api_key["key"]),
                         json={"task": "Ping", "agents": ["agent-alpha"]}).json()["data"]["thread"]
    import time
    db.add(EventRecord(id="reply-1", network_id=workspace["id"], type="workspace.message.posted",
                       source="openagents:agent-alpha", target=f"channel/{thread}",
                       payload={"content": "Pong", "message_type": "chat"}, timestamp=int(time.time() * 1000) + 1000))
    db.commit()
    data = client.get(f"/v1/hub/threads/{thread}", headers=auth(api_key["key"])).json()["data"]
    assert data["state"] == "replied" and data["messages"][-1]["content"] == "Pong"
    assert data["messages"][-1]["kind"] == "agent"


def test_unknown_agent_and_empty_task_explain_the_fix(client, api_key):
    response = client.post("/v1/hub/threads", headers=auth(api_key["key"]), json={"task": "x", "agents": ["nobody"]})
    assert response.status_code == 404 and "agent-alpha" in response.json()["message"]
    response = client.post("/v1/hub/threads", headers=auth(api_key["key"]), json={"task": "   "})
    assert response.status_code == 400


def test_revoked_key_stops_working(client, person, api_key):
    listing = client.get("/v1/account/hub-credentials", headers=person["headers"]).json()["data"]
    assert [k["name"] for k in listing["api_keys"]] == ["Muse"] and "key" not in listing["api_keys"][0]
    assert listing["mcp_url"].endswith("/mcp")
    assert client.delete(f"/v1/account/hub-credentials/{api_key['id']}", headers=person["headers"]).status_code == 200
    assert client.get("/v1/hub/agents", headers=auth(api_key["key"])).status_code == 401


def test_docs_are_plain_text_for_assistants(client):
    response = client.get("/v1/hub/docs")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/markdown")
    assert "POST" in response.text and "/v1/hub/threads" in response.text


def rpc(client, key, method, params=None, msg_id=1):
    return client.post("/mcp", headers=auth(key), json={"jsonrpc": "2.0", "id": msg_id, "method": method,
                                                        **({"params": params} if params is not None else {})})


def test_mcp_initialize_list_and_delegate(client, api_key):
    assert client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"}).status_code == 401
    init = rpc(client, api_key["key"], "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                       "clientInfo": {"name": "t", "version": "1"}}).json()
    assert init["result"]["protocolVersion"] == "2025-06-18" and init["result"]["capabilities"]["tools"]
    note = client.post("/mcp", headers=auth(api_key["key"]),
                       json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert note.status_code == 202
    tools = {t["name"] for t in rpc(client, api_key["key"], "tools/list").json()["result"]["tools"]}
    assert {"list_agents", "delegate_task", "check_thread", "reply_to_thread"} <= tools
    call = rpc(client, api_key["key"], "tools/call",
               {"name": "delegate_task", "arguments": {"task": "Draft release notes", "agents": ["agent-alpha"]}}).json()
    assert call["result"]["isError"] is False and call["result"]["structuredContent"]["thread"]
    missing = rpc(client, api_key["key"], "tools/call",
                  {"name": "check_thread", "arguments": {"thread": "no-such-thread"}}).json()
    assert missing["result"]["isError"] is True
    assert rpc(client, api_key["key"], "nope").json()["error"]["code"] == -32601


def pkce():
    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def test_oauth_flow_from_registration_to_mcp(client, person):
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert client.get("/.well-known/oauth-protected-resource").json()["resource"].endswith("/mcp")

    reg = client.post("/oauth/register", json={"client_name": "ChatGPT",
                                               "redirect_uris": ["https://chatgpt.com/connector/oauth/cb"]})
    assert reg.status_code == 201, reg.text
    client_id = reg.json()["client_id"]
    assert client.post("/oauth/register", json={"redirect_uris": ["http://evil.example/cb"]}).status_code == 400

    verifier, challenge = pkce()
    params = {"client_id": client_id, "redirect_uri": "https://chatgpt.com/connector/oauth/cb", "response_type": "code",
              "code_challenge": challenge, "code_challenge_method": "S256", "state": "xyz"}
    redirect = client.get("/oauth/authorize", params=params, follow_redirects=False)
    assert redirect.status_code == 302 and "/oauth/authorize?" in redirect.headers["location"]
    assert "client_name=ChatGPT" in redirect.headers["location"]
    bad = client.get("/oauth/authorize", params={**params, "redirect_uri": "https://evil.example/cb"},
                     follow_redirects=False)
    assert bad.status_code == 400

    approved = client.post("/v1/oauth/approve", headers=person["headers"], json={
        "client_id": client_id, "redirect_uri": params["redirect_uri"], "code_challenge": challenge, "state": "xyz"})
    assert approved.status_code == 200, approved.text
    query = parse_qs(urlparse(approved.json()["data"]["redirect"]).query)
    assert query["state"] == ["xyz"]
    code = query["code"][0]

    wrong = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": client_id,
                                              "redirect_uri": params["redirect_uri"], "code_verifier": "w" * 64})
    assert wrong.status_code == 400
    tokens = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": client_id,
                                               "redirect_uri": params["redirect_uri"], "code_verifier": verifier})
    assert tokens.status_code == 200, tokens.text
    tokens = tokens.json()
    assert tokens["access_token"].startswith("oa_at_") and tokens["refresh_token"].startswith("oa_rt_")
    # Codes are single-use.
    again = client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": client_id,
                                              "redirect_uri": params["redirect_uri"], "code_verifier": verifier})
    assert again.status_code == 400

    assert rpc(client, tokens["access_token"], "tools/list").status_code == 200
    refreshed = client.post("/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id,
                                                  "refresh_token": tokens["refresh_token"]}).json()
    assert rpc(client, tokens["access_token"], "tools/list").status_code == 401
    assert rpc(client, refreshed["access_token"], "tools/list").status_code == 200

    apps = client.get("/v1/account/hub-credentials", headers=person["headers"]).json()["data"]["connected_apps"]
    assert [a["name"] for a in apps] == ["ChatGPT"]
    client.delete(f"/v1/account/hub-credentials/{apps[0]['id']}", headers=person["headers"])
    assert rpc(client, refreshed["access_token"], "tools/list").status_code == 401


def test_denied_consent_returns_access_denied(client, person):
    client_id = client.post("/oauth/register", json={"redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]}).json()["client_id"]
    _, challenge = pkce()
    denied = client.post("/v1/oauth/approve", headers=person["headers"], json={
        "client_id": client_id, "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
        "code_challenge": challenge, "approve": False}).json()["data"]["redirect"]
    assert parse_qs(urlparse(denied).query)["error"] == ["access_denied"]
